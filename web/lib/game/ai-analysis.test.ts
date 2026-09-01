import { describe, expect, it } from 'vitest';

import { analyzeAiDecision, createEmptyAiHistory, type AiDecisionContext } from './ai-analysis';
import type { GeneratedRoom, ItemId } from './item-types';
import { createRuntimePlayer } from './runtime';

function context(room: GeneratedRoom, overrides: Partial<AiDecisionContext> = {}): AiDecisionContext {
  return {
    moneyRankPercentile: 0.5,
    scoreRankPercentile: 0.5,
    recentMarkets: [],
    history: createEmptyAiHistory(),
    room,
    remainingGameRooms: 10,
    ...overrides,
  };
}

function room(a: ItemId, b: ItemId, hiddenB = false): GeneratedRoom {
  return {
    floorIndex: 0,
    roomIndex: 1,
    kind: 'treasure',
    rewards: [
      { group: 'A', itemId: a, hidden: false },
      { group: 'B', itemId: b, hidden: hiddenB },
    ],
  };
}

describe('AI situation and item-value analysis', () => {
  it('does not leak the identity of a hidden reward into its value', () => {
    const player = createRuntimePlayer({ id: 'ai', money: 100, score: 0, isHuman: false });
    const weakHidden = analyzeAiDecision(player, context(room('score_charm', 'more_options_question', true)));
    const strongHidden = analyzeAiDecision(player, context(room('score_charm', 'sacred_heart', true)));
    expect(weakHidden.groupValues.B).toBe(strongHidden.groupValues.B);
    expect(weakHidden.groupWeights.B).toBe(strongHidden.groupWeights.B);
  });

  it('raises disruption preference for a low-ranked player with repeated failures', () => {
    const player = createRuntimePlayer({ id: 'ai', money: 100, score: 0, isHuman: false });
    const history = createEmptyAiHistory();
    history.rounds = 4;
    history.competitiveRounds = 4;
    history.failedCompetitiveRounds = 4;
    const pressured = analyzeAiDecision(
      player,
      context(room('score_charm', 'interest'), {
        moneyRankPercentile: 0,
        scoreRankPercentile: 0,
        history,
      }),
    );
    const leading = analyzeAiDecision(
      player,
      context(room('score_charm', 'interest'), {
        moneyRankPercentile: 1,
        scoreRankPercentile: 1,
      }),
    );
    expect(pressured.situationMultipliers.disrupt_cooperate).toBeGreaterThan(
      leading.situationMultipliers.disrupt_cooperate,
    );
  });

  it('recognizes owned item and decision combinations', () => {
    const player = createRuntimePlayer({ id: 'ai', money: 100, score: 0, isHuman: false });
    const base = analyzeAiDecision(player, context(room('score_charm', 'interest')));
    player.items.push(
      { instanceId: 't', itemId: 'transcendence', acquiredOrder: 1 },
      { instanceId: 's', itemId: 'short_brimstone', acquiredOrder: 2 },
    );
    const combined = analyzeAiDecision(player, context(room('score_charm', 'interest')));
    expect(combined.itemMultipliers.disrupt_cooperate).toBeGreaterThan(
      base.itemMultipliers.disrupt_cooperate,
    );
  });

  it('discounts duplicate copies of non-stacking items', () => {
    const player = createRuntimePlayer({ id: 'ai', money: 100, score: 0, isHuman: false });
    const before = analyzeAiDecision(player, context(room('transcendence', 'score_charm')));
    player.items.push({ instanceId: 't', itemId: 'transcendence', acquiredOrder: 1 });
    const after = analyzeAiDecision(player, context(room('transcendence', 'score_charm')));
    expect(after.groupValues.A).toBeLessThan(before.groupValues.A);
  });
});
