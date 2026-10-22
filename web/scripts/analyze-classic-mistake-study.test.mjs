import { expect, it } from 'vitest';
import { mistakePlan } from './classic-mistake-plan.mjs';
import {
  mistakeBootstrap,
  validateMistakeRows,
} from './analyze-classic-mistake-study.mjs';
it('preregisters the 10%/3% quote-only trial and handles seed-block intervals', () => {
  expect(mistakePlan.arms.map((a) => a.rate)).toEqual([0, 0.1, 0.03, 0, 0, 0]);
  expect(mistakeBootstrap([1, 1, 1], 0.05 / 3)).toMatchObject({
    mean: 1,
    lower: 1,
    upper: 1,
    blocks: 3,
  });
  expect(mistakeBootstrap([-1, 0, 1])).toEqual(mistakeBootstrap([-1, 0, 1]));
  expect(() => mistakeBootstrap([])).toThrow();
  expect(() => validateMistakeRows([])).toThrow('Incomplete');
});
it('validates all 5400 paired conditions and rejects duplicate, missing and inconsistent data', () => {
  const rows = Array.from({ length: 60 }, (_, block) =>
    mistakePlan.roles.flatMap((role) =>
      mistakePlan.policies.flatMap((policy) =>
        mistakePlan.arms.map((arm) => ({
          kind: 'research-only-quote-lapse',
          block,
          role,
          policy,
          arm: arm.id,
          seed: (0x08010000 + Math.imul(3001 + block, 104729)) >>> 0,
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
          })),
        })),
      ),
    ),
  ).flat();
  expect(validateMistakeRows(rows).size).toBe(5400);
  expect(() => validateMistakeRows([rows[1], ...rows.slice(1)])).toThrow(
    'Duplicate',
  );
  expect(() =>
    validateMistakeRows([
      { ...rows[0], world: 'd'.repeat(64) },
      ...rows.slice(1),
    ]),
  ).toThrow('Unpaired');
  expect(() =>
    validateMistakeRows([
      {
        ...rows[0],
        floors: [
          { ...rows[0].floors[0], applied: 1 },
          ...rows[0].floors.slice(1),
        ],
      },
      ...rows.slice(1),
    ]),
  ).toThrow('Inconsistent');
});
