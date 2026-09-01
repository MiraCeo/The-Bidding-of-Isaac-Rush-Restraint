import { describe, expect, it } from 'vitest';

import { defaultRules } from './config';
import { calculateBaseScore } from './scoring';

describe('single-room base scoring', () => {
  it('awards the maximum score at the shared target', () => {
    const result = calculateBaseScore({ type: 'bid', group: 'A', amount: 30 }, 30, 0, defaultRules);
    expect(result.sigma).toBe(10);
    expect(result.distance).toBe(0);
    expect(result.score).toBe(100);
  });

  it.each([
    [10, 100 / Math.E],
    [20, 100 / Math.E ** 2],
    [30, 100 / Math.E ** 3],
  ])('decays exponentially at distance %i on floor one', (distance, expectedScore) => {
    const result = calculateBaseScore(
      { type: 'bid', group: 'A', amount: 30 + distance },
      30,
      0,
      defaultRules,
    );
    expect(result.score).toBeCloseTo(expectedScore);
  });

  it('is symmetric on both sides of the target', () => {
    const below = calculateBaseScore({ type: 'bid', group: 'A', amount: 20 }, 30, 0, defaultRules);
    const above = calculateBaseScore({ type: 'bid', group: 'A', amount: 40 }, 30, 0, defaultRules);
    expect(below.score).toBeCloseTo(above.score);
  });

  it('uses 1.25x disruption value as the scoring equivalent', () => {
    const result = calculateBaseScore(
      { type: 'disrupt', group: 'B', amount: 20 },
      15,
      0,
      defaultRules,
    );
    expect(result.scoringEquivalent).toBe(25);
    expect(result.distance).toBe(10);
    expect(result.score).toBeCloseTo(100 / Math.E);
  });

  it('awards zero points for watching without participating', () => {
    expect(calculateBaseScore({ type: 'withdraw' }, 30, 0, defaultRules)).toEqual({
      scoringEquivalent: null,
      distance: null,
      sigma: 10,
      score: 0,
    });
  });

  it.each([
    [0, 10],
    [1, 50],
    [2, 100],
  ])('scales sigma with floor starting money on floor %i', (floorIndex, expectedSigma) => {
    const result = calculateBaseScore(
      { type: 'bid', group: 'A', amount: expectedSigma },
      expectedSigma,
      floorIndex,
      defaultRules,
    );
    expect(result.sigma).toBe(expectedSigma);
  });
});
