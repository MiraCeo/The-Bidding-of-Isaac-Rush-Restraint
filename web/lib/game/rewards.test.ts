import { describe, expect, it } from 'vitest';

import { defaultRules } from './config';
import { createSeededRandom } from './random';
import { settleGroupRewards } from './rewards';
import type { PlayerAction, SubmittedAction } from './types';

function entry(id: string, action: PlayerAction): SubmittedAction {
  return { player: { id, money: 100, score: 0, isHuman: false }, action };
}

describe('group reward settlement', () => {
  it('lets a disruptor occupy a high-price slot while leaving its reward vacant', () => {
    const result = settleGroupRewards(
      'A',
      [entry('bidder', { type: 'bid', group: 'A', amount: 40 }), entry('disturber', { type: 'disrupt', group: 'A', amount: 50 })],
      20,
      defaultRules,
    );
    expect(result.highestBidderId).toBe('bidder');
    expect(result.highPricePlacements).toEqual([
      { playerId: 'disturber', marketEquivalent: 125, receivesReward: false, vacancyReason: 'disruptor' },
    ]);
    expect(result.highPriceRecipientIds).toEqual([]);
    expect(result.rewardRecipientIds).not.toContain('disturber');
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

  it('resolves equal highest bids through the injected random source', () => {
    const result = settleGroupRewards(
      'A',
      [
        entry('first', { type: 'bid', group: 'A', amount: 30 }),
        entry('second', { type: 'bid', group: 'A', amount: 30 }),
      ],
      20,
      defaultRules,
      0,
      createSeededRandom(7),
    );
    expect(['first', 'second']).toContain(result.highestBidderId);
  });

  it('awards the rounded top-20% high-price slots per item', () => {
    const seven = settleGroupRewards(
      'A',
      Array.from({ length: 7 }, (_, index) => entry(`p${index}`, { type: 'bid', group: 'A', amount: 100 - index })),
      20,
      defaultRules,
      0,
      createSeededRandom(1),
    );
    const eight = settleGroupRewards(
      'A',
      Array.from({ length: 8 }, (_, index) => entry(`p${index}`, { type: 'bid', group: 'A', amount: 100 - index })),
      20,
      defaultRules,
      0,
      createSeededRandom(1),
    );
    expect(seven.highPriceRecipientIds).toHaveLength(1);
    expect(eight.highPriceRecipientIds).toHaveLength(2);
    expect(eight.rewardRecipientIds).toEqual(expect.arrayContaining(eight.highPriceRecipientIds));
  });

  it('counts normal bids and disruptions together when calculating top-20% slots', () => {
    const result = settleGroupRewards(
      'A',
      [
        ...Array.from({ length: 7 }, (_, index) => entry(`bid-${index}`, { type: 'bid', group: 'A', amount: 70 - index })),
        entry('disruptor', { type: 'disrupt', group: 'A', amount: 40 }),
      ],
      20,
      defaultRules,
      0,
      createSeededRandom(1),
    );
    expect(result.highPricePlacements).toHaveLength(2);
    expect(result.highPricePlacements[0]).toMatchObject({ playerId: 'disruptor', receivesReward: false });
    expect(result.highPriceRecipientIds).toHaveLength(1);
  });

  it('resolves equal cooperation distances through the injected random source', () => {
    const result = settleGroupRewards(
      'A',
      [
        entry('first', { type: 'bid', group: 'A', amount: 20 }),
        entry('second', { type: 'bid', group: 'A', amount: 20 }),
      ],
      20,
      defaultRules,
      0,
      createSeededRandom(11),
    );
    expect(['first', 'second']).toContain(result.cooperationPlacements[0]?.playerId);
  });

  it('scales the cooperation zone with the current floor funds', () => {
    const action = entry('p', { type: 'bid', group: 'A', amount: 60 });
    expect(settleGroupRewards('A', [action], 20, defaultRules, 0).cooperationPopulation).toBe(0);
    expect(settleGroupRewards('A', [action], 20, defaultRules, 1).cooperationPopulation).toBe(1);
  });
});
