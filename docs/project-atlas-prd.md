# Project Atlas - Product Requirements Document

**Product:** AI-powered travel planning PWA
**Status:** Draft for build approval
**Version:** 1.0
**Prepared:** 20 July 2026
**Audience:** Product, design, engineering, and launch stakeholders

## 1. Executive decision

Build Project Atlas as a **trip-planning concierge**, not an online travel agency. A user supplies a destination, dates or trip length, travellers, budget, interests, pace, and constraints. Atlas returns a credible, editable trip workspace: selected stay options, a budget with stated assumptions, a route-aware day plan, map, forecast, food recommendations, cultural guidance, packing list, and a chat interface that applies safe changes to the plan.

The product should launch in two clearly separated capability levels:

1. **Planning MVP:** research-backed recommendations, estimates, maps, weather, and booking redirects. It must not represent estimates as bookable inventory.
2. **Inventory-enabled release:** live accommodation and flight availability from an approved provider, with a displayed retrieval timestamp, source, currency, taxes/fees treatment, and redirect or approved checkout flow.

This distinction is non-negotiable. Booking.com's Demand API can provide real-time accommodation availability and prices, but access requires Affiliate Partner credentials; Amadeus provides a limited free quota for development and production, with full live data only in production. [[1]](https://developers.booking.com/demand/docs/open-api/3.2/demand-api) [[2]](https://developers.amadeus.com/self-service/apis-docs/guides/developer-guides/pricing/)

## 2. Product framing

### 2.1 Problem

Planning a trip currently means reconciling conflicting advice from search, maps, booking sites, reviews, blogs, and spreadsheets. The user must do the hard work: choose a practical area to stay, estimate costs, turn a list of places into feasible days, understand local norms, and revise everything when a constraint changes. Generic itinerary generators save little time because they often create plausible prose without verified opening hours, travel time, budget logic, or a revision model.

### 2.2 Product promise

**“Tell Atlas the trip you want; receive an honest, route-aware travel plan you can inspect and reshape.”**

Atlas earns trust through explanation and provenance:

- Every material recommendation has a reason, source class, and confidence/freshness marker.
- Budget values are explicitly marked as live, quoted, calculated, or estimated.
- The itinerary makes time, travel mode, and cost trade-offs visible.
- Replanning changes only what needs changing, shows a diff, and preserves user-pinned decisions.

### 2.3 Primary users and jobs

| User | Core job | Atlas value |
|---|---|---|
| First-time international traveller | “Help me make a safe, complete plan without missing essentials.” | Guided intake, local etiquette, packing, sensible pacing, clear cost range. |
| Busy couple or family organiser | “Build a trip everyone will enjoy and keep it within a limit.” | Shared preferences, traveller-aware recommendations, cost split, revision history. |
| Budget-conscious explorer | “Maximise experiences without surprise costs.” | Budget envelope, trade-off suggestions, free/paid tagging, transparent estimates. |
| Enthusiast traveller | “Surface distinctive places while keeping the itinerary practical.” | Interest-led discovery, local gems, map/context, editable route order. |

### 2.4 Non-goals for the first release

- Processing payments, issuing tickets, or acting as merchant of record.
- Guaranteeing availability, room quality, visas, health advice, safety, or opening hours.
- Replacing professional travel agents for complex multi-country, group, accessibility, or emergency needs.
- Scraping pages that prohibit automated reuse, or presenting unsourced social content as fact.
- Producing an autonomous plan without allowing the user to inspect, edit, and confirm it.

## 3. Objectives and success measures

### 3.1 Business and product objectives

1. Reach a first useful plan in under three minutes for a typical city break.
2. Make the first itinerary materially more actionable than a text-only plan: it must include travel time, time blocks, costs, and a map.
3. Make change safe: a budget, date, interest, or pace change should yield a comprehensible plan diff in under 30 seconds under normal provider conditions.
4. Establish trust before monetisation through accuracy labels, citations, a clear estimate policy, and booking redirects.
5. Create a narrow, deployable MVP that remains within the selected free-tier guardrails at low launch volume.

### 3.2 Launch metrics

| Metric | Definition | 30-day target |
|---|---|---|
| Plan completion | A generated plan is saved or shared | >= 45% of started trips |
| Time to first plan | Submit intake to complete plan state | p50 < 45 s; p95 < 120 s |
| Itinerary usefulness | Plans with at least one manual edit, pin, or booking redirect | >= 35% of completed plans |
| Replan success | Replan requests producing a valid version without fallback | >= 95% |
| Route validity | Scheduled legs with a known travel duration or deliberate “verify locally” state | >= 98% |
| Budget completeness | Plans with all required cost categories | 100% |
| Trust defect rate | User reports of stale/misleading data per completed plan | < 2% |
| PWA quality | Lighthouse accessibility, best practices, PWA | >= 90 on supported launch routes |

### 3.3 Product guardrails

- A high-confidence plan is not a promise. The UI must state **“check availability and local conditions before booking or travelling.”**
- The planner must reject impossible schedules rather than silently overbooking a day.
- The planner must not invent prices, business hours, reservations, accessibility features, visa requirements, or safety alerts.
- Any unsupported preference should be shown as an assumption or a question, never silently treated as fact.

## 4. Scope and release plan

### 4.1 MVP (P0) - one-city, 1-14 day leisure trips

| Area | Required capability |
|---|---|
| Intake | Destination, dates **or** number of days, origin optional, adults/children, currency, total budget, travel style, interests, pace, mobility/dietary constraints, accommodation preferences, and must-dos. |
| Plan generation | A saved, versioned trip workspace with 2-4 stay choices, daily schedule, budget, map markers/routes, recommendations, tips, packing, and evidence/freshness labels. |
| Hotels | Live inventory only where an approved provider credential is active; otherwise “illustrative price range” and an affiliate/search redirect. Show why each option fits. |
| Attractions and food | Curated/ranked options with category, expected duration, estimated cost, source class, location, and a reason for fit. Include a carefully labelled “local gem” section. |
| Optimised itinerary | Route-aware schedule with travel legs, opening-hour constraints when available, day budget, breaks, and user-editable order. |
| Budget | Accommodation, local transport, food, activities, shopping, contingency, and optional intercity/flight categories. Every value identifies its basis. |
| Context | Weather forecast when dates are within provider range; seasonal expectations otherwise; etiquette, transit/safety tips, and packing recommendations. |
| AI change assistant | Chat and quick actions that translate a user request into a typed change request, generate a preview diff, and apply only after confirmation for material changes. |
| PWA | Install prompt, offline shell, cached last-opened plan, and a clearly degraded offline mode. |

### 4.2 P1

- Multi-city trip graph and intercity transport.
- Collaborative sharing, comments, roles, and export to calendar/PDF.
- Explicit source citations per recommendation and user feedback (“wrong”, “visited”, “save for later”).
- Booking.com Demand API search-and-redirect after partner approval.
- Destination playbooks maintained through editorial review.
- Accessibility mode: step-free preference, rest breaks, and lower-walking itinerary constraints where source data supports them.

### 4.3 P2

- Supplier-approved booking flows, cancellation-aware rate display, price alerts, and affiliate attribution reporting.
- Personalisation learned from opt-in ratings and completed trips.
- Native map downloads and richer offline destination packs.
- Travel disruption monitoring and proactive replan proposals.

## 5. Experience requirements

### 5.1 Information architecture

```text
Landing / explore
  -> Trip brief (guided intake)
  -> “Building your plan” progress view
  -> Trip workspace
       Overview | Itinerary | Stays | Map | Budget | Discover | Guide | Chat
  -> Save / share / export / booking redirect
```

### 5.2 Guided trip brief

The brief must feel conversational but remain structured. It uses progressive disclosure: show essentials first, then quality-improving preferences.

**Required fields:** destination, timing (dates or duration), travellers, budget/currency, and at least one intent/style selection.

**Optional fields:** origin, hotel quality/area, flight inclusion, food preferences, mobility needs, dietary needs, wake/sleep preference, interest weights, must-dos, exclusions, and preferred transport.

The interface must explain why it asks for a detail. Example: “A hotel area helps us reduce your daily travel time.” It must accept a short free-text wish, then display its structured interpretation for correction.

### 5.3 Plan creation progress

The build screen is not a theatrical loading animation. It must expose meaningful progress and partial results:

1. Validate trip brief and resolve destination.
2. Gather stay candidates and current travel context.
3. Find and rank places matching interests.
4. Build feasible day clusters and travel legs.
5. Calculate budget and verify assumptions.
6. Compose the plan and run quality checks.

If a provider is slow, Atlas publishes completed sections, marks unavailable sections, and offers retry. It never waits indefinitely on one provider.

### 5.4 Trip workspace

The desktop experience uses a calm, high-end split layout: itinerary/context on the left and an interactive map on the right. Mobile prioritises an agenda-style itinerary, a sticky day switcher, and a full-screen map sheet. The visual system should favour warm neutral surfaces, expressive destination imagery only where licensed, dense-but-readable cards, crisp typography, and gentle motion that respects `prefers-reduced-motion`.

**Overview:** trip scorecard, next action, budget snapshot, weather alerts, and selected stay.

**Itinerary:** each day includes an editable start area, planned blocks, travel legs, buffer, booking/verification links, cost subtotal, and a “why this order” explanation. Moves and swaps are optimistically previewed but not committed until route/budget validation returns.

**Stays:** 2-4 options with area, nightly/total price basis, cancellation/fee data only when supplied, rating/source information, amenities relevant to preferences, distance to itinerary centre, and “why this fits.”

**Map:** markers grouped by day, route polylines, map filters, a neighbourhood/area lens, and colour-safe status markers. It must display required data attribution.

**Budget:** low/likely/high ranges, category totals, source freshness, and trade-off controls. A user can lock categories or set a target; the assistant will propose the smallest viable set of changes.

**Discover/Guide:** attraction and restaurant candidates, hidden-gem caveats, packing, etiquette, transit guidance, emergency numbers only from verified authoritative data, and forecast/seasons context.

### 5.5 Replanning interaction

Chat is a first-class controller, not a separate generic chatbot. Example requests:

- “Keep the museum, make Tuesday slower, and stay under EUR 1,800.”
- “We now have a child with us.”
- “It will rain Wednesday. Move outdoor sights.”
- “Replace the seafood dinner with vegetarian options.”

For every mutation, the assistant must return:

- the interpreted change request;
- affected constraints and assumptions;
- a diff (added, removed, moved, and budget/time effects);
- warnings or unresolved items; and
- `Apply`, `Refine`, and `Discard` actions.

Minor presentation requests (for example, “show the map”) can execute immediately. Material changes—budget allocation, day schedule, selected hotel, traveller profile—require an explicit apply action.

## 6. Functional requirements

### 6.1 Core requirements

| ID | Requirement | Acceptance criteria |
|---|---|---|
| FR-01 | Create a trip brief | Required inputs validate inline; dates or duration are accepted; the submitted brief is versioned. |
| FR-02 | Resolve a destination | Ambiguous places produce a user choice with country/region and coordinates; no plan starts until resolved. |
| FR-03 | Generate a plan | A plan contains an overview, budget, at least one daily schedule, map data, sources/assumptions, and status. |
| FR-04 | Recommend stays | Each recommendation shows a reason, area, total-price basis, freshness, source, and booking/verification action. “Live” appears only for provider-backed current availability. |
| FR-05 | Recommend places | Each attraction/restaurant has coordinates, category, expected duration, price signal, and source/confidence. Unsupported claims are omitted. |
| FR-06 | Produce a feasible schedule | No overlapping blocks; travel legs are present between non-coincident places; schedule respects hard time windows where known. |
| FR-07 | Estimate a budget | Required categories are visible; totals reconcile; assumptions and source types are visible; unspecified categories use a labelled range. |
| FR-08 | Show weather/context | Forecast is bound to dates and location with timestamp; out-of-range dates use seasonal guidance, not a fabricated forecast. |
| FR-09 | Modify and replan | Every change creates a preview against the prior version and retains pinned items unless the user explicitly unpins/removes them. |
| FR-10 | Persist trips securely | Authenticated users access only their own trips and shared trips for which they have an explicit role. |
| FR-11 | Operate as a PWA | App shell remains installable; last-viewed saved plan is readable offline with a stale/offline banner. |
| FR-12 | Explain data | Each major card exposes “Why this?”, source, data age, and estimation method. |

### 6.2 Budget model

The budget is a planning instrument, not a quote. It calculates:

```text
trip_total = transport_to_destination
           + accommodation
           + local_transport
           + food
           + activities
           + shopping
           + contingency
```

- **Live:** returned for the exact dates/party from a contracted inventory provider.
- **Quoted:** returned from a source but may omit taxes/fees or require refresh.
- **Calculated:** nights × price, route distance × fare assumption, or scheduled item sum.
- **Estimated:** a locale/category range with explicit source date and confidence.
- **User-entered:** the user has supplied the number.

Default contingency is 8-12% of variable local costs, configurable by traveller. The UI must not add an unannounced contingency to the “available to spend” total. All currency conversion must state rate source and retrieval timestamp; initial MVP may lock calculations to the user's selected currency and defer automatic conversion until a compliant rate provider is selected.

### 6.3 Quality rules for recommendations

1. A recommendation is only eligible if its location and category are known.
2. A place may be a “local gem” only when the source evidence is sufficient and the label explains why it is less obvious; it must not imply exclusivity or a local endorsement without evidence.
3. A restaurant recommendation requires cuisine/diet fit, price fit where data exists, distance/route compatibility, and a source/verification link.
4. Hotels are ranked by total cost, location-to-itinerary, traveller needs, quality signals, policy fit, and cancellation/flexibility—never by price alone.
5. A short explanation must trace to structured facts and user preferences, not an ungrounded LLM claim.

## 7. AI behaviour and trust design

### 7.1 Division of responsibility

The LLM may interpret vague preferences, select between already-grounded candidates, write concise explanations, and ask follow-up questions. Deterministic code and provider data must calculate schedules, distances, prices, totals, constraints, permissions, and diffs.

The assistant must produce a structured response that passes schema validation. Free prose is generated from that validated model, not the other way around.

### 7.2 Hallucination controls

- Tool outputs are attached to generated facts using stable IDs.
- The planner uses an allowlist of fields it may state as fact.
- Uncertain data becomes a question, a caveat, or is omitted.
- A validation stage checks location, time, currency, source age, duplicate entries, budget reconciliation, and day feasibility.
- A provider failure yields a partial plan with an explicit missing-data state; it does not trigger fabricated fallback content.

### 7.3 Safety and sensitive contexts

Atlas must avoid medical, legal, immigration, and emergency advice beyond links/contacts from approved authoritative sources. It must politely redirect a user to official resources for visas, health, insurance, legal entry requirements, and urgent safety issues. Collect dietary, access, or family information only with clear purpose and minimise retention.

## 8. Data source policy and feasibility findings

| Need | MVP source strategy | Constraint / product treatment |
|---|---|---|
| Hotel availability/pricing | Booking.com Demand API search-and-redirect when approved; Amadeus where appropriate | Live inventory is partner-controlled. Credentials and content/display rules are required. Show source and freshness. [[1]](https://developers.booking.com/demand/docs/open-api/3.2/demand-api) |
| Flights | Amadeus self-service search for optional research | Test data is limited; live production involves quotas and booking has market/consolidator requirements. Do not make flights P0 critical path. [[3]](https://admin.developers.amadeus.com/self-service/apis-docs/guides/developer-guides/faq/) |
| Destination research | Tavily, authoritative tourism/transit sources, and reviewed provider data | Tavily’s free plan has 1,000 API credits/month; cache and use it only for research enrichment. [[4]](https://help.tavily.com/articles/8816424538-pricing) |
| POIs/geocoding/routing | Geoapify pilot integration behind a provider interface | Free tier is 3,000 credits/day with **limited commercial use**. Secure commercial terms before monetised public launch. [[5]](https://www.geoapify.com/pricing/) |
| Interactive map | MapLibre renderer plus a licensed tile provider | MapLibre is a renderer, not a free global tile service. Show provider/OSM attribution and do not depend on public community tile servers at production traffic. [[6]](https://maplibre.org/maplibre-gl-js/docs) |
| Weather | Open-Meteo for prototype/non-commercial evaluation; commercial provider abstraction for launch | The hosted free API is non-commercial; it requires a commercial key for reserved resources. [[7]](https://open-meteo.com/en/docs) |
| Route optimisation | Geoapify routing or openrouteservice, with caching | Public/free routing is quota/restriction-bound; use a route-provider interface and cache matrices. [[8]](https://openrouteservice.org/restrictions/) |
| AI | Gemini primary, Groq backup, OpenRouter compatibility fallback | Free quotas/rate limits change and must be read from account dashboards at deploy time. [[9]](https://ai.google.dev/gemini-api/docs/rate-limits) [[10]](https://console.groq.com/docs/rate-limits) [[11]](https://openrouter.ai/docs/faq) |

## 9. Non-functional requirements

### 9.1 Performance and resilience

- Initial shell LCP target: < 2.5 s on a realistic mid-tier mobile device/network after CDN warm-up.
- First usable plan section: < 20 s at p50; full plan p95 < 120 s excluding an explicit third-party outage.
- External calls have individual deadlines, circuit-breaker state, retry with jitter only for idempotent calls, and cached fallback where valid.
- Provider cache keys must include destination, dates, occupancy, currency, locale, and provider version where relevant. Do not cache user-specific price eligibility across users.

### 9.2 Accessibility and localisation

- Meet WCAG 2.2 AA on launch paths: keyboard navigation, focus order, contrast, semantic landmarks, labelled map alternatives, and reduced motion.
- UI supports a selected locale, currency, metric/imperial units, timezone-aware dates, and right-to-left readiness. Content quality is initially English-first; the design must not hard-code English sentence order or date formats.

### 9.3 Privacy, security, and compliance

- Use privacy-by-default analytics, a consent-aware cookie strategy, and a publishable privacy notice before public launch.
- Store only what the planner needs. Never retain payment cards or unneeded identity documents.
- Encrypt in transit, restrict server secrets to the backend, protect access with database row-level security, and maintain audit events for shares and sensitive mutations.
- Display affiliate disclosures and provider attributions near outbound booking actions.

## 10. Design system direction

The product should feel like a well-informed concierge, not a dashboard of cards.

- **Visual language:** an editorial travel journal meets a calm operations console; grounded earth/ink palette with one destination-responsive accent, generous whitespace, and durable typography.
- **Motion:** small, purposeful transitions for day changes, diff previews, and map focus. Never motion solely for decoration; offer reduced motion.
- **Responsive layout:** desktop two-pane workspace; tablet adaptive grid; mobile agenda-first with bottom sheets. Primary actions remain thumb-reachable.
- **Component quality:** loading skeletons reflect final content; empty/error states guide recovery; data state chips use text plus colour; no hidden hover-only critical actions.

## 11. Launch risks and decisions

| Risk | Consequence | Mitigation / decision |
|---|---|---|
| “Live price” expectation without inventory access | Loss of trust and potential compliance issue | Ship P0 with estimates/redirects; turn on live cards only per approved provider. |
| Free tier changes/exhaustion | Plan failures or bill surprises | Provider adapter, usage ceilings, cache, feature flags, and daily quota telemetry. |
| Weather/map free licences not commercial | Licence breach | Treat free services as prototype-only where terms say non-commercial/limited; contract or substitute before commercial launch. |
| LLM makes persuasive but false claim | Unsafe/low-quality plan | Ground facts in tools, schema validation, explicit unknowns, quality-gate node. |
| Complex trip scope balloons | Slow, fragile MVP | One city, leisure, max 14 days for P0; make multi-city a P1 graph feature. |
| User changes destroy a good plan | Frustration | Pins, immutable versions, preview diff, undo, and “keep unchanged” control. |
| Vercel Hobby misuse | Hosting terms issue | Use Vercel only for personal previews; production UI deploys to Cloudflare Pages. Vercel’s Hobby plan is non-commercial. [[12]](https://vercel.com/pricing) |

## 12. Release readiness checklist

- [ ] Approved branded domain, privacy policy, terms, affiliate disclosure, and data attribution copy.
- [ ] Provider contracts/keys set per environment; no provider secret in browser bundle.
- [ ] Rate and cost ceilings configured; provider health dashboard available.
- [ ] Hotel cards cannot say “live” without exact-query inventory provenance.
- [ ] Budget reconciliation, currency, date/timezone, and itinerary feasibility test suites pass.
- [ ] RLS tests prove one user cannot access another user’s trips.
- [ ] Accessibility and PWA checks meet targets.
- [ ] Manual red-team review covers hallucination, prompt injection from web content, stale content, and cancellation/fee display.
- [ ] On-call/runbook and provider-outage degradation paths are tested.

## 13. Research appendix

This PRD was researched on 20 July 2026. Free-tier quotas and partner eligibility are operating constraints, not a contractual promise; they must be rechecked during implementation and before a public release.

1. [Booking.com Demand API v3.2](https://developers.booking.com/demand/docs/open-api/3.2/demand-api)
2. [Amadeus self-service pricing](https://developers.amadeus.com/self-service/apis-docs/guides/developer-guides/pricing/)
3. [Amadeus API FAQ and production limitations](https://admin.developers.amadeus.com/self-service/apis-docs/guides/developer-guides/faq/)
4. [Tavily pricing](https://help.tavily.com/articles/8816424538-pricing)
5. [Geoapify pricing](https://www.geoapify.com/pricing/)
6. [MapLibre GL JS documentation](https://maplibre.org/maplibre-gl-js/docs)
7. [Open-Meteo documentation and licence selector](https://open-meteo.com/en/docs)
8. [openrouteservice restrictions](https://openrouteservice.org/restrictions/)
9. [Gemini API rate limits](https://ai.google.dev/gemini-api/docs/rate-limits)
10. [Groq rate limits](https://console.groq.com/docs/rate-limits)
11. [OpenRouter FAQ and free-model policy](https://openrouter.ai/docs/faq)
12. [Vercel plan terms](https://vercel.com/pricing)
13. [Supabase pricing](https://supabase.com/pricing)
14. [Cloudflare Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/)
