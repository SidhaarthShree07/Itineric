import { describe, expect, it } from 'vitest';
import type { Env } from './env';
import worker from './index';

class MemoryKv {
  private readonly values = new Map<string, string>();

  async get(key: string): Promise<string | null> { return this.values.get(key) ?? null; }
  async put(key: string, value: string): Promise<void> { this.values.set(key, value); }
}

describe('voice trip intake route', () => {
  it('accepts an approved transcript without a browser-exposed provider key', async () => {
    const response = await worker.fetch(
      new Request('https://api.example.test/v1/trip-intake/voice', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'cf-connecting-ip': '198.51.100.20' },
        body: JSON.stringify({ transcript: 'A relaxed weekend in Lisbon for two people.' }),
      }),
      { HOTEL_COMPARISON_CACHE: new MemoryKv() as unknown as KVNamespace } as Env,
      {} as ExecutionContext,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      transcript: 'A relaxed weekend in Lisbon for two people.',
      draft: {},
    });
  });

  it('rejects an empty transcript before any AI work is attempted', async () => {
    const response = await worker.fetch(
      new Request('https://api.example.test/v1/trip-intake/voice', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ transcript: ' ' }),
      }),
      { HOTEL_COMPARISON_CACHE: new MemoryKv() as unknown as KVNamespace } as Env,
      {} as ExecutionContext,
    );

    expect(response.status).toBe(400);
  });
});
