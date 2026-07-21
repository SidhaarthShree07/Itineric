import type { LegalPanelId } from './LegalPages';

type ConsoleChromeProps = {
  onOpenLegal: (panel: LegalPanelId) => void;
};

export function ConsoleChrome({ onOpenLegal }: ConsoleChromeProps) {
  return <>
    <header className="console-masthead">
      <p className="console-kicker">Itineric / Planning studio</p>
      <h1><span>Give the journey a beginning.</span> <em>We will give it a shape.</em></h1>
      <div className="console-signal-list" aria-label="Planning workspace capabilities">
        <span><i aria-hidden="true" />Voice brief</span>
        <span><i aria-hidden="true" />Route aware</span>
        <span><i aria-hidden="true" />Live searches</span>
      </div>
      <p className="console-masthead-lead">Describe the feeling first. Then refine the route, stays, flights, and pace without losing the thread.</p>
    </header>
    <nav className="console-nav" aria-label="Travel workspace sections">
      <a href="#trip-plan">Plan</a>
      <a href="#stay-search">Stays</a>
      <a href="#flight-search">Flights</a>
      <a href="#route-map">Route map</a>
      <button type="button" onClick={() => onOpenLegal('contact')}>Support</button>
    </nav>
  </>;
}

export function ConsoleFooter({ onOpenLegal }: ConsoleChromeProps) {
  return <footer className="console-footer">
    <div>
      <p className="console-footer-wordmark">Itineric</p>
      <p>Thoughtful travel planning, held in one place.</p>
    </div>
    <nav aria-label="Footer navigation">
      <button type="button" onClick={() => onOpenLegal('privacy')}>Privacy</button>
      <button type="button" onClick={() => onOpenLegal('terms')}>Terms</button>
      <button type="button" onClick={() => onOpenLegal('contact')}>Contact</button>
    </nav>
  </footer>;
}
