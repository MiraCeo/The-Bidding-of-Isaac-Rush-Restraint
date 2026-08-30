import type { ActionAmounts, PlayerAction, PlayerState, RulesConfig } from './types';

export function validateAction(
  player: PlayerState,
  action: PlayerAction,
  rules: RulesConfig,
): string[] {
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

export function getActionAmounts(action: PlayerAction, rules: RulesConfig): ActionAmounts {
  if (action.type === 'withdraw') {
    return { actualCost: 0, marketEquivalent: null, scoringEquivalent: null };
  }

  if (action.type === 'bid') {
    return {
      actualCost: action.amount,
      marketEquivalent: action.amount,
      scoringEquivalent: action.amount,
    };
  }

  return {
    actualCost: action.amount,
    marketEquivalent: action.amount * rules.disruptionMarketMultiplier,
    scoringEquivalent: action.amount * rules.disruptionScoringMultiplier,
  };
}
