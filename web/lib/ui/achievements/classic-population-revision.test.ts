import { expect, it } from 'vitest';
import { populationRevisionPlan as plan } from '../../../scripts/classic-population-revision-plan.mjs';
import { populationPlan } from '../../../scripts/classic-population-plan.mjs';
import {
  assignPopulation,
  populationSeed,
  runPopulationMatch,
} from './classic-population.test-helper';
import { runMistakeMatch } from './classic-mistake.test-helper';

it('uses the new 20/70/10, 10/30/60 and 0/0/100 quotas without changing grade definitions', () => {
  expect(plan.arms.slice(0, 4).map((a) => a.ratios)).toEqual([
    [80, 20, 0],
    [20, 70, 10],
    [10, 30, 60],
    [0, 0, 100],
  ]);
  expect(plan.arms.slice(0, 4).map((a) => a.counts)).toEqual([
    [15, 4, 0],
    [4, 13, 2],
    [2, 6, 11],
    [0, 0, 19],
  ]);
  expect(plan.levels).toEqual(populationPlan.levels);
  expect(plan.content).toEqual(populationPlan.content);
  expect(populationPlan.arms.slice(0, 4).map((a) => a.counts)).toEqual([
    [15, 4, 0],
    [9, 8, 2],
    [4, 9, 6],
    [0, 8, 11],
  ]);
});
it('keeps per-seed assignment promotions monotonic and restores highest to the exact original', () => {
  for (let b = 0; b < plan.blocks; b++) {
    const assigned = plan.arms
      .slice(0, 4)
      .map((a) => assignPopulation(populationSeed(b, plan), a, plan));
    expect(new Set(assigned.map((a) => JSON.stringify(a.order))).size).toBe(1);
    for (const id of assigned[0]!.order) {
      const grades = assigned.map((a) =>
        plan.grades.indexOf(a.assignment[id]!),
      );
      expect(grades).toEqual([...grades].sort((a, b) => a - b));
    }
  }
  const rows = plan.arms.map((a) =>
    runPopulationMatch(0, 'jacob_esau', 'public-ai', a, undefined, plan),
  );
  expect(new Set(rows.map((r) => r.world)).size).toBe(1);
  const original = runMistakeMatch(
    0,
    'jacob_esau',
    'public-ai',
    { id: 'original', base: 'highest', rate: 0, mediumShare: 0 },
    undefined,
    populationSeed(0, plan),
  );
  expect(rows[3]!.traceHash).toBe(original.traceHash);
  expect(rows[3]!.terminalHash).toBe(original.terminalHash);
  expect(Object.values(rows[3]!.assignment).every((g) => g === 'high')).toBe(
    true,
  );
  expect(rows[3]!.byGrade.high.triggered).toBe(0);
  expect(
    runPopulationMatch(
      0,
      'jacob_esau',
      'public-ai',
      plan.arms[1]!,
      undefined,
      plan,
    ).traceHash,
  ).toBe(rows[1]!.traceHash);
});
