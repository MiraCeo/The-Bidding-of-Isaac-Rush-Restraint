import { getActionAmounts } from './actions';
import type {
  GroupRewardSettlement,
  PlayerId,
  RewardGroup,
  RulesConfig,
  SubmittedAction,
} from './types';

export function settleGroupRewards(
  group: RewardGroup,
  submissions: readonly SubmittedAction[],
  baseline: number,
  rules: RulesConfig,
): GroupRewardSettlement {
  const groupEntries = submissions.filter(
    (entry) => entry.action.type !== 'withdraw' && entry.action.group === group,
  );
  const normalBidders = groupEntries.filter((entry) => entry.action.type === 'bid');

  const highestBidder = [...normalBidders].sort((left, right) => {
    if (left.action.type !== 'bid' || right.action.type !== 'bid') return 0;
    return right.action.amount - left.action.amount || left.player.id.localeCompare(right.player.id);
  })[0];

  const cooperationCandidates = groupEntries
    .map((entry) => {
      const scoringEquivalent = getActionAmounts(entry.action, rules).scoringEquivalent;
      return {
        entry,
        distance: Math.abs((scoringEquivalent ?? baseline) - baseline),
      };
    })
    .filter((candidate) => candidate.distance <= rules.cooperationZoneRadius)
    .sort(
      (left, right) =>
        left.distance - right.distance || left.entry.player.id.localeCompare(right.entry.player.id),
    );

  const slotCount = Math.ceil(cooperationCandidates.length / 2);
  const placements = cooperationCandidates.slice(0, slotCount).map(({ entry, distance }) => ({
    playerId: entry.player.id,
    distance,
    receivesReward: entry.action.type === 'bid',
    ...(entry.action.type === 'disrupt' ? { vacancyReason: 'disruptor' as const } : {}),
  }));

  const rewardRecipients = new Set<PlayerId>();
  if (highestBidder) rewardRecipients.add(highestBidder.player.id);
  for (const placement of placements) {
    if (placement.receivesReward) rewardRecipients.add(placement.playerId);
  }

  return {
    group,
    highestBidderId: highestBidder?.player.id ?? null,
    cooperationPopulation: cooperationCandidates.length,
    cooperationSlotCount: slotCount,
    cooperationPlacements: placements,
    rewardRecipientIds: [...rewardRecipients],
  };
}
