import { expect, it } from 'vitest';
import { decideAiTurn } from './ai-decision';
import { createClientResearchReducer, startClientGame } from './client-session';
import {
  applyFeasibleMistake as production,
  applyClassicPopulationMistake,
  selectFeasibleKind,
} from './classic-mistake';
import { applyFeasibleMistake as research } from '../ui/achievements/classic-feasible-mistake.test-helper';
import { validateTurn } from './turns';
it('ports candidates, single trigger, fallback and type selection exactly, including forced and zero-rate paths', () => {
  const kinds = new Set<string>(),
    severities = new Set<string>();
  let doubles = 0,
    empty = 0,
    comparisons = 0;
  const reduce = createClientResearchReducer(
    (player, floor, rules, random, options) => {
      if (!options) throw Error('No public context');
      const base = decideAiTurn(player, floor, rules, random, options);
      const snapshot = JSON.stringify({ base, player, options });
      for (const config of [
        { rate: 1, mediumShare: 0.4 },
        { rate: 0.25, mediumShare: 0.4 },
        { rate: 0.15, mediumShare: 0.2 },
        { rate: 0, mediumShare: 0 },
      ]) {
        const actual = production(
          base,
          player,
          floor,
          rules,
          options,
          42,
          config,
        );
        expect(actual).toEqual(
          research(base, player, floor, rules, options, 42, config),
        );
        comparisons++;
        expect(validateTurn(player, actual.decision.turn, rules)).toEqual([]);
        if (actual.event.applied) {
          kinds.add(actual.event.kind!);
          severities.add(actual.event.severity!);
          doubles += Number(base.turn.actions.length === 2);
          expect(actual.event.availableKinds).toContain(actual.event.kind);
        } else empty++;
        if (config.rate === 0) expect(actual.decision).toBe(base);
      }
      const adapted = applyClassicPopulationMistake(
        base,
        player,
        floor,
        rules,
        options,
        42,
        'low',
      );
      const expected = research(base, player, floor, rules, options, 42, {
        rate: 0.25,
        mediumShare: 0.4,
      });
      if (expected.event.applied) {
        expect(adapted.classicMistake!.intendedTurn).toBe(base.turn);
        const { classicMistake: _metadata, ...execution } = adapted;
        expect(execution).toEqual(expected.decision);
      } else expect(adapted).toBe(base);
      expect(
        applyClassicPopulationMistake(
          base,
          player,
          floor,
          rules,
          options,
          42,
          'high',
        ),
      ).toBe(base);
      expect(JSON.stringify({ base, player, options })).toBe(snapshot);
      return base;
    },
  );
  for (const seed of [42, 91, 31415, 271828]) {
    let game = startClientGame('jacob_esau', seed);
    for (let room = 0; room < 15; room++) {
      const result = reduce(game, {
        type: 'submit_player_turn',
        turn: {
          playerId: 'human',
          actions: [{ type: 'bid', group: 'A', amount: 1 }],
        },
      });
      if (result.phase !== 'room_result') throw Error('No result');
      const next = reduce(result, { type: 'advance_room' });
      if (next.phase === 'character_selection') throw Error('No active game');
      game = next;
    }
  }
  expect(comparisons).toBe(4560);
  expect([...kinds].sort((a, b) => a.localeCompare(b))).toEqual([
    'budget',
    'quote',
    'reward',
  ]);
  expect(severities.size).toBe(2);
  expect(doubles).toBeGreaterThan(0);
  expect(empty).toBeGreaterThan(0);
  expect(selectFeasibleKind(['budget'], 0.99)).toBe('budget');
  expect(selectFeasibleKind(['reward', 'quote'], 0.69)).toBe('reward');
  expect(selectFeasibleKind(['reward', 'quote'], 0.7)).toBe('quote');
  expect(selectFeasibleKind([], 0)).toBeNull();
}, 20000);
