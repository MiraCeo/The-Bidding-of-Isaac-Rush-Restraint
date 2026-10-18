import { describe, expect, it } from 'vitest';
import { createRuntimePlayer } from '../game/runtime';
import { getRuntimeActionAmounts, validateTurn } from '../game/turns';
import { defaultRules } from '../game/config';
import type { ItemId } from '../game/item-types';
import type { PlayerAction } from '../game/types';
import {
  getQuoteCapacity,
  capacityDescription,
  formatMarketAmount,
} from './quote-capacity';

const player = (money: number, items: ItemId[] = []) => ({
  ...createRuntimePlayer({ id: 'p', money, score: 0, isHuman: false }),
  items: items.map((itemId, i) => ({
    itemId,
    instanceId: `i${i}`,
    acquiredOrder: i,
  })),
});
describe('public theoretical market capability, not chosen bids', () => {
  it('applies nominal funds and integer disruption limits, not a shared arbitrary graph scale', () => {
    const cap = getQuoteCapacity(player(101), defaultRules);
    expect(cap.bid).toEqual({
      nominal: 101,
      actualCost: 101,
      marketEquivalent: 101,
    });
    expect(cap.disrupt).toEqual({
      nominal: 50,
      actualCost: 50,
      marketEquivalent: 125,
    });
    expect(cap.doubleBid).toBeNull();
    expect(cap.doubleDisrupt).toBeNull();
  });
  it('stacks perfect vision but never turns a Steam discount into extra nominal funds', () => {
    const p = player(100, [
      'steam_sale',
      'steam_sale',
      'twenty_twenty',
      'twenty_twenty',
    ]);
    const before = structuredClone(p),
      cap = getQuoteCapacity(p, defaultRules);
    expect(cap.bid).toEqual({
      nominal: 100,
      actualCost: 49,
      marketEquivalent: 156.25,
    });
    expect(cap.disrupt).toEqual({
      nominal: 50,
      actualCost: 50,
      marketEquivalent: 125,
    });
    expect(p).toEqual(before);
    expect(
      validateTurn(
        p,
        { playerId: 'p', actions: [{ type: 'bid', group: 'A', amount: 101 }] },
        defaultRules,
      ).length,
    ).toBeGreaterThan(0);
  });
  it.each([0, 1, 3])(
    'represents insufficient funds honestly, money=%s',
    (money) => {
      const cap = getQuoteCapacity(
        player(money, ['more_options', 'more_options_question']),
        defaultRules,
      );
      expect(cap.bid.nominal).toBe(money);
      expect(cap.disrupt.nominal).toBe(Math.floor(money * 0.5));
      expect(cap.doubleBid).toBeNull();
      if (money < 2) expect(cap.doubleDisrupt).toBeNull();
    },
  );
  it('uses separate double-action total restrictions without adding two single-bid maxima', () => {
    const cap = getQuoteCapacity(
      player(101, ['more_options', 'more_options_question', 'twenty_twenty']),
      defaultRules,
    );
    expect(cap.doubleBid).toEqual({
      nominal: 50,
      actualCost: 50,
      marketEquivalent: 62.5,
    });
    expect(cap.doubleDisrupt).toEqual({
      nominal: 100,
      actualCost: 100,
      marketEquivalent: 250,
    });
    expect(capacityDescription(cap)).toContain('双竞拍名义总额上限 50');
  });
  it('honors supplied rule limits and multipliers, including a total-cost bound for double disruption', () => {
    const rules = {
      ...defaultRules,
      disruptionMaxMoneyRatio: 0.75,
      disruptionMarketMultiplier: 3,
    };
    const cap = getQuoteCapacity(player(7, ['more_options_question']), rules);
    expect(cap.disrupt).toEqual({
      nominal: 5,
      actualCost: 5,
      marketEquivalent: 15,
    });
    expect(cap.doubleDisrupt).toEqual({
      nominal: 7,
      actualCost: 7,
      marketEquivalent: 21,
    });
  });
  it('matches exhaustive valid single and double market maxima on a small-money matrix', () => {
    for (const money of Array.from({ length: 13 }, (_, i) => i))
      for (const modifiers of [
        [],
        ['twenty_twenty'],
        ['steam_sale', 'twenty_twenty'],
      ] as ItemId[][]) {
        const p = player(money, [
          ...modifiers,
          'more_options',
          'more_options_question',
        ]);
        const cap = getQuoteCapacity(p, defaultRules);
        for (const kind of ['bid', 'disrupt'] as const) {
          let maxSingle = 0,
            maxDouble: number | null = null;
          const market = (actions: PlayerAction[]) =>
            actions.reduce(
              (n, a) =>
                n +
                (getRuntimeActionAmounts(p, a, defaultRules).marketEquivalent ??
                  0),
              0,
            );
          for (let a = 1; a <= money; a++) {
            const single: PlayerAction[] = [
              { type: kind, group: 'A', amount: a },
            ];
            if (
              !validateTurn(p, { playerId: 'p', actions: single }, defaultRules)
                .length
            )
              maxSingle = Math.max(maxSingle, market(single));
            for (let b = 1; b <= money; b++) {
              const actions: PlayerAction[] = [
                ...single,
                { type: kind, group: 'B', amount: b },
              ];
              if (
                !validateTurn(p, { playerId: 'p', actions }, defaultRules)
                  .length
              )
                maxDouble = Math.max(maxDouble ?? 0, market(actions));
            }
          }
          expect(cap[kind].marketEquivalent).toBeCloseTo(maxSingle, 12);
          const paired = kind === 'bid' ? cap.doubleBid : cap.doubleDisrupt;
          if (maxDouble === null) expect(paired).toBeNull();
          else expect(paired!.marketEquivalent).toBeCloseTo(maxDouble, 12);
        }
      }
  });
});

it('marks rounded market displays as approximate while keeping exact short values plain', () => {
  expect(formatMarketAmount(1.23456)).toBe('≈1.2346');
  expect(formatMarketAmount(156.25)).toBe('156.25');
});
