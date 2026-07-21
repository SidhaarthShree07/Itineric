import { describe, expect, it, vi } from 'vitest';
import { createFallbackLinks, googleHotelsSearchUrl, HotelComparisonCache } from './hotel-comparison';

const input = {
  destination: 'Paris, France',
  checkIn: '2026-08-14',
  checkOut: '2026-08-17',
  adults: 2,
  rooms: 1,
  children: 0,
  maxPricePerNight: 220,
  currency: 'EUR',
};

describe('hotel comparison fallbacks', () => {
  it('creates three prefilled platform searches', () => {
    const links = createFallbackLinks(input);
    expect(links).toHaveLength(3);
    expect(links[0]?.url).toContain('checkin=2026-08-14');
    expect(links[1]?.url).toContain('checkin=2026-08-14');
    expect(links[2]?.url).toContain('checkIn=2026-08-14');
  });

  it('creates a public Google Hotels verification query without exposing SerpApi credentials', () => {
    const url = googleHotelsSearchUrl(input, 'Example Hotel');
    expect(url).toContain('www.google.com/travel/search');
    expect(url).toContain('checkin=2026-08-14');
    expect(url).not.toContain('api_key');
  });

  it('never caches a fallback response', async () => {
    const put = vi.fn();
    const cache = new HotelComparisonCache({ get: vi.fn(), put } as unknown as KVNamespace);
    await cache.put(input, {
      status: 'fallback_links',
      generatedAt: new Date().toISOString(),
      cacheExpiresAt: new Date(Date.now() + 60_000).toISOString(),
      hotels: [],
      fallbackLinks: createFallbackLinks(input),
      warnings: ['No verified comparison.'],
    });
    expect(put).not.toHaveBeenCalled();
  });
});
