import { expect, it } from 'vitest';
import { decideAiTurn } from '../../game/ai-decision';
import {
  startClientGame,
  createClientResearchReducer,
} from '../../game/client-session';
import { validateTurn } from '../../game/turns';
import { feasibleMistakePlan as plan } from '../../../scripts/classic-feasible-mistake-plan.mjs';
import { decisionMistakePlan } from '../../../scripts/classic-decision-mistake-plan.mjs';
import { applyDecisionMistake } from './classic-decision-mistake.test-helper';
import { runMistakeMatch } from './classic-mistake.test-helper';
import {
  applyFeasibleMistake,
  selectFeasibleKind,
  feasibleMistakeSeed,
  runFeasibleMistakeMatch,
} from './classic-feasible-mistake.test-helper';

it('normalizes unchanged TYPE weights only over feasible kinds, never over candidate counts', () => {
  expect(plan.content).toEqual(decisionMistakePlan.content);
  expect(plan.arms.map((a) => a.rate)).toEqual([
    0.25, 0.15, 0.25, 0.15, 0.05, 0,
  ]);
  expect(selectFeasibleKind([], 0.5)).toBeNull();
  for (const n of [0, 0.2, 0.5, 0.999999])
    expect(selectFeasibleKind(['budget'], n)).toBe('budget');
  expect(selectFeasibleKind(['reward', 'quote'], 0.69)).toBe('reward');
  expect(selectFeasibleKind(['reward', 'quote'], 0.7)).toBe('quote');
  expect(selectFeasibleKind(['reward', 'budget', 'quote'], 0.44)).toBe(
    'reward',
  );
  expect(selectFeasibleKind(['reward', 'budget', 'quote'], 0.46)).toBe(
    'budget',
  );
  expect(selectFeasibleKind(['reward', 'budget', 'quote'], 0.81)).toBe('quote');
  expect(() => selectFeasibleKind(['quote', 'quote'], 0)).toThrow();
  expect(() => selectFeasibleKind(['quote'], 1)).toThrow();
});

it('executes only a feasible type, does nothing with no candidates, and matches prior behavior when all types are feasible', () => {
  let tested = 0,
    allFeasible = 0,
    unavailable = 0;
  const reduce = createClientResearchReducer(
    (player, floor, rules, random, options) => {
      if (!options) throw Error('No context');
      const base = decideAiTurn(player, floor, rules, random, options);
      const snapshot = JSON.stringify({
        player,
        base,
        context: options.context,
      });
      const result = applyFeasibleMistake(
        base,
        player,
        floor,
        rules,
        options,
        42,
        { rate: 1, mediumShare: 0.2 },
      );
      const zero = applyFeasibleMistake(
        base,
        player,
        floor,
        rules,
        options,
        42,
        { rate: 0, mediumShare: 0.2 },
      );
      expect(zero.decision).toBe(base);
      expect(zero.event.availableKinds).toEqual([]);
      expect(JSON.stringify({ player, base, context: options.context })).toBe(
        snapshot,
      );
      expect(validateTurn(player, result.decision.turn, rules)).toEqual([]);
      expect(result.event.fallback).toBe(false);
      if (result.event.triggered) {
        tested++;
        expect(result.event.availableKinds).toEqual(
          (['reward', 'budget', 'quote'] as const).filter(
            (k) => result.event.candidateCounts[k] > 0,
          ),
        );
        if (result.event.availableKinds.length) {
          expect(result.event.applied).toBe(true);
          expect(result.event.availableKinds).toContain(result.event.kind);
          expect(result.event.requestedKind).toBe(result.event.kind);
        } else {
          unavailable++;
          expect(result.decision).toBe(base);
          expect(result.event.requestedKind).toBeNull();
        }
        if (result.event.availableKinds.length === 3) {
          allFeasible++;
          const prior = applyDecisionMistake(
            base,
            player,
            floor,
            rules,
            options,
            42,
            { rate: 1, mediumShare: 0.2 },
          );
          expect(result.decision.turn).toEqual(prior.decision.turn);
          expect(result.event.severity).toBe(prior.event.severity);
        }
      }
      return base;
    },
  );
  for (const seed of [42, 91, 31415, 271828]) {
    let game = startClientGame('jacob_esau', seed);
    for (let room = 0; room < 15; room++) {
      const next = reduce(game, {
        type: 'submit_player_turn',
        turn: {
          playerId: 'human',
          actions: [{ type: 'bid', group: 'A', amount: 1 }],
        },
      });
      if (next.phase !== 'room_result') throw Error('No result');
      const advanced = reduce(next, { type: 'advance_room' });
      if (advanced.phase === 'character_selection')
        throw Error('No active state');
      game = advanced;
    }
  }
  expect(tested).toBeGreaterThan(1000);
  expect(unavailable).toBeGreaterThan(0);
  expect(allFeasible).toBeGreaterThan(0);
});

it('keeps hard/highest and same-world pairing exact, uses new seeds and remains deterministic', () => {
  const rows = plan.arms.map((a) =>
    runFeasibleMistakeMatch(0, 'jacob_esau', 'public-ai', a),
  );
  expect(new Set(rows.map((r) => r.world)).size).toBe(1);
  for (const i of [4, 5]) {
    const prior = runMistakeMatch(
      0,
      'jacob_esau',
      'public-ai',
      plan.arms[i]!,
      undefined,
      feasibleMistakeSeed(0),
    );
    expect(rows[i]!.traceHash).toBe(prior.traceHash);
    expect(rows[i]!.terminalHash).toBe(prior.terminalHash);
  }
  expect(
    runFeasibleMistakeMatch(0, 'jacob_esau', 'public-ai', plan.arms[0]!)
      .traceHash,
  ).toBe(rows[0]!.traceHash);
  expect(
    new Set(Array.from({ length: 60 }, (_, i) => feasibleMistakeSeed(i))).size,
  ).toBe(60);
  expect(() => feasibleMistakeSeed(60)).toThrow();
});

it('does not consult the current secret human submission', () => {
  const game = startClientGame('isaac', 91);
  const reduce = createClientResearchReducer(
    (player, floor, rules, random, options) => {
      if (!options) throw Error('No context');
      return applyFeasibleMistake(
        decideAiTurn(player, floor, rules, random, options),
        player,
        floor,
        rules,
        options,
        91,
        { rate: 1, mediumShare: 0.2 },
      ).decision;
    },
  );
  const submit = (group: 'A' | 'B', amount: number) =>
    reduce(game, {
      type: 'submit_player_turn',
      turn: { playerId: 'human', actions: [{ type: 'bid', group, amount }] },
    });
  const a = submit('A', 1),
    b = submit('B', 100);
  if (a.phase === 'character_selection' || b.phase === 'character_selection')
    throw Error('No active game');
  expect(a.revealedAiDecisions).toEqual(b.revealedAiDecisions);
});
