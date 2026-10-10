import { describe, expect, it } from 'vitest';
import { mergeResearchMetrics, runTwentyPersonalityStudy, twentyPersonalityStudyCases } from './balance-research';
import { aiPersonalityOrder } from './ai-personality';

describe('controlled twenty-personality ecology experiments', () => {
  it('never includes All-in and keeps formal defaults untouched', () => {
    expect(aiPersonalityOrder).toHaveLength(20);
    expect(aiPersonalityOrder).not.toContain('all_in');
    expect(twentyPersonalityStudyCases).toHaveLength(14);
    for (const variant of twentyPersonalityStudyCases) expect(variant.pool).not.toContain('all_in');
  });

  it('freezes the exogenous world and assigned twenty-personality cohorts across interventions', () => {
    const result = runTwentyPersonalityStudy({ gamesPerSeed: 3, seeds: [41, 42],
      cases: ['original15', 'neutral20', 'formal20', 'gambler_noise05', 'character_budget'] });
    const baseline = result.cases.formal20!;
    expect(baseline.pooled.score.count).toBe(114);
    for (const name of ['neutral20', 'gambler_noise05', 'character_budget']) {
      const intervention = result.cases[name]!;
      expect(intervention.pooled.cohorts.adaptive?.players).toBe(baseline.pooled.cohorts.adaptive?.players);
      expect(intervention.seeds.map((report) => report.personalityFingerprint))
        .toEqual(baseline.seeds.map((report) => report.personalityFingerprint));
      expect(intervention.seeds.map((report) => report.worldFingerprint))
        .toEqual(baseline.seeds.map((report) => report.worldFingerprint));
    }
    expect(result.cases.original15!.pooled.cohorts.adaptive?.players).toBe(0);
  });

  it('merges sample sizes and variances rather than averaging standard deviations', () => {
    const result = mergeResearchMetrics([
      { count: 2, mean: 1, standardDeviation: 1, minimum: 0, maximum: 2 },
      { count: 2, mean: 5, standardDeviation: 1, minimum: 4, maximum: 6 },
    ]);
    expect(result.count).toBe(4);
    expect(result.mean).toBe(3);
    expect(result.standardDeviation).toBeCloseTo(Math.sqrt(5));
  });

  it('rejects empty, duplicate and invalid study inputs', () => {
    expect(() => runTwentyPersonalityStudy({ gamesPerSeed: 0, seeds: [1] })).toThrow();
    expect(() => runTwentyPersonalityStudy({ gamesPerSeed: 1, seeds: [] })).toThrow();
    expect(() => runTwentyPersonalityStudy({ gamesPerSeed: 1, seeds: [1, 1] })).toThrow();
    expect(() => runTwentyPersonalityStudy({ gamesPerSeed: 1, seeds: [1], cases: ['unknown'] })).toThrow();
  });
});
