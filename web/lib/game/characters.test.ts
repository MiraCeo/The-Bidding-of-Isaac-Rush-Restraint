import { describe, expect, it } from 'vitest';

import {
  assignCharacter,
  characterOrder,
  getCharacterFloorStartingMoney,
  getCharacterStartingItems,
} from './characters';
import { createSeededRandom } from './random';
import { createRuntimePlayer } from './runtime';

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
});
