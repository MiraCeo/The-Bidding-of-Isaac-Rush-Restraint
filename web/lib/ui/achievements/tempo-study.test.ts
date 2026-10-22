import { expect, it } from 'vitest';
import {
  tempoPlan,
  tempoSeed,
} from '../../../scripts/achievement-tempo-plan.mjs';
import { runTempoMatch, advanceTempoStep } from './tempo-study.test-helper';
import {
  runCurrentStudyMatch,
  freshStudyProfile,
} from './current-study.test-helper';
import { runBalanceMatch, balanceSeed } from './balance-study.test-helper';

it('observes the real new classic policy without modifying decisions, context or initial world', () => {
  const worlds = [];
  for (const scenario of tempoPlan.scenarios.slice(0, 4)) {
    const actual = runTempoMatch(
      tempoSeed(0, 0, 'pilot'),
      'isaac',
      'public-ai',
      scenario,
    );
    const plain = runCurrentStudyMatch(
      tempoSeed(0, 0, 'pilot'),
      'isaac',
      'public-ai',
      'classic',
      {
        classicAi: {
          policy: 'classic-population-1',
          difficulty: scenario.difficulty,
        },
      },
    );
    expect(actual.match).toEqual(plain.match);
    expect(actual.context).toEqual(plain.context);
    expect(actual.counts).toEqual({
      allIn: actual.progress.D09,
      boss: actual.progress.E03,
    });
    worlds.push(actual.firstWorld);
  }
  expect(new Set(worlds).size).toBe(1);
}, 60000);
it('retains the old standard and unchanged survival interpretation, excluding AI-only continuation', () => {
  for (const scenario of tempoPlan.scenarios.slice(4)) {
    const actual = runTempoMatch(3, 'isaac', 'pace', scenario),
      old = runBalanceMatch(3, 'isaac', 'pace', {
        mode: scenario.mode,
        difficulty: scenario.difficulty,
      });
    expect(actual.match).toEqual(old.match);
    expect(actual.context).toEqual(old.context);
    expect(actual.evidence.length).toBe(actual.match.humanRooms);
  }
  // Use an existing known-elimination fixture, rather than assuming seed 3
  // standard always eliminates the human (it actually completes all 30 rooms).
  const eliminated = runTempoMatch(balanceSeed(0), 'isaac', 'pace', {
    ...tempoPlan.scenarios[5]!,
    difficulty: 'highest',
  });
  expect(eliminated.evidence.length).toBe(eliminated.match.humanRooms);
  expect(eliminated.evidence.length).toBeLessThan(eliminated.match.totalRooms);
}, 60000);
it('starts from a fresh profile and rotates only roles actually unlocked by production growth', () => {
  const profile = freshStudyProfile(),
    before = JSON.stringify(profile);
  const result = advanceTempoStep(
    profile,
    tempoSeed(0, 0),
    1,
    'pace',
    tempoPlan.scenarios[1]!,
  );
  expect(result.role).toBe('isaac');
  expect(result.available).toEqual(['isaac']);
  expect(JSON.stringify(profile)).toBe(before);
  expect(result.advanced.progress.D09).toBe(result.result.counts.allIn);
  expect(result.advanced.progress.E03).toBe(result.result.counts.boss);
});
