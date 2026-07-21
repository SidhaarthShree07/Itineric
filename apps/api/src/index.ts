import { z } from 'zod';
import { Hono } from 'hono';
import {
  flightBookingOptionsInputSchema,
  flightSearchInputSchema,
  tripChatInputSchema,
  tripChatResultSchema,
  tripCreateResultSchema,
  tripReplanInputSchema,
  tripRouteModeSchema,
  tripRouteOptionsResultSchema,
  tripRouteResultSchema,
  tripPlanningInputSchema,
  voiceTripIntakeInputSchema,
  type TripRecord,
} from '@atlas/contracts';
import { createAiProviders } from './ai/providers';
import { AiRouter, KvFeatureCapStore } from './ai/router';
import type { Env } from './env';
import { CityGuideProvider } from './features/city/city-guide';
import { FlightSearchProvider } from './features/flights/flight-search';
import { HotelComparisonProvider } from './features/hotels/hotel-comparison';
import { VoiceTripIntake } from './features/intake/voice-trip-intake';
import { TripPlanner } from './features/plans/trip-planner';
import { GeoProvider, type GeoCoordinates } from './providers/geoapify';
import { pingSupabaseDatabase } from './supabase/keep-alive';
import { TripConflictError, TripNotFoundError, TripRepository, WorkspaceAccessError } from './supabase/trips';

const app = new Hono<{ Bindings: Env }>();

app.use('*', async (context, next) => {
  context.header('access-control-allow-origin', '*');
  context.header('access-control-allow-methods', 'GET,POST,PUT,OPTIONS');
  context.header('access-control-allow-headers', 'content-type,authorization,x-atlas-workspace-token');
  if (context.req.method === 'OPTIONS') return context.body(null, 204);
  await next();
});

app.get('/health', (context) => context.json({ status: 'ok', service: 'project-atlas-api' }));

app.get('/v1/media/hotel-image', async (context) => {
  const source = trustedHotelImageUrl(context.req.query('url'));
  if (!source) return context.json({ error: { code: 'INVALID_IMAGE_URL', message: 'Unsupported hotel image source.' } }, 400);
  try {
    const upstream = await fetch(source, { headers: { accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8' } });
    const contentType = upstream.headers.get('content-type') ?? '';
    if (!upstream.ok || !upstream.body || !contentType.startsWith('image/')) {
      return context.json({ error: { code: 'IMAGE_UNAVAILABLE', message: 'Hotel image is temporarily unavailable.' } }, 404);
    }
    return new Response(upstream.body, {
      headers: {
        'access-control-allow-origin': '*',
        'cache-control': 'public, max-age=3600, stale-while-revalidate=86400',
        'content-type': contentType,
      },
    });
  } catch {
    return context.json({ error: { code: 'IMAGE_UNAVAILABLE', message: 'Hotel image is temporarily unavailable.' } }, 404);
  }
});

app.post('/v1/hotels/compare', async (context) => {
  try {
    const body = await context.req.json<unknown>();
    return context.json(await new HotelComparisonProvider(context.env).compare(body));
  } catch (error) {
    if (error instanceof z.ZodError) {
      return context.json({ error: { code: 'INVALID_INPUT', issues: error.issues } }, 400);
    }
    const message = error instanceof Error ? error.message : 'Unable to compare hotels.';
    return context.json({ error: { code: 'HOTEL_COMPARISON_FAILED', message } }, 503);
  }
});

app.post('/v1/flights/search', async (context) => {
  try {
    const body = flightSearchInputSchema.parse(await context.req.json<unknown>());
    return context.json(await new FlightSearchProvider(context.env).search(body));
  } catch (error) {
    if (error instanceof z.ZodError) return context.json({ error: { code: 'INVALID_INPUT', issues: error.issues } }, 400);
    const message = error instanceof Error ? error.message : 'Unable to search flights.';
    return context.json({ error: { code: 'FLIGHT_SEARCH_FAILED', message } }, 503);
  }
});

app.post('/v1/flights/booking-options', async (context) => {
  try {
    const body = flightBookingOptionsInputSchema.parse(await context.req.json<unknown>());
    return context.json(await new FlightSearchProvider(context.env).bookingOptions(body));
  } catch (error) {
    if (error instanceof z.ZodError) return context.json({ error: { code: 'INVALID_INPUT', issues: error.issues } }, 400);
    const message = error instanceof Error ? error.message : 'Unable to load booking options.';
    return context.json({ error: { code: 'FLIGHT_BOOKING_OPTIONS_FAILED', message } }, 503);
  }
});

app.post('/v1/cities/guide', async (context) => {
  try {
    const body = await context.req.json<unknown>();
    const actorId = context.req.header('cf-connecting-ip') ?? 'anonymous';
    const aiRouter = new AiRouter(
      context.env,
      new KvFeatureCapStore(context.env.HOTEL_COMPARISON_CACHE),
      createAiProviders(context.env),
    );
    return context.json(await new CityGuideProvider(context.env, aiRouter).guide(body, actorId));
  } catch (error) {
    if (error instanceof z.ZodError) {
      return context.json({ error: { code: 'INVALID_INPUT', issues: error.issues } }, 400);
    }
    return context.json({ error: { code: 'CITY_GUIDE_FAILED', message: 'Unable to create city guidance.' } }, 503);
  }
});

/**
 * Speech recognition itself happens in the browser, where Chrome can use its
 * built-in speech service without putting a Google credential in the PWA.
 * This endpoint only turns an already-transcribed note into form fields. It
 * accepts a workspace token when one exists and otherwise uses the edge IP as
 * a rate-cap actor so first-time travellers can use voice before a trip exists.
 */
app.post('/v1/trip-intake/voice', async (context) => {
  try {
    const input = voiceTripIntakeInputSchema.parse(await context.req.json<unknown>());
    const actorId = context.req.header('x-atlas-workspace-token')
      ? `workspace:${context.req.header('x-atlas-workspace-token')}`
      : `voice:${context.req.header('cf-connecting-ip') ?? 'anonymous'}`;
    const aiRouter = new AiRouter(
      context.env,
      new KvFeatureCapStore(context.env.HOTEL_COMPARISON_CACHE),
      createAiProviders(context.env),
    );
    return context.json(await new VoiceTripIntake(aiRouter).extract(input, actorId));
  } catch (error) {
    if (error instanceof z.ZodError) {
      return context.json({ error: { code: 'INVALID_INPUT', issues: error.issues } }, 400);
    }
    return context.json({ error: { code: 'VOICE_TRIP_INTAKE_FAILED', message: 'Unable to process that trip note. Please type it instead.' } }, 503);
  }
});

app.get('/v1/trips', async (context) => {
  try {
    const repository = new TripRepository(context.env);
    const workspace = await repository.workspace(workspaceToken(context));
    return context.json({ trips: await repository.listTrips(workspace.id) });
  } catch (error) {
    return persistenceError(context, error);
  }
});

app.post('/v1/trips', async (context) => {
  try {
    const request = tripPlanningInputSchema.parse(await context.req.json<unknown>());
    const repository = new TripRepository(context.env);
    const workspace = await repository.workspace(workspaceToken(context));
    const plan = await planner(context).create(request, `workspace:${workspace.id}`);
    const trip = await repository.createTrip({ workspaceId: workspace.id, request, plan, reason: 'initial' });
    return context.json(tripCreateResultSchema.parse({ trip, workspaceToken: workspace.token }), 201);
  } catch (error) {
    return persistenceError(context, error);
  }
});

/**
 * Loads all useful, distinct travel modes in one request. The GeoProvider
 * makes the decision with real route geometry/metrics, so the web client can
 * hide a redundant mode chooser instead of trying to compare rendered lines.
 */
app.get('/v1/trips/:tripId/routes', async (context) => {
  try {
    const repository = new TripRepository(context.env);
    const workspace = await repository.workspace(workspaceToken(context));
    const current = await repository.getTrip(workspace.id, context.req.param('tripId'));
    const stops = itineraryRouteStops(current.trip);
    const generatedAt = new Date().toISOString();
    if (stops.length < 2) {
      return context.json(tripRouteOptionsResultSchema.parse({
        status: 'unavailable',
        routes: [],
        generatedAt,
        warnings: ['This itinerary needs at least two mapped stops before travel choices can be drawn.'],
      }));
    }

    const routes = await new GeoProvider(context.env).routeOptions(stops);
    if (!routes.length) {
      return context.json(tripRouteOptionsResultSchema.parse({
        status: 'unavailable',
        routes: [],
        generatedAt,
        warnings: ['Road geometry is temporarily unavailable. The map can still show your itinerary stops.'],
      }));
    }

    return context.json(tripRouteOptionsResultSchema.parse({
      status: 'results',
      routes: routes.map(({ mode, route }) => ({ status: 'results' as const, mode, ...route, generatedAt })),
      defaultMode: routes[0]?.mode,
      generatedAt,
    }));
  } catch (error) {
    return persistenceError(context, error);
  }
});

/**
 * Exposes cached road geometry for the authenticated trip only. The browser
 * gets coordinates it can render in MapLibre, but never the Geoapify key.
 */
app.get('/v1/trips/:tripId/route', async (context) => {
  const modeResult = tripRouteModeSchema.safeParse(context.req.query('mode') ?? 'walk');
  if (!modeResult.success) {
    return context.json({ error: { code: 'INVALID_INPUT', issues: modeResult.error.issues } }, 400);
  }
  try {
    const repository = new TripRepository(context.env);
    const workspace = await repository.workspace(workspaceToken(context));
    const current = await repository.getTrip(workspace.id, context.req.param('tripId'));
    const stops = itineraryRouteStops(current.trip);
    const generatedAt = new Date().toISOString();
    if (stops.length < 2) {
      return context.json(tripRouteResultSchema.parse({
        status: 'unavailable',
        mode: modeResult.data,
        coordinates: [],
        generatedAt,
        warnings: ['This itinerary needs at least two mapped stops before a road route can be drawn.'],
      }));
    }

    const route = await new GeoProvider(context.env).routeGeometry(stops, modeResult.data);
    if (!route) {
      return context.json(tripRouteResultSchema.parse({
        status: 'unavailable',
        mode: modeResult.data,
        coordinates: [],
        generatedAt,
        warnings: ['Road geometry is temporarily unavailable. The map can still show your itinerary stops.'],
      }));
    }

    return context.json(tripRouteResultSchema.parse({
      status: 'results',
      mode: modeResult.data,
      ...route,
      generatedAt,
    }));
  } catch (error) {
    return persistenceError(context, error);
  }
});

app.get('/v1/trips/:tripId', async (context) => {
  try {
    const repository = new TripRepository(context.env);
    const workspace = await repository.workspace(workspaceToken(context));
    return context.json(await repository.getTrip(workspace.id, context.req.param('tripId')));
  } catch (error) {
    return persistenceError(context, error);
  }
});

app.put('/v1/trips/:tripId/replan', async (context) => {
  try {
    const changes = tripReplanInputSchema.parse(await context.req.json<unknown>());
    const repository = new TripRepository(context.env);
    const workspace = await repository.workspace(workspaceToken(context));
    const current = await repository.getTrip(workspace.id, context.req.param('tripId'));
    const request = tripPlanningInputSchema.parse({
      ...current.request,
      totalBudget: changes.totalBudget ?? current.request.totalBudget,
      interests: changes.interests ?? current.request.interests,
      pace: changes.pace ?? current.request.pace,
      days: changes.days ?? current.request.days,
    });
    const plan = await planner(context).create(request, `workspace:${workspace.id}`, {
      changes: changes.changes,
      previousPlan: current.trip.plan,
    });
    const trip = await repository.appendPlanVersion({
      workspaceId: workspace.id,
      tripId: current.trip.id,
      request,
      plan,
      reason: 'replan',
      changeSummary: changes.changes,
    });
    return context.json({ trip });
  } catch (error) {
    return persistenceError(context, error);
  }
});

app.post('/v1/trips/:tripId/chat', async (context) => {
  try {
    const input = tripChatInputSchema.parse(await context.req.json<unknown>());
    const repository = new TripRepository(context.env);
    const workspace = await repository.workspace(workspaceToken(context));
    const tripId = context.req.param('tripId');
    const current = await repository.getTrip(workspace.id, tripId);
    await repository.addMessage(workspace.id, tripId, 'user', input.message);
    const plan = await planner(context).create(current.request, `workspace:${workspace.id}`, {
      changes: input.message,
      previousPlan: current.trip.plan,
    });
    const trip = await repository.appendPlanVersion({
      workspaceId: workspace.id,
      tripId,
      request: current.request,
      plan,
      reason: 'chat_replan',
      changeSummary: input.message,
    });
    const reply = `I saved version ${trip.latestVersion} with your requested changes. Review the updated cost assumptions and itinerary before booking.`;
    await repository.addMessage(workspace.id, tripId, 'assistant', reply);
    return context.json(tripChatResultSchema.parse({ reply, trip }));
  } catch (error) {
    return persistenceError(context, error);
  }
});

function planner(context: { env: Env }): TripPlanner {
  const aiRouter = new AiRouter(
    context.env,
    new KvFeatureCapStore(context.env.HOTEL_COMPARISON_CACHE),
    createAiProviders(context.env),
  );
  return new TripPlanner(context.env, aiRouter);
}

function workspaceToken(context: { req: { header(name: string): string | undefined } }): string | undefined {
  return context.req.header('x-atlas-workspace-token');
}

function itineraryRouteStops(trip: TripRecord): GeoCoordinates[] {
  // Keep a rendered journey concise and within Geoapify's free-tier routing
  // limits. Rest/transport entries are not visitable destinations, so they do
  // not belong in the route itself.
  return trip.plan.itinerary
    .flatMap((day) => day.items)
    .filter((item) => item.category !== 'transport' && item.category !== 'rest')
    .flatMap((item) => item.coordinates && validRouteCoordinates(item.coordinates) ? [item.coordinates] : [])
    .slice(0, 8);
}

function validRouteCoordinates(value: GeoCoordinates): boolean {
  return Number.isFinite(value.longitude)
    && Number.isFinite(value.latitude)
    && value.longitude >= -180
    && value.longitude <= 180
    && value.latitude >= -90
    && value.latitude <= 90;
}

function trustedHotelImageUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    const allowed = host === 'googleusercontent.com' || host.endsWith('.googleusercontent.com') || host === 'ggpht.com' || host.endsWith('.ggpht.com') || host === 'gstatic.com' || host.endsWith('.gstatic.com');
    return url.protocol === 'https:' && allowed ? url.toString() : undefined;
  } catch { return undefined; }
}

function persistenceError(context: { json: (value: unknown, status?: 400 | 401 | 404 | 409 | 500 | 503) => Response }, error: unknown): Response {
  if (error instanceof z.ZodError) {
    return context.json({ error: { code: 'INVALID_INPUT', issues: error.issues } }, 400);
  }
  if (error instanceof WorkspaceAccessError) {
    return context.json({ error: { code: 'WORKSPACE_UNAUTHORIZED', message: error.message } }, 401);
  }
  if (error instanceof TripNotFoundError) {
    return context.json({ error: { code: 'TRIP_NOT_FOUND', message: error.message } }, 404);
  }
  if (error instanceof TripConflictError) {
    return context.json({ error: { code: 'TRIP_CONFLICT', message: error.message } }, 409);
  }
  const message = error instanceof Error ? error.message : 'Unable to complete this trip request.';
  return context.json({ error: { code: 'TRIP_PERSISTENCE_FAILED', message } }, 503);
}

export default {
  fetch: app.fetch,
  async scheduled(_controller: ScheduledController, env: Env, executionContext: ExecutionContext): Promise<void> {
    executionContext.waitUntil(pingSupabaseDatabase(env));
  },
};
