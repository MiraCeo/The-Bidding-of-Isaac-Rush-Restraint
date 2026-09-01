import { describe, expect, it } from 'vitest';

import { simulateAiGames } from './simulation';
import { defaultRules } from './config';

describe('20 AI full-game simulation', () => {
  it('runs a reproducible three-floor game and returns finite aggregate metrics', () => {
    const first = simulateAiGames(2, 20260831);
    const second = simulateAiGames(2, 20260831);
    expect(first).toEqual(second);
    expect(first.decisions).toBe(600);
    expect(Object.values(first.strategyCounts).reduce((sum, count) => sum + count, 0)).toBe(600);
    expect(first.finalScore.count).toBe(40);
    expect(Number.isFinite(first.finalScore.mean)).toBe(true);
    expect(first.averageAwardsPerGame).toBeGreaterThan(0);
    expect(Object.values(first.characterPopulation).reduce((sum, count) => sum + count, 0)).toBe(40);
    for (const character of Object.values(first.characterPerformance)) {
      expect(character.decisions).toBe(character.playerGames * 15);
    }
    expect(first.rankingAnalysis.championTop10).toHaveLength(2);
    expect(first.rankingAnalysis.championDeciles).toHaveLength(10);
    expect(first.rankingAnalysis.allPlayerDeciles).toHaveLength(10);
    expect(
      first.rankingAnalysis.allPlayerDeciles.reduce((sum, band) => sum + band.count, 0),
    ).toBe(40);
    expect(first.rankingAnalysis.championTop10[0]!.finalScore).toBeGreaterThanOrEqual(
      first.rankingAnalysis.championTop10[1]!.finalScore,
    );
  });

  it('keeps generated rooms paired while item analysis changes target selection', () => {
    const baseline = simulateAiGames(10, 20260831, defaultRules, {
      enableSituationAnalysis: false,
      enableItemAnalysis: false,
    });
    const itemAware = simulateAiGames(10, 20260831, defaultRules, {
      enableSituationAnalysis: false,
      enableItemAnalysis: true,
    });
    expect(itemAware.itemAppearanceCounts).toEqual(baseline.itemAppearanceCounts);
    expect(itemAware.decisionAnalysis.higherValueGroupSelectionRate).toBeGreaterThan(
      baseline.decisionAnalysis.higherValueGroupSelectionRate,
    );
  });

  it('supports a fixed mixed doctrine population and reports each group separately', () => {
    const report = simulateAiGames(2, 20260831, defaultRules, {
      doctrinePopulation: { balanced: 10, cooperative: 5, chaotic: 5 },
    });
    expect(report.doctrinePopulation).toEqual({ balanced: 10, cooperative: 5, chaotic: 5 });
    expect(report.doctrinePerformance.balanced.playerGames).toBe(20);
    expect(report.doctrinePerformance.cooperative.playerGames).toBe(10);
    expect(report.doctrinePerformance.chaotic.playerGames).toBe(10);
    expect(
      Object.values(report.doctrinePerformance).reduce(
        (sum, doctrine) => sum + doctrine.decisions,
        0,
      ),
    ).toBe(report.decisions);
  });

  it('rejects a doctrine population that does not fill the room', () => {
    expect(() => simulateAiGames(1, 1, defaultRules, {
      doctrinePopulation: { balanced: 10, cooperative: 5, chaotic: 4 },
    })).toThrow(/player count/i);
  });

  it('assigns one to three personalities and reports overlapping personality groups', () => {
    const rules = { ...defaultRules, playerCount: 19 };
    const report = simulateAiGames(2, 20260831, rules, {
      doctrinePopulation: { balanced: 9, cooperative: 5, chaotic: 5 },
      enablePersonalities: true,
      personalityCountMinimum: 2,
      personalityCountMaximum: 4,
    });
    expect(report.personalityEnabled).toBe(true);
    expect(
      Object.values(report.personalityCountDistribution).reduce((sum, count) => sum + count, 0),
    ).toBe(38);
    expect(report.personalityCountDistribution['1']).toBe(0);
    for (const personality of Object.values(report.personalityPerformance)) {
      expect(personality.decisions).toBe(personality.playerGames * 15);
    }
  });
});
