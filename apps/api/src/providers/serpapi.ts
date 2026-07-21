import type { FlightBookingOptionsResult, FlightSearchInput, FlightSearchResult, HotelComparisonInput } from '@atlas/contracts';
import type { Env } from '../env';

const REQUEST_TIMEOUT_MS = 20_000;

export class SerpApiError extends Error {
  constructor(message: string, readonly code: 'MISSING_API_KEY' | 'UPSTREAM_FAILURE') {
    super(message);
    this.name = 'SerpApiError';
  }
}

export interface SerpApiHotel {
  type?: string;
  name?: string;
  description?: string;
  link?: string;
  hotel_class?: string;
  overall_rating?: number;
  amenities?: string[];
  property_token?: string;
  gps_coordinates?: { longitude?: number; latitude?: number };
  images?: Array<{ thumbnail?: string; original_image?: string }>;
  rate_per_night?: { lowest?: string; extracted_lowest?: number };
}

interface SerpApiSearchResponse {
  error?: string;
  properties?: SerpApiHotel[];
  best_flights?: SerpApiFlight[];
  other_flights?: SerpApiFlight[];
  booking_options?: SerpApiBookingOption[];
  price_insights?: { price_level?: string; lowest_price?: number; typical_price_range?: number[] };
}

interface SerpApiFlight {
  flights?: Array<{
    airline?: string;
    airline_logo?: string;
    flight_number?: string;
    duration?: number;
    departure_airport?: { id?: string; time?: string };
    arrival_airport?: { id?: string; time?: string };
  }>;
  price?: number;
  type?: string;
  total_duration?: number;
  airline_logo?: string;
  departure_token?: string;
  booking_token?: string;
  carbon_emissions?: { this_flight?: number };
}

interface SerpApiBookingOption {
  together?: SerpApiBookingQuote;
  separate?: SerpApiBookingQuote[];
}

interface SerpApiBookingQuote {
  book_with?: string;
  price?: number;
  local_prices?: Array<{ currency?: string; price?: number }>;
  booking_request?: { url?: string };
}

export class SerpApiClient {
  constructor(private readonly env: Env) {}

  async searchHotels(input: HotelComparisonInput): Promise<{ properties: SerpApiHotel[] }> {
    const response = await this.search({
      engine: 'google_hotels',
      q: input.destination,
      check_in_date: input.checkIn,
      check_out_date: input.checkOut,
      adults: String(input.adults),
      children: String(input.children),
      currency: input.currency,
      max_price: String(input.maxPricePerNight),
      gl: 'us',
      hl: 'en',
    });
    return { properties: response.properties?.filter((property) => property.type === 'hotel' || !property.type) ?? [] };
  }

  async searchFlights(input: FlightSearchInput): Promise<FlightSearchResult> {
    const now = new Date();
    const searchParameters = flightSearchParameters(input);
    const initial = await this.search(searchParameters);

    // Google Flights returns outbound choices first for a round trip. Following
    // the first departure token gives the user actual round-trip alternatives
    // and booking tokens without pre-fetching expensive options for every card.
    const initialFlights = collectFlights(initial);
    const resolved = input.returnDate && initialFlights[0]?.departure_token
      // SerpApi currently requires the original route parameters alongside a
      // departure token. Omitting them yields its "Missing departure_id"
      // response even though the token identifies the outbound selection.
      ? await this.search({ ...searchParameters, departure_token: initialFlights[0].departure_token })
      : initial;
    return mapFlightSearch(resolved, input.currency, now);
  }

  async bookingOptions(bookingToken: string, input: FlightSearchInput): Promise<FlightBookingOptionsResult> {
    const now = new Date();
    // Booking tokens do not stand alone in SerpApi's Google Flights engine.
    // Sending the exact search context avoids its "Missing departure_id" error.
    const raw = await this.search({ ...flightSearchParameters(input), booking_token: bookingToken });
    const fetchedAt = now.toISOString();
    const expiresAt = new Date(now.getTime() + 5 * 60_000).toISOString();
    const options = (raw.booking_options ?? []).flatMap((option) => [option.together, ...(option.separate ?? [])])
      .flatMap((quote) => quote ? [quote] : [])
      .map((quote) => {
        const localPrice = quote.local_prices?.find((price) => price.currency === input.currency)?.price;
        return {
          source: quote.book_with?.trim() || 'Booking provider',
          price: isPositiveNumber(localPrice) ? localPrice : isPositiveNumber(quote.price) ? quote.price : undefined,
          // Google exposes this as a booking POST handoff. A naked GET does not
          // preserve the selected fare, so the client intentionally displays it
          // as a quote rather than a misleading booking link.
          evidence: { source: 'serpapi' as const, fetchedAt, expiresAt, attribution: 'Google Flights booking options via SerpApi', freshness: 'recent' as const },
        };
      });
    return {
      generatedAt: fetchedAt,
      currency: input.currency,
      options,
      warnings: ['Provider quotes are returned by Google Flights through SerpApi. Confirm fare rules and the final amount on the provider before purchase.'],
    };
  }

  private async search(parameters: Record<string, string>): Promise<SerpApiSearchResponse> {
    if (!this.env.SERPAPI_API_KEY) throw new SerpApiError('SERPAPI_API_KEY is not configured.', 'MISSING_API_KEY');
    const url = new URL('https://serpapi.com/search.json');
    for (const [key, value] of Object.entries({ ...parameters, api_key: this.env.SERPAPI_API_KEY })) url.searchParams.set(key, value);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(url, { signal: controller.signal });
      const payload = await response.json().catch(() => undefined) as SerpApiSearchResponse | undefined;
      if (!response.ok || payload?.error) {
        throw new SerpApiError(payload?.error || `SerpApi returned HTTP ${response.status}.`, 'UPSTREAM_FAILURE');
      }
      return payload ?? {};
    } catch (error) {
      if (error instanceof SerpApiError) throw error;
      throw new SerpApiError('SerpApi request failed.', 'UPSTREAM_FAILURE');
    } finally {
      clearTimeout(timeout);
    }
  }
}

function mapFlightSearch(raw: SerpApiSearchResponse, currency: string, now: Date): FlightSearchResult {
  const fetchedAt = now.toISOString();
  const expiresAt = new Date(now.getTime() + 5 * 60_000).toISOString();
  const evidence = {
    source: 'serpapi' as const,
    fetchedAt,
    expiresAt,
    attribution: 'Google Flights results via SerpApi',
    freshness: 'recent' as const,
  };
  const flights = collectFlights(raw).flatMap((flight, index) => {
    if (!isPositiveNumber(flight.price) || !flight.flights?.length) return [];
    const segments = flight.flights.flatMap((segment) => {
      if (!segment.airline || !segment.departure_airport?.id || !segment.arrival_airport?.id) return [];
      return [{
        airline: segment.airline,
        flightNumber: segment.flight_number,
        airlineLogoUrl: safePublicUrl(segment.airline_logo),
        departureAirport: segment.departure_airport.id,
        arrivalAirport: segment.arrival_airport.id,
        departureTime: segment.departure_airport.time,
        arrivalTime: segment.arrival_airport.time,
        durationMinutes: isPositiveNumber(segment.duration) ? Math.round(segment.duration) : undefined,
      }];
    });
    if (!segments.length) return [];
    const airlineSummary = [...new Set(segments.map((segment) => segment.airline))].join(' · ');
    return [{
      id: `${index}-${segments.map((segment) => segment.flightNumber ?? `${segment.departureAirport}${segment.arrivalAirport}`).join('-')}`,
      price: flight.price,
      tripType: flight.type ?? 'Flight',
      totalDurationMinutes: isPositiveNumber(flight.total_duration) ? Math.round(flight.total_duration) : undefined,
      stops: Math.max(0, segments.length - 1),
      airlineSummary,
      airlineLogoUrl: safePublicUrl(flight.airline_logo) ?? segments[0]?.airlineLogoUrl,
      carbonKg: isPositiveNumber(flight.carbon_emissions?.this_flight) ? Math.round(flight.carbon_emissions.this_flight / 1_000) : undefined,
      bookingToken: flight.booking_token,
      segments,
      evidence,
    }];
  }).slice(0, 12);
  const insight = raw.price_insights?.price_level
    ? `${raw.price_insights.price_level} price level${isPositiveNumber(raw.price_insights.lowest_price) ? `; lowest observed ${currency} ${raw.price_insights.lowest_price.toLocaleString()}` : ''}.`
    : undefined;
  return {
    status: flights.length ? 'results' : 'unavailable',
    generatedAt: fetchedAt,
    cacheExpiresAt: expiresAt,
    currency,
    flights,
    priceInsight: insight,
    warnings: flights.length
      ? ['Flight prices are recent Google Flights snapshots supplied by SerpApi, not a guaranteed fare. Confirm before purchase.']
      : ['No usable flight results were returned for this route and date.'],
  };
}

function collectFlights(raw: SerpApiSearchResponse): SerpApiFlight[] { return [...(raw.best_flights ?? []), ...(raw.other_flights ?? [])]; }
function flightSearchParameters(input: FlightSearchInput): Record<string, string> {
  return {
    engine: 'google_flights',
    departure_id: input.departureId,
    arrival_id: input.arrivalId,
    outbound_date: input.outboundDate,
    ...(input.returnDate ? { return_date: input.returnDate, type: '1' } : { type: '2' }),
    adults: String(input.adults),
    ...(input.children ? { children: String(input.children) } : {}),
    currency: input.currency,
    gl: 'us',
    hl: 'en',
  };
}
function isPositiveNumber(value: unknown): value is number { return typeof value === 'number' && Number.isFinite(value) && value > 0; }
function safePublicUrl(value: unknown): string | undefined { try { return typeof value === 'string' && new URL(value).protocol === 'https:' ? value : undefined; } catch { return undefined; } }
