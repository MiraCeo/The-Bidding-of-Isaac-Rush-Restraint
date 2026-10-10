import { describe, expect, it } from 'vitest';
import { aiItemProfiles } from './ai-analysis';
import { getItemSubpool, itemCatalog } from './item-catalog';
import { itemPresentations } from './item-presentation';
import { roomDistributions } from './rooms';

describe('item expansion contract', () => {
  it('keeps IDs unique and every item covered by presentation and AI valuation', () => {
    expect(new Set(itemCatalog.map((item) => item.id)).size).toBe(itemCatalog.length);
    for (const item of itemCatalog) {
      expect(item.name.trim().length).toBeGreaterThan(0);
      expect(typeof item.effectStacks).toBe('boolean');
      expect(itemPresentations[item.id].description.trim().length).toBeGreaterThan(0);
      expect(itemPresentations[item.id].emoji.length).toBeGreaterThan(0);
      const profile = aiItemProfiles[item.id];
      expect(Number.isFinite(profile.strength)).toBe(true);
      expect(profile.strength).toBeGreaterThanOrEqual(0);
      expect(profile.strength).toBeLessThanOrEqual(1);
      expect(profile.types.length).toBeGreaterThan(0);
      expect(['immediate', 'short', 'long']).toContain(profile.horizon);
      for (const partner of profile.synergies ?? []) expect(itemCatalog.some((candidate) => candidate.id === partner)).toBe(true);
    }
  });

  it('keeps every configured draw subpool populated and weights normalized', () => {
    for (const distribution of Object.values(roomDistributions)) {
      expect(distribution.pools.reduce((sum, value) => sum + value.weight, 0)).toBeCloseTo(1, 10);
      expect(distribution.rarities.reduce((sum, value) => sum + value.weight, 0)).toBeCloseTo(1, 10);
      for (const pool of distribution.pools) {
        for (const rarity of distribution.rarities) {
          if (pool.weight > 0 && rarity.weight > 0) expect(getItemSubpool(pool.value, rarity.value).length).toBeGreaterThan(0);
        }
      }
    }
  });

  it('keeps the seven explicit non-stacking effects aligned with the item catalog', () => {
    const expected = ['brimstone', 'short_brimstone', 'lucky_foot', 'transcendence', 'more_options', 'more_options_question', 'guppys_tail'];
    expect(itemCatalog.filter((item) => !item.effectStacks).map((item) => item.id).sort())
      .toEqual(expected.sort());
  });
});
