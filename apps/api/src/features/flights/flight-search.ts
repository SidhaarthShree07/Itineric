import {
  flightBookingOptionsInputSchema,
  flightSearchInputSchema,
  flightSearchResultSchema,
  type FlightBookingOptionsResult,
  type FlightSearchInput,
  type FlightSearchResult,
} from '@atlas/contracts';
import type { Env } from '../../env';
import { SerpApiClient, SerpApiError } from '../../providers/serpapi';

const CACHE_TTL_SECONDS = 5 * 60;

export class FlightSearchProvider {
  private readonly serpApi: SerpApiClient;

  constructor(private readonly env: Env) {
    this.serpApi = new SerpApiClient(env);
  }

  async search(inputValue: unknown): Promise<FlightSearchResult> {
    const input = flightSearchInputSchema.parse(inputValue);
    const cached = await this.getCached(input);
    if (cached) return cached;
    try {
      const result = flightSearchResultSchema.parse(await this.serpApi.searchFlights(input));
      if (result.status === 'results' && result.flights.length) {
        await this.env.HOTEL_COMPARISON_CACHE.put(await flightCacheKey(input), JSON.stringify(result), { expirationTtl: CACHE_TTL_SECONDS });
      }
      return result;
    } catch (error) {
      const now = new Date();
      const missingKey = error instanceof SerpApiError && error.code === 'MISSING_API_KEY';
      return flightSearchResultSchema.parse({
        status: 'unavailable',
        generatedAt: now.toISOString(),
        cacheExpiresAt: new Date(now.getTime() + CACHE_TTL_SECONDS * 1_000).toISOString(),
        currency: input.currency,
        flights: [],
        warnings: [missingKey
          ? 'Flight results require SERPAPI_API_KEY. Add it to the Worker environment, then retry this search.'
          : 'Flight search is temporarily unavailable. Try again shortly.'],
      });
    }
  }

  async bookingOptions(inputValue: unknown): Promise<FlightBookingOptionsResult> {
    const input = flightBookingOptionsInputSchema.parse(inputValue);
    return this.serpApi.bookingOptions(input.bookingToken, input.search);
  }

  private async getCached(input: FlightSearchInput): Promise<FlightSearchResult | undefined> {
    const raw = await this.env.HOTEL_COMPARISON_CACHE.get(await flightCacheKey(input));
    if (!raw) return undefined;
    const parsed = flightSearchResultSchema.safeParse(JSON.parse(raw) as unknown);
    if (!parsed.success || parsed.data.status !== 'results' || !parsed.data.flights.length || new Date(parsed.data.cacheExpiresAt) <= new Date()) return undefined;
    return parsed.data;
  }
}

async function flightCacheKey(input: FlightSearchInput): Promise<string> {
  const canonical = JSON.stringify(input);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical));
  return `flight-search:v1:${[...new Uint8Array(digest)].slice(0, 16).map((byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}
