import { tripPlanModelSchema, tripPlanningInputSchema, type TripPlan, type TripPlanningInput } from '@atlas/contracts';
import { z } from 'zod';
import { AiRouter, type JsonSchema } from '../../ai/router';
import type { Env } from '../../env';
import { GeoProvider, type GeocodedPlace } from '../../providers/geoapify';
import { TavilySearchProvider } from '../../providers/tavily';
import { WikimediaMediaProvider } from '../../providers/wikimedia';

export const TRIP_PLAN_SCHEMA: JsonSchema = {
  type: 'object', additionalProperties: false,
  required: ['title', 'overview', 'assumptions', 'costBreakdown', 'itinerary', 'attractions', 'hiddenGems', 'restaurantSuggestions', 'weatherNotes', 'packing', 'culturalEtiquette', 'localTips'],
  properties: {
    title: { type: 'string' }, overview: { type: 'string' }, assumptions: { type: 'array', items: { type: 'string' }, maxItems: 10 },
    costBreakdown: {
      type: 'object', additionalProperties: false,
      required: ['accommodation', 'food', 'localTransport', 'intercityTransport', 'activities', 'shopping', 'emergency', 'total', 'currency'],
      properties: {
        accommodation: { type: 'number', minimum: 0 }, food: { type: 'number', minimum: 0 }, localTransport: { type: 'number', minimum: 0 }, intercityTransport: { type: 'number', minimum: 0 }, activities: { type: 'number', minimum: 0 }, shopping: { type: 'number', minimum: 0 }, emergency: { type: 'number', minimum: 0 }, total: { type: 'number', minimum: 0 }, currency: { type: 'string' },
      },
    },
    itinerary: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false, required: ['day', 'date', 'title', 'summary', 'estimatedDailyCost', 'items'],
        properties: {
          day: { type: 'integer', minimum: 1 }, date: { type: 'string' }, title: { type: 'string' }, summary: { type: 'string' }, estimatedDailyCost: { type: 'number', minimum: 0 },
          items: {
            type: 'array', minItems: 2, maxItems: 10,
            items: {
              type: 'object', additionalProperties: false,
              required: ['time', 'title', 'category', 'description', 'estimatedCost', 'travelFromPreviousMinutes', 'durationMinutes'],
              properties: {
                time: { type: 'string' }, title: { type: 'string' }, category: { enum: ['attraction', 'food', 'transport', 'rest', 'shopping', 'experience'] }, description: { type: 'string' }, neighbourhood: { type: 'string' }, estimatedCost: { type: 'number', minimum: 0 }, travelFromPreviousMinutes: { type: 'integer', minimum: 0 }, durationMinutes: { type: 'integer', minimum: 10 }, bookingUrl: { type: 'string' },
              },
            },
          },
        },
      },
    },
    attractions: { type: 'array', items: { type: 'string' }, maxItems: 12 }, hiddenGems: { type: 'array', items: { type: 'string' }, maxItems: 8 },
    restaurantSuggestions: { type: 'array', maxItems: 12, items: { type: 'object', additionalProperties: false, required: ['name', 'cuisine', 'neighbourhood', 'priceNote'], properties: { name: { type: 'string' }, cuisine: { type: 'string' }, neighbourhood: { type: 'string' }, priceNote: { type: 'string' } } } },
    weatherNotes: { type: 'array', items: { type: 'string' }, maxItems: 6 }, packing: { type: 'array', items: { type: 'string' }, maxItems: 16 }, culturalEtiquette: { type: 'array', items: { type: 'string' }, maxItems: 10 }, localTips: { type: 'array', items: { type: 'string' }, maxItems: 10 },
  },
};

const itineraryCategorySchema = z.enum(['attraction', 'food', 'transport', 'rest', 'shopping', 'experience']);
const itinerarySkeletonModelSchema = z.object({
  days: z.array(z.object({
    day: z.number().int().min(1).max(21),
    theme: z.string().trim().min(1).max(160),
    candidates: z.array(z.object({
      name: z.string().trim().min(1).max(160),
      category: itineraryCategorySchema,
    })).min(2).max(6),
  })).min(1).max(21),
});

type ItinerarySkeleton = z.infer<typeof itinerarySkeletonModelSchema>;
type GroundedSkeleton = {
  days: Array<{
    day: number;
    theme: string;
    candidates: Array<ItinerarySkeleton['days'][number]['candidates'][number] & {
      location?: GeocodedPlace;
      travelFromPreviousMinutes: number;
    }>;
  }>;
};

const ITINERARY_SKELETON_SCHEMA: JsonSchema = {
  type: 'object', additionalProperties: false, required: ['days'],
  properties: {
    days: {
      type: 'array', minItems: 1, maxItems: 21,
      items: {
        type: 'object', additionalProperties: false, required: ['day', 'theme', 'candidates'],
        properties: {
          day: { type: 'integer', minimum: 1 }, theme: { type: 'string' },
          candidates: {
            type: 'array', minItems: 2, maxItems: 6,
            items: {
              type: 'object', additionalProperties: false, required: ['name', 'category'],
              properties: { name: { type: 'string' }, category: { enum: ['attraction', 'food', 'transport', 'rest', 'shopping', 'experience'] } },
            },
          },
        },
      },
    },
  },
};

export class TripPlanner {
  private readonly tavily: TavilySearchProvider;
  private readonly geo: GeoProvider;
  private readonly wikimedia: WikimediaMediaProvider;

  constructor(env: Env, private readonly aiRouter: AiRouter) {
    this.tavily = new TavilySearchProvider(env);
    this.geo = new GeoProvider(env);
    this.wikimedia = new WikimediaMediaProvider(env);
  }

  async create(inputValue: unknown, actorId: string, options?: { changes?: string; previousPlan?: TripPlan }): Promise<TripPlan> {
    const input = tripPlanningInputSchema.parse(inputValue);
    const [research, skeleton] = await Promise.all([
      this.tavily.searchContext(`${input.destination} travel attractions local transport food cultural etiquette weather ${input.startDate ?? 'travel planning'}`),
      this.createSkeleton(input, actorId, options),
    ]);
    // If every model is unavailable, retain a useful plan by deriving named
    // nearby places from Wikipedia instead of showing generic placeholders.
    const recoverySkeleton = skeleton ? undefined : await this.createRecoverySkeleton(input);
    const grounded = await this.groundSkeleton(skeleton ?? recoverySkeleton, input);
    if (!grounded) return fallbackPlan(input, options?.changes);

    const mediaPromise = this.planMedia(input, grounded);
    try {
      const [plan, media] = await Promise.all([
        this.aiRouter.generateJson({
          feature: 'complex_planning',
          actorId,
          prompt: composePrompt(input, grounded, options),
          schemaName: 'trip_plan',
          schema: TRIP_PLAN_SCHEMA,
          // Geoapify coordinates/times and the Tavily context are already the
          // grounded inputs. Free-tier providers cannot rely on live grounding.
          useWebSearch: false,
          supplementalSearchContext: research,
        }, tripPlanModelSchema.parse),
        mediaPromise,
      ]);
      return normalisePlan(plan, input, grounded, media);
    } catch {
      return groundedFallbackPlan(input, grounded, await mediaPromise, options?.changes);
    }
  }

  private async createSkeleton(
    input: TripPlanningInput,
    actorId: string,
    options?: { changes?: string; previousPlan?: TripPlan },
  ): Promise<ItinerarySkeleton | undefined> {
    try {
      return await this.aiRouter.generateJson({
        feature: 'itinerary_skeleton',
        actorId,
        prompt: skeletonPrompt(input, options),
        schemaName: 'itinerary_skeleton',
        schema: ITINERARY_SKELETON_SCHEMA,
        useWebSearch: false,
      }, (value) => {
        const skeleton = itinerarySkeletonModelSchema.parse(value);
        if (!validSkeletonForTrip(skeleton, input)) throw new Error('Itinerary skeleton does not match the requested trip duration.');
        return skeleton;
      });
    } catch {
      return undefined;
    }
  }

  private async createRecoverySkeleton(input: TripPlanningInput): Promise<ItinerarySkeleton | undefined> {
    if (!this.geo.isConfigured()) return undefined;
    const destination = await this.geo.geocode(input.destination);
    if (!destination) return undefined;
    const titles = await this.wikimedia.nearbyAttractionTitles(destination.coordinates, Math.max(12, tripDays(input) * 2));
    if (titles.length < 2) return undefined;
    const days = Array.from({ length: tripDays(input) }, (_, index) => {
      const start = (index * 2) % titles.length;
      const candidates = [titles[start], titles[(start + 1) % titles.length]]
        .filter((name, candidateIndex, names) => Boolean(name) && names.indexOf(name) === candidateIndex)
        .map((name) => ({ name: name!, category: 'attraction' as const }));
      return { day: index + 1, theme: 'Verified nearby landmarks', candidates };
    });
    const skeleton: ItinerarySkeleton = { days };
    return validSkeletonForTrip(skeleton, input) ? skeleton : undefined;
  }

  private async groundSkeleton(skeleton: ItinerarySkeleton | undefined, input: TripPlanningInput): Promise<GroundedSkeleton | undefined> {
    if (!skeleton) return undefined;
    if (!this.geo.isConfigured()) return undefined;
    const days = await Promise.all(skeleton.days.map(async (day) => {
      const candidatesWithLocations = await Promise.all(day.candidates.map(async (candidate) => ({
        ...candidate,
        location: await this.geo.geocode(candidate.name, input.destination),
      })));
      const candidates = await Promise.all(candidatesWithLocations.map(async (candidate, index) => {
        if (index === 0) return { ...candidate, travelFromPreviousMinutes: 0 };
        const previous = candidatesWithLocations[index - 1];
        const route = previous?.location && candidate.location
          ? await this.geo.routeMinutes(previous.location.coordinates, candidate.location.coordinates, 'walk')
          : undefined;
        // A missing provider response remains visibly unknown (0), never a
        // model-invented number. The compose prompt tells the model why.
        return { ...candidate, travelFromPreviousMinutes: route?.minutes ?? 0 };
      }));
      return { day: day.day, theme: day.theme, candidates };
    }));
    return days.some((day) => day.candidates.some((candidate) => candidate.location)) ? { days } : undefined;
  }

  private async planMedia(input: TripPlanningInput, grounded: GroundedSkeleton): Promise<TripPlan['media']> {
    try {
      const cityCoordinates = (await this.geo.geocode(input.destination))?.coordinates;
      const attractionNames = grounded.days.flatMap((day) => day.candidates.map((candidate) => candidate.name));
      const [city, attractions] = await Promise.all([
        this.wikimedia.cityMedia(input.destination, cityCoordinates),
        this.wikimedia.attractionMedia(attractionNames),
      ]);
      return city || attractions.length ? {
        ...(city ? { city } : {}),
        attractions,
      } : undefined;
    } catch {
      // Images are an enhancement. A Wikimedia outage must not block a plan.
      return undefined;
    }
  }
}

function skeletonPrompt(input: TripPlanningInput, options?: { changes?: string; previousPlan?: TripPlan }): string {
  const duration = input.startDate && input.endDate
    ? `${input.startDate} through ${input.endDate}`
    : `${input.days} days (dates not supplied)`;
  const prior = options?.previousPlan ? `\nExisting plan to improve (treat as editable draft, not as factual evidence):\n${JSON.stringify(options.previousPlan.itinerary)}` : '';
  const changes = options?.changes ? `\nUser-requested changes: ${options.changes}` : '';
  return `You are Project Atlas's itinerary-structure assistant. Produce only a compact day-by-day skeleton for ${input.destination}, ${duration}. Travellers: ${input.adults} adult(s), ${input.children} child(ren). Style: ${input.travelStyle}; pace: ${input.pace}; interests: ${input.interests.join(', ')}. Preferred cuisines: ${input.cuisines.join(', ') || 'no preference'}. Avoid: ${input.avoid.join(', ') || 'nothing specified'}.

Return exactly ${tripDays(input)} ordered days. Each day needs a short theme and 2-6 real, uniquely named candidate places or venue categories in geographic visit order. Use named attractions, markets, parks, restaurants, or districts that can be geocoded in ${input.destination}; never use travel times, costs, opening hours, or generic phrases such as "explore nearby". Set each candidate category accurately. This is a cheap routing skeleton, not prose.${changes}${prior}`;
}

function composePrompt(input: TripPlanningInput, grounded: GroundedSkeleton, options?: { changes?: string; previousPlan?: TripPlan }): string {
  const duration = input.startDate && input.endDate
    ? `${input.startDate} through ${input.endDate}`
    : `${input.days} days (dates not supplied)`;
  const changes = options?.changes ? `\nUser-requested changes: ${options.changes}` : '';
  const prior = options?.previousPlan ? `\nExisting plan to improve (treat as editable draft, not factual evidence):\n${JSON.stringify(options.previousPlan)}` : '';
  return `You are Project Atlas, an expert travel planner. Create a polished, practical trip plan for ${input.destination}, ${duration}, for ${input.adults} adult(s) and ${input.children} child(ren), ${input.rooms} room(s). Budget: ${input.totalBudget} ${input.currency} total. Style: ${input.travelStyle}; pace: ${input.pace}; interests: ${input.interests.join(', ')}. Preferred cuisines: ${input.cuisines.join(', ') || 'no preference'}. Accommodation notes: ${input.accommodationNotes || 'none'}. Accessibility notes: ${input.accessibilityNotes || 'none'}. Avoid: ${input.avoid.join(', ') || 'nothing specified'}.

Use the following grounded itinerary exactly: retain every day, candidate title, category, and candidate order. Each itinerary day must contain exactly the listed candidates in that order. Their coordinates are evidence for grouping; each travelFromPreviousMinutes value is an already-calculated walking travel time. A value of 0 means first stop or unavailable route data; do not invent a replacement. Create the remaining polished fields: title, overview, assumptions, estimates, descriptions, attractions, hidden gems, restaurants, weather notes, packing, etiquette, and local tips. Costs are planning estimates in ${input.currency}, never live inventory or guaranteed prices. Do not fabricate opening hours, reservations, weather forecasts, or source URLs. State uncertainty in assumptions.\n\nGrounded skeleton:\n${JSON.stringify(grounded)}${changes}${prior}`;
}

function normalisePlan(plan: TripPlan, input: TripPlanningInput, grounded: GroundedSkeleton, media?: TripPlan['media']): TripPlan {
  const desiredDays = tripDays(input);
  const itinerary: TripPlan['itinerary'] = plan.itinerary
    .slice(0, desiredDays)
    .map((day, index) => ({
      ...day,
      day: index + 1,
      date: dateForDay(input.startDate, index),
      // Model-provided time values are never used. Candidate order and every
      // travel minute come from the skeleton that Geoapify already grounded.
      items: groundedDayItems(day.items, grounded.days[index]?.candidates ?? []),
    } as TripPlan['itinerary'][number]))
    .sort((left, right) => left.day - right.day);
  while (itinerary.length < desiredDays) itinerary.push(fallbackDay(input, itinerary.length));

  const raw = plan.costBreakdown;
  const categoryKeys = ['accommodation', 'food', 'localTransport', 'intercityTransport', 'activities', 'shopping', 'emergency'] as const;
  const sourceTotal = categoryKeys.reduce((sum, key) => sum + raw[key], 0);
  const targetTotal = Math.min(input.totalBudget, sourceTotal > 0 ? sourceTotal : input.totalBudget);
  const scale = sourceTotal > 0 ? targetTotal / sourceTotal : 1;
  const costBreakdown = {
    accommodation: round(raw.accommodation * scale), food: round(raw.food * scale), localTransport: round(raw.localTransport * scale), intercityTransport: round(raw.intercityTransport * scale), activities: round(raw.activities * scale), shopping: round(raw.shopping * scale), emergency: round(raw.emergency * scale), total: 0, currency: input.currency,
  };
  costBreakdown.total = round(categoryKeys.reduce((sum, key) => sum + costBreakdown[key], 0));
  return tripPlanModelSchema.parse({ ...plan, costBreakdown, itinerary, ...(media ? { media } : {}) });
}

function groundedDayItems(
  modelItems: TripPlan['itinerary'][number]['items'],
  candidates: GroundedSkeleton['days'][number]['candidates'],
): TripPlan['itinerary'][number]['items'] {
  if (candidates.length === 0) return modelItems.map((item, index) => ({ ...item, travelFromPreviousMinutes: index === 0 ? 0 : 0 }));
  return candidates.map((candidate, index) => {
    const modelItem = modelItems.find((item) => normalisePlaceName(item.title) === normalisePlaceName(candidate.name))
      ?? modelItems[index];
    const { coordinates: _modelCoordinates, ...item } = modelItem ?? groundedFallbackItem(candidate.name, candidate.category, index);
    return {
      ...item,
      title: candidate.name,
      category: candidate.category,
      travelFromPreviousMinutes: candidate.travelFromPreviousMinutes,
      ...(candidate.location ? {
        coordinates: {
          longitude: candidate.location.coordinates.longitude,
          latitude: candidate.location.coordinates.latitude,
        },
      } : {}),
    };
  });
}

function groundedFallbackItem(
  title: string,
  category: TripPlan['itinerary'][number]['items'][number]['category'],
  index: number,
): TripPlan['itinerary'][number]['items'][number] {
  return {
    time: `${String(9 + Math.min(index * 2, 12)).padStart(2, '0')}:00`,
    title,
    category,
    description: `Visit ${title}; confirm access, opening times, and any reservations before travel.`,
    estimatedCost: 0,
    travelFromPreviousMinutes: 0,
    durationMinutes: 90,
  };
}

function normalisePlaceName(value: string): string {
  return value.trim().toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ');
}

function validSkeletonForTrip(skeleton: ItinerarySkeleton, input: TripPlanningInput): boolean {
  const expectedDays = tripDays(input);
  if (skeleton.days.length !== expectedDays) return false;
  const seenDays = new Set<number>();
  return skeleton.days.every((day, index) => {
    if (day.day !== index + 1 || seenDays.has(day.day)) return false;
    seenDays.add(day.day);
    return new Set(day.candidates.map((candidate) => normalisePlaceName(candidate.name))).size === day.candidates.length;
  });
}

/**
 * Preserve verified locations, route times, and licenced imagery even when
 * the final prose model is unavailable or out of quota. This is intentionally
 * a richer form of fallbackPlan(), not an invented itinerary.
 */
function groundedFallbackPlan(
  input: TripPlanningInput,
  grounded: GroundedSkeleton,
  media: TripPlan['media'] | undefined,
  changeSummary?: string,
): TripPlan {
  const base = fallbackPlan(input, changeSummary);
  const itinerary = grounded.days.map((day, index) => ({
    day: index + 1,
    date: dateForDay(input.startDate, index),
    title: day.theme,
    summary: 'Places and travel times are grounded in provider lookups; confirm access, hours, and reservations before travel.',
    estimatedDailyCost: round(input.totalBudget / tripDays(input)),
    items: day.candidates.map((candidate, candidateIndex) => ({
      ...groundedFallbackItem(candidate.name, candidate.category, candidateIndex),
      travelFromPreviousMinutes: candidate.travelFromPreviousMinutes,
      ...(candidate.location ? {
        coordinates: {
          longitude: candidate.location.coordinates.longitude,
          latitude: candidate.location.coordinates.latitude,
        },
      } : {}),
    })),
  }));
  const attractions = [...new Set(grounded.days.flatMap((day) => day.candidates.map((candidate) => candidate.name)))].slice(0, 12);
  return tripPlanModelSchema.parse({
    ...base,
    overview: `A provider-grounded ${itinerary.length}-day itinerary for ${input.destination}. The narrative is in recovery mode; locations, route times, and available licensed images are retained.`,
    assumptions: [
      'The narrative planner was unavailable, so this recovery itinerary uses named nearby places and calculated route times.',
      `All amounts are planning estimates in ${input.currency}, not live prices.`,
      ...(changeSummary ? [`Applied requested change: ${changeSummary}`] : []),
    ],
    itinerary,
    attractions,
    ...(media ? { media } : {}),
  });
}

function fallbackPlan(input: TripPlanningInput, changeSummary?: string): TripPlan {
  const days = Array.from({ length: tripDays(input) }, (_, index) => fallbackDay(input, index));
  const total = input.totalBudget;
  return tripPlanModelSchema.parse({
    title: `${input.destination} travel plan`,
    overview: `A ${days.length}-day ${input.pace} itinerary for ${input.destination}, designed around your ${input.travelStyle} budget. Verify individual opening times, reservations, and transport before travel.`,
    assumptions: [
      'This fallback plan was generated without a completed research response; confirm place names and availability before booking.',
      `All amounts are planning estimates in ${input.currency}, not live prices.`,
      ...(changeSummary ? [`Applied requested change: ${changeSummary}`] : []),
    ],
    costBreakdown: budgetBreakdown(total, input.currency),
    itinerary: days,
    attractions: ['Central historic district walk', 'Major museum or landmark', 'Local market'],
    hiddenGems: ['Independent neighbourhood café', 'Local viewpoint or park'],
    restaurantSuggestions: [
      { name: 'Neighbourhood market meal', cuisine: input.cuisines[0] ?? 'local cuisine', neighbourhood: 'Central district', priceNote: 'Budget based on local casual dining' },
      { name: 'Local dinner reservation', cuisine: input.cuisines[1] ?? 'regional cuisine', neighbourhood: 'Near your evening activity', priceNote: 'Reserve after confirming availability' },
    ],
    weatherNotes: ['Check the local forecast 3–7 days before departure and adjust outdoor activities accordingly.'],
    packing: ['Comfortable walking shoes', 'Weather-appropriate outer layer', 'Universal power adapter', 'Reusable water bottle'],
    culturalEtiquette: ['Learn a few local greetings and respect dress requirements at religious or formal sites.'],
    localTips: ['Use a contactless payment backup and keep a small cash reserve for smaller vendors.', 'Save offline maps before leaving accommodation.'],
  });
}

function fallbackDay(input: TripPlanningInput, index: number): TripPlan['itinerary'][number] {
  const daily = round(input.totalBudget / tripDays(input));
  return {
    day: index + 1,
    date: dateForDay(input.startDate, index),
    title: index === 0 ? 'Arrival and orientation' : `Explore a nearby district: day ${index + 1}`,
    summary: 'Keep activities geographically grouped; replace these placeholders with researched venues when available.',
    estimatedDailyCost: daily,
    items: [
      { time: '09:30', title: 'Neighbourhood orientation walk', category: 'attraction', description: 'Start near your accommodation and identify transit, food, and essentials.', estimatedCost: 0, travelFromPreviousMinutes: 0, durationMinutes: 90 },
      { time: '13:00', title: 'Local lunch', category: 'food', description: 'Choose a nearby restaurant matching your cuisine preference and daily budget.', estimatedCost: round(daily * 0.2), travelFromPreviousMinutes: 15, durationMinutes: 75 },
      { time: '15:00', title: 'Primary attraction or experience', category: 'experience', description: 'Reserve a confirmed attraction after checking availability and weather.', estimatedCost: round(daily * 0.18), travelFromPreviousMinutes: 20, durationMinutes: 150 },
    ],
  };
}

function budgetBreakdown(total: number, currency: string): TripPlan['costBreakdown'] {
  const accommodation = round(total * 0.35); const food = round(total * 0.2); const localTransport = round(total * 0.1); const intercityTransport = round(total * 0.12); const activities = round(total * 0.1); const shopping = round(total * 0.06); const emergency = round(total - accommodation - food - localTransport - intercityTransport - activities - shopping);
  return { accommodation, food, localTransport, intercityTransport, activities, shopping, emergency, total, currency };
}

function tripDays(input: TripPlanningInput): number {
  if (input.days) return input.days;
  if (!input.startDate || !input.endDate) return 1;
  return Math.max(1, Math.round((Date.parse(input.endDate) - Date.parse(input.startDate)) / 86_400_000));
}

function dateForDay(startDate: string | undefined, dayIndex: number): string | undefined {
  if (!startDate) return undefined;
  const date = new Date(`${startDate}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + dayIndex);
  return date.toISOString().slice(0, 10);
}

function round(value: number): number { return Math.round(value * 100) / 100; }
