import { describe, expect, it } from 'vitest';

import { defaultRules } from './config';
import type { ItemId, RuntimePlayerState } from './item-types';
import { calculateFinalScore, calculateTurnScore } from './item-scoring';
import { createRuntimePlayer } from './runtime';
import { resolveTurnActions } from './turns';

const noRandom = { next: () => 0.99 };

function playerWith(...itemIds: ItemId[]): RuntimePlayerState {
  const player = createRuntimePlayer({ id: 'p', money: 100, score: 100, isHuman: false });
  player.items = itemIds.map((itemId, index) => ({ instanceId: `i${index}`, itemId, acquiredOrder: index + 1 }));
  return player;
}

describe('item-adjusted scoring', () => {
  it('applies the configured room multiplier to the complete room score', () => {
    const player = playerWith();
    const actions = resolveTurnActions(
      player,
      { playerId: 'p', actions: [{ type: 'bid', group: 'A', amount: 30 }] },
      defaultRules,
    );
    const expectedScores = {
      normal: 100,
      treasure: 150,
      shop: 100,
      hidden: 200,
      boss: 200,
    } as const;

    for (const [roomKind, expectedScore] of Object.entries(expectedScores)) {
      const result = calculateTurnScore(
        player,
        actions,
        30,
        30,
        0,
        roomKind as keyof typeof expectedScores,
        defaultRules,
        noRandom,
      );
      expect(result.score).toBe(expectedScore);
    }
  });

  it('lets Brimstone choose the best scoring value without changing the submitted bid', () => {
    const player = playerWith('brimstone');
    const actions = resolveTurnActions(
      player,
      { playerId: 'p', actions: [{ type: 'bid', group: 'A', amount: 80 }] },
      defaultRules,
    );
    const result = calculateTurnScore(player, actions, 100, 100, 0, 'normal', defaultRules, noRandom);
    expect(result.actions[0]?.scoringValue).toBe(100);
    expect(result.score).toBe(100);
  });

  it('uses the highest market-equivalent sample for Moms Knife', () => {
    const player = playerWith('moms_knife');
    const actions = resolveTurnActions(
      player,
      { playerId: 'p', actions: [{ type: 'bid', group: 'A', amount: 50 }] },
      defaultRules,
    );
    const result = calculateTurnScore(player, actions, 50, 200, 0, 'normal', defaultRules, noRandom);
    expect(result.actions[0]?.additiveScore).toBe(50);
    expect(result.score).toBe(150);
  });

  it('lets Jacob and Esau ignore the More Options double-action score penalty', () => {
    const normalPlayer = playerWith('more_options');
    const jacobEsau = playerWith('more_options');
    jacobEsau.characterId = 'jacob_esau';
    const turn = {
      playerId: 'p',
      actions: [
        { type: 'bid' as const, group: 'A' as const, amount: 30 },
        { type: 'bid' as const, group: 'B' as const, amount: 30 },
      ],
    };
    const normalResult = calculateTurnScore(
      normalPlayer,
      resolveTurnActions(normalPlayer, turn, defaultRules),
      30,
      30,
      0,
      'normal',
      defaultRules,
      noRandom,
    );
    const jacobEsauResult = calculateTurnScore(
      jacobEsau,
      resolveTurnActions(jacobEsau, turn, defaultRules),
      30,
      30,
      0,
      'normal',
      defaultRules,
      noRandom,
    );
    expect(normalResult.multiplier).toBe(0.75);
    expect(normalResult.score).toBe(150);
    expect(jacobEsauResult.multiplier).toBe(1);
    expect(jacobEsauResult.score).toBe(200);
  });

  it('stacks Black Prince Crown final multipliers without crowns penalizing each other', () => {
    const player = playerWith('dark_princes_crown', 'dark_princes_crown');
    expect(calculateFinalScore(player)).toBeCloseTo(196);
  });

  it('reduces each Black Prince Crown bonus by five percentage points per other item', () => {
    const player = playerWith('dark_princes_crown', 'd6', 'interest');
    expect(calculateFinalScore(player)).toBeCloseTo(130);
  });

  it('does not count character traits as Black Prince Crown items', () => {
    const player = playerWith('dark_princes_crown');
    player.characterId = 'jacob_esau';
    expect(calculateFinalScore(player)).toBeCloseTo(140);
  });
});
