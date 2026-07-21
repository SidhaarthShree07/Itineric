import { useEffect, useRef, useState, type MutableRefObject } from 'react';
import { gsap } from 'gsap';
import type { GeoJSONSource, Map as MapLibreMap } from 'maplibre-gl';
import type { TripPlan, TripRouteMode, TripRouteOptionsResult } from '@atlas/contracts';
import { getTripRoute, getTripRouteOptions } from '../lib/api';
import 'maplibre-gl/dist/maplibre-gl.css';

interface TripMapProps {
  tripId?: string;
  center: [number, number];
  destination: string;
  itinerary?: TripPlan['itinerary'];
  media?: TripPlan['media'];
}

type TripMediaItem = NonNullable<TripPlan['media']>['attractions'][number];

interface RouteStop {
  id: string;
  name: string;
  query: string;
  day: number;
  time: string;
  category: string;
  coordinates?: [number, number];
  image?: TripMediaItem;
}

interface RouteSampler {
  distanceMeters: number;
  pointAt(progress: number): [number, number];
  closestProgress(point: [number, number], minimumProgress: number): number;
}

const ROUTE_MODES: Array<{ value: TripRouteMode; label: string }> = [
  { value: 'walk', label: 'Walk' },
  { value: 'drive', label: 'Drive' },
  { value: 'bicycle', label: 'Cycle' },
];

interface RouteOptionsRequestCache {
  key: string;
  request: Promise<TripRouteOptionsResult | undefined>;
}

export function TripMap({ tripId, center, destination, itinerary, media }: TripMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const journeyTimelineRef = useRef<gsap.core.Timeline | null>(null);
  const routeOptionsRequestRef = useRef<RouteOptionsRequestCache | null>(null);
  const followCameraUpdateRef = useRef<(() => void) | null>(null);
  const isPlayingRef = useRef(false);
  const cameraFollowRef = useRef(true);
  const activeStopRef = useRef(0);
  const [message, setMessage] = useState<string>();
  const [routeSummary, setRouteSummary] = useState('Create a saved plan to animate its first places in order.');
  const [routeMode, setRouteMode] = useState<TripRouteMode>('walk');
  const [renderedRouteMode, setRenderedRouteMode] = useState<TripRouteMode>('walk');
  const [availableRouteModes, setAvailableRouteModes] = useState<TripRouteMode[]>([]);
  const [is3d, setIs3d] = useState(true);
  const [isPlaying, setIsPlaying] = useState(false);
  const [journeyReady, setJourneyReady] = useState(false);
  const [cameraFollow, setCameraFollow] = useState(true);
  const [activeStop, setActiveStop] = useState(0);
  const [journeyStops, setJourneyStops] = useState<RouteStop[]>([]);
  const [routeStatus, setRouteStatus] = useState<'road' | 'visual' | 'idle'>('idle');
  const routeCenter = firstGroundedCoordinate(itinerary) ?? center;
  const currentStop = journeyStops[activeStop];

  useEffect(() => {
    isPlayingRef.current = isPlaying;
  }, [isPlaying]);

  useEffect(() => {
    cameraFollowRef.current = cameraFollow;
  }, [cameraFollow]);

  useEffect(() => {
    const key = import.meta.env.VITE_MAPTILER_KEY;
    if (!key) {
      setMessage('Add a referrer-restricted VITE_MAPTILER_KEY to show the interactive MapTiler map.');
      return;
    }
    if (!containerRef.current) return;

    let disposed = false;
    let map: MapLibreMap | undefined;
    let journeyTimeline: gsap.core.Timeline | undefined;
    let entranceTween: gsap.core.Tween | undefined;
    let removeManualCameraListeners: (() => void) | undefined;
    // The single-mode route is the map's source of truth. Route options are a
    // progressive enhancement for the mode picker only: it must never make a
    // usable route fall back to a straight visit-order line if a comparison
    // request is slow, unavailable, or one alternate mode fails.
    const primaryRouteRequest = tripId
      ? getTripRoute(tripId, routeMode).catch(() => undefined)
      : Promise.resolve(undefined);
    const routeOptionsKey = tripId ? routeOptionsRequestKey(tripId, itinerary) : undefined;

    setMessage(undefined);
    setRouteStatus('idle');
    setJourneyStops([]);
    setActiveStop(0);
    isPlayingRef.current = false;
    setIsPlaying(false);
    setJourneyReady(false);
    setAvailableRouteModes([]);
    setRenderedRouteMode(routeMode);
    cameraFollowRef.current = true;
    followCameraUpdateRef.current = null;
    setCameraFollow(true);
    activeStopRef.current = 0;

    void import('maplibre-gl').then(async ({ default: maplibregl }) => {
      if (disposed || !containerRef.current) return;
      map = new maplibregl.Map({
        container: containerRef.current,
        style: `https://api.maptiler.com/maps/streets-v2/style.json?key=${encodeURIComponent(key)}`,
        center: routeCenter,
        zoom: is3d ? 15.2 : 11.5,
        bearing: is3d ? -28 : 0,
        pitch: is3d ? 70 : 0,
        maxPitch: 82,
        canvasContextAttributes: { antialias: true },
      });
      mapRef.current = map;
      map.addControl(new maplibregl.NavigationControl({ showCompass: true, visualizePitch: true }), 'top-right');
      // MapTiler's street style occasionally references an empty or office
      // sprite identifier that is absent from the current sprite sheet. Supply
      // a transparent placeholder so the otherwise valid 3D style stays quiet.
      map.on('styleimagemissing', (event) => {
        if ((event.id === ' ' || event.id === 'office') && !map?.hasImage(event.id)) {
          map?.addImage(event.id, { width: 1, height: 1, data: new Uint8Array([0, 0, 0, 0]) });
        }
      });
      map.on('error', () => {
        if (!disposed) setMessage('Map tiles could not be loaded. Check the MapTiler key and its allowed referrers.');
      });

      map.on('load', async () => {
        if (!map || disposed) return;
        const buildingLayerId = configureMapDimension(map, key, is3d);
        const [stops, routeResult] = await Promise.all([
          geocodeStops(buildStops(itinerary, destination, media), key, routeCenter),
          primaryRouteRequest,
        ]);
        if (disposed || !map) return;

        const effectiveRouteMode = routeResult?.mode ?? routeMode;
        setRenderedRouteMode(effectiveRouteMode);

        const validStops = stops.filter((stop): stop is RouteStop & { coordinates: [number, number] } => Boolean(stop.coordinates));
        if (validStops.length < 2) {
          new maplibregl.Marker({ color: '#e87846' }).setLngLat(routeCenter).addTo(map);
          setRouteSummary('Map ready. Create a saved plan with recognizable places to animate the visiting order.');
          setRouteStatus('idle');
          return;
        }

        const useRoadGeometry = routeResult?.status === 'results' && routeResult.coordinates.length >= 2;
        const routeCoordinates = useRoadGeometry
          ? routeResult.coordinates
          : validStops.map((stop) => stop.coordinates);

        // Start the optional comparison only after the primary route has
        // populated its per-mode KV entry. This avoids spending an extra
        // Geoapify request for the same walking geometry on a cold cache.
        if (useRoadGeometry && tripId && routeOptionsKey) {
          void cachedRouteOptionsRequest(routeOptionsRequestRef, routeOptionsKey, tripId).then((routeOptions) => {
            if (disposed) return;
            const routeChoices = routeOptions?.status === 'results' ? routeOptions.routes : [];
            const usableModes = routeChoices.map((route) => route.mode);
            setAvailableRouteModes(usableModes);
            if (!usableModes.length || usableModes.includes(routeMode)) return;
            const nextMode = routeOptions?.defaultMode && usableModes.includes(routeOptions.defaultMode)
              ? routeOptions.defaultMode
              : usableModes[0];
            if (nextMode) setRouteMode(nextMode);
          });
        }
        if (useRoadGeometry) {
          addRouteLayers(map, routeCoordinates, buildingLayerId);
        } else {
          addVisitOrderLayer(map, routeCoordinates, buildingLayerId);
        }

        const sampler = createRouteSampler(routeCoordinates);
        let minimumProgress = 0;
        const stopProgresses = validStops.map((stop) => {
          const progress = sampler.closestProgress(stop.coordinates, minimumProgress);
          minimumProgress = progress;
          return progress;
        });
        const markerElements: HTMLElement[] = [];

        const setActiveMarker = (index: number) => {
          activeStopRef.current = index;
          markerElements.forEach((element, markerIndex) => {
            element.classList.toggle('is-active', markerIndex === index);
            element.setAttribute('aria-current', markerIndex === index ? 'step' : 'false');
          });
          if (!disposed) setActiveStop(index);
        };

        const travelerLayer = useRoadGeometry
          ? addRouteTravelerLayer(map, effectiveRouteMode, routeCoordinates[0]!, buildingLayerId)
          : undefined;

        const travelerProgress = { value: 0 };
        // GSAP drives this once per display frame. Keeping the traveler and
        // camera in that same frame avoids the visible 15–20fps stepping that
        // came from separate 48ms / 64ms throttles.
        let lastCameraFrameAt = performance.now();
        let cameraBearing = map.getBearing();
        let cameraCenter: [number, number] | undefined;
        const routeDuration = journeyDuration(sampler.distanceMeters, validStops.length);
        const cameraLeadMeters = Math.min(
          165,
          Math.max(42, (sampler.distanceMeters / Math.max(routeDuration, 1)) * 0.28),
        );
        const updateTraveler = (force = false) => {
          if (travelerLayer) {
            travelerLayer.setPosition(
              sampler.pointAt(travelerProgress.value),
              routeBearing(sampler, travelerProgress.value),
            );
          }
          const nextStop = stopIndexAtProgress(travelerProgress.value, stopProgresses);
          if (nextStop !== activeStopRef.current) setActiveMarker(nextStop);
        };

        const updateFollowCamera = (force = false) => {
          if (!travelerLayer || !cameraFollowRef.current || !map || disposed) return;
          const now = performance.now();
          const elapsedSeconds = Math.max(0, (now - lastCameraFrameAt) / 1_000);
          // A short critically damped lag makes turns feel cinematic rather
          // than mechanical, while a long tab pause snaps back to the route
          // instead of visibly catching up for seconds.
          const smoothing = force || elapsedSeconds > 0.24
            ? 1
            : 1 - Math.exp(-elapsedSeconds / 0.16);
          const lookAheadProgress = Math.min(1, travelerProgress.value + cameraLeadMeters / Math.max(1, sampler.distanceMeters));
          const heading = routeBearing(sampler, lookAheadProgress);
          const targetCenter = sampler.pointAt(lookAheadProgress);
          cameraCenter = cameraCenter
            ? interpolateCoordinates(cameraCenter, targetCenter, smoothing)
            : targetCenter;
          cameraBearing = force ? heading : interpolateBearing(cameraBearing, heading, smoothing);
          map.jumpTo({
            center: cameraCenter,
            ...(is3d ? { bearing: cameraBearing, pitch: 67 } : {}),
          });
          lastCameraFrameAt = now;
        };

        const updateJourneyFrame = (force = false) => {
          updateTraveler(force);
          updateFollowCamera(force);
        };
        followCameraUpdateRef.current = () => updateFollowCamera(true);

        const disengageCameraFollow = () => {
          if (!cameraFollowRef.current) return;
          cameraFollowRef.current = false;
          if (!disposed) setCameraFollow(false);
        };
        const canvas = map.getCanvas();
        canvas.addEventListener('pointerdown', disengageCameraFollow, { passive: true });
        canvas.addEventListener('wheel', disengageCameraFollow, { passive: true });
        canvas.addEventListener('keydown', disengageCameraFollow);
        map.on('dragstart', disengageCameraFollow);
        removeManualCameraListeners = () => {
          canvas.removeEventListener('pointerdown', disengageCameraFollow);
          canvas.removeEventListener('wheel', disengageCameraFollow);
          canvas.removeEventListener('keydown', disengageCameraFollow);
          map?.off('dragstart', disengageCameraFollow);
        };

        validStops.forEach((stop, index) => {
          const markerElement = createStopCard(stop, index);
          markerElement.addEventListener('click', () => {
            travelerProgress.value = stopProgresses[index] ?? 0;
            journeyTimeline?.pause();
            isPlayingRef.current = false;
            cameraFollowRef.current = false;
            updateJourneyFrame(true);
            setIsPlaying(false);
            setCameraFollow(false);
            map?.stop();
            map?.flyTo({
              center: stop.coordinates,
              zoom: Math.max(map.getZoom(), 16.2),
              pitch: is3d ? 70 : 0,
              bearing: is3d ? -28 : 0,
              duration: 900,
            });
          });
          markerElements.push(markerElement);
          new maplibregl.Marker({ element: markerElement, anchor: 'bottom', offset: [0, -8] })
            .setLngLat(stop.coordinates)
            .addTo(map!);
        });

        const firstCoordinate = routeCoordinates[0]!;
        const bounds = routeCoordinates.reduce(
          (next, point) => next.extend(point),
          new maplibregl.LngLatBounds(firstCoordinate, firstCoordinate),
        );
        map.fitBounds(bounds, { padding: { top: 100, right: 72, bottom: 130, left: 72 }, maxZoom: 15.5, duration: 0 });

        setJourneyStops(validStops);
        setActiveMarker(0);
        setRouteStatus(useRoadGeometry ? 'road' : 'visual');
        if (useRoadGeometry) {
          const metric = routeResult?.distanceMeters ? ` · ${formatDistance(routeResult.distanceMeters)}` : '';
          setRouteSummary(`Road-aware ${modeLabel(effectiveRouteMode).toLowerCase()} route${metric}. The camera follows the traveler; drag the map to explore independently.`);
        } else {
          setRouteSummary('Visual visit order only. Road geometry will appear automatically when this saved plan has mapped stops and Geoapify is available.');
        }

        const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        if (!reduceMotion && useRoadGeometry) {
          entranceTween = gsap.from(markerElements, {
            autoAlpha: 0,
            y: 18,
            scale: 0.92,
            duration: 0.48,
            stagger: 0.075,
            ease: 'back.out(1.55)',
          });
          // The journey advances one leg at a time and pauses on arrival at each
          // stop. It only continues to the next place when the traveller presses
          // Play again, so the camera holds on each location to be explored.
          travelerProgress.value = stopProgresses[0] ?? 0;
          journeyTimeline = gsap.timeline({ paused: true, onComplete: () => { isPlayingRef.current = false; if (!disposed) setIsPlaying(false); } });
          for (let legIndex = 0; legIndex < stopProgresses.length - 1; legIndex += 1) {
            const legStart = stopProgresses[legIndex] ?? 0;
            const legEnd = stopProgresses[legIndex + 1] ?? 1;
            const legDuration = Math.max(1.3, routeDuration * Math.max(0, legEnd - legStart));
            journeyTimeline.to(travelerProgress, {
              value: legEnd,
              duration: legDuration,
              ease: 'power1.inOut',
              onUpdate: updateJourneyFrame,
            });
            // Hold at every stop except the final one; the pause reports back so
            // the controls flip to "Play" until the traveller resumes.
            if (legIndex < stopProgresses.length - 2) {
              journeyTimeline.addPause(undefined, () => {
                isPlayingRef.current = false;
                cameraFollowRef.current = false;
                if (!disposed) { setIsPlaying(false); setCameraFollow(false); }
                updateJourneyFrame(true);
              });
            }
          }
          journeyTimelineRef.current = journeyTimeline;
          setJourneyReady(true);
          updateJourneyFrame(true);
        } else {
          if (useRoadGeometry) updateTraveler(true);
          isPlayingRef.current = false;
          setIsPlaying(false);
        }
        map.easeTo({ pitch: is3d ? 67 : 0, bearing: is3d ? -28 : 0, duration: 880 });
      });
    }).catch(() => {
      if (!disposed) setMessage('The map experience could not be started in this browser.');
    });

    return () => {
      disposed = true;
      entranceTween?.kill();
      journeyTimeline?.kill();
      removeManualCameraListeners?.();
      if (journeyTimelineRef.current === journeyTimeline) journeyTimelineRef.current = null;
      if (followCameraUpdateRef.current) followCameraUpdateRef.current = null;
      if (mapRef.current === map) mapRef.current = null;
      map?.remove();
    };
  }, [destination, itinerary, is3d, media, routeCenter[0], routeCenter[1], routeMode, tripId]);

  const resumeCameraFollow = () => {
    if (routeStatus !== 'road') return;
    cameraFollowRef.current = true;
    setCameraFollow(true);
    mapRef.current?.stop();
    followCameraUpdateRef.current?.();
  };

  const toggleJourney = () => {
    const timeline = journeyTimelineRef.current;
    if (!timeline) return;
    if (timeline.paused()) {
      isPlayingRef.current = true;
      resumeCameraFollow();
      timeline.play();
      setIsPlaying(true);
    } else {
      timeline.pause();
      isPlayingRef.current = false;
      setIsPlaying(false);
    }
  };

  const replayJourney = () => {
    const timeline = journeyTimelineRef.current;
    if (!timeline) return;
    isPlayingRef.current = true;
    resumeCameraFollow();
    timeline.restart();
    timeline.play();
    setIsPlaying(true);
  };

  return <section className="map-panel map-panel-immersive" aria-label={`Interactive map of ${destination}`}>
    <div className="map-header">
      <div><p className="eyebrow">Immersive route guide</p><h2>{destination}</h2></div>
      <span className="map-provider">Map data © MapTiler © OpenStreetMap contributors</span>
    </div>
    <div className="map-canvas-wrap">
      <div className="map-canvas" ref={containerRef} />
      <div className="map-experience-controls" aria-label="Map journey controls">
        {availableRouteModes.length > 1 ? <div className="map-mode-control" role="group" aria-label="Travel mode">
          {ROUTE_MODES.filter((mode) => availableRouteModes.includes(mode.value)).map((mode) => <button
            className={routeMode === mode.value ? 'is-selected' : undefined}
            key={mode.value}
            onClick={() => setRouteMode(mode.value)}
            type="button"
          >{mode.label}</button>)}
        </div> : null}
        <div className="map-action-control">
          <button aria-pressed={is3d} onClick={() => setIs3d((value) => !value)} type="button">{is3d ? '3D on' : '3D off'}</button>
          <button aria-pressed={cameraFollow} disabled={routeStatus !== 'road'} onClick={resumeCameraFollow} type="button">{cameraFollow ? 'Following' : 'Follow camera'}</button>
          <button disabled={routeStatus !== 'road' || !journeyReady || journeyStops.length < 2} onClick={toggleJourney} type="button">{isPlaying ? 'Pause' : 'Play'}</button>
          <button disabled={routeStatus !== 'road' || !journeyReady || journeyStops.length < 2} onClick={replayJourney} type="button">Replay</button>
        </div>
      </div>
      {currentStop ? <div className="map-now-exploring" role="status">
        <span>Now exploring</span><strong>{activeStop + 1}. {currentStop.name}</strong><small>Day {currentStop.day} · {currentStop.time}</small>
      </div> : null}
      {routeStatus !== 'idle' ? <span className={`map-route-status map-route-status-${routeStatus}`}>
        {routeStatus === 'road' ? `Road route · ${modeLabel(renderedRouteMode)}` : 'Visit order fallback'}
      </span> : null}
    </div>
    <p className="map-route-summary">{routeSummary}</p>
    {message ? <p className="map-message" role="status">{message}</p> : null}
  </section>;
}

function cachedRouteOptionsRequest(
  cacheRef: MutableRefObject<RouteOptionsRequestCache | null>,
  key: string,
  tripId: string,
): Promise<TripRouteOptionsResult | undefined> {
  if (cacheRef.current?.key === key) return cacheRef.current.request;
  const request = getTripRouteOptions(tripId).catch(() => {
    // Do not turn a transient comparison failure into a sticky cached result.
    // The primary route remains visible, and the selector can retry next time
    // the map mounts.
    if (cacheRef.current?.key === key) cacheRef.current = null;
    return undefined;
  });
  cacheRef.current = { key, request };
  return request;
}

function routeOptionsRequestKey(tripId: string, itinerary: TripPlan['itinerary'] | undefined): string {
  const stopSignature = itinerary?.flatMap((day) => day.items)
    .filter((item) => item.category !== 'transport' && item.category !== 'rest')
    .slice(0, 8)
    .map((item) => `${item.title}:${item.coordinates?.longitude ?? ''},${item.coordinates?.latitude ?? ''}`)
    .join('|') ?? '';
  return `${tripId}:${stopSignature}`;
}

function configureMapDimension(map: MapLibreMap, key: string, is3d: boolean): string | undefined {
  if (is3d && !map.getSource('atlas-terrain')) {
    map.addSource('atlas-terrain', {
      type: 'raster-dem',
      url: `https://api.maptiler.com/tiles/terrain-rgb-v2/tiles.json?key=${encodeURIComponent(key)}`,
      tileSize: 512,
      maxzoom: 14,
    });
  }
  map.setTerrain(is3d ? { source: 'atlas-terrain', exaggeration: 1.22 } : null);
  map.setSky({ 'atmosphere-blend': is3d ? 0.78 : 0 });
  const buildingLayers = map.getStyle().layers?.filter((layer) => layer.type === 'fill-extrusion') ?? [];
  const buildingLayerId = buildingLayers[0]?.id;
  if (!buildingLayerId) return undefined;

  // The MapTiler style provides actual OSM building heights through
  // render_height/render_min_height. Keep the extrusion opaque and lit so the
  // scene has visible depth even in a flat city such as Paris.
  map.setLight({ anchor: 'viewport', position: [1.5, 210, 30], color: '#fff4dc', intensity: 0.72 });
  buildingLayers.forEach((layer) => {
    map.setLayoutProperty(layer.id, 'visibility', is3d ? 'visible' : 'none');
    if (!is3d) return;
    map.setLayerZoomRange(layer.id, 12, 24);
    map.setPaintProperty(layer.id, 'fill-extrusion-opacity', 0.96);
    map.setPaintProperty(layer.id, 'fill-extrusion-vertical-gradient', true);
    map.setPaintProperty(layer.id, 'fill-extrusion-color', [
      'interpolate', ['linear'], ['coalesce', ['get', 'render_height'], ['get', 'height'], 8],
      0, '#d8d1be', 28, '#c3d2c4', 85, '#93aca3', 220, '#617f79',
    ]);
    map.setPaintProperty(layer.id, 'fill-extrusion-height', [
      'interpolate', ['linear'], ['zoom'],
      12, 0,
      14, ['*', ['coalesce', ['get', 'render_height'], ['get', 'height'], 8], 1.15],
    ]);
    map.setPaintProperty(layer.id, 'fill-extrusion-base', ['coalesce', ['get', 'render_min_height'], ['get', 'min_height'], 0]);
  });
  return buildingLayerId;
}

function addRouteLayers(map: MapLibreMap, coordinates: Array<[number, number]>, beforeBuildingLayerId?: string): void {
  map.addSource('atlas-itinerary-route', {
    type: 'geojson',
    data: { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates } },
  });
  map.addLayer({
    id: 'atlas-itinerary-route-halo', type: 'line', source: 'atlas-itinerary-route',
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': '#123832', 'line-width': 15, 'line-opacity': 0.22, 'line-blur': 2 },
  }, beforeBuildingLayerId);
  map.addLayer({
    id: 'atlas-itinerary-route', type: 'line', source: 'atlas-itinerary-route',
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': '#e87846', 'line-width': 5, 'line-opacity': 0.96 },
  }, beforeBuildingLayerId);
  map.addLayer({
    id: 'atlas-itinerary-route-spark', type: 'line', source: 'atlas-itinerary-route',
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': '#fff9ed', 'line-width': 1.3, 'line-opacity': 0.8, 'line-dasharray': [0.2, 2.4] },
  }, beforeBuildingLayerId);
}

function addVisitOrderLayer(map: MapLibreMap, coordinates: Array<[number, number]>, beforeBuildingLayerId?: string): void {
  map.addSource('atlas-visit-order', {
    type: 'geojson',
    data: { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates } },
  });
  map.addLayer({
    id: 'atlas-visit-order',
    type: 'line',
    source: 'atlas-visit-order',
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': '#8b785f', 'line-width': 2, 'line-opacity': 0.72, 'line-dasharray': [1.2, 1.5] },
  }, beforeBuildingLayerId);
}

function addRouteTravelerLayer(
  map: MapLibreMap,
  mode: TripRouteMode,
  initialPosition: [number, number],
  beforeBuildingLayerId?: string,
): { setPosition: (position: [number, number], heading: number) => void } {
  const sourceId = 'atlas-route-traveler';
  const layerId = 'atlas-route-traveler';
  const iconId = `atlas-route-traveler-${mode}`;
  if (!map.hasImage(iconId)) {
    map.addImage(iconId, createTravelerImage(mode), { pixelRatio: 2 });
  }
  map.addSource(sourceId, { type: 'geojson', data: travelerPointData(initialPosition, 0) });
  map.addLayer({
    id: layerId,
    type: 'symbol',
    source: sourceId,
    layout: {
      'icon-image': iconId,
      'icon-size': 1,
      'icon-rotate': ['get', 'heading'],
      'icon-rotation-alignment': 'map',
      'icon-pitch-alignment': 'map',
      'icon-allow-overlap': true,
      'icon-ignore-placement': true,
    },
  }, beforeBuildingLayerId);
  const source = map.getSource(sourceId) as GeoJSONSource;
  return {
    setPosition(position, heading) {
      source.setData(travelerPointData(position, heading));
    },
  };
}

function travelerPointData(coordinates: [number, number], heading: number) {
  return {
    type: 'Feature' as const,
    properties: { heading },
    geometry: { type: 'Point' as const, coordinates },
  };
}

function createTravelerImage(mode: TripRouteMode): ImageData {
  const logicalSize = 48;
  const pixelRatio = 2;
  const canvas = document.createElement('canvas');
  canvas.width = logicalSize * pixelRatio;
  canvas.height = logicalSize * pixelRatio;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('The browser could not create the route traveler icon.');
  context.scale(pixelRatio, pixelRatio);
  const color = mode === 'drive' ? '#e87846' : mode === 'bicycle' ? '#2f8b77' : '#3c6f9c';

  context.fillStyle = 'rgba(18, 48, 42, 0.24)';
  context.beginPath();
  context.ellipse(24, 38, 13, 5, 0, 0, Math.PI * 2);
  context.fill();
  context.fillStyle = '#fffdf8';
  context.beginPath();
  context.arc(24, 24, 17, 0, Math.PI * 2);
  context.fill();
  context.lineWidth = 2.5;
  context.strokeStyle = color;
  context.stroke();
  context.fillStyle = color;
  context.beginPath();
  context.moveTo(24, 9);
  context.lineTo(35, 34);
  context.lineTo(24, 30);
  context.lineTo(13, 34);
  context.closePath();
  context.fill();
  context.fillStyle = '#173d35';
  context.beginPath();
  context.arc(24, 24, 3.5, 0, Math.PI * 2);
  context.fill();
  return context.getImageData(0, 0, canvas.width, canvas.height);
}

function createStopCard(stop: RouteStop, index: number): HTMLButtonElement {
  const element = document.createElement('button');
  element.className = 'route-stop-card';
  element.type = 'button';
  element.setAttribute('aria-label', `Visit stop ${index + 1}: ${stop.name}`);
  element.setAttribute('aria-current', index === 0 ? 'step' : 'false');

  const badge = document.createElement('span');
  badge.className = 'route-stop-number';
  badge.textContent = String(index + 1);
  element.append(badge);

  if (stop.image?.imageUrl) {
    const image = document.createElement('img');
    image.className = 'route-stop-card-image';
    image.src = stop.image.imageUrl;
    image.alt = stop.image.alt;
        // MapLibre marker DOM is transformed independently of normal page
        // layout. Native lazy loading can therefore decide that visible marker
        // images are off-screen. There are at most eight stops, so eager,
        // attribution-preserving Wikimedia thumbnails are the dependable
        // choice here.
        image.loading = 'eager';
        image.decoding = 'async';
        image.referrerPolicy = 'no-referrer';
        image.addEventListener('error', () => {
          image.replaceWith(createImageFallback(stop.name));
        }, { once: true });
        element.append(image);
  } else {
    element.append(createImageFallback(stop.name));
  }

  const copy = document.createElement('span');
  copy.className = 'route-stop-card-copy';
  const name = document.createElement('strong');
  name.textContent = stop.name;
  const meta = document.createElement('small');
  meta.textContent = `Day ${stop.day} · ${stop.time}`;
  copy.append(name, meta);
  element.append(copy);

  if (stop.image?.evidence.attribution || stop.image?.evidence.referenceUrl) {
    const credit = document.createElement('span');
    credit.className = 'route-stop-card-credit';
    credit.textContent = stop.image.evidence.attribution || 'Wikimedia image';
    element.append(credit);
  }
  return element;
}

function buildStops(itinerary: TripPlan['itinerary'] | undefined, destination: string, media: TripPlan['media'] | undefined): RouteStop[] {
  if (!itinerary) return [];
  const seen = new Set<string>();
  return itinerary.flatMap((day) => day.items
    .filter((item) => item.category !== 'transport' && item.category !== 'rest')
    .flatMap((item, itemIndex) => {
      const name = item.title.trim();
      const normalized = normaliseTitle(name);
      if (!name || seen.has(normalized)) return [];
      seen.add(normalized);
      return [{
        id: `${day.day}-${itemIndex}-${normalized}`,
        name,
        query: `${name}${item.neighbourhood ? `, ${item.neighbourhood}` : ''}, ${destination}`,
        day: day.day,
        time: item.time,
        category: item.category,
        image: findMedia(name, media),
        ...(item.coordinates ? { coordinates: [item.coordinates.longitude, item.coordinates.latitude] as [number, number] } : {}),
      }];
    })).slice(0, 8);
}

function findMedia(title: string, media: TripPlan['media'] | undefined): TripMediaItem | undefined {
  const candidates = media?.attractions ?? [];
  const normalizedTitle = normaliseTitle(title);
  const exact = candidates.find((candidate) => normaliseTitle(candidate.title) === normalizedTitle);
  if (exact) return exact;
  const titleWords = new Set(normalizedTitle.split(' ').filter((word) => word.length > 2));
  const similar = candidates.find((candidate) => {
    const candidateWords = normaliseTitle(candidate.title).split(' ');
    return candidateWords.some((word) => titleWords.has(word));
  });
  // A licensed city photo is still much more useful than an empty marker for
  // older plans whose named-attraction media was not stored yet.
  return similar ?? media?.city;
}

function createImageFallback(name: string): HTMLSpanElement {
  const fallback = document.createElement('span');
  fallback.className = 'route-stop-card-image route-stop-card-image-fallback';
  fallback.setAttribute('aria-hidden', 'true');
  fallback.textContent = name.trim().charAt(0).toLocaleUpperCase() || '•';
  return fallback;
}

async function geocodeStops(stops: RouteStop[], key: string, fallbackCenter: [number, number]): Promise<RouteStop[]> {
  const geocoded = await Promise.all(stops.map(async (stop) => {
    if (stop.coordinates) return stop;
    try {
      const url = `https://api.maptiler.com/geocoding/${encodeURIComponent(stop.query)}.json?key=${encodeURIComponent(key)}&limit=1`;
      const response = await fetch(url);
      if (!response.ok) return stop;
      const payload = await response.json() as { features?: Array<{ center?: [number, number] }> };
      const location = payload.features?.[0]?.center;
      return location && location.length === 2 ? { ...stop, coordinates: location } : stop;
    } catch { return stop; }
  }));
  return geocoded.length ? geocoded : [{
    id: 'destination', name: destinationLabel(fallbackCenter), query: '', day: 1, time: '', category: 'attraction', coordinates: fallbackCenter,
  }];
}

function firstGroundedCoordinate(itinerary: TripPlan['itinerary'] | undefined): [number, number] | undefined {
  const coordinates = itinerary?.flatMap((day) => day.items).find((item) => item.coordinates)?.coordinates;
  return coordinates ? [coordinates.longitude, coordinates.latitude] : undefined;
}

function createRouteSampler(coordinates: Array<[number, number]>): RouteSampler {
  const distances = [0];
  for (let index = 1; index < coordinates.length; index += 1) {
    distances[index] = distances[index - 1]! + distanceBetween(coordinates[index - 1]!, coordinates[index]!);
  }
  const totalDistance = distances[distances.length - 1] ?? 0;
  return {
    distanceMeters: totalDistance,
    pointAt(progress: number): [number, number] {
      if (coordinates.length < 2 || totalDistance <= 0) return coordinates[0] ?? [0, 0];
      const target = Math.min(1, Math.max(0, progress)) * totalDistance;
      const index = routeSegmentAtDistance(distances, target);
      const startIndex = Math.max(0, index - 1);
      const startDistance = distances[startIndex]!;
      const endDistance = distances[index] ?? totalDistance;
      const local = endDistance === startDistance ? 0 : (target - startDistance) / (endDistance - startDistance);
      const start = coordinates[startIndex]!;
      const end = coordinates[index] ?? start;
      return [start[0] + (end[0] - start[0]) * local, start[1] + (end[1] - start[1]) * local];
    },
    closestProgress(point: [number, number], minimumProgress: number): number {
      if (coordinates.length < 2 || totalDistance <= 0) return 0;
      const startingIndex = Math.max(0, Math.floor(Math.min(1, minimumProgress) * (coordinates.length - 1)));
      let closestIndex = startingIndex;
      let closestDistance = Number.POSITIVE_INFINITY;
      for (let index = startingIndex; index < coordinates.length; index += 1) {
        const distance = distanceBetween(coordinates[index]!, point);
        if (distance < closestDistance) {
          closestDistance = distance;
          closestIndex = index;
        }
      }
      return distances[closestIndex]! / totalDistance;
    },
  };
}

function routeSegmentAtDistance(distances: number[], target: number): number {
  let lower = 1;
  let upper = distances.length - 1;
  while (lower < upper) {
    const middle = Math.floor((lower + upper) / 2);
    if (distances[middle]! < target) lower = middle + 1;
    else upper = middle;
  }
  return lower;
}

function stopIndexAtProgress(progress: number, stopProgresses: number[]): number {
  let index = 0;
  for (let current = 1; current < stopProgresses.length; current += 1) {
    if (progress + 0.0005 >= (stopProgresses[current] ?? 1)) index = current;
  }
  return index;
}

function distanceBetween(a: [number, number], b: [number, number]): number {
  const radians = Math.PI / 180;
  const latitudeDelta = (b[1] - a[1]) * radians;
  const longitudeDelta = (b[0] - a[0]) * radians;
  const originLatitude = a[1] * radians;
  const destinationLatitude = b[1] * radians;
  const sinLatitude = Math.sin(latitudeDelta / 2);
  const sinLongitude = Math.sin(longitudeDelta / 2);
  const value = sinLatitude * sinLatitude + Math.cos(originLatitude) * Math.cos(destinationLatitude) * sinLongitude * sinLongitude;
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
}

function routeBearing(sampler: RouteSampler, progress: number): number {
  const delta = 0.001;
  const start = sampler.pointAt(Math.max(0, progress - delta));
  const end = sampler.pointAt(Math.min(1, progress + delta));
  if (start[0] === end[0] && start[1] === end[1]) return 0;
  const radians = Math.PI / 180;
  const longitudeDelta = (end[0] - start[0]) * radians;
  const originLatitude = start[1] * radians;
  const destinationLatitude = end[1] * radians;
  const y = Math.sin(longitudeDelta) * Math.cos(destinationLatitude);
  const x = Math.cos(originLatitude) * Math.sin(destinationLatitude)
    - Math.sin(originLatitude) * Math.cos(destinationLatitude) * Math.cos(longitudeDelta);
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

function interpolateBearing(current: number, target: number, amount: number): number {
  const shortestDelta = ((target - current + 540) % 360) - 180;
  return (current + shortestDelta * amount + 360) % 360;
}

function interpolateCoordinates(
  current: [number, number],
  target: [number, number],
  amount: number,
): [number, number] {
  return [
    current[0] + (target[0] - current[0]) * amount,
    current[1] + (target[1] - current[1]) * amount,
  ];
}

function journeyDuration(distanceMeters: number, stops: number): number {
  return Math.min(42, Math.max(12, stops * 2.4, distanceMeters / 480));
}

function normaliseTitle(value: string): string {
  return value
    .toLocaleLowerCase()
    .replace(/œ/g, 'oe')
    .replace(/æ/g, 'ae')
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

function modeLabel(mode: TripRouteMode): string {
  return ROUTE_MODES.find((entry) => entry.value === mode)?.label ?? 'Walk';
}

function formatDistance(meters: number): string {
  return meters >= 1_000 ? `${(meters / 1_000).toFixed(meters >= 10_000 ? 0 : 1)} km` : `${Math.round(meters)} m`;
}

function destinationLabel(center: [number, number]): string {
  return `Destination ${center[1].toFixed(2)}, ${center[0].toFixed(2)}`;
}
