import { describe, expect, it } from 'vitest';
import type { AiFeature, Env } from '../env';
import {
  AiRouter,
  FeatureCapExceededError,
  type AiJsonRequest,
  type AiProvider,
  type FeatureCapStore,
} from './router';

class TestCapStore implements FeatureCapStore {
  constructor(private readonly allowed = true) {}

  async consume(): Promise<boolean> {
    return this.allowed;
  }
}

function provider(
  name: AiProvider['name'],
  calls: string[],
  behaviour: 'success' | 'failure',
): AiProvider {
  return {
    name,
    isConfigured: () => true,
    async generateJson() {
      calls.push(name);
      if (behaviour === 'failure') throw new Error(`${name} unavailable`);
      return { provider: name };
    },
  };
}

const request: AiJsonRequest = {
  feature: 'hotel_comparison',
  actorId: 'test-user',
  prompt: 'test',
  schemaName: 'test',
  schema: {},
  useWebSearch: true,
};

describe('AI fallback routing', () => {
  it('uses Gemini then OpenAI before free fallbacks for complex work', async () => {
    const calls: string[] = [];
    const router = new AiRouter(
      {} as Env,
      new TestCapStore(),
      [
        provider('openrouter', calls, 'success'),
        provider('groq', calls, 'success'),
        provider('openai', calls, 'success'),
        provider('gemini', calls, 'failure'),
      ],
    );

    await expect(router.generateJson(request)).resolves.toEqual({ provider: 'openai' });
    expect(calls).toEqual(['gemini', 'openai']);
  });

  it('uses Groq before OpenRouter for city-guide work', async () => {
    const calls: string[] = [];
    const router = new AiRouter(
      {} as Env,
      new TestCapStore(),
      [provider('openrouter', calls, 'success'), provider('groq', calls, 'success')],
    );

    await router.generateJson({ ...request, feature: 'city_guide' as AiFeature });
    expect(calls).toEqual(['groq']);
  });

  it('uses Groq before OpenRouter for inexpensive itinerary skeletons', async () => {
    const calls: string[] = [];
    const router = new AiRouter(
      {} as Env,
      new TestCapStore(),
      [provider('openrouter', calls, 'success'), provider('groq', calls, 'success'), provider('gemini', calls, 'success')],
    );

    await router.generateJson({ ...request, feature: 'itinerary_skeleton' });
    expect(calls).toEqual(['groq']);
  });

  it('uses Groq before OpenRouter for small voice intake extraction', async () => {
    const calls: string[] = [];
    const router = new AiRouter(
      {} as Env,
      new TestCapStore(),
      [provider('openrouter', calls, 'success'), provider('groq', calls, 'success'), provider('gemini', calls, 'success')],
    );

    await router.generateJson({ ...request, feature: 'voice_trip_intake' });
    expect(calls).toEqual(['groq']);
  });

  it('tries the next provider when the first JSON response fails feature validation', async () => {
    const calls: string[] = [];
    const router = new AiRouter(
      {} as Env,
      new TestCapStore(),
      [
        { ...provider('groq', calls, 'success'), generateJson: async () => { calls.push('groq'); return { missing: true }; } },
        { ...provider('openrouter', calls, 'success'), generateJson: async () => { calls.push('openrouter'); return { ok: true }; } },
      ],
    );

    const result = await router.generateJson(
      { ...request, feature: 'itinerary_skeleton' },
      (value) => {
        if (!(value as { ok?: boolean }).ok) throw new Error('schema validation failed');
        return value as { ok: true };
      },
    );

    expect(result).toEqual({ ok: true });
    expect(calls).toEqual(['groq', 'openrouter']);
  });

  it('blocks work once the feature cap is exhausted', async () => {
    const router = new AiRouter(
      {} as Env,
      new TestCapStore(false),
      [provider('gemini', [], 'success')],
    );
    await expect(router.generateJson(request)).rejects.toBeInstanceOf(FeatureCapExceededError);
  });
});
