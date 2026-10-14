import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { ItemBadges } from '@/components/game/item-badges';
import { RoomPrototype } from '@/components/game/room-prototype';
import { startClientGame } from '../game/client-session';
import { getItemDefinition, itemCatalog } from '../game/item-catalog';
import type { ItemId } from '../game/item-types';
import { defaultGamePreferences } from './game-preferences';
import { getItemBadges } from './item-badges';

describe('semantic item capsules', () => {
  it('covers every catalog item with independent pool, rarity, effect and stacking labels', () => {
    for (const item of itemCatalog) {
      const badges = getItemBadges(item);
      expect(badges.filter((badge) => badge.kind === 'pool')).toHaveLength(1);
      expect(badges.filter((badge) => badge.kind === 'rarity')).toHaveLength(1);
      expect(
        badges.filter((badge) => badge.kind === 'effect').length,
      ).toBeGreaterThan(0);
      expect(badges.filter((badge) => badge.kind === 'stacking')).toHaveLength(
        1,
      );
      expect(
        new Set(badges.map((badge) => `${badge.kind}:${badge.label}`)).size,
      ).toBe(badges.length);
    }
  });

  it('uses different colors for the four scoring effects shown in the screenshot', () => {
    const ids: ItemId[] = [
      'moms_knife',
      'sacred_heart',
      'brimstone',
      'moms_heart',
    ];
    const effects = ids.map((id) =>
      getItemBadges(getItemDefinition(id)).find(
        (badge) => badge.kind === 'effect',
      )!,
    );
    expect(effects.map((badge) => badge.label)).toEqual([
      '积分加算',
      '积分倍率',
      '计分修正',
      'BOSS增益',
    ]);
    expect(new Set(effects.map((badge) => badge.tone)).size).toBe(4);
  });

  it('differentiates stacking states using the catalog rather than guessed descriptions', () => {
    const stack = getItemBadges(getItemDefinition('sacred_heart')).find(
      (badge) => badge.kind === 'stacking',
    )!;
    const single = getItemBadges(getItemDefinition('brimstone')).find(
      (badge) => badge.kind === 'stacking',
    )!;
    expect(stack.label).toBe('效果可叠加');
    expect(single.label).toBe('效果不叠加');
    expect(stack.tone).not.toBe(single.tone);
    expect(
      itemCatalog.filter((item) =>
        getItemBadges(item).some((badge) => badge.label === '效果不叠加'),
      ),
    ).toHaveLength(7);
  });

  it('keeps mixed effects explicit instead of treating money thresholds as a money gain', () => {
    const eternal = getItemBadges(getItemDefinition('eternal_d6')).filter(
      (badge) => badge.kind === 'effect',
    );
    expect(eternal.map((badge) => badge.label)).toEqual([
      '积分倍率',
      '清零风险',
      '随机触发',
    ]);
    expect(
      getItemBadges(getItemDefinition('poor_charm'))
        .filter((badge) => badge.kind === 'effect')
        .map((badge) => badge.label),
    ).toEqual(['积分加算']);
  });

  it('reads metadata from the passed definition without mutating game catalog data', () => {
    const before = structuredClone(itemCatalog);
    const modified = {
      ...getItemDefinition('sacred_heart'),
      pool: 'common' as const,
      rarity: 'normal' as const,
      effectStacks: false,
    };
    expect(
      getItemBadges(modified)
        .filter((badge) => badge.kind !== 'effect')
        .map((badge) => badge.label),
    ).toEqual(['常见', '普通', '效果不叠加']);
    expect(itemCatalog).toEqual(before);
  });

  it('renders a separate capsule for each label and retains text so color is not the only cue', () => {
    const html = renderToStaticMarkup(
      createElement(ItemBadges, { item: getItemDefinition('brimstone') }),
    );
    expect(html).toContain('aria-label="道具标签"');
    expect(html.match(/<li /g)).toHaveLength(4);
    expect(html).toContain('item-badge-cyan');
    expect(html).toContain('效果不叠加');
    expect(html).not.toContain(' · ');
  });

  it('uses only two compact metadata capsules on the reward card', () => {
    const html = renderToStaticMarkup(
      createElement(ItemBadges, {
        item: getItemDefinition('sacred_heart'),
        compact: true,
      }),
    );
    expect(html.match(/<li /g)).toHaveLength(2);
    expect(html).not.toContain('积分倍率');
  });

  it('never emits specific item capsules for hidden room rewards', () => {
    const game = startClientGame('isaac', 7);
    game.rooms[0]![0]!.rewards.forEach((reward) => {
      reward.hidden = true;
    });
    const html = renderToStaticMarkup(
      createElement(RoomPrototype, {
        game,
        onSubmit: () => {},
        preferences: { ...defaultGamePreferences },
        preferenceSaveStatus: 'unchanged',
        onPreferencesChange: () => {},
      }),
    );
    expect(html).toContain('宝箱房隐藏奖励');
    expect(html).not.toContain('aria-label="道具标签"');
  });
});
