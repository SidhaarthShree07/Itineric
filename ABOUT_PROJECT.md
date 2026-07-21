# About Itineric

## Inspiration

Planning a trip should feel exciting, not like a second job. In practice, travellers jump between maps, hotel tabs, flight searches, reviews, blog posts, notes, and spreadsheets before they can answer a simple question: *what is a realistic plan for this trip?*

Itineric was inspired by the gap between a beautiful travel idea and a practical, personal route. We wanted to make a planner that starts with how someone wants to travel—their dates, budget, pace, interests, cuisine preferences, accessibility needs, and things to avoid—and turns that into an itinerary they can understand, edit, and use.

## What it does

Itineric is an AI-powered travel-planning PWA. It creates an editable, day-by-day plan; compares hotel and flight options; calculates route-aware travel times; shows a map-based journey; and keeps the budget visible throughout the experience.

Instead of treating generated text as the final answer, Itineric grounds the plan with geocoding, route-matrix data, travel-search results, and clearly labelled estimates. Users can replan, chat with the itinerary, compare options, and save versions as their trip evolves.

## How we built it

We built the experience as a TypeScript monorepo with a React 19 + Vite progressive web app on the frontend and a Hono API deployed to Cloudflare Workers.

- **Planning interface:** React, TypeScript, Vite, PWA support, GSAP, ScrollTrigger, and a canvas image sequence for the landing experience.
- **Maps and routing:** MapLibre GL JS with MapTiler for presentation, plus Geoapify for geocoding, route geometry, and travel-time matrices.
- **AI orchestration:** Gemini, OpenAI, Groq, and OpenRouter are arranged as a provider fallback chain, so a plan can continue when a provider is unavailable or rate-limited.
- **Travel research:** SerpApi powers Google Hotels and Google Flights comparisons; Tavily can provide grounded research context; Wikimedia and Wikipedia enrich destinations with licensed media and attribution.
- **Data and reliability:** Supabase Postgres stores trip workspaces and version history, while Cloudflare KV caches expensive provider responses and enforces feature-level usage caps.

The planning flow is deliberately staged: generate a fast itinerary skeleton, geocode the proposed places, calculate real route times, and then compose the final structured itinerary. The budget is treated as a transparent allocation rather than a vague promise:

\[
\text{Trip total} = \text{stay} + \text{transport} + \text{food} + \text{activities} + \text{shopping} + \text{emergency reserve}.
\]

## Architecture

![Itineric architecture](https://raw.githubusercontent.com/SidhaarthShree07/Itineric/refs/heads/main/Architecture%20diagram.png)

## Challenges we faced

The hardest part was making an AI itinerary feel trustworthy. A polished answer is not useful if it invents travel times, treats estimated prices as bookable inventory, or ignores a traveller's constraints. We addressed that by separating generation from grounding: route data replaces model-suggested travel durations, provider results remain clearly labelled, and users can inspect and revise the plan.

We also had to balance a visually rich experience with responsive performance. The landing sequence, interactive map, route animation, progressive web app shell, and dense trip-planning form all needed to remain usable on smaller screens and respect reduced-motion preferences.

Finally, travel and AI APIs can be slow, rate-limited, or temporarily unavailable. The Worker uses provider fallbacks, timeouts, cached responses, and feature caps to make the experience more resilient while keeping private provider keys off the client.

## What we learned

We learned that the most useful AI travel product is not one that writes the longest itinerary. It is one that helps people make better decisions: showing trade-offs, grounding recommendations, preserving personal preferences, and making changes easy.

Technically, the project taught us how to coordinate a multi-provider AI workflow, run a secure browser-to-edge architecture, use route data to validate generated plans, and design a travel interface where utility and atmosphere support each other. Most importantly, we learned that transparency—about prices, timing, sources, and uncertainty—is a feature, not an afterthought.
