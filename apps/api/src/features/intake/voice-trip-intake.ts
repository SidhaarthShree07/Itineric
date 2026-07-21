import {
  voiceTripIntakeInputSchema,
  voiceTripIntakeModelSchema,
  voiceTripIntakeResultSchema,
  type VoiceTripIntakeResult,
} from '@atlas/contracts';
import { AiRouter, type JsonSchema } from '../../ai/router';

/**
 * This schema deliberately makes every field optional. A voice note is a
 * convenience input, not a permission to invent dates, prices, or travellers.
 * The client merges only returned values into its editable planning form.
 */
export const VOICE_TRIP_INTAKE_SCHEMA: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['draft'],
  properties: {
    draft: {
      type: 'object',
      additionalProperties: false,
      properties: {
        destination: { type: 'string' },
        startDate: { type: 'string' },
        endDate: { type: 'string' },
        days: { type: 'integer', minimum: 1, maximum: 21 },
        adults: { type: 'integer', minimum: 1, maximum: 12 },
        children: { type: 'integer', minimum: 0, maximum: 10 },
        rooms: { type: 'integer', minimum: 1, maximum: 6 },
        currency: { type: 'string' },
        totalBudget: { type: 'number', minimum: 0.01, maximum: 1_000_000 },
        travelStyle: { type: 'string', enum: ['budget', 'balanced', 'comfort', 'luxury'] },
        pace: { type: 'string', enum: ['relaxed', 'balanced', 'fast'] },
        interests: {
          type: 'array',
          minItems: 1,
          maxItems: 6,
          items: { type: 'string', enum: ['art', 'architecture', 'beaches', 'food', 'history', 'nature', 'nightlife', 'photography', 'shopping', 'wellness'] },
        },
        cuisines: { type: 'array', maxItems: 6, items: { type: 'string' } },
        accommodationNotes: { type: 'string' },
        accessibilityNotes: { type: 'string' },
        avoid: { type: 'array', maxItems: 8, items: { type: 'string' } },
      },
    },
    clarification: { type: 'string' },
  },
};

export class VoiceTripIntake {
  constructor(private readonly aiRouter: AiRouter) {}

  async extract(inputValue: unknown, actorId: string): Promise<VoiceTripIntakeResult> {
    const input = voiceTripIntakeInputSchema.parse(inputValue);
    const generatedAt = new Date().toISOString();

    try {
      const model = await this.aiRouter.generateJson({
        feature: 'voice_trip_intake',
        actorId,
        prompt: [
          'Turn this spoken travel note into an editable trip-planning draft.',
          'Extract only facts that are explicitly stated or unambiguously expressed in the transcript.',
          'Do not infer a destination, dates, traveller count, currency, budget, style, pace, interests, cuisine, accessibility need, or restriction.',
          'Convert clear absolute dates to YYYY-MM-DD only. Omit relative dates such as next month.',
          'Use only the allowed normalized interest names in the schema. Map close spoken terms only when the mapping is obvious, such as museums to art.',
          'Use clarification only for one concise question that would make the plan more complete. Do not include markdown.',
          `Transcript: ${input.transcript}`,
        ].join('\n'),
        schemaName: 'voice_trip_intake',
        schema: VOICE_TRIP_INTAKE_SCHEMA,
        useWebSearch: false,
      }, (value) => voiceTripIntakeModelSchema.parse(value));

      return voiceTripIntakeResultSchema.parse({
        transcript: input.transcript,
        draft: model.draft,
        clarification: model.clarification,
        generatedAt,
        warnings: [],
      });
    } catch {
      // Keep the speech interaction useful even when a free model is at
      // capacity. The user still has their transcript and a manual form.
      return voiceTripIntakeResultSchema.parse({
        transcript: input.transcript,
        draft: {},
        generatedAt,
        warnings: ['We saved your note, but could not turn it into fields just now. Please complete the form manually.'],
      });
    }
  }
}
