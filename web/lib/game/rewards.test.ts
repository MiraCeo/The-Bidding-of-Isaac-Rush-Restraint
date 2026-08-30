import { describe, expect, it } from 'vitest';

import { defaultRules } from './config';
import { settleGroupRewards } from './rewards';
import type { PlayerAction, SubmittedAction } from './types';

function entry(id: string, action: PlayerAction): SubmittedAction {
  return { player: { id, money: 100, score: 0, isHuman: false }, action };
}

describe('group reward settlement', () => {
  it('excludes disruptors from highest-bid reward eligibility', () => {
    const result = settleGroupRewards(
      'A',
      [entry('bidder', { type: 'bid', group: 'A', amount: 40 }), entry('disturber', { type: 'disrupt', group: 'A', amount: 50 })],
      20,
      defaultRules,
    );
    expect(result.highestBidderId).toBe('bidder');
  });

  it('creates ceil(k / 2) cooperation slots and leaves disruptor slots vacant', () => {
    const result = settleGroupRewards(
      'B',
      [
        entry('near', { type: 'bid', group: 'B', amount: 21 }),
        entry('disturber', { type: 'disrupt', group: 'B', amount: 16 }),
        entry('far', { type: 'bid', group: 'B', amount: 28 }),
      ],
      20,
      defaultRules,
    );
    expect(result.cooperationPopulation).toBe(3);
    expect(result.cooperationSlotCount).toBe(2);
    expect(result.cooperationPlacements).toEqual([
      { playerId: 'disturber', distance: 0, receivesReward: false, vacancyReason: 'disruptor' },
      { playerId: 'near', distance: 1, receivesReward: true },
    ]);
  });

  it('does not duplicate or pass down an overlapping reward slot', () => {
    const result = settleGroupRewards(
      'A',
      [entry('winner', { type: 'bid', group: 'A', amount: 25 }), entry('second', { type: 'bid', group: 'A', amount: 24 })],
      25,
      defaultRules,
    );
    expect(result.cooperationSlotCount).toBe(1);
    expect(result.rewardRecipientIds).toEqual(['winner']);
  });
});
