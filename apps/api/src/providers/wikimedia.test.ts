import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../env';
import { WikimediaMediaProvider } from './wikimedia';

describe('WikimediaMediaProvider', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('returns only credited, licensed Commons images and caches page-image lookups', async () => {
    const cache = new MemoryKv();
    const fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      if (url.hostname === 'en.wikipedia.org') {
        return jsonResponse({ query: {
          redirects: [{ from: 'Louvre Museum', to: 'Louvre' }],
          pages: { '1': { title: 'Louvre', pageimage: 'Louvre_Museum.jpg', thumbnail: { source: 'https://upload.wikimedia.org/louvre.jpg' } } },
        } });
      }
      if (url.hostname === 'commons.wikimedia.org') {
        return jsonResponse({ query: { pages: { '2': { title: 'File:Louvre Museum.jpg', imageinfo: [{ thumburl: 'https://upload.wikimedia.org/louvre-960.jpg', extmetadata: { LicenseShortName: { value: 'CC BY-SA 4.0' }, Artist: { value: '<a>Jane Photographer</a>' }, Credit: { value: 'Wikimedia Commons' } } }] } } } });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetch);
    const provider = new WikimediaMediaProvider({ HOTEL_COMPARISON_CACHE: cache as unknown as KVNamespace } as Env);

    const first = await provider.attractionMedia(['Louvre Museum']);
    const second = await provider.attractionMedia(['Louvre Museum']);

    expect(first[0]).toMatchObject({ title: 'Louvre Museum', imageUrl: 'https://upload.wikimedia.org/louvre-960.jpg' });
    expect(first[0]?.evidence).toMatchObject({ source: 'wikimedia', licence: 'CC BY-SA 4.0', attribution: 'Jane Photographer · Wikimedia Commons · via Wikimedia Commons', freshness: 'static' });
    expect(second).toEqual(first);
    expect(fetch).toHaveBeenCalledTimes(2);
    const headers = new Headers(fetch.mock.calls[0]?.[1]?.headers);
    expect(headers.get('user-agent')).toBe('Project Atlas/1.0 (travel planning media attribution)');
    expect(headers.get('api-user-agent')).toBeNull();
  });

  it('uses Wikipedia geosearch when a destination page has no image', async () => {
    const fetch = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      if (url.hostname === 'en.wikipedia.org' && url.searchParams.get('generator') === 'geosearch') {
        return jsonResponse({ query: { pages: { '3': { title: 'Eiffel Tower', pageimage: 'Eiffel.jpg', thumbnail: { source: 'https://upload.wikimedia.org/eiffel.jpg' } } } } });
      }
      if (url.hostname === 'en.wikipedia.org') return jsonResponse({ query: { pages: { '1': { title: 'Paris' } } } });
      if (url.hostname === 'commons.wikimedia.org') {
        return jsonResponse({ query: { pages: { '4': { title: 'File:Eiffel.jpg', imageinfo: [{ thumburl: 'https://upload.wikimedia.org/eiffel-960.jpg', extmetadata: { LicenseShortName: { value: 'CC BY 4.0' }, Artist: { value: 'A. Photographer' } } }] } } } });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetch);
    const provider = new WikimediaMediaProvider({ HOTEL_COMPARISON_CACHE: new MemoryKv() as unknown as KVNamespace } as Env);

    const media = await provider.cityMedia('Paris, France', { longitude: 2.3522, latitude: 48.8566 });

    expect(media).toMatchObject({ title: 'Eiffel Tower', imageUrl: 'https://upload.wikimedia.org/eiffel-960.jpg' });
    expect(fetch.mock.calls.some(([input]) => new URL(input instanceof Request ? input.url : String(input)).searchParams.get('generator') === 'geosearch')).toBe(true);
  });
});

class MemoryKv {
  private readonly values = new Map<string, string>();
  async get(key: string): Promise<string | null> { return this.values.get(key) ?? null; }
  async put(key: string, value: string): Promise<void> { this.values.set(key, value); }
}

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), { status: 200, headers: { 'content-type': 'application/json' } });
}
