import type { PlayerTurn, ResolvedAction, RuntimePlayerState } from './item-types';
import { roundMoney } from './money';
import { countItem, hasItem } from './runtime';
import type { PlayerAction, RulesConfig } from './types';

export function getRuntimeActionAmounts(
  player: RuntimePlayerState,
  action: PlayerAction,
  rules: RulesConfig,
): Omit<ResolvedAction, 'playerId' | 'action' | 'actionIndex'> {
  if (action.type === 'withdraw') {
    return { actualCost: 0, marketEquivalent: null, scoringEquivalent: null };
  }
  if (action.type === 'bid') {
    const steamSales = countItem(player, 'steam_sale');
    const perfectVision = countItem(player, 'twenty_twenty');
    return {
      actualCost: roundMoney(action.amount * 0.7 ** steamSales),
      marketEquivalent: action.amount * 1.25 ** perfectVision,
      scoringEquivalent: action.amount,
    };
  }
  return {
    actualCost: roundMoney(action.amount),
    marketEquivalent: action.amount * rules.disruptionMarketMultiplier,
    scoringEquivalent: action.amount * rules.disruptionScoringMultiplier,
  };
}

function validateAmount(player: RuntimePlayerState, action: PlayerAction, rules: RulesConfig): string[] {
  if (action.type === 'withdraw') return [];
  const errors: string[] = [];
  if (!Number.isFinite(action.amount) || !Number.isInteger(action.amount)) {
    errors.push('出价必须是有限整数。');
  }
  if (action.amount <= 0) errors.push('出价必须大于 0。');
  if (action.amount > player.money) errors.push('出价不能超过当前资金。');
  if (
    action.type === 'disrupt' &&
    action.amount > Math.floor(player.money * rules.disruptionMaxMoneyRatio)
  ) {
    errors.push('扰乱出价不能超过行动前资金的 50%。');
  }
  return errors;
}

export function validateTurn(
  player: RuntimePlayerState,
  turn: PlayerTurn,
  rules: RulesConfig,
): string[] {
  if (turn.playerId !== player.id) return ['行动玩家与玩家状态不匹配。'];
  if (turn.actions.length < 1 || turn.actions.length > 2) return ['每回合必须提交一至两份行动。'];
  const errors = turn.actions.flatMap((action) => validateAmount(player, action, rules));
  if (turn.actions.length === 1) return errors;

  const [first, second] = turn.actions;
  if (!first || !second || first.type === 'withdraw' || second.type === 'withdraw') {
    return [...errors, '静观其变不能与其他行动同时提交。'];
  }
  if (first.type !== second.type || first.group === second.group) {
    return [...errors, '双行动必须是分别面向 A、B 的同类行动。'];
  }
  if (first.type === 'bid') {
    if (!hasItem(player, 'more_options')) errors.push('只有持有更多选择才能进行双竞拍。');
    if (first.amount + second.amount > Math.floor(player.money * 0.5)) {
      errors.push('双竞拍名义报价总和不能超过当前资金的 50%。');
    }
  } else if (!hasItem(player, 'more_options_question')) {
    errors.push('只有持有更多选择?才能进行双扰乱。');
  }

  const totalCost = turn.actions.reduce(
    (sum, action) => sum + getRuntimeActionAmounts(player, action, rules).actualCost,
    0,
  );
  if (totalCost > player.money) errors.push('行动的实际总扣款不能超过当前资金。');
  return errors;
}

export function resolveTurnActions(
  player: RuntimePlayerState,
  turn: PlayerTurn,
  rules: RulesConfig,
): ResolvedAction[] {
  return turn.actions.map((action, actionIndex) => ({
    playerId: player.id,
    action,
    actionIndex,
    ...getRuntimeActionAmounts(player, action, rules),
  }));
}
