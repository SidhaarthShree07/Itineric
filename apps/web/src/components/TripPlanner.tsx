import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import type { TripPlan, TripPlanningInput, TripRecord, TravelPace, TravelStyle, VoiceTripIntakeDraft } from '@atlas/contracts';
import { chatTrip, createTrip, getTrip, listTrips, replanTrip } from '../lib/api';
import { VoiceTripIntake } from './VoiceTripIntake';

const allInterests = ['art', 'architecture', 'beaches', 'food', 'history', 'nature', 'nightlife', 'photography', 'shopping', 'wellness'] as const;
const cuisineSuggestions = ['French', 'Italian', 'Japanese', 'Vegetarian-friendly', 'Vegan', 'Street food', 'Seafood', 'Fine dining'];
const avoidSuggestions = ['Long walks', 'Nightlife', 'Crowds', 'Early mornings', 'Spicy food', 'Tourist traps'];

const chatPrompts = [
  'Make day two more relaxed',
  'Add a vegetarian dinner',
  'Lower the budget by 200',
  'More local hidden gems',
];

type ChatMessage = { id: string; role: 'user' | 'assistant'; text: string; pending?: boolean };
type TripMediaItem = NonNullable<TripPlan['media']>['attractions'][number];
type ItineraryItem = TripPlan['itinerary'][number]['items'][number];

const initialInput: TripPlanningInput = {
  destination: 'Paris, France',
  startDate: '2026-08-14',
  endDate: '2026-08-17',
  adults: 2,
  children: 0,
  rooms: 1,
  currency: 'EUR',
  totalBudget: 1600,
  travelStyle: 'balanced',
  pace: 'balanced',
  interests: ['food', 'history', 'art'],
  cuisines: ['French', 'Vegetarian-friendly'],
  avoid: [],
};

function messageId(): string {
  return `m_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

function greetingFor(trip: TripRecord): ChatMessage {
  return {
    id: messageId(),
    role: 'assistant',
    text: `Your ${trip.destination} plan is ready as version ${trip.latestVersion}. Ask me to adjust the pace, budget, food, or any day, and I will reshape the route.`,
  };
}

export function TripPlanner({ onTripChange }: { onTripChange?: (trip: TripRecord) => void }) {
  const [input, setInput] = useState<TripPlanningInput>(initialInput);
  const [trip, setTrip] = useState<TripRecord>();
  const [savedTrips, setSavedTrips] = useState<Array<Omit<TripRecord, 'plan'>>>([]);
  const [chat, setChat] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [message, setMessage] = useState<string>();
  const [isWorking, setIsWorking] = useState(false);

  const adoptTrip = useCallback((next: TripRecord, options?: { fresh?: boolean }) => {
    setTrip((current) => {
      if (options?.fresh || current?.id !== next.id) setMessages([greetingFor(next)]);
      return next;
    });
    onTripChange?.(next);
  }, [onTripChange]);

  const applyVoiceDraft = useCallback((draft: VoiceTripIntakeDraft) => {
    setInput((current) => {
      const next: TripPlanningInput = { ...current };
      if (draft.destination !== undefined) next.destination = draft.destination;
      if (draft.startDate !== undefined) next.startDate = draft.startDate;
      if (draft.endDate !== undefined) next.endDate = draft.endDate;
      if (draft.days !== undefined) {
        next.days = draft.days;
        if (draft.startDate === undefined && draft.endDate === undefined) {
          next.startDate = undefined;
          next.endDate = undefined;
        }
      }
      if (draft.adults !== undefined) next.adults = draft.adults;
      if (draft.children !== undefined) next.children = draft.children;
      if (draft.rooms !== undefined) next.rooms = draft.rooms;
      if (draft.currency !== undefined) next.currency = draft.currency;
      if (draft.totalBudget !== undefined) next.totalBudget = draft.totalBudget;
      if (draft.travelStyle !== undefined) next.travelStyle = draft.travelStyle;
      if (draft.pace !== undefined) next.pace = draft.pace;
      if (draft.interests !== undefined) next.interests = draft.interests;
      if (draft.cuisines !== undefined) next.cuisines = draft.cuisines;
      if (draft.accommodationNotes !== undefined) next.accommodationNotes = draft.accommodationNotes;
      if (draft.accessibilityNotes !== undefined) next.accessibilityNotes = draft.accessibilityNotes;
      if (draft.avoid !== undefined) next.avoid = draft.avoid;
      return next;
    });
    setMessage(Object.keys(draft).length ? 'Your voice note is in the editable trip fields below. Review it, then create the plan.' : 'Your note is ready to review. Add the missing trip details in the form below.');
  }, []);

  useEffect(() => {
    void listTrips().then(async (saved) => {
      setSavedTrips(saved);
      if (saved[0]) {
        const loaded = await getTrip(saved[0].id);
        adoptTrip(loaded);
      }
    }).catch(() => undefined);
  }, [adoptTrip]);

  async function planTrip(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsWorking(true); setMessage(undefined);
    try {
      const result = await createTrip(input);
      adoptTrip(result.trip, { fresh: true });
      setSavedTrips((current) => [{ ...result.trip, plan: undefined } as Omit<TripRecord, 'plan'>, ...current]);
      setMessage('Your trip is saved in this browser workspace.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to create this trip.');
    } finally { setIsWorking(false); }
  }

  async function regenerate() {
    if (!trip) return;
    setIsWorking(true); setMessage(undefined);
    try {
      const next = await replanTrip(trip.id, { changes: 'Regenerate this itinerary using verified locations, route times, and licensed imagery.' });
      adoptTrip(next);
      setMessage(`Saved plan version ${next.latestVersion}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to regenerate this trip.');
    } finally { setIsWorking(false); }
  }

  const sendChatMessage = useCallback(async (raw: string) => {
    const text = raw.trim();
    if (!trip || !text || isWorking) return;
    const userMessage: ChatMessage = { id: messageId(), role: 'user', text };
    const pending: ChatMessage = { id: messageId(), role: 'assistant', text: 'Reshaping your route...', pending: true };
    setMessages((current) => [...current, userMessage, pending]);
    setChat('');
    setIsWorking(true); setMessage(undefined);
    try {
      const result = await chatTrip(trip.id, text);
      if (result.trip) adoptTrip(result.trip);
      setMessages((current) => current.map((entry) => entry.id === pending.id
        ? { id: entry.id, role: 'assistant', text: result.reply }
        : entry));
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'That change could not be applied. Try rephrasing it.';
      setMessages((current) => current.map((entry) => entry.id === pending.id
        ? { id: entry.id, role: 'assistant', text: reason }
        : entry));
    } finally { setIsWorking(false); }
  }, [trip, isWorking, adoptTrip]);

  async function onChatSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await sendChatMessage(chat);
  }

  return (
    <section className="hotel-panel trip-planner-panel" aria-labelledby="trip-planner-title">
      <div className="section-heading"><div><p className="eyebrow">Your trip brief</p><h2 id="trip-planner-title">Start with the shape of the journey.</h2><p className="section-description">Make the essentials clear first. You can refine every detail before Itineric starts planning.</p></div></div>
      <VoiceTripIntake onDraftReady={applyVoiceDraft} />
      <form className="hotel-form planning-form" onSubmit={planTrip}>
        <section className="planning-form-section" aria-labelledby="planning-essentials-title">
          <div className="planning-section-heading"><span className="planning-step">01</span><div><h3 id="planning-essentials-title">The essentials</h3><p>Where you are going, when, and who is travelling.</p></div></div>
          <div className="planning-grid planning-grid-essentials">
            <label className="field-destination">Destination<input value={input.destination} onChange={(event) => setInput({ ...input, destination: event.target.value })} required /></label>
            <label>Start date<input type="date" value={input.startDate ?? ''} onChange={(event) => setInput({ ...input, startDate: event.target.value || undefined, days: event.target.value ? undefined : input.days })} /></label>
            <label>End date<input type="date" value={input.endDate ?? ''} onChange={(event) => setInput({ ...input, endDate: event.target.value || undefined, days: event.target.value ? undefined : input.days })} /></label>
            <label>Trip length<NumberField min={1} max={21} value={input.days} onValueChange={(days) => setInput({ ...input, days, ...(days ? { startDate: undefined, endDate: undefined } : {}) })} placeholder="Days" /></label>
            <label>Adults<NumberField min={1} max={12} value={input.adults} onValueChange={(adults) => setInput({ ...input, adults: adults ?? 1 })} /></label>
            <label>Children<NumberField min={0} max={10} value={input.children} onValueChange={(children) => setInput({ ...input, children: children ?? 0 })} /></label>
            <label>Rooms<NumberField min={1} max={6} value={input.rooms} onValueChange={(rooms) => setInput({ ...input, rooms: rooms ?? 1 })} /></label>
          </div>
        </section>
        <section className="planning-form-section" aria-labelledby="planning-preferences-title">
          <div className="planning-section-heading"><span className="planning-step">02</span><div><h3 id="planning-preferences-title">Your preferences</h3><p>Set the rhythm, the budget, and the details that matter.</p></div></div>
          <div className="planning-grid planning-grid-preferences">
            <SelectField label="Travel style" value={input.travelStyle} onChange={(value) => setInput({ ...input, travelStyle: value as TravelStyle })} options={[{ value: 'budget', label: 'Budget' }, { value: 'balanced', label: 'Balanced' }, { value: 'comfort', label: 'Comfort' }, { value: 'luxury', label: 'Luxury' }]} />
            <SelectField label="Pace" value={input.pace} onChange={(value) => setInput({ ...input, pace: value as TravelPace })} options={[{ value: 'relaxed', label: 'Relaxed' }, { value: 'balanced', label: 'Balanced' }, { value: 'fast', label: 'Fast' }]} />
            <label>Budget ({input.currency})<NumberField min={1} value={input.totalBudget} onValueChange={(totalBudget) => setInput({ ...input, totalBudget: totalBudget ?? 1 })} /></label>
            <label>Currency<input value={input.currency} maxLength={3} onChange={(event) => setInput({ ...input, currency: event.target.value.toUpperCase() })} aria-label="Currency code" required /></label>
            <TagField className="field-wide" label="Interests" values={input.interests} options={allInterests as unknown as string[]} allowCustom onChange={(next) => setInput({ ...input, interests: next })} placeholder="Search or add interests" />
            <TagField className="field-wide" label="Preferred cuisines" values={input.cuisines} options={cuisineSuggestions} allowCustom onChange={(next) => setInput({ ...input, cuisines: next })} placeholder="Add a cuisine and press enter" />
            <label>Stay notes<input value={input.accommodationNotes ?? ''} onChange={(event) => setInput({ ...input, accommodationNotes: event.target.value || undefined })} placeholder="Quiet, central, near transit" /></label>
            <label>Accessibility<input value={input.accessibilityNotes ?? ''} onChange={(event) => setInput({ ...input, accessibilityNotes: event.target.value || undefined })} placeholder="Step-free routes" /></label>
            <TagField className="field-wide" label="Avoid" values={input.avoid} options={avoidSuggestions} allowCustom onChange={(next) => setInput({ ...input, avoid: next })} placeholder="Add anything to avoid" />
          </div>
        </section>
        <div className="planning-form-submit"><p>Itineric will organize the route, timings, and planning notes around this brief.</p><button type="submit" disabled={isWorking}>{isWorking ? 'Planning...' : 'Create your trip plan'}</button></div>
      </form>

      {savedTrips.length > 0 ? <label className="trip-saved-picker">Saved trips<select value={trip?.id ?? ''} onChange={(event) => { const id = event.target.value; if (id) void getTrip(id).then((loaded) => adoptTrip(loaded)).catch(() => setMessage('Unable to load that trip.')); }}><option value="">Choose a saved trip</option>{savedTrips.map((saved) => <option key={saved.id} value={saved.id}>{saved.title}</option>)}</select></label> : null}
      {message ? <p className="hotel-warning" role="status">{message}</p> : null}
      {trip ? <TripPlanView
        trip={trip}
        chat={chat}
        setChat={setChat}
        messages={messages}
        onChat={onChatSubmit}
        onQuickPrompt={(prompt) => void sendChatMessage(prompt)}
        onRegenerate={regenerate}
        isWorking={isWorking}
      /> : null}
    </section>
  );
}

/* ---- Custom select (blurred menu, matches the tag field) ------------------ */

function SelectField({ label, value, options, onChange, className }: {
  label: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => { if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const current = options.find((option) => option.value === value);
  return <div className={`select-field${className ? ` ${className}` : ''}`} ref={rootRef}>
    <span className="tag-field-label">{label}</span>
    <button type="button" className={`select-field-control${open ? ' is-open' : ''}`} aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
      <span>{current?.label ?? 'Select'}</span>
      <i aria-hidden="true" className="select-field-caret">▾</i>
    </button>
    {open ? <div className="select-field-menu" role="listbox">
      {options.map((option) => <button type="button" key={option.value} role="option" aria-selected={option.value === value} className={`select-field-option${option.value === value ? ' is-selected' : ''}`} onClick={() => { onChange(option.value); setOpen(false); }}>{option.label}{option.value === value ? <span aria-hidden="true">✓</span> : null}</button>)}
    </div> : null}
  </div>;
}

/* ---- Tag / token input ---------------------------------------------------- */

function TagField({ label, values, options, onChange, placeholder, allowCustom = false, className }: {
  label: string;
  values: string[];
  options: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  allowCustom?: boolean;
  className?: string;
}) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => { if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const selectedLower = new Set(values.map((value) => value.toLocaleLowerCase()));
  const suggestions = options.filter((option) => !selectedLower.has(option.toLocaleLowerCase()) && option.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));

  const add = (raw: string) => {
    const value = raw.trim();
    if (!value || selectedLower.has(value.toLocaleLowerCase())) { setQuery(''); return; }
    onChange([...values, value]);
    setQuery('');
  };
  const remove = (value: string) => onChange(values.filter((entry) => entry !== value));

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if ((event.key === 'Enter' || event.key === ',') && (query.trim() || suggestions[0])) {
      event.preventDefault();
      if (suggestions[0] && (!allowCustom || suggestions[0].toLocaleLowerCase() === query.trim().toLocaleLowerCase())) add(suggestions[0]);
      else if (allowCustom) add(query);
      else if (suggestions[0]) add(suggestions[0]);
    } else if (event.key === 'Backspace' && !query && values.length) {
      const last = values[values.length - 1];
      if (last !== undefined) remove(last);
    }
  };

  return <div className={`tag-field${className ? ` ${className}` : ''}`} ref={rootRef}>
    <span className="tag-field-label">{label}</span>
    <div className={`tag-field-control${open ? ' is-open' : ''}`} onClick={() => setOpen(true)}>
      {values.map((value) => <span className="tag-chip" key={value}>{value}<button type="button" aria-label={`Remove ${value}`} onClick={(event) => { event.stopPropagation(); remove(value); }}>×</button></span>)}
      <input
        value={query}
        onChange={(event) => { setQuery(event.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        placeholder={values.length ? '' : placeholder}
        aria-label={label}
      />
    </div>
    {open && (suggestions.length || (allowCustom && query.trim())) ? <div className="tag-field-menu" role="listbox">
      {allowCustom && query.trim() && !options.some((option) => option.toLocaleLowerCase() === query.trim().toLocaleLowerCase()) ? <button type="button" className="tag-field-option is-custom" onClick={() => add(query)}>Add “{query.trim()}”</button> : null}
      {suggestions.slice(0, 8).map((option) => <button type="button" className="tag-field-option" key={option} onClick={() => add(option)}>{option}</button>)}
    </div> : null}
  </div>;
}

function NumberField({ value, min, max, onValueChange, placeholder }: {
  value: number | undefined;
  min: number;
  max?: number;
  onValueChange: (value: number | undefined) => void;
  placeholder?: string;
}) {
  const boundedValue = value ?? min;
  const update = (delta: number) => onValueChange(Math.min(max ?? Infinity, Math.max(min, boundedValue + delta)));
  return <span className="number-field">
    <input type="number" min={min} max={max} value={value ?? ''} onChange={(event) => onValueChange(event.target.value === '' ? undefined : Number(event.target.value))} placeholder={placeholder} />
    <span className="number-stepper" aria-label="Adjust value">
      <button type="button" aria-label="Increase value" disabled={max !== undefined && boundedValue >= max} onClick={() => update(1)}>⌃</button>
      <button type="button" aria-label="Decrease value" disabled={boundedValue <= min} onClick={() => update(-1)}>⌄</button>
    </span>
  </span>;
}

/* ---- Plan result ---------------------------------------------------------- */

interface TripPlanViewProps {
  trip: TripRecord;
  chat: string;
  setChat: (value: string) => void;
  messages: ChatMessage[];
  onChat: (event: FormEvent<HTMLFormElement>) => void;
  onQuickPrompt: (prompt: string) => void;
  onRegenerate: () => void;
  isWorking: boolean;
}

function TripPlanView({ trip, chat, setChat, messages, onChat, onQuickPrompt, onRegenerate, isWorking }: TripPlanViewProps) {
  const plan = trip.plan;
  const attractionMedia = new Map((plan.media?.attractions ?? []).map((media) => [normaliseMediaTitle(media.title), media]));
  const isGenericFallback = plan.assumptions.some((assumption) => assumption.toLocaleLowerCase().includes('fallback'));
  return <div className="trip-plan-view">
    <article className="hotel-card trip-plan-overview"><h3>{plan.title}</h3><p>{plan.overview}</p>
      {isGenericFallback ? <div className="fallback-searches"><p>This saved version was created before provider-grounded locations and media were available.</p><button type="button" className="quote-button" onClick={onRegenerate} disabled={isWorking}>Regenerate itinerary</button></div> : null}
      {plan.media?.city ? <TripMediaImage media={plan.media.city} eager className="trip-city-media" /> : null}
      <p className="trip-plan-total"><strong>Plan version {trip.latestVersion}</strong> · Estimated total: {plan.costBreakdown.currency} {plan.costBreakdown.total.toLocaleString()}</p>
      <ul className="trip-budget-list">{Object.entries(plan.costBreakdown).filter(([key]) => key !== 'currency' && key !== 'total').map(([key, value]) => <li key={key}><span>{humanize(key)}</span><strong>{plan.costBreakdown.currency} {Number(value).toLocaleString()}</strong></li>)}</ul>
    </article>

    <section className="route-by-day" aria-label="Route by day">
      <header className="route-by-day-head"><p className="day-carousel-eyebrow">Route by day</p><h3>Your daily route</h3></header>
      {plan.itinerary.map((day) => <DayRoute key={day.day} day={day} currency={trip.currency} attractionMedia={attractionMedia} />)}
    </section>

    <article className="hotel-card trip-readiness"><h3>Travel readiness</h3><div className="trip-readiness-grid">
      <ReadinessCard label="Packing" icon="🎒" items={plan.packing} />
      <ReadinessCard label="Etiquette" icon="🤝" items={plan.culturalEtiquette} />
      <ReadinessCard label="Local tips" icon="💡" items={plan.localTips} />
      <ReadinessCard label="Assumptions" icon="📋" items={plan.assumptions} />
    </div></article>

    <TripChat chat={chat} setChat={setChat} messages={messages} onChat={onChat} onQuickPrompt={onQuickPrompt} isWorking={isWorking} />
  </div>;
}

function ReadinessCard({ label, icon, items }: { label: string; icon: string; items: string[] }) {
  return <div className="readiness-card">
    <span className="readiness-card-label"><i aria-hidden="true">{icon}</i>{label}</span>
    <ul>{items.map((item) => <li key={item}>{item}</li>)}</ul>
  </div>;
}

/* ---- One day: heading + auto-scrolling image carousel --------------------- */

function DayRoute({ day, currency, attractionMedia }: { day: TripPlan['itinerary'][number]; currency: string; attractionMedia: Map<string, TripMediaItem> }) {
  const items = day.items;
  return <section className="day-route">
    <header className="day-route-head">
      <span className="day-route-badge">Day {day.day}</span>
      <div><h4>{day.title}</h4><p className="day-route-meta">{day.date ? `${day.date} · ` : ''}{items.length} stop{items.length === 1 ? '' : 's'}</p></div>
    </header>
    <p className="day-route-summary">{day.summary}</p>
    <ItemImageCarousel items={items} currency={currency} attractionMedia={attractionMedia} />
  </section>;
}

function ItemImageCarousel({ items, currency, attractionMedia }: { items: ItineraryItem[]; currency: string; attractionMedia: Map<string, TripMediaItem> }) {
  const [active, setActive] = useState(0);
  const [paused, setPaused] = useState(false);
  const count = items.length;

  useEffect(() => {
    if (paused || count <= 1) return;
    const timer = window.setInterval(() => setActive((current) => (current + 1) % count), 4500);
    return () => window.clearInterval(timer);
  }, [paused, count]);

  useEffect(() => { if (active > count - 1) setActive(0); }, [active, count]);

  return <div
    className="item-carousel"
    onMouseEnter={() => setPaused(true)}
    onMouseLeave={() => setPaused(false)}
  >
    <div className="item-carousel-viewport">
      <div className="item-carousel-track" style={{ transform: `translate3d(-${active * 100}%, 0, 0)` }}>
        {items.map((item, index) => {
          const media = attractionMedia.get(normaliseMediaTitle(item.title));
          return <article className="item-slide" key={`${item.time}-${item.title}-${index}`} aria-hidden={index !== active}>
            {media?.imageUrl
              ? <img className="item-slide-image" src={media.imageUrl} alt={media.alt} loading="lazy" decoding="async" />
              : <div className="item-slide-image item-slide-image-fallback" aria-hidden="true" />}
            <div className="item-slide-scrim" aria-hidden="true" />
            {media?.evidence && (media.evidence.attribution || media.evidence.licence)
              ? <MediaCredit media={media} />
              : null}
            <div className="item-slide-body">
              <span className="item-slide-time">{item.time} · Stop {index + 1}</span>
              <h5>{item.title}</h5>
              <p className="item-slide-meta">{item.travelFromPreviousMinutes} min travel · {item.durationMinutes} min · {currency} {item.estimatedCost.toLocaleString()}</p>
              <p className="item-slide-desc">{item.description}</p>
            </div>
          </article>;
        })}
      </div>
    </div>
    {count > 1 ? <div className="item-carousel-dots" role="tablist" aria-label="Stops">
      {items.map((item, index) => <button key={`${item.time}-${index}`} type="button" role="tab" aria-selected={index === active} aria-label={`Show stop ${index + 1}`} className={index === active ? 'is-active' : undefined} onClick={() => setActive(index)} />)}
    </div> : null}
  </div>;
}

function MediaCredit({ media }: { media: TripMediaItem }) {
  const credit = [media.evidence.licence, media.evidence.attribution].filter(Boolean).join(' · ');
  return <a className="media-credit" href={media.evidence.referenceUrl} target="_blank" rel="noreferrer" aria-label={`Image credit: ${credit}`} onClick={(event) => event.stopPropagation()}>
    <i aria-hidden="true">✳</i>
    <span className="media-credit-pop">{credit}</span>
  </a>;
}

/* ---- Chat ----------------------------------------------------------------- */

function TripChat({ chat, setChat, messages, onChat, onQuickPrompt, isWorking }: { chat: string; setChat: (value: string) => void; messages: ChatMessage[]; onChat: (event: FormEvent<HTMLFormElement>) => void; onQuickPrompt: (prompt: string) => void; isWorking: boolean }) {
  const threadRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const thread = threadRef.current;
    if (thread) thread.scrollTo({ top: thread.scrollHeight, behavior: 'smooth' });
  }, [messages]);

  return <section className="trip-chat" aria-label="Chat with Itineric">
    <header className="trip-chat-head"><span className="trip-chat-avatar" aria-hidden="true">I</span><div><strong>Reshape with Itineric</strong><p>Ask for any change. The plan updates and saves a new version.</p></div></header>
    <div className="trip-chat-thread" ref={threadRef} role="log" aria-live="polite">
      {messages.map((entry) => <div key={entry.id} className={`trip-chat-bubble is-${entry.role}${entry.pending ? ' is-pending' : ''}`}>
        {entry.pending ? <span className="trip-chat-typing" aria-hidden="true"><i /><i /><i /></span> : entry.text}
      </div>)}
    </div>
    <div className="trip-chat-prompts">{chatPrompts.map((prompt) => <button key={prompt} type="button" onClick={() => onQuickPrompt(prompt)} disabled={isWorking}>{prompt}</button>)}</div>
    <form className="trip-chat-composer" onSubmit={onChat}>
      <input value={chat} onChange={(event) => setChat(event.target.value)} placeholder="e.g. move museum visits indoors on day two" aria-label="Message Itineric" disabled={isWorking} />
      <button type="submit" disabled={isWorking || !chat.trim()} aria-label="Send message"><span aria-hidden="true">↑</span></button>
    </form>
  </section>;
}

function TripMediaImage({ media, eager = false, className }: { media: TripMediaItem; eager?: boolean; className: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) return null;
  return <figure className={`trip-media ${className}`}><img src={media.imageUrl} alt={media.alt} loading={eager ? 'eager' : 'lazy'} decoding="async" onError={() => setFailed(true)} /><MediaCredit media={media} /></figure>;
}

function normaliseMediaTitle(value: string): string { return value.trim().toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' '); }
function humanize(value: string): string { return value.replace(/([A-Z])/g, ' $1').replace(/^./, (letter) => letter.toUpperCase()); }
