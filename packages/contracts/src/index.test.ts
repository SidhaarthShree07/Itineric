import { describe, expect, it } from 'vitest';
import { evidenceSchema, tripPlanningInputSchema, tripRouteOptionsResultSchema } from './index';

describe('web aggregate evidence', () => {
  const base = {
    source: 'web_aggregate' as const,
    referenceUrl: 'https://www.booking.com/searchresults.html?ss=Paris',
    fetchedAt: '2026-07-21T00:00:00.000Z',
  };

  it('accepts recent web estimates', () => {
    expect(evidenceSchema.safeParse({ ...base, freshness: 'recent' }).success).toBe(true);
  });

  it('rejects any attempt to label web aggregate data as live', () => {
    expect(evidenceSchema.safeParse({ ...base, freshness: 'live' }).success).toBe(false);
  });
});

describe('trip route choices', () => {
  const generatedAt = '2026-07-21T00:00:00.000Z';
  const route = {
    status: 'results' as const,
    mode: 'walk' as const,
    coordinates: [[2.3376, 48.8606], [2.3312, 48.8584]],
    distanceMeters: 740,
    durationMinutes: 10,
    generatedAt,
  };

  it('accepts one meaningful representative and permits the UI to hide the mode picker', () => {
    expect(tripRouteOptionsResultSchema.safeParse({
      status: 'results',
      routes: [route],
      defaultMode: 'walk',
      generatedAt,
    }).success).toBe(true);
  });

  it('rejects a successful route-choice response with no route to render', () => {
    expect(tripRouteOptionsResultSchema.safeParse({
      status: 'results',
      routes: [],
      generatedAt,
    }).success).toBe(false);
  });
});

describe('trip planner custom tags', () => {
  const request = {
    destination: 'Tokyo, Japan',
    startDate: '2026-08-14',
    endDate: '2026-08-17',
    adults: 2,
    children: 0,
    rooms: 1,
    currency: 'JPY',
    totalBudget: 180000,
    travelStyle: 'balanced' as const,
    pace: 'balanced' as const,
    interests: ['anime'],
    cuisines: ['ramen'],
    avoid: ['peak-hour crowds'],
  };

  it('accepts custom interest, cuisine, and avoid tags at the API boundary', () => {
    expect(tripPlanningInputSchema.safeParse(request).success).toBe(true);
  });

  it('rejects an invalid custom tag', () => {
    expect(tripPlanningInputSchema.safeParse({ ...request, interests: ['x'] }).success).toBe(false);
  });
});
