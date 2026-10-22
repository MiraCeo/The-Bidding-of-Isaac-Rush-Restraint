import { expect, it } from 'vitest';
import {
  apportionAiCounts,
  populationPlan as plan,
} from '../../../scripts/classic-population-plan.mjs';
import {
  assignPopulation,
  populationSeed,
  runPopulationMatch,
} from './classic-population.test-helper';
import { applyFeasibleMistake } from './classic-feasible-mistake.test-helper';
import { runMistakeMatch } from './classic-mistake.test-helper';

it('uses exact 19-AI quotas with deterministic largest remainders', () => {
  expect(plan.arms.slice(0, 4).map((a) => a.counts)).toEqual([
    [15, 4, 0],
    [9, 8, 2],
    [4, 9, 6],
    [0, 8, 11],
  ]);
  expect(apportionAiCounts(19, [1, 1, 1])).toEqual([7, 6, 6]);
  expect(() => apportionAiCounts(19, [0, 0, 0])).toThrow();
  expect(() => apportionAiCounts(19, [-1, 1, 1])).toThrow();
  expect(plan.levels).toEqual({
    low: { rate: 0.25, mediumShare: 0.4 },
    mid: { rate: 0.15, mediumShare: 0.2 },
    high: { rate: 0, mediumShare: 0 },
  });
});
it('assigns once from seed, promotes but never demotes when difficulty rises, and ignores roles/styles', () => {
  for (let block = 0; block < 60; block++) {
    const seed = populationSeed(block);
    const populations = plan.arms
      .slice(0, 4)
      .map((a) => assignPopulation(seed, a));
    expect(new Set(populations.map((p) => JSON.stringify(p.order))).size).toBe(
      1,
    );
    for (const id of populations[0]!.order) {
      const ranks = populations.map((p) =>
        plan.grades.indexOf(p.assignment[id]!),
      );
      expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
    }
    expect(assignPopulation(seed, plan.arms[0]!)).toEqual(populations[0]);
  }
  expect(() => populationSeed(60)).toThrow();
});
it('keeps the physical world paired, grades fixed for 15 rooms, and pure-grade controls exact', () => {
  const rows = plan.arms.map((a) =>
    runPopulationMatch(0, 'jacob_esau', 'public-ai', a),
  );
  expect(new Set(rows.map((r) => r.world)).size).toBe(1);
  expect(new Set(rows.map((r) => JSON.stringify(r.assignmentOrder))).size).toBe(
    1,
  );
  for (const r of rows) {
    expect(r.byGrade.high.triggered).toBe(0);
    expect(r.byGrade.high.applied).toBe(0);
    expect(r.aiResults).toHaveLength(19);
    expect(r.humanLiquidity.rooms).toBe(15);
    expect(Object.values(r.byGrade).reduce((n, g) => n + g.turns, 0)).toBe(285);
  }
  for (const [i, grade] of [
    [4, 'low'],
    [5, 'mid'],
    [6, 'high'],
  ] as const) {
    const config = plan.levels[grade];
    const pure = runMistakeMatch(
      0,
      'jacob_esau',
      'public-ai',
      {
        id: 'pure-control',
        base: grade === 'high' ? 'highest' : 'original',
        ...config,
      },
      undefined,
      populationSeed(0),
      applyFeasibleMistake,
    );
    expect(rows[i]!.traceHash).toBe(pure.traceHash);
    expect(rows[i]!.terminalHash).toBe(pure.terminalHash);
  }
  expect(
    runPopulationMatch(0, 'jacob_esau', 'public-ai', plan.arms[0]!).traceHash,
  ).toBe(rows[0]!.traceHash);
});
