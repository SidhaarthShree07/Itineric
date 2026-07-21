import { startTransition, useState, type FormEvent } from 'react';
import type { FlightBookingOptionsResult, FlightSearchInput, FlightSearchResult } from '@atlas/contracts';
import { getFlightBookingOptions, searchFlights } from '../lib/api';

const initialForm: FlightSearchInput = {
  departureId: 'DEL',
  arrivalId: 'CDG',
  outboundDate: '2026-08-14',
  returnDate: '2026-08-17',
  adults: 1,
  children: 0,
  currency: 'EUR',
};

export function FlightSearch() {
  const [form, setForm] = useState<FlightSearchInput>(initialForm);
  const [result, setResult] = useState<FlightSearchResult>();
  const [searchContext, setSearchContext] = useState<FlightSearchInput>();
  const [quotes, setQuotes] = useState<Record<string, FlightBookingOptionsResult>>({});
  const [isPending, setIsPending] = useState(false);
  const [quoteLoading, setQuoteLoading] = useState<string>();
  const [error, setError] = useState<string>();

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsPending(true); setError(undefined); setQuotes({});
    try {
      const submittedSearch = { ...form, departureId: form.departureId.toUpperCase(), arrivalId: form.arrivalId.toUpperCase() };
      const next = await searchFlights(submittedSearch);
      startTransition(() => { setResult(next); setSearchContext(submittedSearch); });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to search flights.');
    } finally { setIsPending(false); }
  }

  async function loadQuotes(id: string, bookingToken: string) {
    if (!searchContext) { setError('Run the flight search again before loading provider fare options.'); return; }
    setQuoteLoading(id); setError(undefined);
    try {
      const options = await getFlightBookingOptions(bookingToken, searchContext);
      setQuotes((current) => ({ ...current, [id]: options }));
    }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to load booking options.'); }
    finally { setQuoteLoading(undefined); }
  }

  return <section className="hotel-panel flight-search-panel" aria-labelledby="flight-search-title">
    <div className="section-heading"><div><p className="eyebrow">Flight intelligence</p><h2 id="flight-search-title">Compare flight options</h2></div></div>
    <form className="hotel-form flight-form" onSubmit={onSubmit}>
      <label>From (IATA)<input value={form.departureId} maxLength={3} onChange={(event) => setForm({ ...form, departureId: event.target.value.toUpperCase() })} required /></label>
      <label>To (IATA)<input value={form.arrivalId} maxLength={3} onChange={(event) => setForm({ ...form, arrivalId: event.target.value.toUpperCase() })} required /></label>
      <label>Depart<input type="date" value={form.outboundDate} onChange={(event) => setForm({ ...form, outboundDate: event.target.value })} required /></label>
      <label>Return<input type="date" value={form.returnDate ?? ''} onChange={(event) => setForm({ ...form, returnDate: event.target.value || undefined })} /></label>
      <label>Travellers<input type="number" min="1" max="9" value={form.adults} onChange={(event) => setForm({ ...form, adults: Number(event.target.value) })} required /></label>
      <button type="submit" disabled={isPending}>{isPending ? 'Searching…' : 'Search flights'}</button>
    </form>
    {error ? <p className="error-message" role="alert">{error}</p> : null}
    {result ? <div className="flight-results" aria-live="polite">
      {result.priceInsight ? <p className="hotel-warning">{result.priceInsight}</p> : null}
      {result.flights.map((flight, flightIndex) => {
        const options = quotes[flight.id];
        const first = flight.segments[0];
        const last = flight.segments[flight.segments.length - 1];
        return <article className="flight-card" key={flight.id} style={{ '--flight-index': flightIndex } as React.CSSProperties}>
          <header className="flight-card-head">
            <div className="flight-brand">{flight.airlineLogoUrl ? <img src={flight.airlineLogoUrl} alt="" loading="lazy" /> : <span className="flight-brand-fallback" aria-hidden="true">✈</span>}<div><h3>{flight.airlineSummary}</h3><p>{flight.tripType}</p></div></div>
            <div className="flight-price"><span>from</span><strong>{result.currency} {flight.price.toLocaleString()}</strong></div>
          </header>
          <div className="flight-route" role="group" aria-label="Route summary">
            <div className="flight-endpoint"><strong>{first?.departureAirport ?? '—'}</strong><span>{formatTime(first?.departureTime)}</span></div>
            <div className="flight-path"><span className="flight-path-dur">{formatMinutes(flight.totalDurationMinutes)}</span><span className="flight-path-line" data-stops={flight.stops} aria-hidden="true"><i /></span><span className="flight-path-stops">{flight.stops === 0 ? 'Nonstop' : `${flight.stops} stop${flight.stops === 1 ? '' : 's'}`}</span></div>
            <div className="flight-endpoint is-arrival"><strong>{last?.arrivalAirport ?? '—'}</strong><span>{formatTime(last?.arrivalTime)}</span></div>
          </div>
          <details className="flight-segments"><summary>Flight details{flight.carbonKg ? ` · ${flight.carbonKg.toLocaleString()} kg CO₂` : ''}</summary>
            <ul>{flight.segments.map((segment) => <li key={`${flight.id}-${segment.flightNumber ?? `${segment.departureAirport}-${segment.arrivalAirport}`}`}><strong>{segment.airline}{segment.flightNumber ? ` ${segment.flightNumber}` : ''}</strong><span>{segment.departureAirport} {formatTime(segment.departureTime)} → {segment.arrivalAirport} {formatTime(segment.arrivalTime)} · {formatMinutes(segment.durationMinutes)}</span></li>)}</ul>
          </details>
          {flight.bookingToken ? <button className="quote-button" type="button" disabled={quoteLoading === flight.id} onClick={() => void loadQuotes(flight.id, flight.bookingToken!)}>{quoteLoading === flight.id ? 'Loading fare options…' : 'Show booking options'}</button> : null}
          {options ? <div className="flight-quotes"><p>{options.options.length ? 'Provider fare quotes' : 'No separate provider quote is available for this fare. The displayed search fare remains the latest estimate.'}</p>{options.options.map((option, index) => <span className="flight-quote" key={`${option.source}-${index}`}><strong>{option.source}</strong><span className="flight-quote-price">{option.price ? `${options.currency} ${option.price.toLocaleString()}` : 'Price on request'}</span></span>)}{options.warnings.map((warning) => <small key={warning}>{warning}</small>)}</div> : null}
        </article>;
      })}
      {result.warnings.map((warning) => <p className="hotel-warning" key={warning}>{warning}</p>)}
    </div> : null}
  </section>;
}

function formatMinutes(minutes: number | undefined): string { if (!minutes) return 'Duration unavailable'; return `${Math.floor(minutes / 60)}h ${minutes % 60}m`; }
function formatTime(value: string | undefined): string { return value?.split(' ').at(-1) ?? 'time TBC'; }
