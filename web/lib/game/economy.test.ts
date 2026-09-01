import { describe, expect, it } from 'vitest';

import { defaultRules } from './config';
import { resetFundsForFloor } from './economy';

describe('floor economy', () => {
  it('resets funds to the floor starting amount while preserving score and identity', () => {
    const players = [
      { id: 'p1', money: 7, score: 42, isHuman: true },
      { id: 'p2', money: 999, score: 18, isHuman: false },
    ];
    expect(resetFundsForFloor(players, 1, defaultRules)).toEqual([
      { id: 'p1', money: 500, score: 42, isHuman: true },
      { id: 'p2', money: 500, score: 18, isHuman: false },
    ]);
  });
});
