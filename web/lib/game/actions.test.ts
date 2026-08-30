import { describe, expect, it } from 'vitest';

import { defaultRules } from './config';
import { getActionAmounts, validateAction } from './actions';
import type { PlayerState } from './types';

const player: PlayerState = { id: 'player', money: 100, score: 0, isHuman: true };

describe('action rules', () => {
  it('applies separate disruption equivalents without refunding its cost', () => {
    expect(getActionAmounts({ type: 'disrupt', group: 'A', amount: 20 }, defaultRules)).toEqual({
      actualCost: 20,
      marketEquivalent: 50,
      scoringEquivalent: 25,
    });
  });

  it('rejects disruption above half of pre-action money', () => {
    expect(validateAction(player, { type: 'disrupt', group: 'B', amount: 51 }, defaultRules)).toContain(
      '扰乱出价不能超过行动前资金的 50%。',
    );
  });

  it('keeps withdrawal free and outside market calculations', () => {
    expect(getActionAmounts({ type: 'withdraw' }, defaultRules)).toEqual({
      actualCost: 0,
      marketEquivalent: null,
      scoringEquivalent: null,
    });
  });
});
