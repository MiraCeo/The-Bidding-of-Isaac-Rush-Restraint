import { describe, expect, it } from 'vitest';

import type { AiDecisionContext } from './ai-analysis';
import { aiDoctrineWeights, decideAiTurn } from './ai-decision';
import { defaultRules } from './config';
import { createSeededRandom } from './random';
import { createRuntimePlayer } from './runtime';
import { getRuntimeActionAmounts, validateTurn } from './turns';
import type { RandomSource } from './types';

function queuedRandom(...values: number[]): RandomSource {
  let index = 0;
  return { next: () => values[index++] ?? 0.5 };
}

function decisionContext(kind: AiDecisionContext['room']['kind']): AiDecisionContext {
  return {
    moneyRankPercentile: 0.5,
    scoreRankPercentile: 0.5,
    recentMarkets: [],
    history: {
      rounds: 0,
      competitiveRounds: 0,
      awards: 0,
      failedCompetitiveRounds: 0,
      strategyCounts: {
        high_bid: 0,
        cooperate: 0,
        disrupt_high: 0,
        disrupt_cooperate: 0,
        withdraw: 0,
      },
      lastStrategy: null,
    },
    room: {
      floorIndex: 0,
      roomIndex: 0,
      kind,
      rewards: [
        { group: 'A', itemId: 'score_charm', hidden: false },
        { group: 'B', itemId: 'interest', hidden: false },
      ],
    },
    remainingGameRooms: 15,
  };
}

describe('provisional AI decision and quoting', () => {
  it('keeps the three doctrine profiles and their hard-disabled strategies exact', () => {
    expect(aiDoctrineWeights.balanced).toEqual({
      high_bid: 20,
      cooperate: 50,
      disrupt_high: 5,
      disrupt_cooperate: 10,
      withdraw: 15,
    });
    expect(aiDoctrineWeights.cooperative).toEqual({
      high_bid: 10,
      cooperate: 55,
      disrupt_high: 0,
      disrupt_cooperate: 25,
      withdraw: 10,
    });
    expect(aiDoctrineWeights.chaotic).toEqual({
      high_bid: 5,
      cooperate: 25,
      disrupt_high: 15,
      disrupt_cooperate: 35,
      withdraw: 20,
    });
  });

  it('uses 60% floor money as the high-competition base before dynamic corrections', () => {
    const player = createRuntimePlayer({ id: 'ai', money: 100, score: 0, isHuman: false });
    const decision = decideAiTurn(
      player,
      0,
      defaultRules,
      queuedRandom(0.5, 0.5, 0.5, 0.5, 0.05, 0, 0.5),
      {
        strategyMultipliers: {
          cooperate: 0,
          disrupt_high: 0,
          disrupt_cooperate: 0,
          withdraw: 0,
        },
        groupWeights: { A: 1, B: 0 },
      },
    );
    expect(decision.strategy).toBe('high_bid');
    expect(decision.baseQuote).toBe(60);
    expect(decision.turn.actions[0]).toEqual({ type: 'bid', group: 'A', amount: 59 });
  });

  it('keeps high competition probabilistic when late-floor money is still sufficient', () => {
    const player = createRuntimePlayer({ id: 'ai', money: 49, score: 0, isHuman: false });
    const decision = decideAiTurn(
      player,
      0,
      defaultRules,
      queuedRandom(0.5, 0.5, 0.5, 0.5, 0, 0, 0.5),
      {
        remainingRooms: 1,
        strategyMultipliers: {
          cooperate: 0,
          disrupt_high: 0,
          disrupt_cooperate: 0,
          withdraw: 0,
        },
        groupWeights: { A: 1, B: 0 },
      },
    );
    expect(decision.finalWeights.high_bid).toBe(25);
    expect(decision.strategy).toBe('high_bid');
    expect(decision.turn.actions[0]).toEqual({ type: 'bid', group: 'A', amount: 49 });
  });

  it('uses 20% floor money for disruption and clamps it to half current funds', () => {
    const player = createRuntimePlayer({ id: 'ai', money: 30, score: 0, isHuman: false });
    const decision = decideAiTurn(
      player,
      0,
      defaultRules,
      {
        next: (() => {
          const values = [0.5, 0.5, 0.5, 0.5, 0.8, 0, 0.5];
          let index = 0;
          return () => values[index++] ?? 0.5;
        })(),
      },
      {
        strategyMultipliers: {
          high_bid: 0,
          cooperate: 0,
          disrupt_high: 0,
          withdraw: 0,
        },
        remainingRooms: 1,
        groupWeights: { A: 1, B: 0 },
      },
    );
    expect(decision.strategy).toBe('disrupt_cooperate');
    expect(decision.baseQuote).toBe(20);
    expect(decision.turn.actions[0]).toEqual({ type: 'disrupt', group: 'A', amount: 15 });
  });

  it('makes cooperation and disruption lead critical-liquidity weights without eliminating alternatives', () => {
    const player = createRuntimePlayer({ id: 'ai', money: 30, score: 0, isHuman: false });
    const decision = decideAiTurn(
      player,
      0,
      defaultRules,
      queuedRandom(0.5, 0.5, 0.5, 0.5, 0, 0, 0.5),
      { remainingRooms: 5 },
    );
    expect(decision.liquidityRatio).toBe(0.3);
    expect(decision.finalWeights.high_bid).toBe(1);
    expect(decision.finalWeights.cooperate).toBeCloseTo(27.5);
    expect(decision.finalWeights.disrupt_high).toBeCloseTo(0.75);
    expect(decision.finalWeights.disrupt_cooperate).toBe(28);
    expect(decision.finalWeights.withdraw).toBe(13.5);
  });

  it('raises every active strategy weight by the current room score multiplier', () => {
    const player = createRuntimePlayer({ id: 'ai', money: 100, score: 0, isHuman: false });
    const normal = decideAiTurn(player, 0, defaultRules, queuedRandom(), {
      context: decisionContext('normal'),
    });
    const hidden = decideAiTurn(player, 0, defaultRules, queuedRandom(), {
      context: decisionContext('hidden'),
    });

    expect(hidden.finalWeights.high_bid).toBeCloseTo(normal.finalWeights.high_bid * 2);
    expect(hidden.finalWeights.cooperate).toBeCloseTo(normal.finalWeights.cooperate * 2);
    expect(hidden.finalWeights.disrupt_high).toBeCloseTo(normal.finalWeights.disrupt_high * 2);
    expect(hidden.finalWeights.disrupt_cooperate).toBeCloseTo(
      normal.finalWeights.disrupt_cooperate * 2,
    );
    expect(hidden.finalWeights.withdraw).toBeCloseTo(normal.finalWeights.withdraw);
  });

  it('uses the per-room budget as a soft cost signal with a wider safety ceiling', () => {
    const player = createRuntimePlayer({ id: 'ai', money: 40, score: 0, isHuman: false });
    const decision = decideAiTurn(
      player,
      0,
      defaultRules,
      queuedRandom(0.5, 0.5, 0.5, 0.5, 0.2, 0, 0.5),
      {
        remainingRooms: 4,
        strategyMultipliers: {
          high_bid: 0,
          disrupt_high: 0,
          disrupt_cooperate: 0,
          withdraw: 0,
        },
        groupWeights: { A: 1, B: 0 },
      },
    );
    expect(decision.strategy).toBe('cooperate');
    expect(decision.roomBudget).toBe(10);
    expect(decision.turn.actions[0]).toEqual({ type: 'bid', group: 'A', amount: 20 });
    expect(decision.quoteAnalysis?.expectedActualCost).toBeLessThanOrEqual(
      decision.quoteAnalysis!.paceMaximumActualCost,
    );
  });

  it('lets all-in spend the full legal amount after choosing a first-floor action', () => {
    const player = createRuntimePlayer({ id: 'ai', money: 87, score: 0, isHuman: false });
    const decision = decideAiTurn(player, 0, defaultRules, queuedRandom(), {
      context: decisionContext('normal'),
      personalities: ['all_in'],
      strategyMultipliers: {
        cooperate: 0,
        disrupt_high: 0,
        disrupt_cooperate: 0,
        withdraw: 0,
      },
      groupWeights: { A: 1, B: 0 },
    });
    expect(decision.strategy).toBe('high_bid');
    expect(decision.turn.actions[0]).toEqual({ type: 'bid', group: 'A', amount: 87 });
  });

  it('expands final quote noise to plus or minus fifteen percent for gamblers', () => {
    const player = createRuntimePlayer({ id: 'ai', money: 100, score: 0, isHuman: false });
    const decision = decideAiTurn(player, 0, defaultRules, queuedRandom(), {
      personalities: ['gambler'],
      strategyMultipliers: {
        cooperate: 0,
        disrupt_high: 0,
        disrupt_cooperate: 0,
        withdraw: 0,
      },
      groupWeights: { A: 1, B: 0 },
      quoteProfile: {
        highestPredictionBias: 1,
        targetPredictionBias: 1,
        cooperationPositionBias: 0,
        qualificationPredictionBias: 1,
      },
      quoteRandom: queuedRandom(0.5, 0.5, 0.5, 0.5, 0.5, 0),
    });
    expect(decision.quoteFactor).toBe(0.85);
  });

  it('can conditionally add a legal second bid through More Options', () => {
    const player = createRuntimePlayer({ id: 'ai', money: 500, score: 0, isHuman: false });
    player.items.push({ instanceId: 'options', itemId: 'more_options', acquiredOrder: 1 });
    const decisions = Array.from({ length: 100 }, (_, seed) => decideAiTurn(
      player,
      1,
      defaultRules,
      createSeededRandom(seed),
      {
        strategyMultipliers: { high_bid: 0, disrupt_high: 0, disrupt_cooperate: 0, withdraw: 0 },
        groupWeights: { A: 1, B: 0 },
        quoteRandom: createSeededRandom(seed + 1000),
      },
    ));
    const double = decisions.find((decision) => decision.turn.actions.length === 2);
    expect(double?.secondaryActionAnalysis?.mode).toBe('bid');
    expect(double?.turn.actions.map((action) => action.type)).toEqual(['bid', 'bid']);
    expect(validateTurn(player, double!.turn, defaultRules)).toEqual([]);
  });

  it('can conditionally add a legal second disruption through More Options question', () => {
    const player = createRuntimePlayer({ id: 'ai', money: 100, score: 0, isHuman: false });
    player.items.push({ instanceId: 'options-question', itemId: 'more_options_question', acquiredOrder: 1 });
    const decisions = Array.from({ length: 100 }, (_, seed) => decideAiTurn(
      player,
      0,
      defaultRules,
      createSeededRandom(seed),
      {
        strategyMultipliers: { high_bid: 0, cooperate: 0, disrupt_high: 0, withdraw: 0 },
        groupWeights: { A: 1, B: 0 },
        quoteRandom: createSeededRandom(seed + 2000),
      },
    ));
    const double = decisions.find((decision) => decision.turn.actions.length === 2);
    expect(double?.secondaryActionAnalysis?.mode).toBe('disrupt');
    expect(double?.turn.actions.map((action) => action.type)).toEqual(['disrupt', 'disrupt']);
    expect(validateTurn(player, double!.turn, defaultRules)).toEqual([]);
  });

  it('reserves next-room money and caps double-action nominal and actual spending', () => {
    const player = createRuntimePlayer({ id: 'ai', money: 500, score: 0, isHuman: false });
    player.items.push({ instanceId: 'options', itemId: 'more_options', acquiredOrder: 1 });
    const decisions = Array.from({ length: 500 }, (_, seed) => decideAiTurn(
      player,
      1,
      defaultRules,
      createSeededRandom(seed),
      {
        remainingRooms: 5,
        strategyMultipliers: { high_bid: 0, disrupt_high: 0, disrupt_cooperate: 0, withdraw: 0 },
        groupWeights: { A: 1, B: 0 },
        quoteRandom: createSeededRandom(seed + 3000),
      },
    ));
    const doubles = decisions.filter((decision) => decision.turn.actions.length === 2);
    expect(doubles.length).toBeGreaterThan(0);
    for (const decision of doubles) {
      const analysis = decision.secondaryActionAnalysis!;
      const nominalTotal = decision.turn.actions.reduce(
        (sum, action) => sum + (action.type === 'withdraw' ? 0 : action.amount),
        0,
      );
      const actualTotal = decision.turn.actions.reduce(
        (sum, action) => sum + getRuntimeActionAmounts(player, action, defaultRules).actualCost,
        0,
      );
      expect(nominalTotal).toBeLessThanOrEqual(analysis.totalNominalCap);
      expect(actualTotal).toBeLessThanOrEqual(analysis.totalActualCostCap);
      expect(player.money - nominalTotal).toBeGreaterThanOrEqual(analysis.nextRoomReserve);
    }
  });
});
