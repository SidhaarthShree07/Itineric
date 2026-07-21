import {
  flightBookingOptionsResultSchema,
  flightSearchInputSchema,
  flightSearchResultSchema,
  hotelComparisonInputSchema,
  hotelComparisonResultSchema,
  tripChatInputSchema,
  tripChatResultSchema,
  tripCreateResultSchema,
  tripPlanningInputSchema,
  tripRecordSchema,
  tripReplanInputSchema,
  tripRouteModeSchema,
  tripRouteOptionsResultSchema,
  tripRouteResultSchema,
  voiceTripIntakeInputSchema,
  voiceTripIntakeResultSchema,
  type HotelComparisonInput,
  type HotelComparisonResult,
  type FlightBookingOptionsResult,
  type FlightSearchInput,
  type FlightSearchResult,
  type TripChatResult,
  type TripCreateResult,
  type TripPlanningInput,
  type TripRecord,
  type TripReplanInput,
  type TripRouteMode,
  type TripRouteOptionsResult,
  type TripRouteResult,
  type VoiceTripIntakeResult,
} from '@atlas/contracts';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8787';

export async function compareHotels(input: HotelComparisonInput): Promise<HotelComparisonResult> {
  const validated = hotelComparisonInputSchema.parse(input);
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 45_000);
  try {
    const response = await fetch(`${API_BASE_URL}/v1/hotels/compare`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(validated),
      signal: controller.signal,
    });
    const payload = (await response.json()) as unknown;
    if (!response.ok) {
      throw new Error('The hotel comparison service is unavailable. Please try again.');
    }
    return hotelComparisonResultSchema.parse(payload);
  } finally {
    window.clearTimeout(timeout);
  }
}

export async function searchFlights(input: FlightSearchInput): Promise<FlightSearchResult> {
  const validated = flightSearchInputSchema.parse(input);
  const response = await request('/v1/flights/search', { method: 'POST', body: validated });
  return flightSearchResultSchema.parse(response);
}

export async function getFlightBookingOptions(bookingToken: string, search: FlightSearchInput): Promise<FlightBookingOptionsResult> {
  const response = await request('/v1/flights/booking-options', { method: 'POST', body: { bookingToken, search } });
  return flightBookingOptionsResultSchema.parse(response);
}

export function hotelImageProxyUrl(sourceUrl: string): string {
  const proxy = new URL('/v1/media/hotel-image', API_BASE_URL);
  proxy.searchParams.set('url', sourceUrl);
  return proxy.toString();
}

const WORKSPACE_TOKEN_KEY = 'project-atlas.workspace-token.v1';

export async function createTrip(input: TripPlanningInput): Promise<TripCreateResult> {
  const result = tripCreateResultSchema.parse(await request('/v1/trips', {
    method: 'POST', body: tripPlanningInputSchema.parse(input),
  }));
  if (result.workspaceToken) window.localStorage.setItem(WORKSPACE_TOKEN_KEY, result.workspaceToken);
  return result;
}

export async function listTrips(): Promise<Array<Omit<TripRecord, 'plan'>>> {
  if (!workspaceToken()) return [];
  const result = await request('/v1/trips');
  return (result as { trips: Array<Omit<TripRecord, 'plan'>> }).trips;
}

export async function getTrip(tripId: string): Promise<TripRecord> {
  const payload = await request(`/v1/trips/${encodeURIComponent(tripId)}`);
  return tripRecordSchema.parse((payload as { trip: unknown }).trip);
}

export async function getTripRoute(tripId: string, mode: TripRouteMode): Promise<TripRouteResult> {
  const validatedMode = tripRouteModeSchema.parse(mode);
  const payload = await request(`/v1/trips/${encodeURIComponent(tripId)}/route?mode=${encodeURIComponent(validatedMode)}`);
  return tripRouteResultSchema.parse(payload);
}

export async function getTripRouteOptions(tripId: string): Promise<TripRouteOptionsResult> {
  const payload = await request(`/v1/trips/${encodeURIComponent(tripId)}/routes`);
  return tripRouteOptionsResultSchema.parse(payload);
}

export async function replanTrip(tripId: string, input: TripReplanInput): Promise<TripRecord> {
  const payload = await request(`/v1/trips/${encodeURIComponent(tripId)}/replan`, {
    method: 'PUT', body: tripReplanInputSchema.parse(input),
  });
  return tripRecordSchema.parse((payload as { trip: unknown }).trip);
}

export async function chatTrip(tripId: string, message: string): Promise<TripChatResult> {
  return tripChatResultSchema.parse(await request(`/v1/trips/${encodeURIComponent(tripId)}/chat`, {
    method: 'POST', body: tripChatInputSchema.parse({ message }),
  }));
}

/**
 * The browser transcribes locally through SpeechRecognition. This Worker call
 * only extracts a reviewable draft and uses the existing workspace token when
 * there is one, never an AI credential in the PWA bundle.
 */
export async function extractVoiceTrip(transcript: string): Promise<VoiceTripIntakeResult> {
  const payload = await request('/v1/trip-intake/voice', {
    method: 'POST',
    body: voiceTripIntakeInputSchema.parse({ transcript }),
  });
  return voiceTripIntakeResultSchema.parse(payload);
}

async function request(path: string, options: { method?: 'POST' | 'PUT'; body?: unknown } = {}): Promise<unknown> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 90_000);
  try {
    const response = await fetch(`${API_BASE_URL}${path}`, {
      method: options.method ?? 'GET',
      headers: {
        'content-type': 'application/json',
        ...(workspaceToken() ? { 'x-atlas-workspace-token': workspaceToken()! } : {}),
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: controller.signal,
    });
    const payload = (await response.json()) as { error?: { message?: string } };
    if (!response.ok) throw new Error(payload.error?.message ?? 'The trip service is unavailable.');
    return payload;
  } finally {
    window.clearTimeout(timeout);
  }
}

function workspaceToken(): string | null {
  return window.localStorage.getItem(WORKSPACE_TOKEN_KEY);
}
