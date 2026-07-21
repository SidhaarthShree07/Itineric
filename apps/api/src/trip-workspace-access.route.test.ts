import { describe, expect, it } from 'vitest';
import type { Env } from './env';
import worker from './index';

describe('trip workspace access', () => {
  it('does not create or expose a planning workspace when a browser has no workspace token', async () => {
    const response = await worker.fetch(
      new Request('https://api.example.test/v1/trips'),
      { HOTEL_COMPARISON_CACHE: {} as KVNamespace } as Env,
      {} as ExecutionContext,
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'WORKSPACE_UNAUTHORIZED' },
    });
  });
});
