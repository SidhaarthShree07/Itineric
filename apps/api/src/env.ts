export type AiFeature = 'hotel_comparison' | 'complex_planning' | 'city_guide' | 'itinerary_skeleton' | 'voice_trip_intake';

export interface Env {
  HOTEL_COMPARISON_CACHE: KVNamespace;
  SUPABASE_URL?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
  SUPABASE_HEARTBEAT_TABLE?: string;
  GEMINI_API_KEY?: string;
  /** Optional comma-separated fallback keys, used only after an HTTP 429. */
  GEMINI_API_KEYS?: string;
  GEMINI_MODEL?: string;
  OPENAI_API_KEY?: string;
  /** Optional comma-separated fallback keys, used only after an HTTP 429. */
  OPENAI_API_KEYS?: string;
  OPENAI_MODEL?: string;
  GROQ_API_KEY?: string;
  /** Optional comma-separated fallback keys, used only after an HTTP 429. */
  GROQ_API_KEYS?: string;
  GROQ_MODEL?: string;
  OPENROUTER_API_KEY?: string;
  /** Optional comma-separated fallback keys, used only after an HTTP 429. */
  OPENROUTER_API_KEYS?: string;
  OPENROUTER_MODEL?: string;
  TAVILY_API_KEY?: string;
  GEOAPIFY_API_KEY?: string;
  SERPAPI_API_KEY?: string;
  AI_CAP_HOTEL_COMPARISON?: string;
  AI_CAP_COMPLEX_PLANNING?: string;
  AI_CAP_CITY_GUIDE?: string;
  AI_CAP_ITINERARY_SKELETON?: string;
  AI_CAP_VOICE_TRIP_INTAKE?: string;
  AI_CAP_WINDOW_SECONDS?: string;
}

export function featureCap(env: Env, feature: AiFeature): number {
  const configured = {
    hotel_comparison: env.AI_CAP_HOTEL_COMPARISON,
    complex_planning: env.AI_CAP_COMPLEX_PLANNING,
    city_guide: env.AI_CAP_CITY_GUIDE,
    itinerary_skeleton: env.AI_CAP_ITINERARY_SKELETON,
    voice_trip_intake: env.AI_CAP_VOICE_TRIP_INTAKE,
  }[feature];
  const value = Number.parseInt(configured ?? '', 10);
  return Number.isFinite(value) && value > 0 ? value : 3;
}

export function capWindowSeconds(env: Env): number {
  const value = Number.parseInt(env.AI_CAP_WINDOW_SECONDS ?? '', 10);
  return Number.isFinite(value) && value > 0 ? value : 86_400;
}
