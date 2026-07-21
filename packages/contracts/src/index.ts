import { z } from 'zod';

export const evidenceSourceSchema = z.enum([
  'booking',
  'amadeus',
  'geoapify',
  'weather',
  'tavily',
  'editorial',
  'user',
  'web_aggregate',
  'serpapi',
  'wikimedia',
]);

export const evidenceFreshnessSchema = z.enum([
  'live',
  'recent',
  'seasonal',
  'static',
  'user_entered',
]);

export const evidenceSchema = z
  .object({
    source: evidenceSourceSchema,
    referenceUrl: z.url().optional(),
    sourceRecordId: z.string().min(1).optional(),
    fetchedAt: z.iso.datetime(),
    expiresAt: z.iso.datetime().optional(),
    licence: z.string().min(1).optional(),
    attribution: z.string().min(1).optional(),
    freshness: evidenceFreshnessSchema,
  })
  .superRefine((value, ctx) => {
    if ((value.source === 'web_aggregate' || value.source === 'serpapi') && value.freshness !== 'recent') {
      ctx.addIssue({
        code: 'custom',
        path: ['freshness'],
        message: 'Web-derived evidence must always be recent, never live.',
      });
    }
  });

export type Evidence = z.infer<typeof evidenceSchema>;

export const hotelPlatformSchema = z.enum([
  'Google Hotels',
  'Booking.com',
  'Agoda',
  'MakeMyTrip',
  'Trivago',
]);

export type HotelPlatform = z.infer<typeof hotelPlatformSchema>;

export const hotelPriceSchema = z.object({
  platform: hotelPlatformSchema,
  estimatedPricePerNight: z.number().positive(),
  currency: z.string().length(3).toUpperCase(),
  sourceUrl: z.url(),
  evidence: evidenceSchema,
});

export const hotelComparisonInputSchema = z
  .object({
    destination: z.string().trim().min(2).max(160),
    checkIn: z.iso.date(),
    checkOut: z.iso.date(),
    adults: z.number().int().min(1).max(12),
    rooms: z.number().int().min(1).max(6).default(1),
    children: z.number().int().min(0).max(10).default(0),
    maxPricePerNight: z.number().positive().max(100_000),
    currency: z.string().length(3).toUpperCase(),
  })
  .superRefine((value, ctx) => {
    if (new Date(value.checkOut) <= new Date(value.checkIn)) {
      ctx.addIssue({
        code: 'custom',
        path: ['checkOut'],
        message: 'checkOut must be after checkIn.',
      });
    }
  });

export type HotelComparisonInput = z.infer<typeof hotelComparisonInputSchema>;

export const hotelComparisonModelSchema = z.object({
  hotels: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(180),
        rating: z.number().min(0).max(5).nullable().optional(),
        ratingSource: z.string().trim().min(1).max(80).nullable(),
        area: z.string().trim().min(1).max(160).nullable(),
        prices: z
          .array(
            z.object({
              platform: hotelPlatformSchema,
              estimatedPricePerNight: z.number().positive(),
              currency: z.string().length(3).toUpperCase(),
              sourceUrl: z.url(),
            }),
          )
          .max(4),
      }),
    )
  .max(12),
});

export const hotelSearchLinkSchema = z.object({
  platform: z.enum(['Booking.com', 'MakeMyTrip', 'Trivago']),
  url: z.url(),
});

export const hotelComparisonResultSchema = z.object({
  status: z.enum(['results', 'fallback_links']),
  generatedAt: z.iso.datetime(),
  cacheExpiresAt: z.iso.datetime(),
  hotels: z.array(
    z.object({
      name: z.string(),
      rating: z.number().min(0).max(5).nullable(),
      ratingSource: z.string().optional(),
      area: z.string().optional(),
      description: z.string().optional(),
      imageUrl: z.url().optional(),
      hotelClass: z.string().optional(),
      amenities: z.array(z.string()).max(8).optional(),
      bookingUrl: z.url().optional(),
      coordinates: z.object({ longitude: z.number(), latitude: z.number() }).optional(),
      prices: z.array(hotelPriceSchema).min(1),
    }),
  ),
  fallbackLinks: z.array(hotelSearchLinkSchema).length(3),
  warnings: z.array(z.string()),
});

export type HotelComparisonResult = z.infer<typeof hotelComparisonResultSchema>;

export const flightSearchInputSchema = z
  .object({
    departureId: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/, 'Use a 3-letter airport code.'),
    arrivalId: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/, 'Use a 3-letter airport code.'),
    outboundDate: z.iso.date(),
    returnDate: z.iso.date().optional(),
    adults: z.number().int().min(1).max(9).default(1),
    children: z.number().int().min(0).max(8).default(0),
    currency: z.string().length(3).toUpperCase(),
  })
  .superRefine((value, ctx) => {
    if (value.returnDate && new Date(value.returnDate) <= new Date(value.outboundDate)) {
      ctx.addIssue({ code: 'custom', path: ['returnDate'], message: 'Return date must be after outbound date.' });
    }
  });

export type FlightSearchInput = z.infer<typeof flightSearchInputSchema>;

const flightSegmentSchema = z.object({
  airline: z.string(),
  flightNumber: z.string().optional(),
  airlineLogoUrl: z.url().optional(),
  departureAirport: z.string(),
  arrivalAirport: z.string(),
  departureTime: z.string().optional(),
  arrivalTime: z.string().optional(),
  durationMinutes: z.number().int().positive().optional(),
});

export const flightSearchResultSchema = z.object({
  status: z.enum(['results', 'unavailable']),
  generatedAt: z.iso.datetime(),
  cacheExpiresAt: z.iso.datetime(),
  currency: z.string().length(3),
  flights: z.array(z.object({
    id: z.string(),
    price: z.number().positive(),
    tripType: z.string(),
    totalDurationMinutes: z.number().int().positive().optional(),
    stops: z.number().int().min(0),
    airlineSummary: z.string(),
    airlineLogoUrl: z.url().optional(),
    carbonKg: z.number().nonnegative().optional(),
    bookingToken: z.string().optional(),
    segments: z.array(flightSegmentSchema).min(1).max(8),
    evidence: evidenceSchema,
  })).max(12),
  priceInsight: z.string().optional(),
  warnings: z.array(z.string()),
});

export type FlightSearchResult = z.infer<typeof flightSearchResultSchema>;

export const flightBookingOptionsInputSchema = z.object({
  bookingToken: z.string().trim().min(12).max(12_000),
  // A Google Flights booking token is scoped to the exact search. SerpApi
  // requires these original route parameters when resolving the provider list.
  search: flightSearchInputSchema,
});

export const flightBookingOptionsResultSchema = z.object({
  generatedAt: z.iso.datetime(),
  currency: z.string().length(3),
  options: z.array(z.object({
    source: z.string(),
    price: z.number().positive().optional(),
    bookingUrl: z.url().optional(),
    evidence: evidenceSchema,
  })).max(24),
  warnings: z.array(z.string()),
});

export type FlightBookingOptionsResult = z.infer<typeof flightBookingOptionsResultSchema>;

export const cityGuideInputSchema = z.object({
  destination: z.string().trim().min(2).max(160),
  focus: z.enum(['culture', 'etiquette', 'local_tips']).default('culture'),
});

export const cityGuideModelSchema = z.object({
  facts: z
    .array(
      z.object({
        title: z.string().trim().min(1).max(100),
        summary: z.string().trim().min(1).max(500),
        sourceUrl: z.url(),
      }),
    )
    .max(6),
});

export const cityGuideResultSchema = z.object({
  generatedAt: z.iso.datetime(),
  facts: z.array(
    z.object({
      title: z.string(),
      summary: z.string(),
      evidence: evidenceSchema,
    }),
  ),
  warnings: z.array(z.string()),
});

export type CityGuideResult = z.infer<typeof cityGuideResultSchema>;

// The planner offers common interests as suggestions, but travellers can add
// their own (for example, "anime" or "birdwatching"). Keep that flexibility
// while enforcing the same bounded, clean text at every API boundary.
export const tripInterestSchema = z.string().trim().min(2).max(60);

export const travelStyleSchema = z.enum(['budget', 'balanced', 'comfort', 'luxury']);
export const travelPaceSchema = z.enum(['relaxed', 'balanced', 'fast']);
export type TravelStyle = z.infer<typeof travelStyleSchema>;
export type TravelPace = z.infer<typeof travelPaceSchema>;
export type TripInterest = z.infer<typeof tripInterestSchema>;

export const tripPlanningInputSchema = z
  .object({
    destination: z.string().trim().min(2).max(160),
    startDate: z.iso.date().optional(),
    endDate: z.iso.date().optional(),
    days: z.number().int().min(1).max(21).optional(),
    adults: z.number().int().min(1).max(12).default(1),
    children: z.number().int().min(0).max(10).default(0),
    rooms: z.number().int().min(1).max(6).default(1),
    currency: z.string().length(3).toUpperCase(),
    totalBudget: z.number().positive().max(1_000_000),
    travelStyle: travelStyleSchema.default('balanced'),
    pace: travelPaceSchema.default('balanced'),
    interests: z.array(tripInterestSchema).min(1).max(6),
    cuisines: z.array(z.string().trim().min(2).max(60)).max(6).default([]),
    accommodationNotes: z.string().trim().max(500).optional(),
    accessibilityNotes: z.string().trim().max(500).optional(),
    avoid: z.array(z.string().trim().min(2).max(100)).max(8).default([]),
  })
  .superRefine((value, ctx) => {
    const hasDates = Boolean(value.startDate && value.endDate);
    if (!hasDates && !value.days) {
      ctx.addIssue({
        code: 'custom',
        path: ['days'],
        message: 'Provide travel dates or a number of days.',
      });
    }
    if (value.startDate && value.endDate && new Date(value.endDate) <= new Date(value.startDate)) {
      ctx.addIssue({
        code: 'custom',
        path: ['endDate'],
        message: 'endDate must be after startDate.',
      });
    }
  });

export type TripPlanningInput = z.infer<typeof tripPlanningInputSchema>;

/**
 * A short, user-approved voice note is intentionally kept separate from a
 * complete trip request. The model may only return details it heard clearly;
 * the form retains its own defaults for anything omitted from the note.
 */
export const voiceTripIntakeInputSchema = z.object({
  transcript: z.string().trim().min(4).max(4_000),
});

export type VoiceTripIntakeInput = z.infer<typeof voiceTripIntakeInputSchema>;

export const voiceTripIntakeDraftSchema = z.object({
  destination: z.string().trim().min(2).max(160).optional(),
  startDate: z.iso.date().optional(),
  endDate: z.iso.date().optional(),
  days: z.number().int().min(1).max(21).optional(),
  adults: z.number().int().min(1).max(12).optional(),
  children: z.number().int().min(0).max(10).optional(),
  rooms: z.number().int().min(1).max(6).optional(),
  currency: z.string().length(3).toUpperCase().optional(),
  totalBudget: z.number().positive().max(1_000_000).optional(),
  travelStyle: travelStyleSchema.optional(),
  pace: travelPaceSchema.optional(),
  interests: z.array(tripInterestSchema).min(1).max(6).optional(),
  cuisines: z.array(z.string().trim().min(2).max(60)).max(6).optional(),
  accommodationNotes: z.string().trim().max(500).optional(),
  accessibilityNotes: z.string().trim().max(500).optional(),
  avoid: z.array(z.string().trim().min(2).max(100)).max(8).optional(),
});

export type VoiceTripIntakeDraft = z.infer<typeof voiceTripIntakeDraftSchema>;

export const voiceTripIntakeModelSchema = z.object({
  draft: voiceTripIntakeDraftSchema,
  clarification: z.string().trim().min(1).max(500).optional(),
});

export const voiceTripIntakeResultSchema = z.object({
  transcript: z.string(),
  draft: voiceTripIntakeDraftSchema,
  clarification: z.string().optional(),
  generatedAt: z.iso.datetime(),
  warnings: z.array(z.string().trim().min(1).max(300)).max(3),
});

export type VoiceTripIntakeResult = z.infer<typeof voiceTripIntakeResultSchema>;

const itineraryItemSchema = z.object({
  time: z.string().trim().min(1).max(30),
  title: z.string().trim().min(1).max(160),
  category: z.enum(['attraction', 'food', 'transport', 'rest', 'shopping', 'experience']),
  description: z.string().trim().min(1).max(600),
  neighbourhood: z.string().trim().min(1).max(120).optional(),
  estimatedCost: z.number().min(0).max(1_000_000),
  travelFromPreviousMinutes: z.number().int().min(0).max(360),
  durationMinutes: z.number().int().min(10).max(720),
  bookingUrl: z.url().optional(),
  // These coordinates are provider-grounded after generation. They are never
  // trusted from a model response and let the client draw the actual route
  // without issuing a second, lossy browser geocoding request.
  coordinates: z.object({ longitude: z.number(), latitude: z.number() }).optional(),
});

const tripMediaItemSchema = z.object({
  title: z.string().trim().min(1).max(160),
  imageUrl: z.url(),
  alt: z.string().trim().min(1).max(300),
  evidence: evidenceSchema,
});

export const tripPlanModelSchema = z.object({
  title: z.string().trim().min(1).max(160),
  overview: z.string().trim().min(1).max(1_000),
  assumptions: z.array(z.string().trim().min(1).max(300)).max(10),
  costBreakdown: z.object({
    accommodation: z.number().min(0),
    food: z.number().min(0),
    localTransport: z.number().min(0),
    intercityTransport: z.number().min(0),
    activities: z.number().min(0),
    shopping: z.number().min(0),
    emergency: z.number().min(0),
    total: z.number().min(0),
    currency: z.string().length(3).toUpperCase(),
  }),
  itinerary: z
    .array(
      z.object({
        day: z.number().int().min(1).max(21),
        date: z.iso.date().optional(),
        title: z.string().trim().min(1).max(160),
        summary: z.string().trim().min(1).max(500),
        estimatedDailyCost: z.number().min(0),
        items: z.array(itineraryItemSchema).min(2).max(10),
      }),
    )
    .min(1)
    .max(21),
  attractions: z.array(z.string().trim().min(1).max(160)).max(12),
  hiddenGems: z.array(z.string().trim().min(1).max(160)).max(8),
  restaurantSuggestions: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(160),
        cuisine: z.string().trim().min(1).max(80),
        neighbourhood: z.string().trim().min(1).max(120),
        priceNote: z.string().trim().min(1).max(120),
      }),
    )
    .max(12),
  weatherNotes: z.array(z.string().trim().min(1).max(300)).max(6),
  packing: z.array(z.string().trim().min(1).max(160)).max(16),
  culturalEtiquette: z.array(z.string().trim().min(1).max(300)).max(10),
  localTips: z.array(z.string().trim().min(1).max(300)).max(10),
  media: z.object({
    city: tripMediaItemSchema.optional(),
    attractions: z.array(tripMediaItemSchema).max(12),
  }).optional(),
});

export type TripPlan = z.infer<typeof tripPlanModelSchema>;

export const tripRecordSchema = z.object({
  id: z.uuid(),
  destination: z.string(),
  title: z.string(),
  startDate: z.iso.date().nullable(),
  endDate: z.iso.date().nullable(),
  days: z.number().int().min(1),
  currency: z.string().length(3),
  totalBudget: z.number().positive(),
  latestVersion: z.number().int().min(1),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  plan: tripPlanModelSchema,
});

export type TripRecord = z.infer<typeof tripRecordSchema>;

/** Modes supported by the server-side Geoapify route adapter. */
export const tripRouteModeSchema = z.enum(['walk', 'drive', 'bicycle']);
export type TripRouteMode = z.infer<typeof tripRouteModeSchema>;

/**
 * Road-aware geometry for a persisted itinerary. Coordinates use GeoJSON's
 * [longitude, latitude] order and are deliberately returned only through the
 * authenticated trip endpoint, never by exposing a routing provider key.
 */
export const tripRouteResultSchema = z.object({
  status: z.enum(['results', 'unavailable']),
  mode: tripRouteModeSchema,
  coordinates: z.array(z.tuple([z.number(), z.number()])).max(5_000),
  distanceMeters: z.number().nonnegative().optional(),
  durationMinutes: z.number().int().nonnegative().optional(),
  generatedAt: z.iso.datetime(),
  warnings: z.array(z.string().trim().min(1).max(300)).max(4).optional(),
});

export type TripRouteResult = z.infer<typeof tripRouteResultSchema>;

/**
 * The distinct road-route choices for a persisted itinerary. The API omits
 * unavailable modes and collapses only routes with materially identical
 * geometry, distance, and ETA, so clients never need to infer that from map
 * pixels.
 */
export const tripRouteOptionsResultSchema = z
  .object({
    status: z.enum(['results', 'unavailable']),
    routes: z.array(tripRouteResultSchema).max(3),
    defaultMode: tripRouteModeSchema.optional(),
    generatedAt: z.iso.datetime(),
    warnings: z.array(z.string().trim().min(1).max(300)).max(4).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.status === 'results' && value.routes.length === 0) {
      ctx.addIssue({ code: 'custom', path: ['routes'], message: 'A successful route choice response needs at least one route.' });
    }
    if (value.status === 'unavailable' && value.routes.length > 0) {
      ctx.addIssue({ code: 'custom', path: ['routes'], message: 'Unavailable route choices cannot include routes.' });
    }
    if (value.routes.some((route) => route.status !== 'results')) {
      ctx.addIssue({ code: 'custom', path: ['routes'], message: 'Route choices must contain usable road routes only.' });
    }
    if (value.defaultMode && !value.routes.some((route) => route.mode === value.defaultMode)) {
      ctx.addIssue({ code: 'custom', path: ['defaultMode'], message: 'The default mode must be one of the returned routes.' });
    }
  });

export type TripRouteOptionsResult = z.infer<typeof tripRouteOptionsResultSchema>;

export const tripCreateResultSchema = z.object({
  trip: tripRecordSchema,
  workspaceToken: z.string().min(32).optional(),
});

export type TripCreateResult = z.infer<typeof tripCreateResultSchema>;

export const tripReplanInputSchema = z.object({
  changes: z.string().trim().min(4).max(2_000),
  totalBudget: z.number().positive().max(1_000_000).optional(),
  interests: z.array(tripInterestSchema).min(1).max(6).optional(),
  pace: travelPaceSchema.optional(),
  days: z.number().int().min(1).max(21).optional(),
});

export type TripReplanInput = z.infer<typeof tripReplanInputSchema>;

export const tripChatInputSchema = z.object({
  message: z.string().trim().min(2).max(2_000),
});

export const tripChatResultSchema = z.object({
  reply: z.string().trim().min(1).max(2_000),
  trip: tripRecordSchema.optional(),
});

export type TripChatResult = z.infer<typeof tripChatResultSchema>;
