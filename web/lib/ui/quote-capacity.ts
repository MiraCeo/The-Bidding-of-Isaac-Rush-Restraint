import { getRuntimeActionAmounts, validateTurn } from '../game/turns';
import { hasItem } from '../game/runtime';
import type { PlayerAction, RulesConfig } from '../game/types';
import type { RuntimePlayerState } from '../game/item-types';

export interface QuoteCapacityAmount {
  nominal: number;
  marketEquivalent: number;
  actualCost: number;
}

/** Public owned inventory + current money only, never a player's chosen turn. */
export function getQuoteCapacity(
  player: RuntimePlayerState,
  rules: RulesConfig,
) {
  const money = Math.max(0, Math.floor(player.money));
  const bidMaximum = money;
  const disruptMaximum = Math.min(
    money,
    Math.floor(player.money * rules.disruptionMaxMoneyRatio),
  );
  const resolve = (actions: PlayerAction[]): QuoteCapacityAmount => {
    if (!actions.length)
      return { nominal: 0, marketEquivalent: 0, actualCost: 0 };
    if (validateTurn(player, { playerId: player.id, actions }, rules).length)
      throw new Error('理论竞价能力计算产生了不合法的行动。');
    return actions.reduce(
      (sum, action) => {
        const amounts = getRuntimeActionAmounts(player, action, rules);
        return {
          nominal:
            sum.nominal + (action.type === 'withdraw' ? 0 : action.amount),
          marketEquivalent:
            sum.marketEquivalent + (amounts.marketEquivalent ?? 0),
          actualCost: sum.actualCost + amounts.actualCost,
        };
      },
      { nominal: 0, marketEquivalent: 0, actualCost: 0 },
    );
  };
  const single = (type: 'bid' | 'disrupt', amount: number) =>
    resolve(amount >= 1 ? [{ type, group: 'A', amount }] : []);
  const pair = (
    type: 'bid' | 'disrupt',
    total: number,
    eachMaximum: number,
  ) => {
    if (total < 2 || eachMaximum < 1) return null;
    const first = Math.min(eachMaximum, total - 1);
    return resolve([
      { type, group: 'A', amount: first },
      { type, group: 'B', amount: total - first },
    ]);
  };
  return {
    bid: single('bid', bidMaximum),
    disrupt: single('disrupt', disruptMaximum),
    doubleBid: hasItem(player, 'more_options')
      ? pair('bid', Math.floor(player.money * 0.5), bidMaximum)
      : null,
    doubleDisrupt: hasItem(player, 'more_options_question')
      ? pair('disrupt', Math.min(money, 2 * disruptMaximum), disruptMaximum)
      : null,
  };
}

export type QuoteCapacity = ReturnType<typeof getQuoteCapacity>;

const marketAmountFormat = new Intl.NumberFormat('zh-CN', {
  useGrouping: false,
  maximumFractionDigits: 4,
});

/** Compact display only. Preserve the full raw value in the element's title. */
export function formatMarketAmount(value: number): string {
  const display = marketAmountFormat.format(value);
  return Number(display) === value ? display : `≈${display}`;
}

export function capacityDescription(capacity: QuoteCapacity): string {
  const parts = [
    `单目标理论市场等价上限：竞拍 ${capacity.bid.marketEquivalent}，扰乱 ${capacity.disrupt.marketEquivalent}。`,
  ];
  if (capacity.doubleBid)
    parts.push(
      `双竞拍名义总额上限 ${capacity.doubleBid.nominal}，市场等价合计上限 ${capacity.doubleBid.marketEquivalent}。`,
    );
  if (capacity.doubleDisrupt)
    parts.push(
      `双扰乱名义总额上限 ${capacity.doubleDisrupt.nominal}，市场等价合计上限 ${capacity.doubleDisrupt.marketEquivalent}。`,
    );
  parts.push('这些是可选行动的能力边界，不代表本房实际出价或获奖。');
  return parts.join('');
}
