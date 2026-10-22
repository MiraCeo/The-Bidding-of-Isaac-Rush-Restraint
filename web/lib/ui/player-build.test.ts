import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { startClientGame } from '../game/client-session';
import { grantItemInstance } from '../game/runtime';
import type { ItemId } from '../game/item-types';
import { getBuildSummary, getQuotePreviews } from './player-build';
import { PlayerBuild } from '@/components/game/player-build';
import { defaultRules } from '../game/config';
import { getRuntimeActionAmounts } from '../game/turns';

function withItems(ids: ItemId[]) {
  const game = startClientGame('isaac', 42);
  const human = game.players.find((p) => p.isHuman)!;
  human.items = [];
  human.temporaryShields = 0;
  human.persistentShields = 0;
  ids.forEach((itemId, i) =>
    grantItemInstance(human, {
      itemId,
      instanceId: `test-${i}`,
      acquiredOrder: i,
    }),
  );
  return game;
}
describe('player inventory and quote presentation', () => {
  it('uses supplied rules consistently for market/scoring numbers and scoring intervals', () => {
    const game = withItems(['short_brimstone']);
    const player = game.players.find((p) => p.isHuman)!;
    const action = {
      type: 'disrupt' as const,
      group: 'A' as const,
      amount: 20,
    };
    const rules = {
      ...defaultRules,
      disruptionMarketMultiplier: 3,
      disruptionScoringMultiplier: 2,
    };
    const preview = getQuotePreviews(
      player,
      { playerId: player.id, actions: [action] },
      rules,
    )[0]!;
    expect(preview).toMatchObject(
      getRuntimeActionAmounts(player, action, rules),
    );
    expect(preview.scoringRange).toEqual([34, 48]);
  });
  it('shows combined additive effects without pretending conditional or random outcomes are known', () => {
    const game = withItems([
      'score_charm',
      'score_charm',
      'blood_of_the_martyr',
      'poor_charm',
    ]);
    const effects = getBuildSummary(game).effects;
    expect(effects.find((e) => e.label === '固定行动加算')?.value).toBe('+40');
    expect(effects.find((e) => e.label === '穷人护符条件加算')).toMatchObject({
      value: '+5 / +20',
    });
    expect(effects.find((e) => e.label === '本房确定性倍率')?.note).toContain(
      '随机触发',
    );
  });
  it('groups duplicates without losing instances or non-stacking inventory', () => {
    const game = withItems([
      'brimstone',
      'brimstone',
      'sacred_heart',
      'sacred_heart',
      'dark_princes_crown',
    ]);
    const summary = getBuildSummary(game);
    expect(summary.itemCount).toBe(5);
    expect(summary.inventory.map((v) => [v.count, v.effectiveCopies])).toEqual([
      [2, 1],
      [2, 2],
      [1, 1],
    ]);
    expect(summary.crownFactor).toBeCloseTo(1.2);
    expect(summary.human.items).toHaveLength(5);
  });
  it('uses remaining shield state, not the count of shield items', () => {
    const game = withItems(['holy_mantle', 'holy_mantle', 'wooden_cross']);
    const human = game.players[0]!;
    human.temporaryShields = 0;
    human.persistentShields = 0;
    expect(getBuildSummary(game)).toMatchObject({
      temporaryShields: 0,
      persistentShields: 0,
    });
    human.temporaryShields = 2;
    expect(getBuildSummary(game).temporaryShields).toBe(2);
  });
  it.each([
    [[], false, false],
    [['more_options'], true, false],
    [['more_options_question'], false, true],
    [['more_options', 'more_options_question'], true, true],
  ] as [ItemId[], boolean, boolean][])(
    'shows only granted double-action types for %s',
    (ids, bid, disrupt) => {
      expect(getBuildSummary(withItems(ids))).toMatchObject({
        canDoubleBid: bid,
        canDoubleDisrupt: disrupt,
        doubleMultiplier: 0.75,
      });
      expect(
        getBuildSummary(startClientGame('jacob_esau', 42)).doubleMultiplier,
      ).toBe(1);
    },
  );
  it('separates nominal, actual, market and scoring values, including discounts and ranges', () => {
    const game = withItems([
      'steam_sale',
      'steam_sale',
      'twenty_twenty',
      'brimstone',
      'short_brimstone',
    ]);
    const [bid, disrupt, withdraw] = getQuotePreviews(game.players[0]!, {
      playerId: 'human',
      actions: [
        { type: 'bid', group: 'A', amount: 20 },
        { type: 'disrupt', group: 'B', amount: 20 },
        { type: 'withdraw' },
      ],
    });
    expect(bid).toMatchObject({
      nominal: 20,
      actualCost: 10,
      marketEquivalent: 25,
      scoringEquivalent: 20,
      scoringRange: [16, 25],
    });
    expect(disrupt).toMatchObject({
      nominal: 20,
      actualCost: 20,
      marketEquivalent: 50,
      scoringEquivalent: 25,
      scoringRange: [21.25, 30],
    });
    expect(withdraw).toMatchObject({
      nominal: null,
      actualCost: 0,
      marketEquivalent: null,
      scoringEquivalent: null,
    });
  });
  it('does not render hidden room reward information or mutate the game', () => {
    const game = withItems(['holy_mantle']);
    game.rooms[0]![0]!.rewards.forEach((r) => {
      r.itemId = 'steam_sale';
      r.hidden = true;
    });
    const before = JSON.stringify(game);
    const html = renderToStaticMarkup(createElement(PlayerBuild, { game }));
    expect(html).toContain('神圣屏障');
    expect(html).not.toContain('Steam大促');
    expect(html).not.toContain('steam_sale');
    expect(JSON.stringify(game)).toBe(before);
  });
});
