import { getActionAmounts } from './actions';
import type {
  GroupRewardSettlement,
  PlayerId,
  RandomSource,
  RewardGroup,
  RulesConfig,
  SubmittedAction,
} from './types';

export function calculateHighPriceSlotCount(
  participantCount: number,
  rules: RulesConfig,
): number {
  if (participantCount <= 0) return 0;
  return Math.max(1, Math.round(participantCount * rules.highPriceWinnerRatio));
}

export function settleGroupRewards(
  group: RewardGroup,
  submissions: readonly SubmittedAction[],
  baseline: number,
  rules: RulesConfig,
  floorIndex = 0,
  random: RandomSource = { next: () => Math.random() },
): GroupRewardSettlement {
  const floorStartingMoney = rules.floorStartingMoney[floorIndex];
  if (floorStartingMoney === undefined) {
    throw new RangeError(`Unknown floor index: ${floorIndex}`);
  }
  const cooperationZoneRadius = floorStartingMoney * rules.cooperationZoneRatio;
  const groupEntries = submissions.filter(
    (entry) => entry.action.type !== 'withdraw' && entry.action.group === group,
  );
  const rankedParticipants = groupEntries
    .map((entry) => ({
      entry,
      marketEquivalent: getActionAmounts(entry.action, rules).marketEquivalent ?? 0,
      randomTieBreak: random.next(),
    }))
    .sort((left, right) =>
      right.marketEquivalent - left.marketEquivalent || left.randomTieBreak - right.randomTieBreak,
    );
  const highPriceSlotCount = calculateHighPriceSlotCount(rankedParticipants.length, rules);
  const highPricePlacements = rankedParticipants.slice(0, highPriceSlotCount).map(({ entry, marketEquivalent }) => ({
    playerId: entry.player.id,
    marketEquivalent,
    receivesReward: entry.action.type === 'bid',
    ...(entry.action.type === 'disrupt' ? { vacancyReason: 'disruptor' as const } : {}),
  }));
  const highPriceRecipients = rankedParticipants
    .slice(0, highPriceSlotCount)
    .map(({ entry }) => entry)
    .filter((entry) => entry.action.type === 'bid');
  const highestBidder = rankedParticipants.find(({ entry }) => entry.action.type === 'bid')?.entry;

  const cooperationCandidates = groupEntries
    .map((entry) => {
      const scoringEquivalent = getActionAmounts(entry.action, rules).scoringEquivalent;
      return {
        entry,
        distance: Math.abs((scoringEquivalent ?? baseline) - baseline),
        randomTieBreak: random.next(),
      };
    })
    .filter((candidate) => candidate.distance <= cooperationZoneRadius)
    .sort((left, right) => left.distance - right.distance || left.randomTieBreak - right.randomTieBreak);

  const slotCount = Math.ceil(cooperationCandidates.length / 2);
  const placements = cooperationCandidates.slice(0, slotCount).map(({ entry, distance }) => ({
    playerId: entry.player.id,
    distance,
    receivesReward: entry.action.type === 'bid',
    ...(entry.action.type === 'disrupt' ? { vacancyReason: 'disruptor' as const } : {}),
  }));

  const rewardRecipients = new Set<PlayerId>();
  for (const recipient of highPriceRecipients) rewardRecipients.add(recipient.player.id);
  for (const placement of placements) {
    if (placement.receivesReward) rewardRecipients.add(placement.playerId);
  }

  return {
    group,
    highestBidderId: highestBidder?.player.id ?? null,
    highPriceRecipientIds: highPriceRecipients.map((entry) => entry.player.id),
    highPricePlacements,
    cooperationPopulation: cooperationCandidates.length,
    cooperationSlotCount: slotCount,
    cooperationPlacements: placements,
    rewardRecipientIds: [...rewardRecipients],
  };
}
