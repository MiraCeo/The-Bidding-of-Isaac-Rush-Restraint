import { expect, it } from 'vitest';
import { decisionMistakePlan as plan } from './classic-decision-mistake-plan.mjs';
import {
  analyzeMistakeRows,
  validateMistakeRows,
} from './analyze-classic-mistake-study.mjs';
import { summarizeDecisionWitnesses } from './analyze-classic-decision-mistakes.mjs';

it('preregisters paired content controls, fixed probabilities and honest row identity', () => {
  expect(plan.arms.map((a) => a.rate)).toEqual([
    0.25, 0.15, 0.25, 0.15, 0.05, 0,
  ]);
  expect(
    plan.content.rewardShare +
      plan.content.budgetShare +
      plan.content.quoteShare,
  ).toBe(1);
  const rows = Array.from({ length: plan.blocks }, (_, block) =>
    plan.roles.flatMap((role) =>
      plan.policies.flatMap((policy) =>
        plan.arms.map((arm, index) => ({
          kind: plan.rowKind,
          block,
          role,
          policy,
          arm: arm.id,
          seed: (0x08010000 + Math.imul(5001 + block, 104729)) >>> 0,
          rooms: 15,
          rank: index + 1,
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
  expect(validateMistakeRows(rows, plan).size).toBe(5400);
  expect(() =>
    validateMistakeRows(
      [{ ...rows[0], kind: 'research-only-quote-lapse' }, ...rows.slice(1)],
      plan,
    ),
  ).toThrow('Invalid');
  const result = analyzeMistakeRows(rows, plan);
  expect(result.primary[0].rankDifference).toMatchObject({
    mean: -2,
    lower: -2,
    upper: -2,
    confidence: 0.99,
  });
});
it('reconciles content witnesses and rejects duplicate or unbounded modifications', () => {
  const event = {
    arm: 'new25',
    block: 0,
    role: 'isaac',
    policy: 'pace',
    playerId: 'ai-1',
    floor: 0,
    room: 0,
    triggered: true,
    applied: true,
    severity: 'mild',
    requestedKind: 'reward',
    kind: 'reward',
    fallback: false,
    modelLoss: 0.1,
    visibleValueGap: 0.2,
    beforeCost: 10,
    afterCost: 10,
    before: {
      playerId: 'ai-1',
      actions: [{ type: 'bid', amount: 10, group: 'A' }],
    },
    after: {
      playerId: 'ai-1',
      actions: [{ type: 'bid', amount: 10, group: 'B' }],
    },
  };
  expect(summarizeDecisionWitnesses([event])[0].executed.reward).toBe(1);
  expect(() => summarizeDecisionWitnesses([event, event])).toThrow('Duplicate');
  expect(() =>
    summarizeDecisionWitnesses([{ ...event, modelLoss: 10 }]),
  ).toThrow('cap');
  expect(() =>
    summarizeDecisionWitnesses([{ ...event, arm: 'old25' }]),
  ).toThrow('Control');
});
