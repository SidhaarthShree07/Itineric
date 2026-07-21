import { useEffect, useRef } from 'react';

export type LegalPanelId = 'privacy' | 'terms' | 'contact';

type LegalPanelProps = {
  active: LegalPanelId | null;
  onClose: () => void;
  onOpen: (panel: LegalPanelId) => void;
};

const PANEL_META: Record<LegalPanelId, { eyebrow: string; title: string }> = {
  privacy: { eyebrow: 'Privacy', title: 'Your travel ideas stay yours.' },
  terms: { eyebrow: 'Terms of use', title: 'A clear agreement for every route.' },
  contact: { eyebrow: 'Contact', title: 'Need a hand with the route?' },
};

export function LegalPages({ active, onClose, onOpen }: LegalPanelProps) {
  const closeButton = useRef<HTMLButtonElement>(null);
  const sheet = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!active) return undefined;
    closeButton.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
      if (event.key !== 'Tab') return;
      const focusable = sheet.current?.querySelectorAll<HTMLElement>('a[href], button:not([disabled])');
      if (!focusable?.length) return;
      const first = focusable.item(0);
      const last = focusable.item(focusable.length - 1);
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [active, onClose]);

  if (!active) return null;
  const meta = PANEL_META[active];

  return (
    <div className="legal-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section ref={sheet} className="legal-sheet" aria-labelledby="legal-title" aria-modal="true" role="dialog">
        <header className="legal-sheet-header">
          <div>
            <p className="console-kicker">{meta.eyebrow}</p>
            <h2 id="legal-title">{meta.title}</h2>
          </div>
          <button ref={closeButton} type="button" className="legal-close" aria-label="Close panel" onClick={onClose}>Close</button>
        </header>

        <nav className="legal-tabs" aria-label="Legal pages">
          {(Object.keys(PANEL_META) as LegalPanelId[]).map((panel) => (
            <button key={panel} type="button" aria-current={panel === active ? 'page' : undefined} onClick={() => onOpen(panel)}>{PANEL_META[panel].eyebrow}</button>
          ))}
        </nav>

        <div className="legal-content">
          {active === 'privacy' ? <PrivacyContent /> : null}
          {active === 'terms' ? <TermsContent /> : null}
          {active === 'contact' ? <ContactContent /> : null}
        </div>
      </section>
    </div>
  );
}

function PrivacyContent() {
  return <>
    <p className="legal-updated">Last updated: 22 July 2026</p>
    <p>Itineric uses the details you enter, such as destinations, dates, budgets, and preferences, to create and improve your travel plan. We only use these details to operate the planning experience you request.</p>
    <h3>Saved trip privacy</h3>
    <p>Saved trips belong to a private browser workspace. They can only be listed or opened when that browser sends its random workspace token; another visitor cannot browse your saved plans. The token stays in your browser storage and is never a personal profile or an IP address.</p>
    <p>We do not use an IP address as a trip-ownership key because IP addresses can change or be shared. The edge service may use an IP temporarily for first-use rate limiting, but it does not use it to share, identify, or retrieve saved trip plans.</p>
    <h3>What can be processed</h3>
    <p>Trip requests can be sent to the connected planning, search, mapping, and accommodation providers. Results may include links to third-party services. Their handling of data is governed by their own policies.</p>
    <h3>Voice notes</h3>
    <p>The PWA does not upload or store raw microphone audio. Voice recognition is supplied by your browser, and only the text you explicitly approve with Shape fields is sent to the planning service to fill in editable trip details.</p>
    <h3>Your choices</h3>
    <p>Review details before you submit a plan. Do not include passport numbers, payment card details, medical information, or other sensitive personal information in trip notes. Clearing this browser's storage removes its workspace token, so its saved trips cannot be reopened from that browser.</p>
    <h3>Local build note</h3>
    <p>This interface does not make claims about analytics, advertising, or sale of personal data. Deployment operators should review this notice against their own provider settings and legal requirements before public release.</p>
  </>;
}

function TermsContent() {
  return <>
    <p className="legal-updated">Last updated: 22 July 2026</p>
    <p>Itineric is a travel-planning tool. Schedules, prices, availability, opening hours, routes, weather, and local guidance are estimates that can change. Always confirm important details directly with the relevant provider before booking or travelling.</p>
    <h3>Use responsibly</h3>
    <p>You are responsible for ensuring that your travel, visa, health, insurance, safety, and accessibility decisions are appropriate for your situation. Do not rely on a generated plan as emergency, legal, medical, or financial advice.</p>
    <h3>Third-party services</h3>
    <p>Hotel, flight, map, image, and search links can lead to independent services. Itineric does not complete bookings or control the content, availability, or terms of those services.</p>
    <h3>Fair use</h3>
    <p>Do not attempt to disrupt the service, bypass rate limits, or submit content that you do not have the right to use. The deployment operator may change or suspend the service when needed.</p>
  </>;
}

function ContactContent() {
  return <>
    <p>If a plan looks incorrect, include the destination, travel dates, and a short description of what happened. Do not send payment or identity information.</p>
    <div className="contact-action-card">
      <span>Support request</span>
      <p>Open a pre-addressed draft in your preferred mail app. Add the project support address configured by your deployment team before sending.</p>
      <a href="mailto:?subject=Itineric%20support%20request">Start an email</a>
    </div>
    <h3>Before you reach out</h3>
    <p>Refresh the relevant search once, then check that dates, currency, traveller counts, and airport codes are correct. Pricing and availability are supplied by external providers and may change between searches.</p>
  </>;
}
