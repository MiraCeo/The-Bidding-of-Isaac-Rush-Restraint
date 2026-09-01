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
  | 'greedy';

export const aiPersonalityOrder: readonly AiPersonality[] = [
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
};

const conflicts: Readonly<Record<AiPersonality, readonly AiPersonality[]>> = {
  stable: ['disruptive'],
  disruptive: ['stable', 'common_good', 'generous'],
  cautious: ['aggressive', 'impulsive'],
  aggressive: ['cautious', 'retreating'],
  follower: ['rebellious'],
  rebellious: ['follower'],
  common_good: ['disruptive'],
  generous: ['disruptive'],
  steady: [],
  retreating: ['aggressive', 'impulsive'],
  impulsive: ['cautious', 'retreating'],
  speculative: ['conservative'],
  conservative: ['speculative'],
  vain: [],
  greedy: [],
};

const strategyOrder: readonly AiStrategy[] = [
  'high_bid',
  'cooperate',
  'disrupt_high',
  'disrupt_cooperate',
  'withdraw',
];

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
): AiPersonality[] {
  if (!Number.isInteger(minimum) || !Number.isInteger(maximum) || minimum < 0 || maximum > 4 || minimum > maximum) {
    throw new RangeError('AI personality count must be an integer range between 0 and 4.');
  }
  const count = minimum + Math.floor(random.next() * (maximum - minimum + 1));
  const candidates = [...aiPersonalityOrder];
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
): AiStrategyWeights {
  const result = emptyMultipliers();
  const recentMarkets = context?.recentMarkets.slice(-3) ?? [];
  const disruptionRate = recentMarkets.length === 0
    ? 0.25
    : recentMarkets.reduce((sum, market) => sum + market.disruptionRate, 0) / recentMarkets.length;
  const participationRate = recentMarkets.length === 0
    ? 0.75
    : recentMarkets.reduce((sum, market) => sum + market.participationRate, 0) / recentMarkets.length;
  const bestValue = Math.max(analysis?.groupValues.A ?? 0.5, analysis?.groupValues.B ?? 0.5);
  const averageValue = ((analysis?.groupValues.A ?? 0.5) + (analysis?.groupValues.B ?? 0.5)) / 2;

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
    }
  }

  for (const strategy of strategyOrder) result[strategy] = Math.min(2.5, Math.max(0.35, result[strategy]));
  return result;
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
  return result;
}

export function personalityCooperationPosition(
  personalities: readonly AiPersonality[],
): number | undefined {
  if (personalities.includes('generous')) return -0.72;
  if (personalities.includes('common_good')) return 0;
  return undefined;
}

export function reshapeWeightsForPersonalities(
  weights: AiStrategyWeights,
  doctrineWeights: Readonly<AiStrategyWeights>,
  personalities: readonly AiPersonality[],
): AiStrategyWeights {
  if (!personalities.includes('speculative')) return weights;
  return Object.fromEntries(strategyOrder.map((strategy) => [
    strategy,
    weights[strategy] <= 0 || doctrineWeights[strategy] <= 0
      ? 0
      : Math.sqrt(weights[strategy] * doctrineWeights[strategy]),
  ])) as AiStrategyWeights;
}

export function personalitiesConflict(personalities: readonly AiPersonality[]): boolean {
  return personalities.some((personality) =>
    personalities.some((other) => conflicts[personality].includes(other)),
  );
}
