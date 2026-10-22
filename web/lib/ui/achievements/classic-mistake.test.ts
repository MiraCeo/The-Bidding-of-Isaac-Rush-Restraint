import { expect, it } from 'vitest';
import { decideAiTurn } from '../../game/ai-decision';
import {
  startClientGame,
  createClientResearchReducer,
} from '../../game/client-session';
import { getRuntimeActionAmounts, validateTurn } from '../../game/turns';
import { mistakePlan } from '../../../scripts/classic-mistake-plan.mjs';
import {
  applyQuoteMistake,
  mistakeQuoteUtility,
  mistakeSeed,
  runMistakeMatch,
} from './classic-mistake.test-helper';

it('keeps zero rate identical to original and initial worlds paired across all six arms', () => {
  const rows = mistakePlan.arms.map((arm) =>
    runMistakeMatch(0, 'lost', 'public-ai', arm),
  );
  expect(new Set(rows.map((r) => r.world)).size).toBe(1);
  const zero = runMistakeMatch(0, 'lost', 'public-ai', {
    id: 'zero',
    base: 'original',
    rate: 0,
    mediumShare: 0,
  });
  expect(zero.traceHash).toBe(rows[0]!.traceHash);
  expect(zero.terminalHash).toBe(rows[0]!.terminalHash);
  expect(
    runMistakeMatch(0, 'lost', 'public-ai', mistakePlan.arms[1]!).traceHash,
  ).toBe(rows[1]!.traceHash);
  for (const r of rows)
    expect(r.floors.reduce((s, f) => s + f.turns, 0)).toBe(285);
});

it('mirrors the original utility and only makes bounded legal quote changes, once per bundle', () => {
  let matched = 0,
    changed = 0,
    paired = 0;
  const reducer = createClientResearchReducer(
    (player, floor, rules, random, options) => {
      if (!options) throw Error('Research reducer must supply public context');
      const original = decideAiTurn(player, floor, rules, random, options);
      const action = original.turn.actions[0]!;
      if (
        original.quoteAnalysis &&
        action.type !== 'withdraw' &&
        original.strategy !== 'withdraw'
      ) {
        for (const c of original.quoteAnalysis.candidates) {
          const value = mistakeQuoteUtility(
            player,
            { ...action, amount: c.nominalQuote },
            original.strategy,
            original.quoteAnalysis,
            original,
            floor,
            rules,
            options,
          );
          expect(value).toBe(c.utility);
          matched++;
        }
      }
      const disabled = applyQuoteMistake(
        original,
        player,
        floor,
        rules,
        options,
        42,
        { rate: 0, mediumShare: 0 },
      );
      expect(disabled.decision).toBe(original);
      const result = applyQuoteMistake(
        original,
        player,
        floor,
        rules,
        options,
        42,
        { rate: 1, mediumShare: 0.2 },
      );
      expect(validateTurn(player, result.decision.turn, rules)).toEqual([]);
      if (result.event.applied) {
        changed++;
        expect(result.event.modelLoss).toBeGreaterThan(0);
        expect(result.event.modelLoss).toBeLessThanOrEqual(
          result.event.severity === 'mild' ? 0.15 : 0.35,
        );
        expect(result.event.afterCost).toBeLessThanOrEqual(player.money);
        expect(result.decision.strategy).toBe(original.strategy);
        expect(result.decision.turn.actions.length).toBe(
          original.turn.actions.length,
        );
        let edits = 0;
        for (const [index, a] of result.decision.turn.actions.entries()) {
          const before = original.turn.actions[index]!;
          expect(a.type).toBe(before.type);
          if (a.type !== 'withdraw' && before.type !== 'withdraw') {
            expect(a.group).toBe(before.group);
            edits += Number(a.amount !== before.amount);
            if (before.amount < player.money)
              expect(a.amount).toBeLessThan(player.money);
          }
        }
        expect(edits).toBe(1);
        if (original.turn.actions.length === 2) paired++;
        expect(
          result.decision.turn.actions.reduce(
            (s, a) => s + getRuntimeActionAmounts(player, a, rules).actualCost,
            0,
          ),
        ).toBe(result.event.afterCost);
      } else expect(result.decision).toBe(original);
      return original;
    },
  );
  for (const seed of [42, 91, 31415]) {
    let game = startClientGame('jacob_esau', seed);
    for (let room = 0; room < 15; room++) {
      const next = reducer(game, {
        type: 'submit_player_turn',
        turn: {
          playerId: 'human',
          actions: [{ type: 'bid', group: 'A', amount: 1 }],
        },
      });
      if (next.phase !== 'room_result') throw Error('No quote test result');
      const advance = reducer(next, { type: 'advance_room' });
      if (advance.phase === 'character_selection')
        throw Error('No active quote test');
      game = advance;
    }
  }
  expect(matched).toBeGreaterThan(1000);
  expect(changed).toBeGreaterThan(100);
  expect(paired).toBeGreaterThan(0);
});

it('does not use human secrets, and 3% never requests medium mistakes', () => {
  const game = startClientGame('isaac', 91);
  const events: unknown[] = [];
  const reducer = createClientResearchReducer(
    (p, floor, rules, random, options) => {
      if (!options) throw Error('Research reducer must supply public context');
      const d = decideAiTurn(p, floor, rules, random, options);
      const result = applyQuoteMistake(d, p, floor, rules, options, 91, {
        rate: 0.03,
        mediumShare: 0,
      });
      expect(result.event.requestedSeverity).not.toBe('medium');
      events.push(result.event);
      return result.decision;
    },
  );
  const a = reducer(game, {
    type: 'submit_player_turn',
    turn: {
      playerId: 'human',
      actions: [{ type: 'bid', group: 'A', amount: 1 }],
    },
  });
  const first = structuredClone(events);
  events.length = 0;
  const b = reducer(game, {
    type: 'submit_player_turn',
    turn: {
      playerId: 'human',
      actions: [{ type: 'bid', group: 'B', amount: 100 }],
    },
  });
  if (a.phase === 'character_selection' || b.phase === 'character_selection')
    throw Error('No active result');
  expect(a.revealedAiDecisions).toEqual(b.revealedAiDecisions);
  expect(events).toEqual(first);
});

it('uses 60 new seeds and rejects invalid block numbers', () => {
  const seeds = Array.from({ length: 60 }, (_, i) => mistakeSeed(i));
  expect(new Set(seeds).size).toBe(60);
  expect(seeds[0]).toBe((0x08010000 + Math.imul(3001, 104729)) >>> 0);
  for (const i of [-1, 60, NaN]) expect(() => mistakeSeed(i)).toThrow();
});
