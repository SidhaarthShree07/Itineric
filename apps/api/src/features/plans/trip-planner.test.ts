import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AiRouter } from '../../ai/router';
import type { Env } from '../../env';
import { TRIP_PLAN_SCHEMA, TripPlanner } from './trip-planner';

describe('TripPlanner', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('leaves outer itinerary length unconstrained for Gemini responseJsonSchema compatibility', () => {
    const properties = TRIP_PLAN_SCHEMA.properties as Record<string, unknown>;
    const itinerary = properties.itinerary as Record<string, unknown>;
    const day = itinerary.items as Record<string, unknown>;
    const dayProperties = day.properties as Record<string, unknown>;
    const items = dayProperties.items as Record<string, unknown>;

    expect(itinerary).not.toHaveProperty('minItems');
    expect(itinerary).not.toHaveProperty('maxItems');
    expect(items).toMatchObject({ minItems: 2, maxItems: 10 });
  });

  it('returns a complete budgeted fallback plan when every model is unavailable', async () => {
    const planner = new TripPlanner(
      {} as Env,
      { generateJson: async () => { throw new Error('all providers unavailable'); } } as unknown as AiRouter,
    );

    const plan = await planner.create({
      destination: 'Kyoto, Japan', startDate: '2026-10-10', endDate: '2026-10-13', adults: 2, children: 0, rooms: 1,
      currency: 'JPY', totalBudget: 180000, travelStyle: 'balanced', pace: 'balanced', interests: ['food', 'history'], cuisines: [], avoid: [],
    }, 'test-workspace');

    expect(plan.itinerary).toHaveLength(3);
    expect(plan.costBreakdown.total).toBe(180000);
    expect(plan.itinerary.every((day) => day.items.length >= 2)).toBe(true);
    expect(plan.assumptions.join(' ')).toContain('fallback');
  });

  it('uses Geoapify route-matrix minutes instead of the compose model travel values', async () => {
    const cache = new MemoryKv();
    let routeRequest = 0;
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      if (url.pathname.endsWith('/geocode/search')) {
        const text = url.searchParams.get('text') ?? '';
        const places: Record<string, { lon: number; lat: number }> = {
          'Louvre Museum, Paris, France': { lon: 2.3376, lat: 48.8606 },
          'Jardin des Tuileries, Paris, France': { lon: 2.3275, lat: 48.8634 },
          'Musée d’Orsay, Paris, France': { lon: 2.3266, lat: 48.8600 },
        };
        const coordinates = places[text] ?? { lon: 2.35, lat: 48.86 };
        return jsonResponse({ results: [{ ...coordinates, formatted: text }] });
      }
      if (url.pathname.endsWith('/routematrix')) {
        routeRequest += 1;
        return jsonResponse({ sources_to_targets: [[{ time: routeRequest === 1 ? 1_020 : 1_440, distance: 1_200 }]] });
      }
      throw new Error(`Unexpected provider request: ${url}`);
    }));

    const generateJson = vi.fn()
      .mockResolvedValueOnce({
        days: [{
          day: 1,
          theme: 'Left Bank and river icons',
          candidates: [
            { name: 'Louvre Museum', category: 'attraction' },
            { name: 'Jardin des Tuileries', category: 'attraction' },
            { name: 'Musée d’Orsay', category: 'attraction' },
          ],
        }],
      })
      .mockResolvedValueOnce(polishedPlanWithInventedTravelTimes());
    const planner = new TripPlanner(
      { GEOAPIFY_API_KEY: 'geo-test-key', HOTEL_COMPARISON_CACHE: cache as unknown as KVNamespace } as Env,
      { generateJson } as unknown as AiRouter,
    );

    const plan = await planner.create({
      destination: 'Paris, France', days: 1, adults: 1, children: 0, rooms: 1,
      currency: 'EUR', totalBudget: 800, travelStyle: 'balanced', pace: 'balanced', interests: ['art'], cuisines: [], avoid: [],
    }, 'test-workspace');

    expect(generateJson.mock.calls.map(([request]) => request.feature)).toEqual(['itinerary_skeleton', 'complex_planning']);
    expect(plan.itinerary[0]?.items.map((item) => item.travelFromPreviousMinutes)).toEqual([0, 17, 24]);
    expect(plan.itinerary[0]?.items.map((item) => item.travelFromPreviousMinutes)).not.toContain(319);
    expect(plan.itinerary[0]?.items.map((item) => item.travelFromPreviousMinutes)).not.toContain(287);
  });

  it('falls back to a usable plan when Geoapify is not configured', async () => {
    const generateJson = vi.fn().mockResolvedValue({
      days: [{
        day: 1,
        theme: 'Historic centre',
        candidates: [
          { name: 'Louvre Museum', category: 'attraction' },
          { name: 'Jardin des Tuileries', category: 'attraction' },
        ],
      }],
    });
    const planner = new TripPlanner(
      { HOTEL_COMPARISON_CACHE: new MemoryKv() as unknown as KVNamespace } as Env,
      { generateJson } as unknown as AiRouter,
    );

    const plan = await planner.create({
      destination: 'Paris, France', days: 1, adults: 1, children: 0, rooms: 1,
      currency: 'EUR', totalBudget: 800, travelStyle: 'balanced', pace: 'balanced', interests: ['art'], cuisines: [], avoid: [],
    }, 'test-workspace');

    expect(plan.assumptions.join(' ')).toContain('fallback');
    expect(generateJson).toHaveBeenCalledTimes(1);
  });

  it('keeps Wikipedia-discovered places and Geoapify coordinates when all planning models fail', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      if (url.hostname === 'en.wikipedia.org' && url.searchParams.get('generator') === 'geosearch') {
        return jsonResponse({ query: { pages: {
          '1': { title: 'Louvre Museum' },
          '2': { title: 'Jardin des Tuileries' },
        } } });
      }
      if (url.hostname === 'en.wikipedia.org') return jsonResponse({ query: { pages: { '3': { title: 'Paris' } } } });
      if (url.pathname.endsWith('/geocode/search')) {
        const text = url.searchParams.get('text') ?? '';
        const locations: Record<string, { lon: number; lat: number }> = {
          'Paris, France': { lon: 2.3522, lat: 48.8566 },
          'Louvre Museum, Paris, France': { lon: 2.3376, lat: 48.8606 },
          'Jardin des Tuileries, Paris, France': { lon: 2.3275, lat: 48.8634 },
        };
        return jsonResponse({ results: [{ ...(locations[text] ?? locations['Paris, France']!), formatted: text }] });
      }
      if (url.pathname.endsWith('/routematrix')) return jsonResponse({ sources_to_targets: [[{ time: 1_020, distance: 1_200 }]] });
      throw new Error(`Unexpected provider request: ${url}`);
    }));
    const planner = new TripPlanner(
      { GEOAPIFY_API_KEY: 'geo-test-key', HOTEL_COMPARISON_CACHE: new MemoryKv() as unknown as KVNamespace } as Env,
      { generateJson: async () => { throw new Error('all models unavailable'); } } as unknown as AiRouter,
    );

    const plan = await planner.create({
      destination: 'Paris, France', days: 1, adults: 1, children: 0, rooms: 1,
      currency: 'EUR', totalBudget: 800, travelStyle: 'balanced', pace: 'balanced', interests: ['art'], cuisines: [], avoid: [],
    }, 'test-workspace');

    expect(plan.itinerary[0]?.items.map((item) => item.title)).toEqual(['Louvre Museum', 'Jardin des Tuileries']);
    expect(plan.itinerary[0]?.items.map((item) => item.coordinates)).toEqual([
      { longitude: 2.3376, latitude: 48.8606 },
      { longitude: 2.3275, latitude: 48.8634 },
    ]);
    expect(plan.itinerary[0]?.items[1]?.travelFromPreviousMinutes).toBe(17);
    expect(plan.assumptions.join(' ')).toContain('recovery itinerary');
  });
});

class MemoryKv {
  private readonly values = new Map<string, string>();

  async get(key: string): Promise<string | null> { return this.values.get(key) ?? null; }
  async put(key: string, value: string): Promise<void> { this.values.set(key, value); }
}

function polishedPlanWithInventedTravelTimes() {
  return {
    title: 'Paris art walk', overview: 'A compact museum-focused day.', assumptions: ['Confirm tickets before visiting.'],
    costBreakdown: { accommodation: 280, food: 120, localTransport: 30, intercityTransport: 0, activities: 180, shopping: 80, emergency: 110, total: 800, currency: 'EUR' },
    itinerary: [{
      day: 1, title: 'Museum highlights', summary: 'Walk between nearby cultural landmarks.', estimatedDailyCost: 800,
      items: [
        { time: '09:00', title: 'Louvre Museum', category: 'attraction', description: 'Start with the permanent collection.', estimatedCost: 40, travelFromPreviousMinutes: 319, durationMinutes: 180 },
        { time: '13:00', title: 'Jardin des Tuileries', category: 'attraction', description: 'Walk through the gardens.', estimatedCost: 0, travelFromPreviousMinutes: 319, durationMinutes: 60 },
        { time: '15:00', title: 'Musée d’Orsay', category: 'attraction', description: 'Visit impressionist galleries.', estimatedCost: 20, travelFromPreviousMinutes: 287, durationMinutes: 150 },
      ],
    }],
    attractions: ['Louvre Museum'], hiddenGems: ['Quiet garden path'], restaurantSuggestions: [], weatherNotes: ['Check rain before walking.'], packing: ['Walking shoes'], culturalEtiquette: ['Respect gallery rules.'], localTips: ['Use transit for longer distances.'],
  };
}

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), { status: 200, headers: { 'content-type': 'application/json' } });
}
