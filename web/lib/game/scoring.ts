import { getActionAmounts } from './actions';
import type { BaseScoreResult, PlayerAction, RulesConfig } from './types';

function roundTo(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

export function calculateBaseScore(
  action: PlayerAction,
  target: number,
  floorIndex: number,
  rules: RulesConfig,
): BaseScoreResult {
  const floorStartingMoney = rules.floorStartingMoney[floorIndex];
  if (floorStartingMoney === undefined) {
    throw new RangeError(`不存在第 ${floorIndex + 1} 层的资金配置。`);
  }

  const sigma = floorStartingMoney * rules.scoreSigmaRatio;
  if (sigma <= 0) throw new RangeError('积分曲线的 σ 必须大于 0。');

  const scoringEquivalent = getActionAmounts(action, rules).scoringEquivalent;
  if (scoringEquivalent === null) {
    return { scoringEquivalent: null, distance: null, sigma, score: 0 };
  }

  const distance = Math.abs(scoringEquivalent - target);
  return {
    scoringEquivalent,
    distance,
    sigma,
    score: roundTo(rules.maximumBaseScore * Math.exp(-distance / sigma), rules.scoreStorageDecimals),
  };
}
