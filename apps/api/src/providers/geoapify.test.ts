import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../env';
import { GeoProvider, routesAreEffectivelyEquivalent } from './geoapify';

describe('GeoProvider', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('caches a directional route-matrix lookup for 24 hours using rounded coordinates', async () => {
    const cache = new MemoryKv();
    const fetch = vi.fn(async () => jsonResponse({ sources_to_targets: [[{ time: 1_020, distance: 1_240 }]] }));
    vi.stubGlobal('fetch', fetch);
    const provider = new GeoProvider({
      GEOAPIFY_API_KEY: 'geo-test-key',
      HOTEL_COMPARISON_CACHE: cache as unknown as KVNamespace,
    } as Env);

    const first = await provider.routeMinutes(
      { longitude: 2.33761, latitude: 48.86061 },
      { longitude: 2.32751, latitude: 48.86341 },
    );
    const second = await provider.routeMinutes(
      { longitude: 2.33762, latitude: 48.86062 },
      { longitude: 2.32752, latitude: 48.86342 },
    );

    expect(first).toEqual({ minutes: 17, distanceMeters: 1240 });
    expect(second).toEqual(first);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(cache.keys()).toContain('geoapify:routematrix:v1:walk:2.3376,48.8606:2.3275,48.8634');
    expect(cache.ttls()).toContain(86_400);
  });

  it('uses explicit longitude-first stopovers and caches the real GeoJSON route geometry', async () => {
    const cache = new MemoryKv();
    let requestedUrl: URL | undefined;
    const fetch = vi.fn(async (input: unknown) => {
      requestedUrl = input instanceof URL ? input : new URL(String(input));
      return jsonResponse({
        features: [{
          geometry: {
            type: 'MultiLineString',
            coordinates: [
              [[2.3376, 48.8606], [2.3312, 48.8584]],
              [[2.3312, 48.8584], [2.3291, 48.8612], [2.3275, 48.8634]],
            ],
          },
          properties: { distance: 1_240, time: 1_020 },
        }],
      });
    });
    vi.stubGlobal('fetch', fetch);
    const provider = new GeoProvider({
      GEOAPIFY_API_KEY: 'geo-test-key',
      HOTEL_COMPARISON_CACHE: cache as unknown as KVNamespace,
    } as Env);
    const stops = [
      { longitude: 2.33761, latitude: 48.86061 },
      { longitude: 2.33121, latitude: 48.85841 },
      { longitude: 2.32751, latitude: 48.86341 },
    ];

    const first = await provider.routeGeometry(stops, 'bicycle');
    const second = await provider.routeGeometry(stops, 'bicycle');

    expect(first).toEqual({
      // The response stays on the provider's actual route geometry. The
      // duplicated leg boundary is removed, but no synthetic straight line is
      // introduced between the itinerary stops.
      coordinates: [[2.3376, 48.8606], [2.3312, 48.8584], [2.3291, 48.8612], [2.3275, 48.8634]],
      legs: [
        [[2.3376, 48.8606], [2.3312, 48.8584]],
        [[2.3312, 48.8584], [2.3291, 48.8612], [2.3275, 48.8634]],
      ],
      distanceMeters: 1240,
      durationMinutes: 17,
    });
    expect(second).toEqual(first);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(requestedUrl?.pathname).toBe('/v1/routing');
    expect(requestedUrl?.searchParams.get('mode')).toBe('bicycle');
    expect(requestedUrl?.searchParams.get('waypoints')).toBe(
      'lonlat:2.33761,48.86061|lonlat:2.33121,48.85841|lonlat:2.32751,48.86341',
    );
    expect(requestedUrl?.searchParams.get('intermediate_waypoint_mode')).toBe('stopover');
    expect(cache.keys()).toContain('geoapify:routing:v2:bicycle:2.3376,48.8606|2.3312,48.8584|2.3275,48.8634');
    expect(cache.keys()).not.toContain('geoapify:routing:v1:bicycle:2.3376,48.8606|2.3312,48.8584|2.3275,48.8634');
    expect(cache.ttls()).toContain(86_400);
  });

  it('collapses only genuinely redundant travel modes and reuses the per-mode route cache', async () => {
    const cache = new MemoryKv();
    const fetch = vi.fn(async (input: unknown) => {
      const url = input instanceof URL ? input : new URL(String(input));
      const mode = url.searchParams.get('mode');
      return jsonResponse({
        features: [{
          geometry: {
            type: 'MultiLineString',
            coordinates: [
              [[2.3376, 48.8606], [2.3312, 48.8584]],
              [[2.3312, 48.8584], [2.3275, 48.8634]],
            ],
          },
          properties: { distance: 1240, time: mode === 'drive' ? 360 : 1020 },
        }],
      });
    });
    vi.stubGlobal('fetch', fetch);
    const provider = new GeoProvider({
      GEOAPIFY_API_KEY: 'geo-test-key',
      HOTEL_COMPARISON_CACHE: cache as unknown as KVNamespace,
    } as Env);
    const stops = [
      { longitude: 2.33761, latitude: 48.86061 },
      { longitude: 2.33121, latitude: 48.85841 },
      { longitude: 2.32751, latitude: 48.86341 },
    ];

    const first = await provider.routeOptions(stops);
    const second = await provider.routeOptions(stops);

    // Bicycle follows the same corridor with the same ETA as walking, while
    // driving has a materially different ETA and remains a meaningful choice.
    expect(first.map((option) => option.mode)).toEqual(['walk', 'drive']);
    expect(second.map((option) => option.mode)).toEqual(['walk', 'drive']);
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it('keeps a usable route option when another mode cannot be cached', async () => {
    const cache = new FailingModeKv('drive');
    const fetch = vi.fn(async (input: unknown) => {
      const url = input instanceof URL ? input : new URL(String(input));
      const mode = url.searchParams.get('mode');
      return jsonResponse({
        features: [{
          geometry: { type: 'LineString', coordinates: [[2.3376, 48.8606], [2.3275, 48.8634]] },
          properties: { distance: mode === 'bicycle' ? 1_340 : 1_240, time: mode === 'bicycle' ? 900 : 1_020 },
        }],
      });
    });
    vi.stubGlobal('fetch', fetch);
    const provider = new GeoProvider({
      GEOAPIFY_API_KEY: 'geo-test-key',
      HOTEL_COMPARISON_CACHE: cache as unknown as KVNamespace,
    } as Env);

    const options = await provider.routeOptions([
      { longitude: 2.33761, latitude: 48.86061 },
      { longitude: 2.32751, latitude: 48.86341 },
    ]);

    expect(options.map((option) => option.mode)).toEqual(['walk', 'bicycle']);
  });

  it('does not collapse paths that use different roads even if their metrics match', () => {
    const first = {
      coordinates: [[2.3376, 48.8606], [2.3312, 48.8584], [2.3275, 48.8634]] as Array<[number, number]>,
      legs: [
        [[2.3376, 48.8606], [2.3312, 48.8584]],
        [[2.3312, 48.8584], [2.3275, 48.8634]],
      ] as Array<Array<[number, number]>>,
      distanceMeters: 1240,
      durationMinutes: 17,
    };
    const differentCorridor = {
      coordinates: [[2.3376, 48.8606], [2.346, 48.855], [2.3275, 48.8634]] as Array<[number, number]>,
      legs: [
        [[2.3376, 48.8606], [2.346, 48.855]],
        [[2.346, 48.855], [2.3275, 48.8634]],
      ] as Array<Array<[number, number]>>,
      distanceMeters: 1240,
      durationMinutes: 17,
    };

    expect(routesAreEffectivelyEquivalent(first, differentCorridor)).toBe(false);
  });
});

class MemoryKv {
  private readonly values = new Map<string, string>();
  private readonly expirationTtls: number[] = [];

  async get(key: string): Promise<string | null> { return this.values.get(key) ?? null; }
  async put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void> {
    this.values.set(key, value);
    if (options?.expirationTtl) this.expirationTtls.push(options.expirationTtl);
  }
  keys(): string[] { return [...this.values.keys()]; }
  ttls(): number[] { return this.expirationTtls; }
}

class FailingModeKv extends MemoryKv {
  constructor(private readonly failingMode: string) { super(); }

  override async put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void> {
    if (key.includes(`:${this.failingMode}:`)) throw new Error('simulated cache write failure');
    await super.put(key, value, options);
  }
}

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), { status: 200, headers: { 'content-type': 'application/json' } });
}
