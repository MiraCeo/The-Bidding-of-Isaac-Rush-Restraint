import { expect, it } from 'vitest';
import { easySeverityPlan as plan } from '../../../scripts/classic-easy-severity-plan.mjs';
import { feasibleMistakePlan } from '../../../scripts/classic-feasible-mistake-plan.mjs';
import { applyFeasibleMistake } from './classic-feasible-mistake.test-helper';
import { runMistakeMatch } from './classic-mistake.test-helper';
import {
  easySeveritySeed,
  runEasySeverityMatch,
} from './classic-easy-severity.test-helper';

it('changes only easy medium-request probability and freezes all rules and other tiers', () => {
  expect(plan.content).toEqual(feasibleMistakePlan.content);
  expect(plan.arms.map((a) => [a.rate, a.mediumShare])).toEqual([
    [0.25, 0.4],
    [0.25, 0.2],
    [0.15, 0.2],
    [0.05, 0.2],
    [0, 0],
  ]);
  expect(plan.primaryPairs).toEqual([['easy-m40', 'easy-m20']]);
  expect(plan.seedStart).toBe(7000);
});
it('pairs the world, observes human liquidity without changing trajectories, and keeps highest exact', () => {
  const rows = plan.arms.map((a) =>
    runEasySeverityMatch(0, 'jacob_esau', 'public-ai', a),
  );
  expect(new Set(rows.map((r) => r.world)).size).toBe(1);
  for (const i of [1, 2, 3, 4]) {
    const a = plan.arms[i]!;
    const old = runMistakeMatch(
      0,
      'jacob_esau',
      'public-ai',
      a,
      undefined,
      easySeveritySeed(0),
      plan.feasibleArms.includes(a.id) ? applyFeasibleMistake : undefined,
    );
    expect(rows[i]!.traceHash).toBe(old.traceHash);
    expect(rows[i]!.terminalHash).toBe(old.terminalHash);
  }
  for (const row of rows) {
    expect(row.humanLiquidity.rooms).toBe(15);
    expect(row.humanLiquidity.bossEntries).toBe(3);
    expect(row.humanLiquidity.earlyZeroAfterRooms).toBeLessThanOrEqual(12);
  }
  expect(
    runEasySeverityMatch(0, 'jacob_esau', 'public-ai', plan.arms[0]!).traceHash,
  ).toBe(rows[0]!.traceHash);
  expect(() => easySeveritySeed(60)).toThrow();
});
