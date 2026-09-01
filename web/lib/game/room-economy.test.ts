import { describe, expect, it } from 'vitest';

import { defaultRules } from './config';
import type { ItemId, RuntimePlayerState } from './item-types';
import { createRuntimePlayer } from './runtime';
import { preparePlayersForRoom } from './room-economy';

function playerWith(...itemIds: ItemId[]): RuntimePlayerState {
  const player = createRuntimePlayer({ id: 'p', money: 12, score: 0, isHuman: false });
  player.items = itemIds.map((itemId, index) => ({ instanceId: `i${index}`, itemId, acquiredOrder: index + 1 }));
  return player;
}

function queuedRandom(...values: number[]) {
  let index = 0;
  return { next: () => values[index++] ?? 0.5 };
}

describe('room transition economy', () => {
  it('applies 10% next-floor interest and 5% room interest without a Poor Charm deduction', () => {
    const result = preparePlayersForRoom(
      [playerWith('interest', 'poor_charm')],
      1,
      0,
      defaultRules,
      { next: () => 0.99 },
    );
    // 500 -> 550 next-floor interest -> 578 room interest; Poor Charm no longer deducts money.
    expect(result.players[0]?.money).toBe(578);
  });

  it('refreshes temporary shields while preserving persistent shields', () => {
    const player = playerWith('holy_mantle', 'holy_mantle');
    player.temporaryShields = 8;
    player.persistentShields = 2;
    const result = preparePlayersForRoom([player], 1, 0, defaultRules, { next: () => 0.99 });
    expect(result.players[0]?.temporaryShields).toBe(2);
    expect(result.players[0]?.persistentShields).toBe(2);
  });

  it('draws Eden floor money independently on each floor', () => {
    const eden = playerWith();
    eden.characterId = 'eden';
    const random = queuedRandom(0, 0.999);
    const firstFloor = preparePlayersForRoom([eden], 0, 0, defaultRules, random).players[0]!;
    const secondFloor = preparePlayersForRoom([firstFloor], 1, 0, defaultRules, random).players[0]!;
    expect(firstFloor.money).toBe(90);
    expect(secondFloor.money).toBe(550);
  });

  it('applies an acquired Interest after the character floor-money trait', () => {
    const isaac = playerWith('interest');
    isaac.characterId = 'isaac';
    const result = preparePlayersForRoom([isaac], 1, 0, defaultRules, queuedRandom(0.5));
    // 500 -> 550 character trait -> 605 next-floor Interest -> 635 room Interest.
    expect(result.players[0]?.money).toBe(635);
  });

  it('steals 5% of the adjacent ranked player money for each Money Bag', () => {
    const owner = createRuntimePlayer({ id: 'owner', money: 50, score: 0, isHuman: false });
    owner.items = [{ instanceId: 'bag', itemId: 'money_bag', acquiredOrder: 1 }];
    const leader = createRuntimePlayer({ id: 'leader', money: 100, score: 0, isHuman: false });
    const result = preparePlayersForRoom([owner, leader], 0, 1, defaultRules, { next: () => 0.99 });
    expect(result.players.find((player) => player.id === 'owner')?.money).toBe(55);
    expect(result.players.find((player) => player.id === 'leader')?.money).toBe(95);
  });
});
