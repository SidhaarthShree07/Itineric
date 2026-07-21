import {
  hotelComparisonInputSchema,
  hotelComparisonResultSchema,
  type Evidence,
  type HotelComparisonInput,
  type HotelComparisonResult,
} from '@atlas/contracts';
import type { Env } from '../../env';
import { SerpApiClient, SerpApiError, type SerpApiHotel } from '../../providers/serpapi';

const CACHE_TTL_SECONDS = 10 * 60;

/**
 * Availability and price data is deliberately cached only when SerpApi returned
 * usable properties. A missing key, quota response, or empty search is a
 * fallback and must not suppress a later real search.
 */
export class HotelComparisonCache {
  constructor(private readonly cache: KVNamespace) {}

  async get(input: HotelComparisonInput): Promise<HotelComparisonResult | undefined> {
    const raw = await this.cache.get(await hotelComparisonCacheKey(input));
    if (!raw) return undefined;
    const parsed = hotelComparisonResultSchema.safeParse(JSON.parse(raw) as unknown);
    if (
      !parsed.success ||
      parsed.data.status !== 'results' ||
      parsed.data.hotels.length === 0 ||
      new Date(parsed.data.cacheExpiresAt) <= new Date()
    ) return undefined;
    return parsed.data;
  }

  async put(input: HotelComparisonInput, value: HotelComparisonResult): Promise<void> {
    if (value.status !== 'results' || value.hotels.length === 0) return;
    await this.cache.put(await hotelComparisonCacheKey(input), JSON.stringify(value), {
      expirationTtl: CACHE_TTL_SECONDS,
    });
  }
}

export class HotelComparisonProvider {
  private readonly cache: HotelComparisonCache;
  private readonly serpApi: SerpApiClient;

  constructor(env: Env) {
    this.cache = new HotelComparisonCache(env.HOTEL_COMPARISON_CACHE);
    this.serpApi = new SerpApiClient(env);
  }

  async compare(inputValue: unknown): Promise<HotelComparisonResult> {
    const input = hotelComparisonInputSchema.parse(inputValue);
    const cached = await this.cache.get(input);
    if (cached) return cached;

    const now = new Date();
    const fallbackLinks = createFallbackLinks(input);
    try {
      const response = await this.serpApi.searchHotels(input);
      const hotels = normaliseHotels(response.properties, input, now);
      const result = buildResult({
        status: hotels.length > 0 ? 'results' : 'fallback_links',
        now,
        hotels,
        fallbackLinks,
        warnings: hotels.length > 0
          ? ['Prices are Google Hotels result snapshots supplied by SerpApi. They are recent estimates, not live inventory; confirm the final price before booking.']
          : ['Google Hotels returned no properties matching this search. Use the prefilled booking-platform searches below.'],
      });
      await this.cache.put(input, result);
      return result;
    } catch (error) {
      const reason = error instanceof SerpApiError && error.code === 'MISSING_API_KEY'
        ? 'Hotel results require SERPAPI_API_KEY. Add it to the Worker environment, then retry this search.'
        : 'Hotel search is temporarily unavailable. Use the prefilled booking-platform searches below.';
      const fallback = buildResult({ status: 'fallback_links', now, hotels: [], fallbackLinks, warnings: [reason] });
      await this.cache.put(input, fallback);
      return fallback;
    }
  }
}

function normaliseHotels(
  properties: SerpApiHotel[],
  input: HotelComparisonInput,
  now: Date,
): HotelComparisonResult['hotels'] {
  const fetchedAt = now.toISOString();
  const expiresAt = new Date(now.getTime() + CACHE_TTL_SECONDS * 1_000).toISOString();

  return properties
    .flatMap((property) => {
      const nightlyPrice = property.rate_per_night?.extracted_lowest;
      if (!property.name || !isPositiveNumber(nightlyPrice) || nightlyPrice > input.maxPricePerNight) return [];
      const sourceUrl = googleHotelsSearchUrl(input, property.name);
      const evidence: Evidence = {
        source: 'serpapi',
        referenceUrl: sourceUrl,
        sourceRecordId: property.property_token,
        fetchedAt,
        expiresAt,
        attribution: 'Google Hotels results via SerpApi',
        freshness: 'recent',
      };
      return [{
        name: property.name,
        rating: isRating(property.overall_rating) ? property.overall_rating : null,
        ratingSource: isRating(property.overall_rating) ? 'Google Hotels' : undefined,
        description: property.description,
        imageUrl: safeUrl(property.images?.[0]?.thumbnail),
        hotelClass: property.hotel_class,
        amenities: property.amenities?.filter((amenity) => typeof amenity === 'string').slice(0, 8),
        bookingUrl: safeUrl(property.link),
        coordinates: property.gps_coordinates && isFiniteNumber(property.gps_coordinates.longitude) && isFiniteNumber(property.gps_coordinates.latitude)
          ? { longitude: property.gps_coordinates.longitude, latitude: property.gps_coordinates.latitude }
          : undefined,
        prices: [{
          platform: 'Google Hotels' as const,
          estimatedPricePerNight: nightlyPrice,
          currency: input.currency,
          sourceUrl,
          evidence,
        }],
      }];
    })
    .sort((left, right) => (right.rating ?? -1) - (left.rating ?? -1) || left.prices[0]!.estimatedPricePerNight - right.prices[0]!.estimatedPricePerNight)
    .slice(0, 12);
}

function buildResult(input: {
  status: HotelComparisonResult['status'];
  now: Date;
  hotels: HotelComparisonResult['hotels'];
  fallbackLinks: HotelComparisonResult['fallbackLinks'];
  warnings: string[];
}): HotelComparisonResult {
  return hotelComparisonResultSchema.parse({
    status: input.status,
    generatedAt: input.now.toISOString(),
    cacheExpiresAt: new Date(input.now.getTime() + CACHE_TTL_SECONDS * 1_000).toISOString(),
    hotels: input.hotels,
    fallbackLinks: input.fallbackLinks,
    warnings: input.warnings,
  });
}

export function createFallbackLinks(input: HotelComparisonInput): HotelComparisonResult['fallbackLinks'] {
  const booking = new URL('https://www.booking.com/searchresults.html');
  booking.search = new URLSearchParams({
    ss: input.destination,
    checkin: input.checkIn,
    checkout: input.checkOut,
    group_adults: String(input.adults),
    no_rooms: String(input.rooms),
    group_children: String(input.children),
    selected_currency: input.currency,
  }).toString();

  const makeMyTrip = new URL('https://www.makemytrip.com/hotels/hotel-listing/');
  makeMyTrip.search = new URLSearchParams({
    city: input.destination,
    checkin: input.checkIn,
    checkout: input.checkOut,
    adults: String(input.adults),
    rooms: String(input.rooms),
    children: String(input.children),
    currency: input.currency,
  }).toString();

  const trivago = new URL('https://www.trivago.com/en-US/srl');
  trivago.search = new URLSearchParams({
    destination: input.destination,
    checkIn: input.checkIn,
    checkOut: input.checkOut,
    adults: String(input.adults),
    rooms: String(input.rooms),
    currency: input.currency,
  }).toString();

  return [
    { platform: 'Booking.com', url: booking.toString() },
    { platform: 'MakeMyTrip', url: makeMyTrip.toString() },
    { platform: 'Trivago', url: trivago.toString() },
  ];
}

export function googleHotelsSearchUrl(input: HotelComparisonInput, hotelName: string): string {
  const url = new URL('https://www.google.com/travel/search');
  url.search = new URLSearchParams({
    q: `${hotelName} ${input.destination}`,
    checkin: input.checkIn,
    checkout: input.checkOut,
    adults: String(input.adults),
    currency: input.currency,
  }).toString();
  return url.toString();
}

function isPositiveNumber(value: unknown): value is number { return typeof value === 'number' && Number.isFinite(value) && value > 0; }
function isFiniteNumber(value: unknown): value is number { return typeof value === 'number' && Number.isFinite(value); }
function isRating(value: unknown): value is number { return isFiniteNumber(value) && value >= 0 && value <= 5; }
function safeUrl(value: unknown): string | undefined { try { return typeof value === 'string' && new URL(value).protocol === 'https:' ? value : undefined; } catch { return undefined; } }

async function hotelComparisonCacheKey(input: HotelComparisonInput): Promise<string> {
  const canonical = JSON.stringify({
    destination: input.destination.trim().toLocaleLowerCase(),
    checkIn: input.checkIn,
    checkOut: input.checkOut,
    adults: input.adults,
    children: input.children,
    rooms: input.rooms,
    currency: input.currency,
    maxPricePerNight: input.maxPricePerNight,
  });
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical));
  return `hotel-comparison:v5:${[...new Uint8Array(digest)].slice(0, 16).map((byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}
