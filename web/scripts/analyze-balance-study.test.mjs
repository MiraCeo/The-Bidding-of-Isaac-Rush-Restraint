import { expect, it } from 'vitest';
import {
  distribution,
  pairedEffects,
  hardGate,
  summarizePaths,
} from './analyze-balance-study.mjs';
it('keeps missing observations null and uses the conventional median among hits', () => {
  expect(distribution([])).toMatchObject({ n: 0, median: null, mean: null });
  expect(distribution([1, 2, 3, 4]).median).toBe(2.5);
  expect(() => distribution([NaN])).toThrow();
});
it('requires complete same-initial-world quartets without imposing per-game monotonic ranks', () => {
  const rows = ['easy', 'standard', 'hard', 'highest'].map((difficulty, i) => ({
    scenario: { mode: 'classic', difficulty },
    role: 'isaac',
    policy: 'pace',
    seed: 1,
    diagnostics: { firstWorld: 'same', rank: [8, 2, 19, 10][i], score: i },
    match: { survived: true, humanRooms: 15 },
  }));
  expect(
    pairedEffects(rows).find((r) => r.key.includes('/easy/')).rankDelta.mean,
  ).toBe(-2);
  expect(() => pairedEffects(rows.slice(1))).toThrow('Incomplete');
  expect(() =>
    pairedEffects(
      rows.map((r, i) =>
        i
          ? r
          : { ...r, diagnostics: { ...r.diagnostics, firstWorld: 'other' } },
      ),
    ),
  ).toThrow('Different initial');
});
it('keeps role/tier ineligibility separate from zero hits', () => {
  const row = {
    scenario: { mode: 'survival', difficulty: 'standard' },
    role: 'isaac',
  };
  expect(hardGate({ id: 'F16', scope: 'survival' }, row)).toBe(false);
  expect(hardGate({ id: 'E16', scope: 'shared' }, row)).toBe(false);
  expect(hardGate({ id: 'E07', scope: 'classic' }, row)).toBe(false);
  expect(
    hardGate(
      { id: 'F16', scope: 'survival' },
      { ...row, scenario: { mode: 'survival', difficulty: 'hard' } },
    ),
  ).toBe(true);
});
it('does not turn censored profiles into a zero-game completion time', () => {
  const result = summarizePaths(
    [
      {
        cell: 'p',
        index: 1,
        role: 'isaac',
        scenario: { mode: 'classic', difficulty: 'highest' },
        policy: 'pace',
        match: { root: 'one', humanRooms: 15 },
        unlocks: ['isaac'],
        campaignAchieved: [],
        campaignProgress: { A01: 0 },
      },
    ],
    [{ id: 'A01', scope: 'shared' }],
  );
  expect(result.achievements[0]).toMatchObject({
    eligiblePaths: 1,
    hitPaths: 0,
    censoredPaths: 1,
  });
  expect(result.achievements[0].firstGameAmongHits.median).toBeNull();
});
