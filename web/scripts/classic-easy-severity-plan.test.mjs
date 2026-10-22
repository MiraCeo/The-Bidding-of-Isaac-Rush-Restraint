import { expect, it } from 'vitest';
import { easySeverityPlan as plan } from './classic-easy-severity-plan.mjs';
import { feasibleMistakePlan } from './classic-feasible-mistake-plan.mjs';
import { analyzeEasySeverityRows } from './analyze-classic-easy-severity.mjs';
import { auditFeasibleEvents } from './analyze-classic-feasible-mistakes.mjs';

it('keeps a single preregistered primary comparison and validates risk/liquidity diagnostics', () => {
  expect(plan.content).toEqual(feasibleMistakePlan.content);
  expect(plan.primaryPairs).toHaveLength(1);
  const rows = Array.from({ length: plan.blocks }, (_, block) =>
    plan.roles.flatMap((role) =>
      plan.policies.flatMap((policy) =>
        plan.arms.map((arm, i) => ({
          kind: plan.rowKind,
          block,
          role,
          policy,
          arm: arm.id,
          seed: (0x08010000 + Math.imul(7001 + block, 104729)) >>> 0,
          rooms: 15,
          rank: i + 1,
          score: 100,
          world: 'a'.repeat(64),
          traceHash: 'b'.repeat(64),
          terminalHash: 'c'.repeat(64),
          humanLiquidity: {
            rooms: 15,
            zeroEntryRooms: 0,
            earlyZeroAfterRooms: 0,
            bossEntries: 3,
            zeroBossEntries: 0,
            bossCashRatio: 0.6,
          },
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
  const result = analyzeEasySeverityRows(rows);
  expect(result.primary[0].rankDifference).toMatchObject({
    mean: -1,
    lower: -1,
    upper: -1,
    confidence: 0.95,
  });
  expect(result.groups[0]).toMatchObject({
    top5: 1,
    bottom5: 0,
    humanEarlyZeroAfterRate: 0,
  });
  expect(result.groups[0].humanBossCashRatio).toBeCloseTo(0.2);
  expect(() =>
    analyzeEasySeverityRows([
      { ...rows[0], humanLiquidity: undefined },
      ...rows.slice(1),
    ]),
  ).toThrow('liquidity');
});
it('audits feasible metadata for explicitly named severity arms without changing old defaults', () => {
  const event = {
    arm: 'easy-m40',
    selection: 'feasible-first',
    fallback: false,
    availableKinds: [],
    candidateCounts: { reward: 0, budget: 0, quote: 0 },
    applied: false,
    kind: null,
    requestedKind: null,
  };
  expect(
    auditFeasibleEvents([event], plan, plan.feasibleArms)[0].withoutOptions,
  ).toBe(1);
  expect(() => auditFeasibleEvents([event])).toThrow('Unknown');
});
