import type { Env } from '../env';

const CACHE_TTL_SECONDS = 24 * 60 * 60;
const REQUEST_TIMEOUT_MS = 8_000;

export type GeoCoordinates = { longitude: number; latitude: number };

export type GeocodedPlace = {
  query: string;
  formatted: string;
  coordinates: GeoCoordinates;
};

export type RouteTravelTime = {
  minutes: number;
  distanceMeters?: number;
};

export type GeoRouteMode = 'walk' | 'drive' | 'bicycle';

/**
 * The ordered, road-aware path returned by Geoapify's routing endpoint.
 * Coordinates retain GeoJSON's [longitude, latitude] order so they can be
 * passed directly to MapLibre without a lossy conversion in the browser.
 */
export type RouteGeometry = {
  coordinates: Array<[number, number]>;
  /**
   * Stopover legs are retained internally for route-mode comparison. The
   * public trip-route schema intentionally strips this implementation detail
   * and exposes the flattened GeoJSON coordinates used by MapLibre.
   */
  legs?: Array<Array<[number, number]>>;
  distanceMeters?: number;
  durationMinutes?: number;
};

export type RouteModeOption = { mode: GeoRouteMode; route: RouteGeometry };

const ROUTE_MODE_PRIORITY: GeoRouteMode[] = ['walk', 'bicycle', 'drive'];

/**
 * Geoapify adapter for grounded itinerary locations and travel times.
 *
 * Route-matrix entries are directional and use rounded coordinate pairs in the
 * key. This makes repeated itinerary edits inexpensive while keeping within
 * Geoapify's free daily quota.
 */
export class GeoProvider {
  constructor(private readonly env: Env) {}

  isConfigured(): boolean {
    return Boolean(this.env.GEOAPIFY_API_KEY);
  }

  async geocode(placeName: string, destination?: string): Promise<GeocodedPlace | undefined> {
    if (!this.env.GEOAPIFY_API_KEY) return undefined;
    const query = [placeName, destination].filter((part): part is string => Boolean(part?.trim())).join(', ');
    const cacheKey = `geoapify:geocode:v1:${await hash(normaliseQuery(query))}`;
    const cached = await this.readCache<GeocodedPlace>(cacheKey);
    if (cached) return cached;

    const url = new URL('https://api.geoapify.com/v1/geocode/search');
    url.search = new URLSearchParams({
      text: query,
      format: 'json',
      limit: '1',
      apiKey: this.env.GEOAPIFY_API_KEY,
    }).toString();
    const payload = await this.requestJson<GeoapifyGeocodeResponse>(url);
    const result = payload?.results?.[0];
    if (!isFiniteNumber(result?.lon) || !isFiniteNumber(result?.lat)) return undefined;

    const place: GeocodedPlace = {
      query: placeName,
      formatted: typeof result.formatted === 'string' ? result.formatted : query,
      coordinates: { longitude: result.lon, latitude: result.lat },
    };
    await this.writeCache(cacheKey, place);
    return place;
  }

  async routeMinutes(
    from: GeoCoordinates,
    to: GeoCoordinates,
    mode: 'walk' | 'drive' = 'walk',
  ): Promise<RouteTravelTime | undefined> {
    if (!this.env.GEOAPIFY_API_KEY) return undefined;
    const cacheKey = `geoapify:routematrix:v1:${mode}:${roundedCoordinateKey(from)}:${roundedCoordinateKey(to)}`;
    const cached = await this.readCache<RouteTravelTime>(cacheKey);
    if (cached) return cached;

    const url = new URL('https://api.geoapify.com/v1/routematrix');
    url.searchParams.set('apiKey', this.env.GEOAPIFY_API_KEY);
    const payload = await this.requestJson<GeoapifyRouteMatrixResponse>(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        mode,
        sources: [{ location: [from.longitude, from.latitude] }],
        targets: [{ location: [to.longitude, to.latitude] }],
      }),
    });
    const entry = payload?.sources_to_targets?.[0]?.[0];
    if (!isFiniteNumber(entry?.time) || entry.time < 0) return undefined;

    const route: RouteTravelTime = {
      minutes: Math.max(1, Math.round(entry.time / 60)),
      ...(isFiniteNumber(entry.distance) && entry.distance >= 0 ? { distanceMeters: Math.round(entry.distance) } : {}),
    };
    await this.writeCache(cacheKey, route);
    return route;
  }

  /**
   * Fetch real route geometry for a sequence of itinerary stops. This is kept
   * server-side so the Geoapify key never reaches the browser. It is separate
   * from routeMinutes because the map needs the detailed road path, while the
   * planner only needs a cheap origin-to-destination duration.
   */
  async routeGeometry(
    stops: GeoCoordinates[],
    mode: GeoRouteMode = 'walk',
  ): Promise<RouteGeometry | undefined> {
    if (!this.env.GEOAPIFY_API_KEY) return undefined;
    const waypoints = deduplicateCoordinates(stops);
    if (waypoints.length < 2) return undefined;

    // v2 fixes the waypoint wire format. Geoapify accepts either `lat,lon` or
    // an explicitly-prefixed `lonlat:lon,lat`; our domain coordinates are
    // longitude-first, so the prefix is essential. Keeping v1 out of this
    // namespace prevents routes calculated with the reversed interpretation
    // from being served after this correction.
    const cacheKey = `geoapify:routing:v2:${mode}:${waypoints.map(roundedCoordinateKey).join('|')}`;
    const cached = await this.readCache<RouteGeometry>(cacheKey);
    if (cached?.coordinates.length && cached.coordinates.length >= 2) return cached;

    const url = new URL('https://api.geoapify.com/v1/routing');
    url.search = new URLSearchParams({
      waypoints: waypoints.map(formatLonLatWaypoint).join('|'),
      mode,
      // Each itinerary location is a real visit. `stopover` creates an
      // independent route leg for every stop and keeps per-leg geometry and
      // timing aligned with the route-matrix calls used by the planner.
      intermediate_waypoint_mode: 'stopover',
      apiKey: this.env.GEOAPIFY_API_KEY,
    }).toString();

    const payload = await this.requestJson<GeoapifyRoutingResponse>(url);
    const feature = payload?.features?.[0];
    const legs = routeLegs(feature?.geometry);
    const coordinates = capRouteCoordinates(flattenRouteCoordinates(feature?.geometry));
    if (coordinates.length < 2) return undefined;

    const route: RouteGeometry = {
      coordinates,
      ...(legs.length ? { legs } : {}),
      ...(isFiniteNumber(feature?.properties?.distance) && feature.properties.distance >= 0
        ? { distanceMeters: Math.round(feature.properties.distance) }
        : {}),
      ...(isFiniteNumber(feature?.properties?.time) && feature.properties.time >= 0
        ? { durationMinutes: Math.max(1, Math.round(feature.properties.time / 60)) }
        : {}),
    };
    await this.writeCache(cacheKey, route);
    return route;
  }

  /**
   * Returns only meaningful route-mode choices. This belongs beside the
   * provider rather than in MapLibre: the comparison uses the original road
   * geometry and metrics, not a lossy rendered polyline. Individual mode
   * requests retain their existing 24-hour KV cache, so this costs at most
   * three Geoapify requests on a cold itinerary and none after that.
   */
  async routeOptions(stops: GeoCoordinates[]): Promise<RouteModeOption[]> {
    // A comparison should degrade per mode. An outage while discovering, for
    // example, a cycling route must not discard a confirmed walking route and
    // make the map lose its only road geometry.
    const settled = await Promise.allSettled(ROUTE_MODE_PRIORITY.map(async (mode) => ({
      mode,
      route: await this.routeGeometry(stops, mode),
    })));
    const variants = settled.flatMap((result) => result.status === 'fulfilled' ? [result.value] : []);

    const distinct: RouteModeOption[] = [];
    for (const variant of variants) {
      const route = variant.route;
      if (!route) continue;
      if (distinct.some((existing) => routesAreEffectivelyEquivalent(existing.route, route))) continue;
      distinct.push({ mode: variant.mode, route });
    }
    return distinct;
  }

  private async requestJson<T>(url: URL, init?: RequestInit): Promise<T | undefined> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(url, { ...init, signal: controller.signal });
      if (!response.ok) return undefined;
      return await response.json() as T;
    } catch {
      return undefined;
    } finally {
      clearTimeout(timeout);
    }
  }

  private async readCache<T>(key: string): Promise<T | undefined> {
    const raw = await this.env.HOTEL_COMPARISON_CACHE?.get(key);
    if (!raw) return undefined;
    try { return JSON.parse(raw) as T; } catch { return undefined; }
  }

  private async writeCache(key: string, value: unknown): Promise<void> {
    await this.env.HOTEL_COMPARISON_CACHE?.put(key, JSON.stringify(value), { expirationTtl: CACHE_TTL_SECONDS });
  }
}

interface GeoapifyGeocodeResponse {
  results?: Array<{ lon?: number; lat?: number; formatted?: string }>;
}

interface GeoapifyRouteMatrixResponse {
  sources_to_targets?: Array<Array<{ time?: number; distance?: number }>>;
}

interface GeoapifyRouteGeometry {
  type?: string;
  coordinates?: unknown;
}

interface GeoapifyRoutingResponse {
  features?: Array<{
    geometry?: GeoapifyRouteGeometry;
    properties?: { distance?: number; time?: number };
  }>;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function normaliseQuery(value: string): string {
  return value.trim().toLocaleLowerCase().replace(/\s+/g, ' ');
}

function roundedCoordinateKey(value: GeoCoordinates): string {
  return `${value.longitude.toFixed(4)},${value.latitude.toFixed(4)}`;
}

/**
 * Geoapify's unprefixed waypoint syntax is `lat,lon`. Atlas stores GeoJSON
 * coordinates as longitude then latitude, so always make that order explicit
 * on the wire rather than relying on the ambiguous default.
 */
function formatLonLatWaypoint(value: GeoCoordinates): string {
  return `lonlat:${value.longitude},${value.latitude}`;
}

function deduplicateCoordinates(stops: GeoCoordinates[]): GeoCoordinates[] {
  const deduplicated: GeoCoordinates[] = [];
  for (const stop of stops) {
    if (!isFiniteNumber(stop.longitude) || !isFiniteNumber(stop.latitude)) continue;
    const previous = deduplicated[deduplicated.length - 1];
    if (previous && roundedCoordinateKey(previous) === roundedCoordinateKey(stop)) continue;
    deduplicated.push(stop);
  }
  return deduplicated;
}

function flattenRouteCoordinates(geometry: GeoapifyRouteGeometry | undefined): Array<[number, number]> {
  const coordinates: Array<[number, number]> = [];
  for (const leg of routeLegs(geometry)) {
    for (const coordinate of leg) {
      const previous = coordinates[coordinates.length - 1];
      if (!previous || previous[0] !== coordinate[0] || previous[1] !== coordinate[1]) coordinates.push(coordinate);
    }
  }
  return coordinates;
}

function routeLegs(geometry: GeoapifyRouteGeometry | undefined): Array<Array<[number, number]>> {
  if (!geometry) return [];
  const rawLegs = geometry.type === 'LineString'
    ? [geometry.coordinates]
    : geometry.type === 'MultiLineString' && Array.isArray(geometry.coordinates)
      ? geometry.coordinates
      : [];
  if (!Array.isArray(rawLegs)) return [];
  return rawLegs.flatMap((rawLeg) => {
    if (!Array.isArray(rawLeg)) return [];
    const leg: Array<[number, number]> = [];
    for (const position of rawLeg) {
      if (!Array.isArray(position) || !isFiniteNumber(position[0]) || !isFiniteNumber(position[1])) continue;
      const coordinate: [number, number] = [position[0], position[1]];
      const previous = leg[leg.length - 1];
      if (!previous || previous[0] !== coordinate[0] || previous[1] !== coordinate[1]) leg.push(coordinate);
    }
    return leg.length >= 2 ? [leg] : [];
  });
}

/**
 * A routing mode is redundant only when Geoapify produced the same corridor,
 * distance, and ETA. Matching just a start/end pair is deliberately not
 * enough: that would hide a meaningful walking or driving alternative.
 */
export function routesAreEffectivelyEquivalent(first: RouteGeometry, second: RouteGeometry): boolean {
  if (first.coordinates.length < 2 || second.coordinates.length < 2) return false;
  if (!isFiniteNumber(first.distanceMeters) || !isFiniteNumber(second.distanceMeters)
    || !isFiniteNumber(first.durationMinutes) || !isFiniteNumber(second.durationMinutes)) return false;
  if (!withinTolerance(first.distanceMeters, second.distanceMeters, 75, 0.015)) return false;
  if (!withinTolerance(first.durationMinutes, second.durationMinutes, 1, 0.1)) return false;

  const firstLegs = first.legs?.length ? first.legs : [first.coordinates];
  const secondLegs = second.legs?.length ? second.legs : [second.coordinates];
  if (firstLegs.length !== secondLegs.length) return false;
  return firstLegs.every((leg, index) => sameRouteCorridor(leg, secondLegs[index]!));
}

function withinTolerance(first: number, second: number, absoluteTolerance: number, relativeTolerance: number): boolean {
  return Math.abs(first - second) <= Math.max(absoluteTolerance, Math.max(first, second) * relativeTolerance);
}

function sameRouteCorridor(first: Array<[number, number]>, second: Array<[number, number]>): boolean {
  const firstLength = polylineDistance(first);
  const secondLength = polylineDistance(second);
  if (firstLength <= 0 || secondLength <= 0) return false;
  const sampleCount = Math.min(32, Math.max(8, Math.ceil(Math.max(firstLength, secondLength) / 350)));
  const deviations = Array.from({ length: sampleCount + 1 }, (_, index) => {
    const progress = index / sampleCount;
    return distanceBetween(routePointAt(first, firstLength, progress), routePointAt(second, secondLength, progress));
  }).sort((left, right) => left - right);
  const mean = deviations.reduce((sum, value) => sum + value, 0) / deviations.length;
  const p95 = deviations[Math.floor((deviations.length - 1) * 0.95)] ?? Number.POSITIVE_INFINITY;
  const maximum = deviations[deviations.length - 1] ?? Number.POSITIVE_INFINITY;
  return mean <= 12 && p95 <= 30 && maximum <= 75;
}

function polylineDistance(coordinates: Array<[number, number]>): number {
  let total = 0;
  for (let index = 1; index < coordinates.length; index += 1) total += distanceBetween(coordinates[index - 1]!, coordinates[index]!);
  return total;
}

function routePointAt(coordinates: Array<[number, number]>, totalDistance: number, progress: number): [number, number] {
  const targetDistance = Math.min(1, Math.max(0, progress)) * totalDistance;
  let travelled = 0;
  for (let index = 1; index < coordinates.length; index += 1) {
    const start = coordinates[index - 1]!;
    const end = coordinates[index]!;
    const segmentDistance = distanceBetween(start, end);
    if (travelled + segmentDistance >= targetDistance || index === coordinates.length - 1) {
      const localProgress = segmentDistance <= 0 ? 0 : (targetDistance - travelled) / segmentDistance;
      return [
        start[0] + (end[0] - start[0]) * localProgress,
        start[1] + (end[1] - start[1]) * localProgress,
      ];
    }
    travelled += segmentDistance;
  }
  return coordinates[coordinates.length - 1] ?? [0, 0];
}

function distanceBetween(first: [number, number], second: [number, number]): number {
  const radians = Math.PI / 180;
  const latitudeDelta = (second[1] - first[1]) * radians;
  const longitudeDelta = (second[0] - first[0]) * radians;
  const firstLatitude = first[1] * radians;
  const secondLatitude = second[1] * radians;
  const sinLatitude = Math.sin(latitudeDelta / 2);
  const sinLongitude = Math.sin(longitudeDelta / 2);
  const angle = sinLatitude * sinLatitude
    + Math.cos(firstLatitude) * Math.cos(secondLatitude) * sinLongitude * sinLongitude;
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(angle), Math.sqrt(1 - angle));
}

/** Keep API responses bounded even for a very long, detailed driving route. */
function capRouteCoordinates(coordinates: Array<[number, number]>, maximum = 5_000): Array<[number, number]> {
  if (coordinates.length <= maximum) return coordinates;
  const finalIndex = coordinates.length - 1;
  return Array.from({ length: maximum }, (_, index) => {
    const sourceIndex = Math.round((index * finalIndex) / (maximum - 1));
    return coordinates[sourceIndex]!;
  });
}

async function hash(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].slice(0, 16).map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
