import { describe, expect, it } from 'vitest';

import {
  assignCharacter,
  characterOrder,
  getCharacterFloorStartingMoney,
  getCharacterStartingItems,
} from './characters';
import { createSeededRandom } from './random';
import { createRuntimePlayer } from './runtime';
import { itemCatalog } from './item-catalog';
import { defaultRules } from './config';
import { preparePlayersForRoom } from './room-economy';
import { settleRuntimeRoom } from './room-engine';

function edenWithStartingCross() {
  const pool = itemCatalog.filter((item) => item.id !== 'grab_bag');
  const crossIndex = pool.findIndex((item) => item.id === 'wooden_cross');
  let draws = 0;
  return assignCharacter(
    createRuntimePlayer({ id: 'eden', money: 0, score: 0, isHuman: true }),
    'eden',
    { next: () => draws++ === 0 ? (crossIndex + 0.5) / pool.length : 0 },
  );
}

describe('character system', () => {
  it('defines the five initial characters', () => {
    expect(characterOrder).toEqual(['isaac', 'lost', 'azazel', 'eden', 'jacob_esau']);
  });

  it('assigns each fixed character its starting items', () => {
    const random = createSeededRandom(1);
    expect(getCharacterStartingItems('isaac', random)).toEqual(['d6']);
    expect(getCharacterStartingItems('lost', random)).toEqual(['holy_mantle', 'eternal_d6']);
    expect(getCharacterStartingItems('azazel', random)).toEqual(['brimstone']);
    expect(getCharacterStartingItems('jacob_esau', random)).toEqual([
      'more_options',
      'more_options_question',
    ]);
  });

  it('gives Eden two distinct items and never gives a Grab Bag', () => {
    for (let seed = 0; seed < 200; seed += 1) {
      const items = getCharacterStartingItems('eden', createSeededRandom(seed));
      expect(items).toHaveLength(2);
      expect(new Set(items).size).toBe(2);
      expect(items).not.toContain('grab_bag');
    }
  });

  it('stores the selected character and initial inventory on the runtime player', () => {
    const base = createRuntimePlayer({ id: 'p', money: 0, score: 0, isHuman: false });
    const assigned = assignCharacter(base, 'lost', createSeededRandom(1));
    expect(assigned.characterId).toBe('lost');
    expect(assigned.items.map((item) => item.itemId)).toEqual(['holy_mantle', 'eternal_d6']);
    expect(base.characterId).toBeNull();
  });

  it('applies character floor-money traits without creating item instances', () => {
    const player = createRuntimePlayer({ id: 'p', money: 0, score: 0, isHuman: false });
    player.characterId = 'isaac';
    expect(getCharacterFloorStartingMoney(player, 100, { next: () => 0.5 })).toBe(110);
    player.characterId = 'jacob_esau';
    expect(getCharacterFloorStartingMoney(player, 500, { next: () => 0.5 })).toBe(600);
    player.characterId = 'eden';
    expect(getCharacterFloorStartingMoney(player, 1000, { next: () => 0 })).toBe(900);
    expect(getCharacterFloorStartingMoney(player, 1000, { next: () => 0.5 })).toBe(1000);
    expect(getCharacterFloorStartingMoney(player, 1000, { next: () => 0.999 })).toBe(1100);
    expect(player.items).toEqual([]);
  });

  it('grants Eden a persistent shield immediately for a starting Wooden Cross', () => {
    const assigned = edenWithStartingCross();
    expect(assigned.items.filter((item) => item.itemId === 'wooden_cross')).toHaveLength(1);
    expect(assigned.persistentShields).toBe(1);

    const firstRoom = preparePlayersForRoom([assigned], 0, 0, defaultRules, { next: () => 0.5 });
    const nextFloor = preparePlayersForRoom(firstRoom.players, 1, 0, defaultRules, { next: () => 0.5 });
    expect(firstRoom.players[0]?.persistentShields).toBe(1);
    expect(nextFloor.players[0]?.persistentShields).toBe(1);
  });

  it('uses a starting cross for a failed first-room bid and never regenerates it', () => {
    const prepared = preparePlayersForRoom(
      [edenWithStartingCross()], 0, 0, defaultRules, { next: () => 0.5 },
    ).players[0]!;
    const winner = createRuntimePlayer({ id: 'winner', money: 100, score: 0, isHuman: false });
    const settled = settleRuntimeRoom(
      {
        floorIndex: 0, roomIndex: 0, kind: 'normal',
        rewards: [
          { group: 'A', itemId: 'score_charm', hidden: false },
          { group: 'B', itemId: 'interest', hidden: false },
        ],
      },
      [prepared, winner],
      [
        { playerId: 'eden', actions: [{ type: 'bid', group: 'A', amount: 10 }] },
        { playerId: 'winner', actions: [{ type: 'bid', group: 'A', amount: 50 }] },
      ],
      defaultRules,
      { next: () => 0.5 },
    );
    const after = settled.players.find((player) => player.id === 'eden')!;
    expect(after.money).toBe(prepared.money);
    expect(after.persistentShields).toBe(0);
    expect(settled.events).toContainEqual(expect.objectContaining({
      type: 'refund', playerId: 'eden', itemId: 'wooden_cross', amount: 10,
    }));
    expect(preparePlayersForRoom([after], 0, 1, defaultRules, { next: () => 0.5 })
      .players[0]?.persistentShields).toBe(0);
    expect(preparePlayersForRoom([after], 1, 0, defaultRules, { next: () => 0.5 })
      .players[0]?.persistentShields).toBe(0);
  });

  it('does not double-grant starting Holy Mantle shields when the first floor starts', () => {
    const base = createRuntimePlayer({ id: 'lost', money: 0, score: 0, isHuman: false });
    const assigned = assignCharacter(base, 'lost', createSeededRandom(1));
    expect(assigned.temporaryShields).toBe(1);
    const prepared = preparePlayersForRoom([assigned], 0, 0, defaultRules, createSeededRandom(2));
    expect(prepared.players[0]?.temporaryShields).toBe(1);
    expect(base.items).toEqual([]);
    expect(base.temporaryShields).toBe(0);
  });
});
