import { lazy, Suspense, useCallback, useState } from 'react';
import type { TripRecord } from '@atlas/contracts';
import { ConsoleChrome, ConsoleFooter } from './components/ConsoleChrome';
import { FlightSearch } from './components/FlightSearch';
import { HotelComparison } from './components/HotelComparison';
import { ItinericLanding } from './components/ItinericLanding';
import { LegalPages, type LegalPanelId } from './components/LegalPages';
import { TripPlanner } from './components/TripPlanner';

const TripMap = lazy(() => import('./components/TripMap').then((module) => ({ default: module.TripMap })));

export function App() {
  const [activeTrip, setActiveTrip] = useState<TripRecord>();
  const [legalPanel, setLegalPanel] = useState<LegalPanelId | null>(null);
  const scrollToWorkspace = useCallback(() => document.getElementById('atlas-workspace')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), []);

  return <>
    <ItinericLanding onBegin={scrollToWorkspace} />
    <main id="atlas-workspace" className="atlas-workspace-shell itineric-console">
      <div className="console-shell-inner">
        <ConsoleChrome onOpenLegal={setLegalPanel} />
        <section className="workspace console-layout" aria-label="Trip planning workspace">
          <div className="workspace-main console-stack">
            <section id="trip-plan" aria-label="Trip plan"><TripPlanner onTripChange={setActiveTrip} /></section>
          </div>
          <aside id="route-map" className="console-map-rail" aria-label="Route map">
            <Suspense fallback={<section className="map-panel map-loading">Loading map...</section>}>
              <TripMap
                tripId={activeTrip?.id}
                destination={activeTrip?.destination ?? 'Paris, France'}
                center={[2.3522, 48.8566]}
                itinerary={activeTrip?.plan.itinerary}
                media={activeTrip?.plan.media}
              />
            </Suspense>
          </aside>
        </section>
        <section className="console-tools" aria-label="Travel research tools">
          <section id="stay-search" aria-label="Hotel comparison"><HotelComparison /></section>
          <section id="flight-search" aria-label="Flight comparison"><FlightSearch /></section>
        </section>
        <ConsoleFooter onOpenLegal={setLegalPanel} />
      </div>
    </main>
    <LegalPages active={legalPanel} onClose={() => setLegalPanel(null)} onOpen={setLegalPanel} />
  </>;
}
