import { expect, it } from 'vitest';
import { mistakeTierPlan } from '../../../scripts/classic-mistake-tier-plan.mjs';
import { mistakePlan } from '../../../scripts/classic-mistake-plan.mjs';
import { mistakeSeed, runMistakeMatch } from './classic-mistake.test-helper';
import {
  mistakeTierSeed,
  runMistakeTierMatch,
} from './classic-mistake-tier.test-helper';

it('uses exactly user-specified probabilities with constant mistake strength', () => {
  expect(mistakeTierPlan.arms.map((a) => a.rate)).toEqual([
    0.25, 0.15, 0.05, 0,
  ]);
  expect(
    mistakeTierPlan.arms.filter((a) => a.rate > 0).map((a) => a.mediumShare),
  ).toEqual([0.2, 0.2, 0.2]);
  expect(mistakeTierPlan.mildFactors).toEqual(mistakePlan.mildFactors);
  expect(mistakeTierPlan.mediumFactors).toEqual(mistakePlan.mediumFactors);
  expect(mistakePlan.arms.map((a) => a.rate)).toEqual([0, 0.1, 0.03, 0, 0, 0]);
  expect(mistakeTierPlan.seedStart).toBe(4000);
});
it('uses 60 disjoint new seeds and keeps zero-rate highest identical to original', () => {
  const seeds = Array.from({ length: 60 }, (_, i) => mistakeTierSeed(i));
  expect(new Set(seeds).size).toBe(60);
  expect(
    seeds.some((seed) =>
      Array.from({ length: 60 }, (_, i) => mistakeSeed(i)).includes(seed),
    ),
  ).toBe(false);
  expect(() => mistakeTierSeed(60)).toThrow();
  const rows = mistakeTierPlan.arms.map((a) =>
    runMistakeTierMatch(0, 'jacob_esau', 'public-ai', a),
  );
  expect(new Set(rows.map((r) => r.world)).size).toBe(1);
  const original = runMistakeMatch(
    0,
    'jacob_esau',
    'public-ai',
    { id: 'zero', base: 'original', rate: 0, mediumShare: 0 },
    undefined,
    seeds[0],
  );
  expect(rows[3]!.traceHash).toBe(original.traceHash);
  expect(rows[3]!.terminalHash).toBe(original.terminalHash);
  expect(
    rows[3]!.floors.every((f) => f.applied === 0 && f.triggers === 0),
  ).toBe(true);
  expect(
    runMistakeTierMatch(0, 'jacob_esau', 'public-ai', mistakeTierPlan.arms[0]!)
      .traceHash,
  ).toBe(rows[0]!.traceHash);
});
