import { describe, expect, it } from 'vitest';

import { defaultRules } from './config';
import { calculateMarketBaseline } from './market';
import type { PlayerAction, SubmittedAction } from './types';

function entry(id: string, action: PlayerAction): SubmittedAction {
  return { player: { id, money: 1000, score: 0, isHuman: false }, action };
}

describe('shared market baseline', () => {
  it('uses normal bids and 2.5x disruption values while excluding withdrawals', () => {
    const result = calculateMarketBaseline(
      [
        entry('bid-a', { type: 'bid', group: 'A', amount: 10 }),
        entry('bid-b', { type: 'bid', group: 'B', amount: 20 }),
        entry('disrupt', { type: 'disrupt', group: 'A', amount: 20 }),
        entry('withdraw', { type: 'withdraw' }),
      ],
      0,
      defaultRules,
    );

    expect(result).not.toBeNull();
    expect(result?.participantCount).toBe(3);
    expect(result?.totalMarketEquivalent).toBe(80);
    expect(result?.meanMarketBid).toBeCloseTo(80 / 3);
    expect(result?.floorConstant).toBe(10);
    expect(result?.target).toBeCloseTo((2 / 3) * (80 / 3) + 10);
  });

  it.each([
    [0, 30],
    [1, 150],
    [2, 300],
  ])('has a fixed point at 30%% of floor starting money on floor %i', (floorIndex, bid) => {
    const result = calculateMarketBaseline(
      [entry('bidder', { type: 'bid', group: 'A', amount: bid })],
      floorIndex,
      defaultRules,
    );
    expect(result?.target).toBeCloseTo(bid);
  });

  it('has no baseline when every player withdraws', () => {
    expect(
      calculateMarketBaseline([entry('one', { type: 'withdraw' }), entry('two', { type: 'withdraw' })], 0, defaultRules),
    ).toBeNull();
  });
});
