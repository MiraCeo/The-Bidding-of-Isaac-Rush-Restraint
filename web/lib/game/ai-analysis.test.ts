import { describe, expect, it } from 'vitest';

import { analyzeAiDecision, createEmptyAiHistory, type AiDecisionContext } from './ai-analysis';
import type { GeneratedRoom, ItemId } from './item-types';
import { createRuntimePlayer } from './runtime';
import { getItemDefinition } from './item-catalog';

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

  it.each(['brimstone', 'short_brimstone', 'lucky_foot'] as const)(
    'treats %s as non-stacking and discounts every repeat to 0.08', (itemId) => {
      const player = createRuntimePlayer({ id: 'ai', money: 100, score: 0, isHuman: false });
      expect(getItemDefinition(itemId).effectStacks).toBe(false);
      expect(analyzeAiDecision(player, context(room(itemId, 'score_charm'))).groupValues.A)
        .toBeGreaterThan(0.08);
      for (let copies = 1; copies <= 3; copies += 1) {
        player.items.push({ instanceId: `copy-${copies}`, itemId, acquiredOrder: copies });
        expect(analyzeAiDecision(player, context(room(itemId, 'score_charm'))).groupValues.A)
          .toBe(0.08);
      }
    },
  );

  it('does not expose an owned non-stacking item behind a hidden reward', () => {
    const player = createRuntimePlayer({ id: 'ai', money: 100, score: 0, isHuman: false });
    player.items.push({ instanceId: 'owned', itemId: 'brimstone', acquiredOrder: 1 });
    const ownedHidden = analyzeAiDecision(player, context(room('score_charm', 'brimstone', true)));
    const otherHidden = analyzeAiDecision(player, context(room('score_charm', 'sacred_heart', true)));
    expect(ownedHidden.groupValues.B).toBe(otherHidden.groupValues.B);
    expect(ownedHidden.groupValues.B).toBeGreaterThan(0.08);
  });
});
