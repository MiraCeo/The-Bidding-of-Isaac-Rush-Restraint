import { expect, it } from 'vitest';
import {
  classicDifficulties,
  classicAiPolicy,
  classicPopulationPolicy,
  classicReplayId,
  readClassicAiSettings,
} from './classic-difficulty';
import {
  assignClassicPopulation,
  classicPopulationCounts,
  classicGradeProfiles,
} from './classic-population';
import {
  startClientGame,
  clientGameReducer,
  type ActiveClientGameState,
} from './client-session';
import { defaultRules } from './config';
import { validateTurn, getRuntimeActionAmounts } from './turns';
import { populationRevisionPlan as plan } from '../../scripts/classic-population-revision-plan.mjs';
import {
  assignPopulation,
  populationSeed,
  runPopulationMatch,
} from '../ui/achievements/classic-population.test-helper';
import {
  createStudyController,
  type StudyPolicy,
} from '../ui/achievements/difficulty-study.test-helper';
import {
  classicTierTrace,
  classicTierTerminalHash,
} from '../ui/achievements/classic-tier-study.test-helper';
import type { CharacterId } from './item-types';

const settings = (difficulty: (typeof classicDifficulties)[number]) => ({
  policy: classicPopulationPolicy,
  difficulty,
});
const submit = (g: ActiveClientGameState, group: 'A' | 'B' = 'A', amount = 1) =>
  clientGameReducer(g, {
    type: 'submit_player_turn',
    turn: { playerId: 'human', actions: [{ type: 'bid', group, amount }] },
  }) as ActiveClientGameState;

it('locks the exact quotas and independent seed assignment, with monotonic grade promotions', () => {
  expect(Object.values(classicPopulationCounts)).toEqual(
    plan.arms.slice(0, 4).map((a) => a.counts),
  );
  expect(classicGradeProfiles).toEqual(plan.levels);
  for (let block = 0; block < 60; block++) {
    const seed = populationSeed(block, plan);
    const assigned = classicDifficulties.map((d, i) => {
      const actual = assignClassicPopulation(seed, d);
      expect(actual).toEqual(assignPopulation(seed, plan.arms[i]!, plan));
      return actual;
    });
    for (const id of assigned[0]!.order) {
      const grades = assigned.map((a) =>
        ['low', 'mid', 'high'].indexOf(a.assignment[id]!),
      );
      expect(grades).toEqual([...grades].sort((a, b) => a - b));
    }
  }
});
it.each([42, 91, 31415])(
  'keeps full highest decision objects/world/random streams exactly original: %s',
  (seed) => {
    let original = startClientGame('jacob_esau', seed),
      highest = startClientGame('jacob_esau', seed, settings('highest'));
    for (let room = 0; room < 15; room++) {
      const { classicAi: _settings, ...rest } = highest;
      expect(rest).toEqual(original);
      original = submit(original);
      highest = submit(highest);
      expect(highest.revealedAiDecisions).toEqual(original.revealedAiDecisions);
      original = clientGameReducer(original, {
        type: 'advance_room',
      }) as ActiveClientGameState;
      highest = clientGameReducer(highest, {
        type: 'advance_room',
      }) as ActiveClientGameState;
    }
  },
);
it.each(classicDifficulties)(
  'keeps initial world/roles/funds identical and ignores current human secret at %s',
  (difficulty) => {
    const game = startClientGame('isaac', 91, settings(difficulty));
    const legacy = startClientGame('isaac', 91);
    expect(game.players).toEqual(legacy.players);
    expect(game.rooms).toEqual(legacy.rooms);
    expect(game.aiProfiles).toEqual(legacy.aiProfiles);
    expect(submit(game, 'A', 1).revealedAiDecisions).toEqual(
      submit(game, 'B', 100).revealedAiDecisions,
    );
  },
);
it('distinguishes new/old/absent policy identities without relabelling old games', () => {
  const ids = [undefined, classicAiPolicy, classicPopulationPolicy].flatMap(
    (policy) =>
      policy
        ? classicDifficulties.map((difficulty) =>
            classicReplayId(42, 'isaac', 'rules-v1', { policy, difficulty }),
          )
        : [classicReplayId(42, 'isaac', 'rules-v1')],
  );
  expect(new Set(ids).size).toBe(9);
  expect(ids[0]).toBe('ISAAC-0000002a-isaac-v1');
  expect(ids[1]).toMatch(/-CA1-easy$/);
  expect(ids[5]).toMatch(/-CP1-easy$/);
  expect(readClassicAiSettings(settings('easy'))).toEqual(settings('easy'));
  expect(() =>
    readClassicAiSettings({ ...settings('easy'), grade: 'low' }),
  ).toThrow();
});
const roles: CharacterId[] = ['isaac', 'lost', 'azazel', 'eden', 'jacob_esau'];
const policies: StudyPolicy[] = ['pace', 'public-ai', 'explore'];
it.each(
  classicDifficulties.flatMap((difficulty, i) =>
    roles.map((role) => ({ difficulty, i, role })),
  ),
)(
  'matches the approved research gameplay exactly: $difficulty / $role (3 controllers)',
  ({ difficulty, i, role }) => {
    for (const policy of policies) {
      const seed = populationSeed(0, plan),
        ctrl = createStudyController(seed, policy),
        trace = classicTierTrace();
      let game = startClientGame(role, seed, settings(difficulty));
      while (game.phase !== 'game_result') {
        if (game.phase === 'room_action') {
          const before = game.players;
          game = clientGameReducer(game, {
            type: 'submit_player_turn',
            turn: ctrl.decide(game, defaultRules),
          }) as ActiveClientGameState;
          const r = game.roomSettlement!;
          for (const d of game.revealedAiDecisions) {
            const player = before.find((p) => p.id === d.turn.playerId)!;
            expect(validateTurn(player, d.turn, defaultRules)).toEqual([]);
            if (d.classicMistake) {
              const m = d.classicMistake;
              expect(m.analysisBasis).toBe('before-mistake');
              expect(m.intendedTurn).not.toEqual(d.turn);
              expect(m.modelLoss).toBeGreaterThan(0);
              expect(m.afterCost).toBe(
                d.turn.actions.reduce(
                  (n, a) =>
                    n +
                    getRuntimeActionAmounts(player, a, defaultRules).actualCost,
                  0,
                ),
              );
            }
          }
          ctrl.update(r);
          trace.update(r);
        } else
          game = clientGameReducer(game, {
            type: 'advance_room',
          }) as ActiveClientGameState;
      }
      const expected = runPopulationMatch(
        0,
        role,
        policy,
        plan.arms[i]!,
        undefined,
        plan,
      );
      expect(trace.digest()).toBe(expected.traceHash);
      expect(classicTierTerminalHash(game)).toBe(expected.terminalHash);
    }
  },
  20000,
);
