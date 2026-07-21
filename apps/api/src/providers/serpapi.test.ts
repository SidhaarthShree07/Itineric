import { afterEach, describe, expect, it, vi } from 'vitest';
import { SerpApiClient } from './serpapi';

const env = { SERPAPI_API_KEY: 'test-key' } as never;

describe('SerpApiClient', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('uses structured Google Hotels properties instead of an LLM response', async () => {
    const fetch = vi.fn(async () => jsonResponse({ properties: [{ type: 'hotel', name: 'Example Stay', rate_per_night: { extracted_lowest: 180 } }] }));
    vi.stubGlobal('fetch', fetch);
    const result = await new SerpApiClient(env).searchHotels({
      destination: 'Paris, France', checkIn: '2026-08-14', checkOut: '2026-08-17', adults: 2, children: 0, rooms: 1, maxPricePerNight: 220, currency: 'EUR',
    });
    expect(result.properties[0]?.name).toBe('Example Stay');
    const calledInput = (fetch.mock.calls as unknown as Array<[string | URL | Request]>)[0]?.[0];
    expect(calledInput).toBeDefined();
    const url = new URL(calledInput instanceof Request ? calledInput.url : String(calledInput));
    expect(url.searchParams.get('engine')).toBe('google_hotels');
    expect(url.searchParams.get('max_price')).toBe('220');
  });

  it('follows a round-trip departure token and retains carrier, fare, and booking-token data', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ best_flights: [{ departure_token: 'departure-token' }] }))
      .mockResolvedValueOnce(jsonResponse({ best_flights: [{
        price: 900, type: 'Round trip', total_duration: 600, booking_token: 'booking-token-which-is-long-enough',
        carbon_emissions: { this_flight: 128000 },
        flights: [{ airline: 'Example Air', airline_logo: 'https://example.com/air.png', flight_number: 'EA 101', duration: 600, departure_airport: { id: 'DEL', time: '2026-08-14 09:00' }, arrival_airport: { id: 'CDG', time: '2026-08-14 16:00' } }],
      }] }));
    vi.stubGlobal('fetch', fetch);
    const result = await new SerpApiClient(env).searchFlights({ departureId: 'DEL', arrivalId: 'CDG', outboundDate: '2026-08-14', returnDate: '2026-08-17', adults: 1, children: 0, currency: 'EUR' });
    expect(fetch).toHaveBeenCalledTimes(2);
    const secondRequest = new URL((fetch.mock.calls as unknown as Array<[string | URL | Request]>)[1]![0]!.toString());
    expect(secondRequest.searchParams.get('departure_id')).toBe('DEL');
    expect(result.flights[0]).toMatchObject({ price: 900, airlineSummary: 'Example Air', bookingToken: 'booking-token-which-is-long-enough', carbonKg: 128 });
  });

  it('converts booking options to provider quotes without exposing a non-functional POST handoff as a link', async () => {
    const fetch = vi.fn(async () => jsonResponse({ booking_options: [{ together: { book_with: 'Example Air', price: 490, local_prices: [{ currency: 'EUR', price: 450 }], booking_request: { url: 'https://www.google.com/travel/clk/f' } } }] }));
    vi.stubGlobal('fetch', fetch);
    const result = await new SerpApiClient(env).bookingOptions('booking-token-which-is-long-enough', {
      departureId: 'DEL', arrivalId: 'CDG', outboundDate: '2026-08-14', returnDate: '2026-08-17', adults: 1, children: 0, currency: 'EUR',
    });
    const calledInput = (fetch.mock.calls as unknown as Array<[string | URL | Request]>)[0]?.[0];
    const url = new URL(String(calledInput));
    expect(url.searchParams.get('booking_token')).toBe('booking-token-which-is-long-enough');
    expect(url.searchParams.get('departure_id')).toBe('DEL');
    expect(url.searchParams.get('return_date')).toBe('2026-08-17');
    expect(result.options[0]).toMatchObject({ source: 'Example Air', price: 450 });
    expect(result.options[0]).not.toHaveProperty('bookingUrl');
  });
});

function jsonResponse(payload: unknown): Response { return new Response(JSON.stringify(payload), { status: 200, headers: { 'content-type': 'application/json' } }); }
