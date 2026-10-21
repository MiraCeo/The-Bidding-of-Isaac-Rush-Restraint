import { createHash } from 'node:crypto';
import { expect, it } from 'vitest';
import {
  populationPlan as plan,
  apportionAiCounts,
} from './classic-population-plan.mjs';
import {
  validatePopulationRows,
  analyzePopulationRows,
} from './analyze-classic-population-study.mjs';

it('apportions every configured quota and keeps the mean-rate fields descriptive', () => {
  expect(plan.arms.slice(0, 4).map((a) => a.counts)).toEqual([
    [15, 4, 0],
    [9, 8, 2],
    [4, 9, 6],
    [0, 8, 11],
  ]);
  for (const a of plan.arms) {
    expect(a.counts).toEqual(apportionAiCounts(19, a.ratios));
    expect(a.rate).toBe(
      a.counts.reduce(
        (n, c, i) => n + c * plan.levels[plan.grades[i]].rate,
        0,
      ) / 19,
    );
  }
  expect(plan.probabilityMode).toBe('per-ai-fixed-grade');
});
it('validates all quotas, fixed identities, results and grade totals before comparing mixtures', () => {
  const order = Array.from({ length: 19 }, (_, i) => `ai-${i + 1}`);
  const rows = Array.from({ length: 60 }, (_, block) =>
    plan.roles.flatMap((role) =>
      plan.policies.flatMap((policy) =>
        plan.arms.map((arm, armIndex) => {
          const assignment = Object.fromEntries(
            order.map((id, i) => [
              id,
              i < arm.counts[0]
                ? 'low'
                : i < arm.counts[0] + arm.counts[1]
                  ? 'mid'
                  : 'high',
            ]),
          );
          const canonical = JSON.stringify({
            assignment: Object.fromEntries(
              Object.keys(assignment)
                .sort()
                .map((k) => [k, assignment[k]]),
            ),
            order,
          });
          const humanRank = armIndex + 1;
          const availableRanks = Array.from(
            { length: 20 },
            (_, i) => i + 1,
          ).filter((r) => r !== humanRank);
          const aiResults = order.map((playerId, i) => ({
            playerId,
            grade: assignment[playerId],
            role: 'isaac',
            doctrine: 'balanced',
            rank: availableRanks[i],
            score: 100,
          }));
          return {
            kind: plan.rowKind,
            block,
            role,
            policy,
            arm: arm.id,
            seed: (0x08010000 + Math.imul(8001 + block, 104729)) >>> 0,
            rooms: 15,
            rank: humanRank,
            score: 100,
            world: 'a'.repeat(64),
            traceHash: 'b'.repeat(64),
            terminalHash: 'c'.repeat(64),
            assignmentOrder: order,
            assignment,
            assignmentHash: createHash('sha256')
              .update(canonical)
              .digest('hex'),
            aiResults,
            byGrade: Object.fromEntries(
              plan.grades.map((g, i) => [
                g,
                {
                  turns: arm.counts[i] * 15,
                  positiveCash: arm.counts[i] * 15,
                  triggered: 0,
                  applied: 0,
                  awardCopies: 0,
                  entitledTurns: 0,
                  rankSum: aiResults
                    .filter((a) => a.grade === g)
                    .reduce((n, a) => n + a.rank, 0),
                  scoreSum: arm.counts[i] * 100,
                },
              ]),
            ),
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
          };
        }),
      ),
    ),
  ).flat();
  expect(validatePopulationRows(rows).size).toBe(6300);
  expect(analyzePopulationRows(rows).primary[0].rankDifference).toMatchObject({
    mean: -1,
    lower: -1,
    upper: -1,
  });
  expect(() =>
    validatePopulationRows([
      { ...rows[0], assignmentHash: '0'.repeat(64) },
      ...rows.slice(1),
    ]),
  ).toThrow('fingerprint');
  expect(() =>
    validatePopulationRows([
      { ...rows[0], assignmentOrder: [...order].reverse() },
      ...rows.slice(1),
    ]),
  ).toThrow();
});
