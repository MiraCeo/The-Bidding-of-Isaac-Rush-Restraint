import { expect, it } from 'vitest';
import {
  runBalanceMatch,
  balanceSeed,
  balanceScenarios,
} from './balance-study.test-helper';
import { runCurrentStudyMatch } from './current-study.test-helper';
import { classicAiPolicy } from '../../game/classic-difficulty';
import { playAchievementStudy } from './difficulty-study.test-helper';

it('allocates eight explicit mode/tier cells and distinct seed blocks', () => {
  expect(balanceScenarios).toHaveLength(8);
  expect(
    new Set(balanceScenarios.map((s) => s.mode + '/' + s.difficulty)).size,
  ).toBe(8);
  expect(
    new Set(
      [
        0,
        ...Array.from({ length: 10 }, (_, i) => 100 + i),
        1000,
        1020,
        1040,
      ].map(balanceSeed),
    ).size,
  ).toBe(14);
  expect(() => balanceSeed(-1)).toThrow();
  expect(() =>
    playAchievementStudy(1, 'isaac', 'pace', 'easy', undefined, {
      policy: classicAiPolicy,
      difficulty: 'easy',
    }),
  ).toThrow('cannot label a survival');
});
it('observes named classic tiers without changing actions, growth or the common initial world', () => {
  const worlds: string[] = [];
  for (const difficulty of ['easy', 'highest'] as const) {
    const observed = runBalanceMatch(balanceSeed(0), 'isaac', 'pace', {
      mode: 'classic',
      difficulty,
    });
    const plain = runCurrentStudyMatch(
      balanceSeed(0),
      'isaac',
      'pace',
      'classic',
      { classicAi: { policy: classicAiPolicy, difficulty } },
    );
    expect(observed.match).toEqual(plain.match);
    expect(observed.context).toEqual(plain.context);
    expect(observed.match.classicAi?.difficulty).toBe(difficulty);
    expect(observed.match.humanRooms).toBe(15);
    expect(observed.diagnostics.duringHuman.playerTurns).toBe(19 * 15);
    expect(observed.diagnostics.afterHuman.playerTurns).toBe(0);
    expect(observed.diagnostics.aiFinal).toHaveLength(19);
    worlds.push(observed.diagnostics.firstWorld);
  }
  expect(worlds[0]).toBe(worlds[1]);
}, 60000);
it('keeps AI continuation diagnostics separate from frozen human achievement facts', () => {
  const observed = runBalanceMatch(balanceSeed(0), 'isaac', 'pace', {
    mode: 'survival',
    difficulty: 'highest',
  });
  const plain = runCurrentStudyMatch(
    balanceSeed(0),
    'isaac',
    'pace',
    'highest',
  );
  expect(observed.match).toEqual(plain.match);
  expect(observed.context).toEqual(plain.context);
  expect(observed.exposure.humanRooms).toBe(observed.match.humanRooms);
  expect(observed.diagnostics.duringHuman.invalidTurns).toBe(0);
  expect(observed.diagnostics.afterHuman.invalidTurns).toBe(0);
  expect(observed.match.totalRooms).toBeGreaterThan(observed.match.humanRooms);
  expect(observed.diagnostics.afterHuman.playerTurns).toBeGreaterThan(0);
  expect(observed.diagnostics.humanFloors).toBe(observed.match.humanRooms / 5);
  expect(observed.diagnostics.lowestFloors).toBeLessThanOrEqual(
    observed.diagnostics.passedFloors,
  );
  expect(observed.diagnostics.aiFinal).toHaveLength(19);
}, 60000);
