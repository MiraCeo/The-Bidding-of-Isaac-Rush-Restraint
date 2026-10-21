import { expect, it } from 'vitest';
import { decideAiTurn } from '../../game/ai-decision';
import { defaultRules } from '../../game/config';
import { createSeededRandom } from '../../game/random';
import { createEmptyAiHistory } from '../../game/ai-analysis';
import type { AiDecisionOptions } from '../../game/ai-decision';
import {
  startClientGame,
  createClientResearchReducer,
} from '../../game/client-session';
import { validateTurn, getRuntimeActionAmounts } from '../../game/turns';
import { decisionMistakePlan as plan } from '../../../scripts/classic-decision-mistake-plan.mjs';
import {
  applyDecisionMistake,
  decisionMistakeCandidates,
  decisionMistakeSeed,
  runDecisionMistakeMatch,
} from './classic-decision-mistake.test-helper';
import { runMistakeMatch } from './classic-mistake.test-helper';

it('keeps the chosen probabilities and pairs old/new content while preserving highest and hard', () => {
  expect(plan.arms.map((a) => a.rate)).toEqual([
    0.25, 0.15, 0.25, 0.15, 0.05, 0,
  ]);
  const rows = plan.arms.map((a) =>
    runDecisionMistakeMatch(0, 'jacob_esau', 'public-ai', a),
  );
  expect(new Set(rows.map((r) => r.world)).size).toBe(1);
  for (const index of [4, 5]) {
    const old = runMistakeMatch(
      0,
      'jacob_esau',
      'public-ai',
      plan.arms[index]!,
      undefined,
      decisionMistakeSeed(0),
    );
    expect(rows[index]!.traceHash).toBe(old.traceHash);
    expect(rows[index]!.terminalHash).toBe(old.terminalHash);
  }
  expect(
    runDecisionMistakeMatch(0, 'jacob_esau', 'public-ai', plan.arms[0]!)
      .traceHash,
  ).toBe(rows[0]!.traceHash);
});

it('produces actual reward and budget mistakes, preserving legality, cash and immutable inputs', () => {
  const counts = {
    reward: 0,
    budget: 0,
    quote: 0,
    fallback: 0,
  };
  let zeroChecks = 0;
  const reduce = createClientResearchReducer(
    (player, floor, rules, random, options) => {
      if (!options) throw Error('Missing public context');
      const base = decideAiTurn(player, floor, rules, random, options);
      const snapshot = JSON.stringify({
        player,
        base,
        context: options.context,
      });
      const zero = applyDecisionMistake(
        base,
        player,
        floor,
        rules,
        options,
        42,
        { rate: 0, mediumShare: 0.2 },
      );
      expect(zero.decision).toBe(base);
      zeroChecks++;
      const result = applyDecisionMistake(
        base,
        player,
        floor,
        rules,
        options,
        42,
        { rate: 1, mediumShare: 0.2 },
      );
      expect(JSON.stringify({ player, base, context: options.context })).toBe(
        snapshot,
      );
      expect(validateTurn(player, result.decision.turn, rules)).toEqual([]);
      if (result.event.fallback) counts.fallback++;
      if (result.event.applied) {
        counts[result.event.kind!]++;
        expect(result.event.modelLoss).toBeGreaterThan(0);
        expect(result.event.afterCost).toBeLessThanOrEqual(player.money);
        expect(result.decision.strategy).toBe(base.strategy);
        expect(result.decision.turn.actions.length).toBe(
          base.turn.actions.length,
        );
        if (result.event.kind === 'reward') {
          expect(options.context!.room.rewards.every((r) => !r.hidden)).toBe(
            true,
          );
          expect(result.event.visibleValueGap).toBeGreaterThanOrEqual(0.15);
          expect(result.event.afterCost).toBe(result.event.beforeCost);
          for (const [i, after] of result.decision.turn.actions.entries()) {
            const before = base.turn.actions[i]!;
            if (before.type === 'withdraw' || after.type === 'withdraw')
              throw Error('Reward lapse cannot withdraw');
            expect(after.amount).toBe(before.amount);
            expect(after.group).not.toBe(before.group);
          }
        } else if (result.event.kind === 'budget') {
          expect(options.remainingRooms).toBeGreaterThan(1);
          expect(options.context!.room.kind).not.toBe('boss');
          expect(result.event.afterCost!).toBeGreaterThan(
            result.event.beforeCost!,
          );
          expect(result.event.reserveAfter).toBeGreaterThanOrEqual(
            player.money * 0.25,
          );
          expect(result.event.modelLoss).toBeLessThanOrEqual(
            plan.content.budgetLossCaps[result.event.severity!],
          );
          const total = result.decision.turn.actions.reduce(
            (n, a) => n + getRuntimeActionAmounts(player, a, rules).actualCost,
            0,
          );
          expect(total).toBe(result.event.afterCost);
        }
      }
      const noFuture = { ...options, remainingRooms: 1 };
      expect(
        decisionMistakeCandidates(
          'budget',
          'medium',
          base,
          player,
          floor,
          rules,
          noFuture,
        ),
      ).toEqual([]);
      if (options.context) {
        const hidden = {
          ...options,
          context: {
            ...options.context,
            room: {
              ...options.context.room,
              rewards: [
                { ...options.context.room.rewards[0], hidden: true },
                { ...options.context.room.rewards[1], hidden: true },
              ] as const,
            },
          },
        };
        expect(
          decisionMistakeCandidates(
            'reward',
            'mild',
            base,
            player,
            floor,
            rules,
            hidden,
          ),
        ).toEqual([]);
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
      if (next.phase !== 'room_result') throw Error('No study result');
      const advanced = reduce(next, { type: 'advance_room' });
      if (advanced.phase === 'character_selection')
        throw Error('No active state');
      game = advanced;
    }
  }
  expect(zeroChecks).toBe(1140);
  expect(counts.reward).toBeGreaterThan(10);
  expect(counts.budget).toBeGreaterThan(10);
  expect(counts.quote).toBeGreaterThan(10);
  expect(counts.fallback).toBeGreaterThan(10);
});

it('reassigns a legal dual bid as one whole bundle without changing amounts or costs', () => {
  const game = startClientGame('isaac', 42);
  const player = {
    ...game.players[1]!,
    money: 1000,
    items: [
      {
        instanceId: 'unit-more-options',
        itemId: 'more_options' as const,
        acquiredOrder: 1,
      },
    ],
  };
  const options: AiDecisionOptions = {
    remainingRooms: 5,
    enableDoubleActions: true,
    strategyMultipliers: {
      high_bid: 0,
      cooperate: 1,
      disrupt_high: 0,
      disrupt_cooperate: 0,
      withdraw: 0,
    },
    context: {
      moneyRankPercentile: 0.5,
      scoreRankPercentile: 0.5,
      recentMarkets: [],
      history: createEmptyAiHistory(),
      remainingGameRooms: 15,
      room: {
        floorIndex: 0,
        roomIndex: 0,
        kind: 'normal',
        rewards: [
          { group: 'A', itemId: 'moms_heart', hidden: false },
          { group: 'B', itemId: 'score_charm', hidden: false },
        ],
      },
    },
  };
  const base = decideAiTurn(
    player,
    0,
    defaultRules,
    createSeededRandom(42),
    options,
  );
  expect(base.secondaryActionAnalysis).toBeDefined();
  const quote = {
    ...base.quoteAnalysis!,
    prediction: { ...base.quoteAnalysis!.prediction, predictedTarget: 100 },
  };
  const decision = {
    ...base,
    analysis: { ...base.analysis!, groupValues: { A: 1, B: 0.1 } },
    quoteAnalysis: quote,
    secondaryActionAnalysis: {
      ...base.secondaryActionAnalysis!,
      selectedStrategy: 'cooperate' as const,
      selectedQuote: quote,
    },
    turn: {
      playerId: player.id,
      actions: [
        { type: 'bid' as const, group: 'A' as const, amount: 100 },
        { type: 'bid' as const, group: 'B' as const, amount: 1 },
      ],
    },
  };
  const candidates = decisionMistakeCandidates(
    'reward',
    'medium',
    decision,
    player,
    0,
    defaultRules,
    options,
  );
  expect(candidates).toHaveLength(1);
  expect(validateTurn(player, candidates[0]!.turn, defaultRules)).toEqual([]);
  expect(candidates[0]!.turn.actions).toEqual([
    { type: 'bid', group: 'B', amount: 100 },
    { type: 'bid', group: 'A', amount: 1 },
  ]);
  expect(candidates[0]!.cost).toBe(101);
});

it('ignores human secret submissions and keeps all experiments off the production reducer', () => {
  const game = startClientGame('isaac', 91);
  const reduce = createClientResearchReducer(
    (player, floor, rules, random, options) => {
      if (!options) throw Error('Missing context');
      return applyDecisionMistake(
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
    throw Error('No result');
  expect(a.revealedAiDecisions).toEqual(b.revealedAiDecisions);
  expect(
    new Set(Array.from({ length: 60 }, (_, i) => decisionMistakeSeed(i))).size,
  ).toBe(60);
  expect(() => decisionMistakeSeed(60)).toThrow();
});
