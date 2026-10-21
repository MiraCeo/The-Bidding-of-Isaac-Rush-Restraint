import { expect, it } from 'vitest';
import { mistakeTierPlan } from './classic-mistake-tier-plan.mjs';
import { mistakePlan } from './classic-mistake-plan.mjs';
import {
  analyzeMistakeRows,
  validateMistakeRows,
} from './analyze-classic-mistake-study.mjs';

it('accepts the explicit four-tier plan without changing the legacy six-arm default', () => {
  const rows = Array.from({ length: mistakeTierPlan.blocks }, (_, block) =>
    mistakeTierPlan.roles.flatMap((role) =>
      mistakeTierPlan.policies.flatMap((policy) =>
        mistakeTierPlan.arms.map((arm) => ({
          kind: 'research-only-quote-lapse',
          block,
          role,
          policy,
          arm: arm.id,
          seed: (0x08010000 + Math.imul(4001 + block, 104729)) >>> 0,
          rooms: 15,
          rank: 1,
          score: 100,
          world: 'a'.repeat(64),
          traceHash: 'b'.repeat(64),
          terminalHash: 'c'.repeat(64),
          floors: Array.from({ length: 3 }, () => ({
            turns: 95,
            positiveCash: 95,
            zeroCash: 0,
            triggers: 0,
            applied: 0,
            blocked: 0,
            mild: 0,
            medium: 0,
            targets: 5,
            targetRatio: 1,
            targetRatioSquared: 0.2,
            modelLoss: 0,
            costChange: 0,
            withdraw: 0,
            humanAwards: 0,
            humanEntitled: 0,
            aiAwards: 0,
            beforeBossCash: 0,
            beforeBossTurns: 19,
          })),
        })),
      ),
    ),
  ).flat();
  expect(rows.length).toBe(3600);
  expect(validateMistakeRows(rows, mistakeTierPlan).size).toBe(3600);
  expect(() => validateMistakeRows(rows, mistakePlan)).toThrow('Incomplete');
  const findings = analyzeMistakeRows(rows, mistakeTierPlan);
  expect(findings.primary.map((p) => [p.low, p.high])).toEqual(
    mistakeTierPlan.primaryPairs,
  );
  expect(
    findings.primary.every(
      (p) =>
        p.rankDifference.mean === 0 &&
        p.rankDifference.lower === 0 &&
        p.rankDifference.upper === 0,
    ),
  ).toBe(true);
  expect(() =>
    validateMistakeRows([rows[1], ...rows.slice(1)], mistakeTierPlan),
  ).toThrow('Duplicate');
});
