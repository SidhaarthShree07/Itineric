import { useEffect, useRef } from 'react';
import { ItinericScrollSequence } from './ItinericScrollSequence';
import '../itineric.css';

const HERO_VIDEO = 'https://res.cloudinary.com/dxpkpafdb/video/upload/v1784661997/Comp_1_vssdsz.mp4';
const HERO_POSTER = '/Comp%201_00000.webp';

interface ItinericLandingProps {
  onBegin: () => void;
}

export function ItinericLanding({ onBegin }: ItinericLandingProps) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const motionPreference = window.matchMedia('(prefers-reduced-motion: reduce)');
    const updatePlayback = () => {
      if (motionPreference.matches) {
        video.pause();
      } else {
        void video.play().catch(() => undefined);
      }
    };

    updatePlayback();
    motionPreference.addEventListener('change', updatePlayback);
    return () => motionPreference.removeEventListener('change', updatePlayback);
  }, []);

  const heroOverlay = <div className="itineric-hero itineric-hero-overlay" id="itineric-top" aria-labelledby="itineric-title">
      <video className="itineric-hero-video" ref={videoRef} autoPlay loop muted playsInline poster={HERO_POSTER} preload="metadata" aria-hidden="true">
        <source src={HERO_VIDEO} type="video/mp4" />
      </video>
      <div className="itineric-hero-shade" aria-hidden="true" />
      <nav className="itineric-nav" aria-label="Itineric landing navigation">
        <a className="itineric-wordmark" href="#itineric-top" aria-label="Itineric home">Itineric</a>
        <button type="button" onClick={onBegin}>Open planner <span aria-hidden="true">↘</span></button>
      </nav>

      <div className="itineric-hero-copy">
        <p className="itineric-kicker">Personal travel intelligence</p>
        <h1 id="itineric-title" aria-label="Some journeys are dreamed. Ours are drawn.">
          <span>Some journeys are dreamed.</span>
          <em>Ours are drawn.</em>
        </h1>
        <p className="itineric-hero-description">A considered route, shaped around the way you want to travel.</p>
        <div className="itineric-hero-actions">
          <button className="itineric-primary-action" type="button" onClick={onBegin}>Start planning <span aria-hidden="true">↘</span></button>
          <a href="#itineric-sequence">Explore the route <span aria-hidden="true">↓</span></a>
        </div>
      </div>

      <span className="itineric-scroll-cue">Scroll to follow the route <i aria-hidden="true" /></span>
    </div>;

  return <div className="itineric-shell">
    <ItinericScrollSequence heroOverlay={heroOverlay} />

    <div className="itineric-outro-bridge" aria-hidden="true" />
  </div>;
}
