import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../env';
import { GeminiProvider, OpenAiProvider } from './providers';
import type { AiJsonRequest } from './router';

const request: AiJsonRequest = {
  feature: 'complex_planning',
  actorId: 'test-user',
  prompt: 'Return an object.',
  schemaName: 'test_response',
  schema: { type: 'object' },
  useWebSearch: false,
};

afterEach(() => vi.unstubAllGlobals());

describe('provider API-key rotation', () => {
  it('rotates Gemini keys only after a 429 and keeps the successful fallback active', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ error: { message: 'Rate limit exceeded' } }, 429))
      .mockResolvedValueOnce(geminiResponse({ source: 'backup-key' }))
      .mockResolvedValueOnce(geminiResponse({ source: 'backup-key' }));
    vi.stubGlobal('fetch', fetch);

    const provider = new GeminiProvider({
      GEMINI_API_KEY: 'primary-key',
      // Include the primary key again to prove list entries are deduplicated.
      GEMINI_API_KEYS: 'primary-key, backup-key',
    } as Env);

    await expect(provider.generateJson(request)).resolves.toEqual({ source: 'backup-key' });
    await expect(provider.generateJson(request)).resolves.toEqual({ source: 'backup-key' });

    expect(fetch).toHaveBeenCalledTimes(3);
    const keys = (fetch.mock.calls as unknown as Array<[string | URL | Request]>).map(([input]) => {
      const url = input instanceof Request ? input.url : String(input);
      return new URL(url).searchParams.get('key');
    });
    expect(keys).toEqual(['primary-key', 'backup-key', 'backup-key']);
  });

  it('does not spend a backup OpenAI key for a non-429 provider failure', async () => {
    const fetch = vi.fn().mockResolvedValue(jsonResponse({ error: { message: 'Upstream unavailable' } }, 503));
    vi.stubGlobal('fetch', fetch);

    const provider = new OpenAiProvider({
      OPENAI_API_KEY: 'primary-key',
      OPENAI_API_KEYS: 'backup-key',
    } as Env);

    await expect(provider.generateJson(request)).rejects.toThrow('openai returned 503: Upstream unavailable');
    expect(fetch).toHaveBeenCalledTimes(1);
    const init = (fetch.mock.calls as unknown as Array<[string | URL | Request, RequestInit]>)[0]?.[1];
    expect(new Headers(init?.headers).get('authorization')).toBe('Bearer primary-key');
  });

  it('treats a backup-only configured provider as available', () => {
    expect(new GeminiProvider({ GEMINI_API_KEYS: 'backup-key' } as Env).isConfigured()).toBe(true);
  });
});

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function geminiResponse(payload: unknown): Response {
  return jsonResponse({
    candidates: [{ content: { parts: [{ text: JSON.stringify(payload) }] } }],
  });
}
