import { useCallback, useEffect, useRef, useState } from 'react';
import type { VoiceTripIntakeDraft, VoiceTripIntakeResult } from '@atlas/contracts';
import { extractVoiceTrip } from '../lib/api';
import './voice-intake.css';

type IntakeStage = 'idle' | 'listening' | 'transcribing' | 'processing' | 'review' | 'error';

interface RecognitionResultLike {
  0?: { transcript?: string };
  isFinal: boolean;
}

interface RecognitionEventLike extends Event {
  results: ArrayLike<RecognitionResultLike>;
}

interface RecognitionErrorEventLike extends Event {
  error?: string;
}

interface BrowserSpeechRecognition {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: RecognitionEventLike) => void) | null;
  onerror: ((event: RecognitionErrorEventLike) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

type SpeechRecognitionConstructor = new () => BrowserSpeechRecognition;

function nativeSpeechRecognition(): SpeechRecognitionConstructor | undefined {
  if (typeof window === 'undefined') return undefined;
  const browser = window as Window & typeof globalThis & {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  };
  return browser.SpeechRecognition ?? browser.webkitSpeechRecognition;
}

function formatFieldValue(key: keyof VoiceTripIntakeDraft, value: NonNullable<VoiceTripIntakeDraft[keyof VoiceTripIntakeDraft]>): string {
  if (Array.isArray(value)) return value.join(', ');
  if (key === 'travelStyle' || key === 'pace') return `${value}`.replace(/^./, (letter) => letter.toUpperCase());
  if (key === 'totalBudget') return value.toLocaleString();
  return String(value);
}

function fieldLabel(key: keyof VoiceTripIntakeDraft): string {
  return {
    destination: 'Destination',
    startDate: 'Start date',
    endDate: 'End date',
    days: 'Days',
    adults: 'Travellers',
    children: 'Children',
    rooms: 'Rooms',
    currency: 'Currency',
    totalBudget: 'Budget',
    travelStyle: 'Travel style',
    pace: 'Pace',
    interests: 'Interests',
    cuisines: 'Cuisines',
    accommodationNotes: 'Stay notes',
    accessibilityNotes: 'Accessibility',
    avoid: 'Avoid',
  }[key];
}

export function VoiceTripIntake({ onDraftReady }: { onDraftReady: (draft: VoiceTripIntakeDraft) => void }) {
  const recognition = useRef<BrowserSpeechRecognition | undefined>(undefined);
  const noteRef = useRef('');
  const cancelled = useRef(false);
  const [stage, setStage] = useState<IntakeStage>('idle');
  const [note, setNote] = useState('');
  const [result, setResult] = useState<VoiceTripIntakeResult>();
  const [error, setError] = useState<string>();
  const [speechAvailable] = useState(() => Boolean(nativeSpeechRecognition()));

  const applyTranscript = useCallback(async (rawTranscript: string) => {
    const transcript = rawTranscript.trim();
    if (transcript.length < 4) {
      setError('Add a little more detail so we can shape a useful trip draft.');
      setStage('error');
      return;
    }

    setError(undefined);
    setResult(undefined);
    setStage('processing');
    try {
      const next = await extractVoiceTrip(transcript);
      setNote(next.transcript);
      noteRef.current = next.transcript;
      setResult(next);
      onDraftReady(next.draft);
      setStage('review');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'We could not read that note. You can still fill out the trip fields yourself.');
      setStage('error');
    }
  }, [onDraftReady]);

  useEffect(() => () => {
    cancelled.current = true;
    recognition.current?.abort();
  }, []);

  const startListening = useCallback(() => {
    const Recognition = nativeSpeechRecognition();
    if (!Recognition) {
      setError('Voice input is not available in this browser. Type your trip note below instead.');
      setStage('error');
      return;
    }

    cancelled.current = false;
    noteRef.current = '';
    setNote('');
    setResult(undefined);
    setError(undefined);
    const session = new Recognition();
    recognition.current = session;
    session.continuous = true;
    session.interimResults = true;
    session.lang = navigator.language || 'en-US';
    session.onresult = (event) => {
      let next = '';
      for (let index = 0; index < event.results.length; index += 1) {
        const segment = event.results[index];
        const words = segment?.[0]?.transcript?.trim();
        if (words) next += `${words} `;
      }
      const transcript = next.trim();
      noteRef.current = transcript;
      setNote(transcript);
    };
    session.onerror = (event) => {
      if (event.error === 'aborted') return;
      const message = event.error === 'not-allowed'
        ? 'Microphone permission is off. Allow it in your browser or type a trip note below.'
        : event.error === 'network'
          ? 'Speech recognition could not connect. Type your trip note below instead.'
          : 'Voice input stopped unexpectedly. You can continue with a typed trip note.';
      cancelled.current = true;
      setError(message);
      setStage('error');
    };
    session.onend = () => {
      recognition.current = undefined;
      if (cancelled.current) return;
      const transcript = noteRef.current.trim();
      if (!transcript) {
        setStage('idle');
        return;
      }
      // The captured note remains editable. Nothing leaves the browser until
      // the traveller explicitly chooses the Shape fields action below.
      setStage('idle');
    };
    try {
      session.start();
      setStage('listening');
    } catch {
      setError('Voice input is already active in another tab. Type your trip note below instead.');
      setStage('error');
    }
  }, [applyTranscript]);

  const stopListening = useCallback(() => {
    if (!recognition.current) return;
    setStage('transcribing');
    recognition.current.stop();
  }, []);

  const reset = useCallback(() => {
    cancelled.current = true;
    recognition.current?.abort();
    recognition.current = undefined;
    noteRef.current = '';
    setNote('');
    setResult(undefined);
    setError(undefined);
    setStage('idle');
  }, []);

  const fields = result
    ? (Object.entries(result.draft) as Array<[keyof VoiceTripIntakeDraft, NonNullable<VoiceTripIntakeDraft[keyof VoiceTripIntakeDraft]>]>).filter(([, value]) => value !== undefined)
    : [];
  const isBusy = stage === 'transcribing' || stage === 'processing';

  return (
    <aside className="voice-intake" aria-labelledby="voice-intake-title">
      <div className="voice-intake-heading">
        <div>
          <p className="voice-intake-eyebrow">Voice trip note</p>
          <h3 id="voice-intake-title">Say the trip you have in mind</h3>
        </div>
        <span className={`voice-intake-status is-${stage}`} aria-hidden="true"><i />{stage === 'listening' ? 'Listening' : stage === 'processing' ? 'Reading note' : 'Ready'}</span>
      </div>

      <p className="voice-intake-intro">Mention a destination, dates, budget, people, and the things you want to experience. We will place clear details into the form for you to review.</p>

      <div className="voice-intake-actions">
        {stage === 'listening' ? (
          <button className="voice-intake-record is-recording" type="button" onClick={stopListening}>
            <span aria-hidden="true" />Stop and review note
          </button>
        ) : (
          <button className="voice-intake-record" type="button" onClick={startListening} disabled={!speechAvailable || isBusy}>
            <span aria-hidden="true" />{speechAvailable ? 'Speak your trip note' : 'Voice input unavailable'}
          </button>
        )}
        <span className="voice-intake-or">or type below</span>
      </div>

      <label className="voice-intake-note">
        <span>Your trip note</span>
        <textarea
          value={note}
          onChange={(event) => { noteRef.current = event.target.value; setNote(event.target.value); }}
          placeholder="For example: I want a relaxed four-day food and art trip to Kyoto for two people in October, around JPY 180,000."
          disabled={stage === 'listening' || isBusy}
          rows={3}
        />
      </label>
      <div className="voice-intake-note-footer">
        <span>{note.length ? `${note.length} characters captured. Check the note, then choose Shape fields.` : 'Audio is handled by browser speech recognition. Only the text you approve with Shape fields is sent for trip-field extraction.'}</span>
        <button type="button" onClick={() => void applyTranscript(note)} disabled={isBusy || note.trim().length < 4}>Shape fields</button>
      </div>

      {isBusy ? <div className="voice-intake-loading" role="status"><i aria-hidden="true" /><span>{stage === 'transcribing' ? 'Finalizing your note' : 'Finding the trip details'}</span><small>Using your words to prepare editable fields</small></div> : null}
      {error ? <p className="voice-intake-error" role="alert">{error}</p> : null}
      {result ? <div className="voice-intake-review" aria-live="polite">
        <div className="voice-intake-review-heading"><strong>Review the drafted fields</strong><button type="button" onClick={reset}>Start again</button></div>
        {fields.length ? <dl className="voice-intake-fields">{fields.map(([key, value]) => <div key={key}><dt>{fieldLabel(key)}</dt><dd>{formatFieldValue(key, value)}</dd></div>)}</dl> : <p className="voice-intake-empty">No exact field values were found. Your note is preserved above, and the form remains ready for manual entry.</p>}
        {result.clarification ? <p className="voice-intake-clarification">{result.clarification}</p> : null}
        {result.warnings.map((warning) => <p className="voice-intake-warning" key={warning}>{warning}</p>)}
        <p className="voice-intake-next">The matching form fields below are now editable. Confirm them, then create your plan.</p>
      </div> : null}
    </aside>
  );
}
