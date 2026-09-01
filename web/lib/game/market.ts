import { getActionAmounts } from './actions';
import type { MarketBaseline, RulesConfig, SubmittedAction } from './types';

function roundTo(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

export function calculateMarketBaseline(
  submissions: readonly SubmittedAction[],
  floorIndex: number,
  rules: RulesConfig,
): MarketBaseline | null {
  const floorStartingMoney = rules.floorStartingMoney[floorIndex];
  if (floorStartingMoney === undefined) {
    throw new RangeError(`不存在第 ${floorIndex + 1} 层的资金配置。`);
  }

  const marketValues = submissions.flatMap((submission) => {
    const marketEquivalent = getActionAmounts(submission.action, rules).marketEquivalent;
    return marketEquivalent === null ? [] : [marketEquivalent];
  });

  if (marketValues.length === 0) return null;

  const totalMarketEquivalent = marketValues.reduce((total, value) => total + value, 0);
  const meanMarketBid = roundTo(totalMarketEquivalent / marketValues.length, 4);
  const floorConstant = roundTo(floorStartingMoney * rules.targetConstantRatio, 4);

  return {
    participantCount: marketValues.length,
    totalMarketEquivalent,
    meanMarketBid,
    floorConstant,
    target: roundTo(rules.baselineMeanMultiplier * meanMarketBid + floorConstant, 4),
  };
}
