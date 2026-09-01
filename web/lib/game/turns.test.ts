import { describe, expect, it } from 'vitest';

import { defaultRules } from './config';
import type { ItemId, RuntimePlayerState } from './item-types';
import { createRuntimePlayer } from './runtime';
import { getRuntimeActionAmounts, validateTurn } from './turns';

function playerWith(...itemIds: ItemId[]): RuntimePlayerState {
  const player = createRuntimePlayer({ id: 'p', money: 100, score: 0, isHuman: false });
  player.items = itemIds.map((itemId, index) => ({ instanceId: `i${index}`, itemId, acquiredOrder: index + 1 }));
  return player;
}

describe('runtime turns and item amount modifiers', () => {
  it('applies Steam Sale to actual cost and 20/20 to market value only', () => {
    const player = playerWith('steam_sale', 'twenty_twenty');
    expect(getRuntimeActionAmounts(player, { type: 'bid', group: 'A', amount: 80 }, defaultRules)).toEqual({
      actualCost: 56,
      marketEquivalent: 100,
      scoringEquivalent: 80,
    });
  });

  it('allows two bids only with More Options and at no more than half the nominal funds', () => {
    const player = playerWith('more_options');
    expect(
      validateTurn(
        player,
        {
          playerId: 'p',
          actions: [
            { type: 'bid', group: 'A', amount: 25 },
            { type: 'bid', group: 'B', amount: 25 },
          ],
        },
        defaultRules,
      ),
    ).toEqual([]);
    expect(
      validateTurn(
        player,
        {
          playerId: 'p',
          actions: [
            { type: 'bid', group: 'A', amount: 26 },
            { type: 'bid', group: 'B', amount: 25 },
          ],
        },
        defaultRules,
      ),
    ).toContain('双竞拍名义报价总和不能超过当前资金的 50%。');
  });

  it('treats two disruptions as independently capped actions', () => {
    const player = playerWith('more_options_question');
    expect(
      validateTurn(
        player,
        {
          playerId: 'p',
          actions: [
            { type: 'disrupt', group: 'A', amount: 50 },
            { type: 'disrupt', group: 'B', amount: 50 },
          ],
        },
        defaultRules,
      ),
    ).toEqual([]);
  });
});
