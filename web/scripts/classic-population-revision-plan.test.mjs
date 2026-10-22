import { expect, it } from 'vitest';
import { populationRevisionPlan as plan } from './classic-population-revision-plan.mjs';
import {
  populationPlan,
  apportionAiCounts,
  makePopulationArm,
} from './classic-population-plan.mjs';
import { validatePopulationRows } from './analyze-classic-population-study.mjs';

it('keeps the three grade profiles and previous plan intact while revising only the requested compositions', () => {
  expect(plan.arms.slice(0, 4).map((a) => a.counts)).toEqual([
    [15, 4, 0],
    [4, 13, 2],
    [2, 6, 11],
    [0, 0, 19],
  ]);
  expect(plan.arms.slice(4).map((a) => a.counts)).toEqual([
    [9, 8, 2],
    [4, 9, 6],
    [0, 8, 11],
  ]);
  expect(plan.levels).toEqual(populationPlan.levels);
  expect(plan.content).toEqual(populationPlan.content);
  expect(plan.seedStart).toBe(9000);
  for (const a of plan.arms)
    expect(a.counts).toEqual(apportionAiCounts(19, a.ratios));
  expect(populationPlan.arms[3].counts).toEqual([0, 8, 11]);
});
it('restores all-high highest fast path and preregisters the matching old controls', () => {
  expect(makePopulationArm('original', [0, 0, 100])).toMatchObject({
    rate: 0,
    mediumShare: 0,
    base: 'highest',
    counts: [0, 0, 19],
  });
  expect(plan.primaryPairs).toEqual([
    ['mix-easy', 'mix-standard'],
    ['mix-standard', 'mix-hard'],
    ['mix-hard', 'mix-highest'],
  ]);
  expect(plan.secondaryPairs).toEqual([
    ['mix-standard', 'prior-standard'],
    ['mix-hard', 'prior-hard'],
    ['mix-highest', 'prior-highest'],
  ]);
  expect(() => validatePopulationRows([], plan)).toThrow('Incomplete');
});
