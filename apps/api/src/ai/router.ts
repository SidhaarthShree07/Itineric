import type { AiFeature, Env } from '../env';
import { capWindowSeconds, featureCap } from '../env';

export type JsonSchema = Record<string, unknown>;

export interface AiJsonRequest {
  feature: AiFeature;
  actorId: string;
  prompt: string;
  schemaName: string;
  schema: JsonSchema;
  useWebSearch: boolean;
  supplementalSearchContext?: string;
}

export interface AiProvider {
  readonly name: 'gemini' | 'openai' | 'groq' | 'openrouter';
  isConfigured(): boolean;
  generateJson(request: AiJsonRequest): Promise<unknown>;
}

export type AiResponseValidator<T> = (value: unknown) => T;

export interface FeatureCapStore {
  consume(input: {
    feature: AiFeature;
    actorId: string;
    maxRequests: number;
    windowSeconds: number;
  }): Promise<boolean>;
}

export class KvFeatureCapStore implements FeatureCapStore {
  constructor(private readonly cache: KVNamespace) {}

  async consume(input: {
    feature: AiFeature;
    actorId: string;
    maxRequests: number;
    windowSeconds: number;
  }): Promise<boolean> {
    const bucket = Math.floor(Date.now() / (input.windowSeconds * 1_000));
    const key = `ai-cap:v1:${input.feature}:${bucket}:${await hash(input.actorId)}`;
    const current = Number.parseInt((await this.cache.get(key)) ?? '0', 10) || 0;
    if (current >= input.maxRequests) return false;

    // KV is deliberately a coarse, low-cost cap. Downstream provider quotas remain the hard stop.
    await this.cache.put(key, String(current + 1), {
      expirationTtl: input.windowSeconds + 60,
    });
    return true;
  }
}

export class FeatureCapExceededError extends Error {
  constructor(readonly feature: AiFeature) {
    super(`Request cap reached for ${feature}.`);
  }
}

export class AllAiProvidersFailedError extends Error {
  constructor(readonly attempts: Array<{ provider: string; reason: string }>) {
    super('No configured AI provider completed this request.');
  }
}

export class AiRouter {
  constructor(
    private readonly env: Env,
    private readonly capStore: FeatureCapStore,
    private readonly providers: AiProvider[],
  ) {}

  async generateJson<T = unknown>(request: AiJsonRequest, validate?: AiResponseValidator<T>): Promise<T> {
    const allowed = await this.capStore.consume({
      feature: request.feature,
      actorId: request.actorId,
      maxRequests: featureCap(this.env, request.feature),
      windowSeconds: capWindowSeconds(this.env),
    });
    if (!allowed) throw new FeatureCapExceededError(request.feature);

    const ordered = orderedProviders(request.feature, this.providers);
    const attempts: Array<{ provider: string; reason: string }> = [];
    for (const provider of ordered) {
      if (!provider.isConfigured()) continue;
      try {
        const response = await provider.generateJson(request);
        // A transport-successful response can still be unusable: free models
        // often return valid JSON that misses a strict product field. Treat
        // that exactly like a provider failure so the next provider gets a
        // chance before the feature degrades.
        return validate ? validate(response) : response as T;
      } catch (error) {
        attempts.push({ provider: provider.name, reason: safeError(error) });
      }
    }
    throw new AllAiProvidersFailedError(attempts);
  }
}

function orderedProviders(feature: AiFeature, providers: AiProvider[]): AiProvider[] {
  const order =
    feature === 'city_guide' || feature === 'itinerary_skeleton' || feature === 'voice_trip_intake'
      ? ['groq', 'openrouter', 'gemini', 'openai']
      : ['gemini', 'openai', 'groq', 'openrouter'];
  return order
    .map((name) => providers.find((provider) => provider.name === name))
    .filter((provider): provider is AiProvider => Boolean(provider));
}

function safeError(error: unknown): string {
  return error instanceof Error ? error.message.slice(0, 240) : 'Unknown provider error';
}

async function hash(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)]
    .slice(0, 12)
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}
