import {
  cityGuideInputSchema,
  cityGuideModelSchema,
  cityGuideResultSchema,
  type CityGuideResult,
  type Evidence,
} from '@atlas/contracts';
import { AiRouter, type JsonSchema } from '../../ai/router';
import type { Env } from '../../env';
import { TavilySearchProvider } from '../../providers/tavily';

const CITY_GUIDE_SCHEMA: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['facts'],
  properties: {
    facts: {
      type: 'array',
      maxItems: 6,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'summary', 'sourceUrl'],
        properties: {
          title: { type: 'string' },
          summary: { type: 'string' },
          sourceUrl: { type: 'string' },
        },
      },
    },
  },
};

export class CityGuideProvider {
  private readonly tavily: TavilySearchProvider;

  constructor(env: Env, private readonly aiRouter: AiRouter) {
    this.tavily = new TavilySearchProvider(env);
  }

  async guide(inputValue: unknown, actorId: string): Promise<CityGuideResult> {
    const input = cityGuideInputSchema.parse(inputValue);
    const context = await this.tavily.searchContext(
      `${input.destination} official visitor information local ${input.focus} travel tips`,
    );
    const now = new Date().toISOString();
    if (!context) {
      return cityGuideResultSchema.parse({
        generatedAt: now,
        facts: [],
        warnings: ['City research is unavailable until TAVILY_API_KEY is configured.'],
      });
    }

    try {
      const raw = await this.aiRouter.generateJson({
        feature: 'city_guide',
        actorId,
        prompt: `Create a concise ${input.focus} guide for ${input.destination}. Use only facts supported by the supplied Tavily research context. Do not invent customs, safety claims, or regulations.`,
        schemaName: 'city_guide',
        schema: CITY_GUIDE_SCHEMA,
        // City guide work is grounded in Tavily so the router prioritises Groq then OpenRouter.
        useWebSearch: false,
        supplementalSearchContext: context,
      });
      const model = cityGuideModelSchema.parse(raw);
      return cityGuideResultSchema.parse({
        generatedAt: now,
        facts: model.facts.map((fact) => {
          const evidence: Evidence = {
            source: 'web_aggregate',
            referenceUrl: fact.sourceUrl,
            fetchedAt: now,
            freshness: 'recent',
          };
          return { title: fact.title, summary: fact.summary, evidence };
        }),
        warnings: [],
      });
    } catch {
      return cityGuideResultSchema.parse({
        generatedAt: now,
        facts: [],
        warnings: ['City guide generation is temporarily unavailable.'],
      });
    }
  }
}
