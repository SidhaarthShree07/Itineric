import { describe, expect, it, vi } from 'vitest';
import type { AiRouter } from '../../ai/router';
import { VOICE_TRIP_INTAKE_SCHEMA, VoiceTripIntake } from './voice-trip-intake';

describe('VoiceTripIntake', () => {
  it('uses the inexpensive Groq-first feature and returns only reviewable fields', async () => {
    const generateJson = vi.fn().mockResolvedValue({
      draft: {
        destination: 'Kyoto, Japan',
        days: 4,
        adults: 2,
        currency: 'JPY',
        totalBudget: 180000,
        pace: 'relaxed',
        interests: ['food', 'art'],
      },
      clarification: 'Which dates in October work best for you?',
    });
    const intake = new VoiceTripIntake({ generateJson } as unknown as AiRouter);

    const result = await intake.extract(
      { transcript: 'I want a relaxed four day food and art trip to Kyoto for two people in October, around JPY 180000.' },
      'test-actor',
    );

    expect(generateJson).toHaveBeenCalledOnce();
    expect(generateJson.mock.calls[0]?.[0]).toMatchObject({
      feature: 'voice_trip_intake',
      actorId: 'test-actor',
      schemaName: 'voice_trip_intake',
      useWebSearch: false,
    });
    expect(result.draft).toMatchObject({ destination: 'Kyoto, Japan', days: 4, adults: 2, interests: ['food', 'art'] });
    expect(result.clarification).toBe('Which dates in October work best for you?');
    expect(result.warnings).toEqual([]);
  });

  it('keeps the approved transcript usable when no AI provider is available', async () => {
    const intake = new VoiceTripIntake({ generateJson: async () => { throw new Error('all providers unavailable'); } } as unknown as AiRouter);
    const result = await intake.extract({ transcript: 'A long weekend in Lisbon for one person.' }, 'test-actor');

    expect(result.transcript).toBe('A long weekend in Lisbon for one person.');
    expect(result.draft).toEqual({});
    expect(result.warnings[0]).toContain('complete the form manually');
  });

  it('keeps all draft properties optional so an incomplete voice note never fabricates a field', () => {
    const draft = (VOICE_TRIP_INTAKE_SCHEMA.properties as Record<string, unknown>).draft as Record<string, unknown>;
    expect(draft).not.toHaveProperty('required');
  });
});
