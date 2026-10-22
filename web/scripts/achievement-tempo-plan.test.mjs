import { expect, it } from 'vitest';
import { tempoPlan as plan, tempoSeed } from './achievement-tempo-plan.mjs';
import {
  firstHit,
  describe,
  thresholdReading,
  summarizeTempo,
} from './analyze-achievement-tempo.mjs';
it('fixes a targeted six-scenario, three-controller, six-block plan and disjoint pilot/main seeds', () => {
  expect(plan.scenarios.map((s) => s.aiPolicy)).toEqual([
    'classic-population-1',
    'classic-population-1',
    'classic-population-1',
    'classic-population-1',
    'classic-tiered-1',
    'role-aware-1',
  ]);
  expect(
    plan.blocks * plan.steps * plan.scenarios.length * plan.policies.length,
  ).toBe(2160);
  const seeds = Array.from({ length: 6 }, (_, b) =>
    Array.from({ length: 20 }, (_, s) => tempoSeed(b, s)),
  ).flat();
  expect(new Set(seeds).size).toBe(120);
  expect(seeds).not.toContain(tempoSeed(0, 0, 'pilot'));
  expect(() => tempoSeed(6, 0)).toThrow();
  expect(() => tempoSeed(0, 20)).toThrow();
  expect(plan.current).toEqual({ allIn: [1, 5, 10], boss: [1, 5, 15] });
  for (const matrix of Object.values(plan.candidates))
    for (const row of matrix) expect(row[0]).toBe(1);
});
it('keeps censored paths null rather than zero or extrapolated, and handles reached-only medians', () => {
  expect(firstHit([0, 2, 4], 3)).toBe(3);
  expect(firstHit([0, 2, 4], 5)).toBeNull();
  expect(() => firstHit([2, 1], 3)).toThrow();
  expect(() => firstHit([1], 0)).toThrow();
  expect(describe([2, 5])).toMatchObject({ median: 3.5 });
  const paths = [
    [0, 2, 4],
    [0, 0, 1],
  ].map((p) => p.map((allIn) => ({ cumulative: { allIn } })));
  expect(thresholdReading(paths, 'allIn', 3)).toEqual({
    threshold: 3,
    paths: 2,
    reached: 1,
    censored: 1,
    reachedFraction: 0.5,
    firstHitAmongReached: { n: 1, mean: 3, median: 3, min: 3, max: 3 },
  });
  expect(
    thresholdReading(paths, 'allIn', 5).firstHitAmongReached.median,
  ).toBeNull();
});
it('does not merge modes, controller cells or seed-block sample counts', () => {
  const rows = [0, 1].flatMap((block) =>
    ['pace', 'explore'].flatMap((policy) =>
      [1, 2].map((index) => ({
        block,
        cell: 'population-standard/' + policy,
        index,
        scenario: plan.scenarios[1],
        cumulative: { allIn: index, boss: index * 2 },
        opportunities: { humanRooms: 15 },
        policy,
      })),
    ),
  );
  const summary = summarizeTempo(rows);
  expect(summary.paths).toBe(4);
  expect(summary.byScenario[0]).toMatchObject({
    paths: 4,
    independentBlocks: 2,
    steps: 2,
  });
  expect(summary.byCell).toHaveLength(2);
  expect(summary.byCell[0].paths).toBe(2);
});
