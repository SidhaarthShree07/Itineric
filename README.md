# Itineric

> Some journeys are dreamed. Ours are drawn.

Itineric is an AI-powered travel concierge and progressive web app that turns a destination, dates, budget, travel style, and personal interests into a grounded, editable trip plan. It combines itinerary intelligence, hotel and flight research, route geometry, licensed imagery, and an immersive MapLibre experience in one planning studio.

![Itineric architecture](<Architecture diagram.png>)

## What Itineric does

- Creates a personalized day-by-day itinerary from destination, dates or trip length, budget, pace, interests, cuisines, accessibility needs, and things to avoid.
- Uses a two-stage planning workflow: a fast itinerary skeleton, real geocoding and route-matrix timings, then a final structured composition.
- Replaces invented travel times with Geoapify route data and preserves route geometry for the interactive map.
- Compares hotel estimates from SerpApi Google Hotels results, including images, ratings, nightly prices, provider links, and fallback search links.
- Searches flights through SerpApi Google Flights data and exposes booking-option quotes when a provider token is available.
- Enriches city and attraction results with Wikimedia Commons and Wikipedia imagery, licence metadata, and attribution links.
- Includes an immersive MapLibre GL JS route view with 3D buildings, animated traveler marker, camera following, stop cards, visit order, and walk, drive, or cycle options.
- Supports replan, chat-based changes, saved trips, plan versions, budget changes, and itinerary regeneration.
- Provides voice trip intake with browser speech recognition, editable transcript review, Groq-first field extraction, and a confirmation step before planning.
- Includes weather and city-guide context, local tips, packing guidance, cultural etiquette, and cost breakdowns.
- Works as an installable PWA with responsive layouts, reduced-motion handling, offline shell caching, and mobile-friendly controls.

## Architecture

The system architecture is available in the root-level [Architecture diagram.png](<Architecture diagram.png>).

## Planning workflow

1. The user enters a brief or records a voice note.
2. The voice transcript is reviewed and converted into editable trip fields.
3. The itinerary skeleton provider proposes day themes and candidate places.
4. Tavily supplies research context where available.
5. Geoapify geocodes each candidate and calculates route-matrix travel times.
6. Gemini or OpenAI composes the final structured trip plan from the grounded inputs.
7. Groq and OpenRouter provide ordered fallbacks when a primary provider is unavailable or rate-limited.
8. The plan, route data, media evidence, and revisions are persisted to Supabase.
9. Cloudflare KV caches provider responses using feature-specific TTLs and keys.

The final itinerary always overwrites model-provided travel minutes with route-matrix values. Hotel estimates are recent web snapshots, not guaranteed live inventory.

## Technology

| Layer | Technology |
| --- | --- |
| Frontend | React 19, TypeScript, Vite, PWA plugin |
| Motion | GSAP, ScrollTrigger, canvas image sequence |
| Maps | MapLibre GL JS, MapTiler, Geoapify route geometry |
| API | Cloudflare Workers, Hono, Wrangler |
| Cache | Cloudflare KV |
| Database | Supabase Postgres with RLS |
| AI | Gemini, OpenAI, Groq, OpenRouter |
| Search and travel data | SerpApi, Tavily, Geoapify |
| Media | Wikimedia Commons and Wikipedia APIs |
| Delivery | Vercel, Cloudflare, GitHub Actions |

## Repository layout

```text
apps/
  api/                 Cloudflare Worker API and provider adapters
  web/                 React PWA and immersive planning studio
packages/
  contracts/           Shared Zod schemas and TypeScript contracts
docs/
  project-atlas-prd.md Product requirements document
  project-atlas-technical-specification.md Technical specification
supabase/
  migrations/          Postgres schema and heartbeat migration
Architecture diagram.png Exported architecture visual
```

## Local development

### Requirements

- Node.js 20 or newer
- pnpm 10
- A MapTiler client key for the map
- Supabase project credentials for persistence
- At least one AI provider key for generated plans

### Install

```bash
pnpm install
```

### Configure the API

```powershell
Copy-Item apps/api/.dev.vars.example apps/api/.dev.vars
```

Fill in only the provider keys you have. Private keys belong in `apps/api/.dev.vars` and must never be exposed through a `VITE_` variable.

Important API variables include:

```env
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
GEMINI_API_KEY=
GEMINI_API_KEYS=
GEMINI_MODEL=gemini-3.1-flash-lite
OPENAI_API_KEY=
OPENAI_API_KEYS=
OPENAI_MODEL=gpt-5.6-luna
GROQ_API_KEY=
GROQ_API_KEYS=
OPENROUTER_API_KEY=
OPENROUTER_API_KEYS=
SERPAPI_API_KEY=
GEOAPIFY_API_KEY=
TAVILY_API_KEY=
```

The comma-separated key variables rotate keys after HTTP 429 responses. Feature caps are configured with `AI_CAP_*` variables.

### Configure the web app

```powershell
Copy-Item apps/web/.env.example apps/web/.env.local
```

```env
VITE_API_BASE_URL=http://localhost:8787
VITE_MAPTILER_KEY=
```

Restrict the MapTiler key to the deployed domains before production use.

### Run locally

Open two terminals:

```bash
pnpm dev:api
```

```bash
pnpm dev:web
```

The frontend is available at `http://localhost:5173` and the API health check is available at `http://localhost:8787/health`.

### Database setup

Apply both migrations to the Supabase project:

```text
supabase/migrations/20260721_atlas_heartbeat.sql
supabase/migrations/20260721_trip_planning.sql
```

The Worker uses the service role server-side. RLS remains enabled for the application tables.

## Production deployment

The recommended production topology is hybrid:

- Vercel hosts the React PWA and creates preview deployments for pull requests.
- Cloudflare Workers hosts the API, KV cache, and scheduled keep-alive trigger.
- Supabase hosts Postgres persistence.
- GitHub is the source of truth for both deployments.

For Vercel, set the project root to `apps/web`, use `pnpm install --frozen-lockfile`, build with `pnpm --filter @atlas/web build`, and publish `apps/web/dist`.

For Cloudflare, create the KV namespace, replace the placeholder namespace ID in `apps/api/wrangler.toml`, configure Worker secrets, and deploy with:

```bash
pnpm --filter @atlas/api deploy
```

Set `VITE_API_BASE_URL` in Vercel to the deployed Worker URL. Configure the Worker CORS allowlist for the Vercel production domain and preview domains.

## API surface

- `GET /health`
- `POST /v1/trips`
- `GET /v1/trips`
- `GET /v1/trips/:tripId`
- `PUT /v1/trips/:tripId/replan`
- `POST /v1/trips/:tripId/chat`
- `GET /v1/trips/:tripId/route`
- `GET /v1/trips/:tripId/routes`
- `POST /v1/trip-intake/voice`
- `POST /v1/hotels/compare`
- `POST /v1/flights/search`
- `POST /v1/flights/booking-options`
- `POST /v1/cities/guide`
- `GET /v1/media/hotel-image`

## Quality and verification

```bash
pnpm --filter @atlas/web typecheck
pnpm --filter @atlas/web build
pnpm --filter @atlas/api typecheck
pnpm --filter @atlas/api test
```

The API test suite covers provider routing, key rotation, Geoapify, Wikimedia attribution, hotel comparison, route timing normalization, voice intake, and HTTP routes.

## How Codex and GPT-5.6 were used

Codex, powered by GPT-5.6, was used as the implementation and review agent throughout the build. It helped:

- Translate the product requirements into the PRD, technical specification, deployment plan, and architecture diagrams.
- Implement the Cloudflare Worker adapters, AI provider fallback chain, per-feature caps, KV caching, Supabase persistence, and scheduled keep-alive.
- Build the two-stage itinerary pipeline that grounds place coordinates and travel times before final composition.
- Implement SerpApi hotel and flight adapters with structured responses, fallback links, image handling, and attribution-safe Wikimedia media.
- Build the MapLibre 3D route experience with route geometry, stop cards, animated traveler movement, and camera-follow behavior.
- Refine the Itineric landing sequence, responsive PWA workspace, liquid-glass planning studio, legal panels, and review-first voice intake flow.
- Inspect runtime behavior, diagnose API and map issues, patch schema and User-Agent bugs, and run typechecks, builds, API tests, and local endpoint checks.

GPT-5.6 was used for complex planning and engineering reasoning, while the application itself routes production travel requests through the configured Gemini, OpenAI, Groq, and OpenRouter providers according to each feature's cost, latency, and fallback policy.

## Privacy and attribution

- Raw microphone audio is not uploaded by the voice intake flow. The browser speech-recognition result is shown for review before extraction.
- Private provider keys stay in Worker secrets and are not bundled into the frontend.
- Wikimedia media is displayed only with resolved licence and attribution metadata, linked back to the source.
- Hotel and flight prices are estimates or provider snapshots. Users should confirm availability and final fare rules before booking.

## License

The Itineric application source code is released under the [MIT License](LICENSE), copyright © 2026 Sidhaarth Shree.

Provider data, map tiles, imagery, fonts, and third-party APIs remain subject to their respective licences and usage terms.
