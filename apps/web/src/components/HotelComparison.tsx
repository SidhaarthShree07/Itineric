import { startTransition, useState, type FormEvent } from 'react';
import type { HotelComparisonInput, HotelComparisonResult } from '@atlas/contracts';
import { compareHotels, hotelImageProxyUrl } from '../lib/api';

const initialForm: HotelComparisonInput = {
  destination: 'Paris, France', checkIn: '2026-08-14', checkOut: '2026-08-17', adults: 2, rooms: 1, children: 0, maxPricePerNight: 220, currency: 'EUR',
};

export function HotelComparison() {
  const [form, setForm] = useState<HotelComparisonInput>(initialForm);
  const [result, setResult] = useState<HotelComparisonResult>();
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string>();

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setIsPending(true); setError(undefined);
    try { const nextResult = await compareHotels(form); startTransition(() => setResult(nextResult)); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to compare hotels.'); }
    finally { setIsPending(false); }
  }

  return <section className="hotel-panel hotel-comparison-panel" aria-labelledby="hotel-comparison-title">
    <div className="section-heading"><div><p className="eyebrow">Stay intelligence</p><h2 id="hotel-comparison-title">Compare hotel prices</h2></div></div>
    <form className="hotel-form" onSubmit={onSubmit}>
      <label>Destination<input value={form.destination} onChange={(event) => setForm({ ...form, destination: event.target.value })} required /></label>
      <label>Check-in<input type="date" value={form.checkIn} onChange={(event) => setForm({ ...form, checkIn: event.target.value })} required /></label>
      <label>Check-out<input type="date" value={form.checkOut} onChange={(event) => setForm({ ...form, checkOut: event.target.value })} required /></label>
      <label>Guests<input type="number" min="1" max="12" value={form.adults} onChange={(event) => setForm({ ...form, adults: Number(event.target.value) })} required /></label>
      <label>Nightly cap ({form.currency})<input type="number" min="1" value={form.maxPricePerNight} onChange={(event) => setForm({ ...form, maxPricePerNight: Number(event.target.value) })} required /></label>
      <button type="submit" disabled={isPending}>{isPending ? 'Checking inventory…' : 'Compare stays'}</button>
    </form>
    {error ? <p className="error-message" role="alert">{error}</p> : null}
    {result ? <HotelResults result={result} /> : null}
  </section>;
}

function HotelResults({ result }: { result: HotelComparisonResult }) {
  return <div className="stay-results" aria-live="polite">
    {result.hotels.map((hotel, cardIndex) => {
      const cheapestIndex = hotel.prices.reduce((min, price, index) => price.estimatedPricePerNight < hotel.prices[min]!.estimatedPricePerNight ? index : min, 0);
      const cheapest = hotel.prices[cheapestIndex];
      return <article className="stay-card" key={hotel.name} style={{ '--stay-index': cardIndex } as React.CSSProperties}>
        <div className="stay-card-media">
          {hotel.imageUrl ? <HotelImage sourceUrl={hotel.imageUrl} hotelName={hotel.name} /> : <HotelImageFallback hotelName={hotel.name} />}
          {hotel.rating !== null ? <span className="stay-rating"><i aria-hidden="true">★</i>{hotel.rating.toFixed(1)}</span> : null}
          {cheapest ? <span className="stay-best-badge">Best {cheapest.currency} {cheapest.estimatedPricePerNight.toLocaleString()}<small>/ night</small></span> : null}
        </div>
        <div className="stay-card-body">
          <div className="stay-card-head"><h3>{hotel.name}</h3><p>{[hotel.area, hotel.hotelClass, hotel.ratingSource].filter(Boolean).join(' · ')}</p></div>
          {hotel.description ? <p className="stay-description">{hotel.description}</p> : null}
          <div className="stay-price-row">{hotel.prices.map((price, index) => <a key={`${hotel.name}-${price.platform}`} className={`stay-price-chip${index === cheapestIndex ? ' is-best' : ''}`} href={price.sourceUrl} target="_blank" rel="noreferrer">
            <span className="stay-price-platform">{price.platform}</span>
            <strong>{price.currency} {price.estimatedPricePerNight.toLocaleString()}</strong>
          </a>)}</div>
          {hotel.amenities?.length ? <p className="stay-amenities">{hotel.amenities.slice(0, 6).join(' · ')}</p> : null}
          {hotel.bookingUrl ? <a className="stay-direct-link" href={hotel.bookingUrl} target="_blank" rel="noreferrer">Visit hotel website →</a> : null}
        </div>
      </article>;
    })}
    <div className="fallback-searches"><p>{result.status === 'fallback_links' ? 'Search on a booking platform:' : 'Verify more options:'}</p>{result.fallbackLinks.map((link) => <a key={link.platform} href={link.url} target="_blank" rel="noreferrer">{link.platform}</a>)}</div>
    {result.warnings.map((warning) => <p className="hotel-warning" key={warning}>{warning}</p>)}
  </div>;
}

function HotelImage({ sourceUrl, hotelName }: { sourceUrl: string; hotelName: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) return <HotelImageFallback hotelName={hotelName} />;
  return <img className="hotel-image" src={hotelImageProxyUrl(sourceUrl)} alt={`Exterior of ${hotelName}`} loading="eager" decoding="async" onError={() => setFailed(true)} />;
}

function HotelImageFallback({ hotelName }: { hotelName: string }) {
  return <div className="hotel-image hotel-image-fallback" role="img" aria-label={`Photo unavailable for ${hotelName}`}><span>Hotel photo unavailable</span></div>;
}
