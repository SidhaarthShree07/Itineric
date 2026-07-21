import { useEffect, useRef, useState, type ReactNode } from 'react';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

const FRAME_COUNT = 233;
const CACHE_LIMIT = 18;
const INK_BASE = '#0F1B2E';
const DUSK = '#2B3550';
const AMBER = '#F0A94E';
const SUNSET = '#E07B45';

type StoryPhase = 'intro' | 'one' | 'two' | 'three';

if (typeof window !== 'undefined') gsap.registerPlugin(ScrollTrigger);

export function ItinericScrollSequence({ heroOverlay }: { heroOverlay?: ReactNode }) {
  const sectionRef = useRef<HTMLElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [phase, setPhase] = useState<StoryPhase>('intro');
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    const section = sectionRef.current;
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d', { alpha: false });
    if (!section || !canvas || !context) return;

    let disposed = false;
    let currentFrame = 0;
    let currentPosition = 0;
    let activePhase: StoryPhase = 'intro';
    let canvasWidth = 0;
    let canvasHeight = 0;
    let refreshFrame = 0;
    const cache = new Map<number, HTMLImageElement>();
    const pending = new Map<number, HTMLImageElement>();

    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';

    const frameUrl = (frame: number) => `/${encodeURIComponent(`Comp 1_${String(frame).padStart(5, '0')}.webp`)}`;

    const touch = (frame: number, image: HTMLImageElement) => {
      cache.delete(frame);
      cache.set(frame, image);

      while (cache.size > CACHE_LIMIT) {
        const oldest = Array.from(cache.keys()).find((cachedFrame) => cachedFrame !== currentFrame);
        if (oldest === undefined) break;
        const staleImage = cache.get(oldest);
        if (staleImage) staleImage.src = '';
        cache.delete(oldest);
      }
    };

    const closestImage = (frame: number): HTMLImageElement | undefined => {
      const direct = cache.get(frame);
      if (direct) {
        touch(frame, direct);
        return direct;
      }

      let bestFrame: number | undefined;
      for (const cachedFrame of cache.keys()) {
        if (bestFrame === undefined || Math.abs(cachedFrame - frame) < Math.abs(bestFrame - frame)) bestFrame = cachedFrame;
      }

      const nearest = bestFrame === undefined ? undefined : cache.get(bestFrame);
      if (nearest && bestFrame !== undefined) touch(bestFrame, nearest);
      return nearest;
    };

    const drawCover = (image: HTMLImageElement, opacity = 1) => {
      if (!image.naturalWidth || !image.naturalHeight || !canvasWidth || !canvasHeight) return;
      const scale = Math.max(canvasWidth / image.naturalWidth, canvasHeight / image.naturalHeight);
      const width = image.naturalWidth * scale;
      const height = image.naturalHeight * scale;
      context.globalAlpha = opacity;
      context.drawImage(image, (canvasWidth - width) / 2, (canvasHeight - height) / 2, width, height);
    };

    const draw = (framePosition: number) => {
      const lowerFrame = Math.floor(framePosition);
      const upperFrame = Math.min(FRAME_COUNT - 1, Math.ceil(framePosition));
      const crossfade = framePosition - lowerFrame;
      const lowerImage = closestImage(lowerFrame);
      const upperImage = upperFrame === lowerFrame ? lowerImage : closestImage(upperFrame);

      context.globalAlpha = 1;
      context.fillStyle = mixHex(INK_BASE, DUSK, framePosition / (FRAME_COUNT - 1));
      context.fillRect(0, 0, canvasWidth, canvasHeight);

      if (lowerImage) drawCover(lowerImage, upperImage && upperImage !== lowerImage ? 1 - crossfade : 1);
      if (upperImage && upperImage !== lowerImage) drawCover(upperImage, crossfade);
      if (!lowerImage && upperImage) drawCover(upperImage);
      context.globalAlpha = 1;
    };

    const preload = (frame: number) => {
      const bounded = Math.max(0, Math.min(FRAME_COUNT - 1, frame));
      if (cache.has(bounded) || pending.has(bounded)) return;

      const image = new Image();
      image.decoding = 'async';
      image.onload = () => {
        pending.delete(bounded);
        if (disposed) return;
        touch(bounded, image);
        if (bounded === currentFrame || cache.size === 1) draw(currentPosition);
        setIsReady(true);
      };
      image.onerror = () => pending.delete(bounded);
      pending.set(bounded, image);
      image.src = frameUrl(bounded);
    };

    const warmAround = (frame: number) => {
      preload(frame);
      for (let offset = 1; offset <= 11; offset += 1) preload(frame + offset);
      for (let offset = 1; offset <= 5; offset += 1) preload(frame - offset);
    };

    const setCanvasSize = () => {
      const bounds = canvas.getBoundingClientRect();
      const scale = Math.min(window.devicePixelRatio || 1, 2);
      canvasWidth = Math.max(1, Math.floor(bounds.width * scale));
      canvasHeight = Math.max(1, Math.floor(bounds.height * scale));

      if (canvas.width !== canvasWidth || canvas.height !== canvasHeight) {
        canvas.width = canvasWidth;
        canvas.height = canvasHeight;
      }

      draw(currentPosition);
    };

    const phaseForProgress = (progress: number): StoryPhase => {
      if (progress < 0.1) return 'intro';
      if (progress < 0.4) return 'one';
      if (progress < 0.72) return 'two';
      return 'three';
    };

    const renderProgress = (value: number) => {
      const progress = clamp(value, 0, 1);
      // Hold the matching first canvas frame while the hero video dissolves.
      // The route animation only starts once that hand-off is complete.
      const sequenceProgress = clamp((progress - 0.16) / 0.84, 0, 1);
      currentPosition = sequenceProgress * (FRAME_COUNT - 1);
      const nextFrame = Math.round(currentPosition);

      section.style.setProperty('--itineric-progress-pct', `${Math.round(sequenceProgress * 100)}%`);
      section.style.setProperty('--itineric-progress', sequenceProgress.toFixed(4));
      section.style.setProperty('--itineric-ink', mixHex(INK_BASE, DUSK, sequenceProgress));
      section.style.setProperty('--itineric-accent', mixHex(AMBER, SUNSET, sequenceProgress));
      section.style.setProperty('--itineric-hero-copy-opacity', (1 - clamp(progress / 0.1, 0, 1)).toFixed(3));
      section.style.setProperty('--itineric-hero-layer-opacity', (1 - clamp((progress - 0.08) / 0.14, 0, 1)).toFixed(3));
      section.style.setProperty('--itineric-hero-copy-shift', `${Math.round(-28 * clamp(progress / 0.1, 0, 1))}px`);

      const nextPhase = phaseForProgress(sequenceProgress);
      if (nextPhase !== activePhase) {
        activePhase = nextPhase;
        setPhase(nextPhase);
      }

      if (nextFrame !== currentFrame) {
        currentFrame = nextFrame;
        warmAround(currentFrame);
      }

      draw(currentPosition);
    };

    const resizeObserver = new ResizeObserver(setCanvasSize);
    resizeObserver.observe(canvas);
    warmAround(0);
    setCanvasSize();
    renderProgress(0);

    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reducedMotion) {
      return () => {
        disposed = true;
        resizeObserver.disconnect();
        for (const image of pending.values()) image.src = '';
        for (const image of cache.values()) image.src = '';
      };
    }

    const playhead = { value: 0 };
    const animationContext = gsap.context(() => {
      gsap.to(playhead, {
        value: 1,
        ease: 'none',
        onUpdate: () => renderProgress(playhead.value),
        scrollTrigger: {
          trigger: section,
          start: 'top top',
          end: () => `+=${Math.max(window.innerHeight, section.offsetHeight - window.innerHeight)}`,
          // A higher scrub time lets GSAP glide the playhead toward the scroll
          // position instead of snapping to it, which removes the stepped,
          // rigid feel on the frame-by-frame canvas.
          scrub: window.matchMedia('(max-width: 760px)').matches ? 0.9 : 1.25,
          invalidateOnRefresh: true,
          onRefresh: () => renderProgress(playhead.value),
        },
      });
    }, section);

    refreshFrame = window.requestAnimationFrame(() => ScrollTrigger.refresh());

    return () => {
      disposed = true;
      if (refreshFrame) window.cancelAnimationFrame(refreshFrame);
      animationContext.revert();
      resizeObserver.disconnect();
      for (const image of pending.values()) image.src = '';
      for (const image of cache.values()) image.src = '';
    };
  }, []);

  return <section className={`itineric-sequence${isReady ? ' is-ready' : ''}`} data-phase={phase} ref={sectionRef} id="itineric-sequence" aria-labelledby="itineric-sequence-title">
    <div className="itineric-sequence-sticky">
      <canvas className="itineric-sequence-canvas" ref={canvasRef} role="img" aria-label="An illustrated train journey traveling from a midnight city into a glowing autumn landscape." />
      <div className="itineric-sequence-wash" aria-hidden="true" />
      {heroOverlay}
      {!isReady ? <div className="itineric-sequence-loader" role="status"><span aria-hidden="true" />Preparing the route</div> : null}
      <div className="itineric-sequence-progress" aria-hidden="true"><span /></div>
      <div className="itineric-sequence-copy">
        <div className="itineric-step-tracker" aria-hidden="true">
          <span data-step="one"><i>01</i>Intent</span>
          <span data-step="two"><i>02</i>Rhythm</span>
          <span data-step="three"><i>03</i>Open</span>
        </div>
        <article className="itineric-story-card itineric-story-card-first">
          <span className="itineric-story-index"><i>01</i>Intent</span>
          <h2 id="itineric-sequence-title">Name the feeling.</h2>
          <p>The place, the pace, the people. Your first spark becomes a route.</p>
        </article>
        <article className="itineric-story-card itineric-story-card-second">
          <span className="itineric-story-index"><i>02</i>Rhythm</span>
          <h2>Let it find its order.</h2>
          <p>Stays, meals, and moments settle into a day that flows.</p>
        </article>
        <article className="itineric-story-card itineric-story-card-third">
          <span className="itineric-story-index"><i>03</i>Open</span>
          <h2>Leave room to wander.</h2>
          <p>Change one thing, and the whole route reshapes around you.</p>
        </article>
      </div>
    </div>
  </section>;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function mixHex(from: string, to: string, amount: number): string {
  const progress = clamp(amount, 0, 1);
  const channels = [0, 2, 4].map((offset) => {
    const start = Number.parseInt(from.slice(offset + 1, offset + 3), 16);
    const end = Number.parseInt(to.slice(offset + 1, offset + 3), 16);
    return Math.round(start + (end - start) * progress).toString(16).padStart(2, '0');
  });
  return `#${channels.join('')}`;
}
