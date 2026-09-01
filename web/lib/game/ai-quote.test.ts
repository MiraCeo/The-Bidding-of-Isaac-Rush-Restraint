import { describe, expect, it } from 'vitest';

import type { AiAnalysisResult, AiDecisionContext } from './ai-analysis';
import { analyzeAiQuote } from './ai-quote';
import { defaultRules } from './config';
import type { GeneratedRoom } from './item-types';
import { createRuntimePlayer } from './runtime';
import type { RandomSource } from './types';

function queuedRandom(...values: number[]): RandomSource {
  let index = 0;
  return { next: () => values[index++] ?? 0.5 };
}

const room: GeneratedRoom = {
  floorIndex: 0,
  roomIndex: 0,
  kind: 'normal',
  rewards: [
    { group: 'A', itemId: 'sacred_heart', hidden: false },
    { group: 'B', itemId: 'score_charm', hidden: false },
  ],
};

function context(): AiDecisionContext {
  return {
    moneyRankPercentile: 0.5,
    scoreRankPercentile: 0.5,
    recentMarkets: [
      {
        targetRatio: 0.32,
        participationRate: 0.85,
        disruptionRate: 0.15,
        highestMarketEquivalentRatio: 0.68,
      },
    ],
    history: {
      rounds: 3,
      competitiveRounds: 3,
      awards: 1,
      failedCompetitiveRounds: 2,
      strategyCounts: {
        high_bid: 1,
        cooperate: 1,
        disrupt_high: 0,
        disrupt_cooperate: 1,
        withdraw: 0,
      },
      lastStrategy: 'disrupt_cooperate',
    },
    room,
    remainingGameRooms: 15,
  };
}

function analysis(groupValue: number): AiAnalysisResult {
  return {
    situationMultipliers: {
      high_bid: 1,
      cooperate: 1,
      disrupt_high: 1,
      disrupt_cooperate: 1,
      withdraw: 1,
    },
    itemMultipliers: {
      high_bid: 1,
      cooperate: 1,
      disrupt_high: 1,
      disrupt_cooperate: 1,
      withdraw: 1,
    },
    groupWeights: { A: 1, B: 1 },
    groupValues: { A: groupValue, B: 0.5 },
    inventoryPower: 0,
  };
}

function quote(
  liquidityRatio: number,
  groupValue: number,
  random: RandomSource = queuedRandom(0.5, 0.5, 0.5),
) {
  const player = createRuntimePlayer({ id: 'ai', money: 1000, score: 0, isHuman: false });
  return analyzeAiQuote({
    player,
    strategy: 'high_bid',
    group: 'A',
    floorIndex: 0,
    remainingRooms: 5,
    liquidityRatio,
    rules: defaultRules,
    random,
    analysis: analysis(groupValue),
    context: context(),
    profile: {
      highestPredictionBias: 1,
      targetPredictionBias: 1,
      cooperationPositionBias: 0,
      qualificationPredictionBias: 1,
    },
  });
}

describe('AI dynamic quote analysis', () => {
  it('reduces the same high-bid quote when liquidity becomes tight', () => {
    expect(quote(0.4, 0.8).amount).toBeLessThan(quote(1.2, 0.8).amount);
  });

  it('raises high-bid quotes for a more valuable selected reward', () => {
    expect(quote(1, 1).amount).toBeGreaterThan(quote(1, 0.2).amount);
  });

  it('keeps final quote noise between minus and plus five percent', () => {
    expect(quote(1, 0.8, queuedRandom(0.5, 0.5, 0.5, 0.5, 0.5, 0)).randomFactor).toBe(0.95);
    expect(quote(1, 0.8, queuedRandom(0.5, 0.5, 0.5, 0.5, 0.5, 1)).randomFactor).toBe(1.05);
  });

  it('forms private market and cooperation-zone predictions per AI', () => {
    const lower = quote(1, 0.8, queuedRandom(0, 0, 0, 0.5, 0.5)).prediction;
    const higher = quote(1, 0.8, queuedRandom(1, 1, 1, 0.5, 0.5)).prediction;
    expect(lower.predictedHighestMarketEquivalent).toBeLessThan(
      higher.predictedHighestMarketEquivalent,
    );
    expect(lower.predictedTarget).toBeLessThan(higher.predictedTarget);
    expect(lower.predictedCooperationUpper - lower.predictedTarget).toBe(10);
  });

  it('converts the cooperation target back to nominal money for disruption', () => {
    const player = createRuntimePlayer({ id: 'ai', money: 1000, score: 0, isHuman: false });
    const common = {
      player,
      group: 'A' as const,
      floorIndex: 0,
      remainingRooms: 5,
      liquidityRatio: 1,
      rules: defaultRules,
      analysis: analysis(0.5),
      context: context(),
      profile: {
      highestPredictionBias: 1,
      targetPredictionBias: 1,
      cooperationPositionBias: 0,
      qualificationPredictionBias: 1,
      },
    };
    const cooperate = analyzeAiQuote({
      ...common,
      strategy: 'cooperate',
      random: queuedRandom(0.5, 0.5, 0.5),
    });
    const disrupt = analyzeAiQuote({
      ...common,
      strategy: 'disrupt_cooperate',
      random: queuedRandom(0.5, 0.5, 0.5),
    });
    expect(disrupt.nominalQuoteBeforeLimit).toBeLessThan(cooperate.nominalQuoteBeforeLimit);
  });

  it('reserves more money for future premium rooms', () => {
    const early = quote(1, 0.8);
    const player = createRuntimePlayer({ id: 'ai', money: 1000, score: 0, isHuman: false });
    const bossContext = context();
    bossContext.room = { ...room, roomIndex: 4, kind: 'boss' };
    const boss = analyzeAiQuote({
      player,
      strategy: 'high_bid',
      group: 'A',
      floorIndex: 0,
      remainingRooms: 1,
      liquidityRatio: 1,
      rules: defaultRules,
      random: queuedRandom(0.5, 0.5, 0.5, 0.5, 0.5),
      analysis: analysis(0.8),
      context: bossContext,
      profile: {
      highestPredictionBias: 1,
      targetPredictionBias: 1,
      cooperationPositionBias: 0,
      qualificationPredictionBias: 1,
      },
    });
    expect(boss.opportunityBudget).toBeGreaterThan(early.opportunityBudget);
  });

  it('values the same hidden room more highly than a normal room', () => {
    const player = createRuntimePlayer({ id: 'ai', money: 1000, score: 0, isHuman: false });
    const normalContext = context();
    const hiddenContext = context();
    hiddenContext.room = { ...room, kind: 'hidden' };
    const common = {
      player,
      strategy: 'cooperate' as const,
      group: 'A' as const,
      floorIndex: 0,
      remainingRooms: 5,
      liquidityRatio: 1,
      rules: defaultRules,
      analysis: analysis(0.8),
      profile: {
        highestPredictionBias: 1,
        targetPredictionBias: 1,
        cooperationPositionBias: 0,
        qualificationPredictionBias: 1,
      },
    };
    const normal = analyzeAiQuote({
      ...common,
      context: normalContext,
      random: queuedRandom(0.5, 0.5, 0.5),
    });
    const hidden = analyzeAiQuote({
      ...common,
      context: hiddenContext,
      random: queuedRandom(0.5, 0.5, 0.5),
    });

    expect(hidden.opportunityBudget).toBeGreaterThan(normal.opportunityBudget);
    expect(hidden.candidates[1]!.utility).toBeGreaterThan(normal.candidates[1]!.utility);
  });

  it('treats the model output as equivalent value before item cost processing', () => {
    const steamPlayer = createRuntimePlayer({ id: 'steam', money: 1000, score: 0, isHuman: false });
    steamPlayer.items.push({ instanceId: 'steam-1', itemId: 'steam_sale', acquiredOrder: 1 });
    const result = analyzeAiQuote({
      player: steamPlayer,
      strategy: 'high_bid',
      group: 'A',
      floorIndex: 0,
      remainingRooms: 5,
      liquidityRatio: 1,
      rules: defaultRules,
      random: queuedRandom(0.5, 0.5, 0.5, 0.5, 0.5),
      analysis: analysis(0.8),
      context: context(),
      profile: {
      highestPredictionBias: 1,
      targetPredictionBias: 1,
      cooperationPositionBias: 0,
      qualificationPredictionBias: 1,
      },
    });
    expect(result.expectedActualCost).toBeLessThan(result.amount);
  });
});
