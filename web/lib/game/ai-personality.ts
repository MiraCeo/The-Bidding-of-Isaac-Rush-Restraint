import { aiItemProfiles, type AiAnalysisResult, type AiDecisionContext } from './ai-analysis';
import type { AiStrategy, AiStrategyWeights } from './ai-decision';
import type { RandomSource, RewardGroup } from './types';

export type AiPersonality =
  | 'stable'
  | 'disruptive'
  | 'cautious'
  | 'aggressive'
  | 'follower'
  | 'rebellious'
  | 'common_good'
  | 'generous'
  | 'steady'
  | 'retreating'
  | 'impulsive'
  | 'speculative'
  | 'conservative'
  | 'vain'
  | 'greedy'
  | 'adaptive'
  | 'rational'
  | 'arrogant'
  | 'all_in'
  | 'stubborn'
  | 'gambler';

export const initialAiPersonalityOrder: readonly AiPersonality[] = [
  'stable',
  'disruptive',
  'cautious',
  'aggressive',
  'follower',
  'rebellious',
  'common_good',
  'generous',
  'steady',
  'retreating',
  'impulsive',
  'speculative',
  'conservative',
  'vain',
  'greedy',
];

export const implementedAiPersonalityOrder: readonly AiPersonality[] = [
  ...initialAiPersonalityOrder,
  'adaptive',
  'rational',
  'arrogant',
  'all_in',
  'stubborn',
  'gambler',
];

export const aiPersonalityOrder: readonly AiPersonality[] = implementedAiPersonalityOrder.filter(
  (personality) => personality !== 'all_in',
);

export const aiPersonalityNames: Readonly<Record<AiPersonality, string>> = {
  stable: '稳定',
  disruptive: '扰乱',
  cautious: '谨慎',
  aggressive: '冒进',
  follower: '跟风',
  rebellious: '叛逆',
  common_good: '共赢',
  generous: '慷慨',
  steady: '稳健',
  retreating: '退让',
  impulsive: '冲动',
  speculative: '投机',
  conservative: '守旧',
  vain: '虚荣',
  greedy: '贪婪',
  adaptive: '适应',
  rational: '理智',
  arrogant: '傲慢',
  all_in: '孤注一掷',
  stubborn: '固执',
  gambler: '赌徒',
};

const conflicts: Readonly<Record<AiPersonality, readonly AiPersonality[]>> = {
  stable: ['disruptive'],
  disruptive: ['stable', 'common_good', 'generous'],
  cautious: ['aggressive', 'impulsive', 'all_in', 'gambler'],
  aggressive: ['cautious', 'retreating'],
  follower: ['rebellious'],
  rebellious: ['follower'],
  common_good: ['disruptive'],
  generous: ['disruptive'],
  steady: [],
  retreating: ['aggressive', 'impulsive', 'all_in'],
  impulsive: ['cautious', 'retreating'],
  speculative: ['conservative', 'stubborn'],
  conservative: ['speculative'],
  vain: [],
  greedy: [],
  adaptive: ['arrogant'],
  rational: ['arrogant', 'all_in', 'gambler'],
  arrogant: ['adaptive', 'rational'],
  all_in: ['cautious', 'retreating', 'rational'],
  stubborn: ['speculative'],
  gambler: ['cautious', 'rational'],
};

const strategyOrder: readonly AiStrategy[] = [
  'high_bid',
  'cooperate',
  'disrupt_high',
  'disrupt_cooperate',
  'withdraw',
];

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function emptyMultipliers(): AiStrategyWeights {
  return {
    high_bid: 1,
    cooperate: 1,
    disrupt_high: 1,
    disrupt_cooperate: 1,
    withdraw: 1,
  };
}

function apply(
  target: AiStrategyWeights,
  values: Partial<Record<AiStrategy, number>>,
): void {
  for (const strategy of strategyOrder) target[strategy] *= values[strategy] ?? 1;
}

export function generateAiPersonalities(
  random: RandomSource,
  minimum = 1,
  maximum = 4,
  pool: readonly AiPersonality[] = aiPersonalityOrder,
): AiPersonality[] {
  if (!Number.isInteger(minimum) || !Number.isInteger(maximum) || minimum < 0 || maximum > 4 || minimum > maximum) {
    throw new RangeError('AI personality count must be an integer range between 0 and 4.');
  }
  const count = minimum + Math.floor(random.next() * (maximum - minimum + 1));
  const candidates = [...pool];
  for (let index = candidates.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random.next() * (index + 1));
    [candidates[index], candidates[swapIndex]] = [candidates[swapIndex]!, candidates[index]!];
  }
  const selected: AiPersonality[] = [];
  for (const personality of candidates) {
    if (selected.some((existing) => conflicts[personality].includes(existing))) continue;
    selected.push(personality);
    if (selected.length === count) break;
  }
  return selected;
}

export function calculatePersonalityMultipliers(
  personalities: readonly AiPersonality[],
  context?: AiDecisionContext,
  analysis?: AiAnalysisResult | null,
  liquidityRatio = 1,
): AiStrategyWeights {
  const result = emptyMultipliers();
  const recentMarkets = context?.recentMarkets?.slice(-3) ?? [];
  const disruptionRate = recentMarkets.length === 0
    ? 0.25
    : recentMarkets.reduce((sum, market) => sum + market.disruptionRate, 0) / recentMarkets.length;
  const participationRate = recentMarkets.length === 0
    ? 0.75
    : recentMarkets.reduce((sum, market) => sum + market.participationRate, 0) / recentMarkets.length;
  const bestValue = Math.max(analysis?.groupValues.A ?? 0.5, analysis?.groupValues.B ?? 0.5);
  const averageValue = ((analysis?.groupValues.A ?? 0.5) + (analysis?.groupValues.B ?? 0.5)) / 2;
  const failedCompetitionRate = context?.history.competitiveRounds
    ? context.history.failedCompetitiveRounds / context.history.competitiveRounds
    : 0;

  for (const personality of personalities) {
    if (personality === 'stable') {
      apply(result, { high_bid: 1.03, cooperate: 1.08, disrupt_high: 0.6, disrupt_cooperate: 0.65 });
    } else if (personality === 'disruptive') {
      apply(result, { high_bid: 0.9, cooperate: 0.9, disrupt_high: 1.5, disrupt_cooperate: 1.4, withdraw: 0.9 });
    } else if (personality === 'cautious') {
      apply(result, { high_bid: 0.7, cooperate: 0.82, disrupt_high: 0.8, disrupt_cooperate: 0.9, withdraw: 1.35 });
    } else if (personality === 'aggressive') {
      apply(result, { high_bid: 1.35, cooperate: 1.2, disrupt_high: 1.1, disrupt_cooperate: 1.05, withdraw: 0.7 });
    } else if (personality === 'follower') {
      apply(result, disruptionRate >= 0.5
        ? { high_bid: 0.85, cooperate: 0.85, disrupt_high: 1.35, disrupt_cooperate: 1.35 }
        : { high_bid: 1.15, cooperate: 1.2, disrupt_high: 0.85, disrupt_cooperate: 0.85 });
      apply(result, participationRate >= 0.65 ? { withdraw: 0.75 } : { withdraw: 1.3 });
    } else if (personality === 'rebellious') {
      apply(result, disruptionRate >= 0.5
        ? { high_bid: 1.2, cooperate: 1.25, disrupt_high: 0.75, disrupt_cooperate: 0.75 }
        : { high_bid: 0.9, cooperate: 0.9, disrupt_high: 1.25, disrupt_cooperate: 1.25 });
      apply(result, participationRate >= 0.65 ? { withdraw: 1.25 } : { withdraw: 0.8 });
    } else if (personality === 'common_good') {
      apply(result, { high_bid: 0.9, cooperate: 1.4, disrupt_high: 0.7, disrupt_cooperate: 0.82, withdraw: 0.8 });
    } else if (personality === 'generous') {
      apply(result, { high_bid: 0.72, cooperate: 1.4, disrupt_high: 0.62, disrupt_cooperate: 0.82, withdraw: 0.9 });
    } else if (personality === 'steady') {
      apply(result, {
        high_bid: 0.72 + bestValue * 0.7,
        cooperate: 0.82 + averageValue * 0.42,
        withdraw: 1.18 - bestValue * 0.42,
      });
    } else if (personality === 'retreating') {
      apply(result, {
        high_bid: 1 - bestValue * 0.62,
        cooperate: 1 - bestValue * 0.3,
        withdraw: 1 + bestValue * 0.45,
      });
    } else if (personality === 'impulsive') {
      apply(result, {
        high_bid: 0.9 + bestValue * 1.15,
        cooperate: 0.95 + averageValue * 0.35,
        withdraw: 1.05 - bestValue * 0.42,
      });
    } else if (personality === 'conservative' && context?.history.lastStrategy) {
      apply(result, { [context.history.lastStrategy]: 1.55 });
    } else if (personality === 'vain' || personality === 'greedy') {
      const wantedType = personality === 'vain' ? 'score' : 'economy';
      const visibleWantedValues = context?.room.rewards.flatMap((reward) =>
        reward.hidden || !aiItemProfiles[reward.itemId].types.includes(wantedType) ? [] : [analysis?.groupValues[reward.group] ?? 0.5],
      ) ?? [];
      const wantedValue = visibleWantedValues.length === 0 ? 0 : Math.max(...visibleWantedValues);
      if (wantedValue > 0) {
        apply(result, {
          high_bid: 1 + wantedValue * 0.7,
          cooperate: 1 + wantedValue * 0.35,
          withdraw: 1 - wantedValue * 0.35,
        });
      }
    } else if (personality === 'adaptive') {
      const scorePressure = 1 - (context?.scoreRankPercentile ?? 0.5);
      apply(result, {
        high_bid: 1 + bestValue * 0.16,
        cooperate: 1.08 + scorePressure * 0.22,
        disrupt_cooperate: 1.04 + scorePressure * 0.16,
        withdraw: 0.9,
      });
    } else if (personality === 'rational') {
      const scarcityPressure = clamp((0.9 - liquidityRatio) / 0.65, 0, 1);
      apply(result, {
        high_bid: (1 - scarcityPressure * 0.42) * (1 - failedCompetitionRate * 0.12),
        cooperate: 1 + scarcityPressure * 0.18,
        disrupt_high: 1 - scarcityPressure * 0.28,
        disrupt_cooperate: 1 + scarcityPressure * 0.32,
        withdraw: 1 + scarcityPressure * 0.18,
      });
    } else if (personality === 'all_in' && context?.room.floorIndex === 0) {
      if (bestValue < 0.55) {
        apply(result, {
          high_bid: 0.45,
          cooperate: 0.55,
          disrupt_high: 0.55,
          disrupt_cooperate: 0.65,
          withdraw: 2.2,
        });
      } else {
        apply(result, {
          high_bid: 1.25,
          cooperate: 1.12,
          disrupt_high: 1.1,
          disrupt_cooperate: 1.08,
          withdraw: 0.55,
        });
      }
    }
  }

  const suppressionExponent = personalities.includes('stubborn')
    ? 0.5
    : personalities.includes('gambler')
      ? 0.72
      : 1;
  for (const strategy of strategyOrder) {
    result[strategy] = Math.min(
      2.5,
      Math.max(0.35, result[strategy] ** suppressionExponent),
    );
  }
  return result;
}

export function personalityAnalysisInfluence(
  personalities: readonly AiPersonality[],
): { situation: number; items: number } {
  let situation = 1;
  let items = 1;
  if (personalities.includes('adaptive')) {
    situation *= 1.45;
    items *= 1.1;
  }
  if (personalities.includes('rational')) situation *= 1.35;
  if (personalities.includes('arrogant')) {
    situation *= 0.45;
    items *= 0.65;
  }
  if (personalities.includes('stubborn')) {
    situation *= 0.65;
    items *= 0.8;
  }
  return {
    situation: clamp(situation, 0.3, 1.75),
    items: clamp(items, 0.45, 1.35),
  };
}

export function personalityQuoteNoiseRatio(personalities: readonly AiPersonality[]): number {
  return personalities.includes('gambler') ? 0.15 : 0.05;
}

export function personalityForcesMaximumQuote(
  personalities: readonly AiPersonality[],
  floorIndex: number,
): boolean {
  return floorIndex === 0 && personalities.includes('all_in');
}

function personalitySuppressionExponent(personalities: readonly AiPersonality[]): number {
  if (personalities.includes('stubborn')) return 0.5;
  if (personalities.includes('gambler')) return 0.72;
  return 1;
}

export function calculatePersonalityGroupMultipliers(
  personalities: readonly AiPersonality[],
  context?: AiDecisionContext,
): Record<RewardGroup, number> {
  const result: Record<RewardGroup, number> = { A: 1, B: 1 };
  for (const reward of context?.room.rewards ?? []) {
    if (reward.hidden) continue;
    const types = aiItemProfiles[reward.itemId].types;
    if (personalities.includes('vain') && types.includes('score')) result[reward.group] *= 2.2;
    if (personalities.includes('greedy') && types.includes('economy')) result[reward.group] *= 2.2;
  }
  const exponent = personalitySuppressionExponent(personalities);
  result.A **= exponent;
  result.B **= exponent;
  return result;
}

export function personalityCooperationPosition(
  personalities: readonly AiPersonality[],
): number | undefined {
  const exponent = personalitySuppressionExponent(personalities);
  if (personalities.includes('generous')) return -0.72 * exponent;
  if (personalities.includes('common_good')) return 0;
  return undefined;
}

export function reshapeWeightsForPersonalities(
  weights: AiStrategyWeights,
  doctrineWeights: Readonly<AiStrategyWeights>,
  personalities: readonly AiPersonality[],
): AiStrategyWeights {
  let reshaped = { ...weights };
  if (personalities.includes('speculative')) {
    reshaped = Object.fromEntries(strategyOrder.map((strategy) => [
      strategy,
      reshaped[strategy] <= 0 || doctrineWeights[strategy] <= 0
        ? 0
        : Math.sqrt(reshaped[strategy] * doctrineWeights[strategy]),
    ])) as AiStrategyWeights;
  }
  if (personalities.includes('stubborn')) {
    reshaped = Object.fromEntries(strategyOrder.map((strategy) => [
      strategy,
      reshaped[strategy] <= 0 || doctrineWeights[strategy] <= 0
        ? 0
        : doctrineWeights[strategy] * (reshaped[strategy] / doctrineWeights[strategy]) ** 0.55,
    ])) as AiStrategyWeights;
  }
  return reshaped;
}

export function personalitiesConflict(personalities: readonly AiPersonality[]): boolean {
  return personalities.some((personality) =>
    personalities.some((other) => conflicts[personality].includes(other)),
  );
}
