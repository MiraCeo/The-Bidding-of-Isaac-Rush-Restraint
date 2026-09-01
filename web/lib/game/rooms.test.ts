import { describe, expect, it } from 'vitest';

import { itemCatalog } from './item-catalog';
import { createSeededRandom } from './random';
import { generateFloor } from './rooms';

describe('room and item generation', () => {
  it('contains the formal first set of 26 items in all six subpools', () => {
    expect(itemCatalog).toHaveLength(26);
    const counts = Object.fromEntries(
      ['common:normal', 'common:rare', 'boss:normal', 'boss:rare', 'curse:normal', 'curse:rare'].map(
        (key) => [
          key,
          itemCatalog.filter((item) => `${item.pool}:${item.rarity}` === key).length,
        ],
      ),
    );
    expect(counts).toEqual({
      'common:normal': 5,
      'common:rare': 5,
      'boss:normal': 4,
      'boss:rare': 6,
      'curse:normal': 3,
      'curse:rare': 3,
    });
    expect(itemCatalog.find((item) => item.id === 'holy_mantle')?.rarity).toBe('rare');
    expect(itemCatalog.find((item) => item.id === 'transcendence')?.rarity).toBe('normal');
  });

  it('generates five rooms with distinct A/B rewards and a hidden treasure B', () => {
    const rooms = generateFloor(0, createSeededRandom(42));
    expect(rooms).toHaveLength(5);
    expect(rooms[1]?.kind).toBe('treasure');
    expect(rooms[1]?.rewards[1].hidden).toBe(true);
    expect(rooms[3]?.kind).toBe('shop');
    expect(rooms[4]?.kind).toBe('boss');
    for (const room of rooms) expect(room.rewards[0].itemId).not.toBe(room.rewards[1].itemId);
  });

  it('uses two Moms Hearts as the only same-room duplicate exception', () => {
    const boss = generateFloor(2, createSeededRandom(7))[4];
    expect(boss?.rewards.map((reward) => reward.itemId)).toEqual(['moms_heart', 'moms_heart']);
  });
});
