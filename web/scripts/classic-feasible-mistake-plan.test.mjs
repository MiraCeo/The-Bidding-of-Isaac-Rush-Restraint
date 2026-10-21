import { expect, it } from 'vitest';
import { feasibleMistakePlan as plan } from './classic-feasible-mistake-plan.mjs';
import { decisionMistakePlan } from './classic-decision-mistake-plan.mjs';
import { auditFeasibleEvents } from './analyze-classic-feasible-mistakes.mjs';
import { summarizeDecisionWitnesses } from './analyze-classic-decision-mistakes.mjs';
import {
  analyzeMistakeRows,
  validateMistakeRows,
} from './analyze-classic-mistake-study.mjs';

it('preserves probabilities, strength, candidate constraints and preregisters paired selection controls', () => {
  expect(plan.content).toEqual(decisionMistakePlan.content);
  expect(plan.arms.map((a) => a.rate)).toEqual([
    0.25, 0.15, 0.25, 0.15, 0.05, 0,
  ]);
  const rows = Array.from({ length: plan.blocks }, (_, block) =>
    plan.roles.flatMap((role) =>
      plan.policies.flatMap((policy) =>
        plan.arms.map((arm, i) => ({
          kind: plan.rowKind,
          block,
          role,
          policy,
          arm: arm.id,
          seed: (0x08010000 + Math.imul(6001 + block, 104729)) >>> 0,
          rooms: 15,
          rank: i + 1,
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
  expect(
    analyzeMistakeRows(rows, plan).primary[0].rankDifference,
  ).toMatchObject({ mean: -2, lower: -2, upper: -2, confidence: 0.99 });
});
it('records no-candidate triggers honestly without inventing a requested type, and audits feasibility', () => {
  const empty = {
    arm: 'eligible25',
    block: 0,
    role: 'isaac',
    policy: 'pace',
    playerId: 'ai-1',
    floor: 0,
    room: 0,
    triggered: true,
    applied: false,
    requestedKind: null,
    kind: null,
    fallback: false,
    selection: 'feasible-first',
    availableKinds: [],
    candidateCounts: { reward: 0, budget: 0, quote: 0 },
  };
  expect(auditFeasibleEvents([empty])[0].withoutOptions).toBe(1);
  const summary = summarizeDecisionWitnesses(
    [empty],
    plan,
    plan.structuredArms,
  )[0];
  expect(summary).toMatchObject({
    triggered: 1,
    applied: 0,
    blocked: 1,
    requested: { reward: 0, budget: 0, quote: 0 },
  });
  expect(() =>
    auditFeasibleEvents([
      {
        ...empty,
        availableKinds: ['quote'],
        candidateCounts: { reward: 0, budget: 0, quote: 1 },
      },
    ]),
  ).toThrow('execute');
  expect(() => auditFeasibleEvents([{ ...empty, fallback: true }])).toThrow(
    'metadata',
  );
  expect(() =>
    summarizeDecisionWitnesses([empty, empty], plan, plan.structuredArms),
  ).toThrow('Duplicate');
});
