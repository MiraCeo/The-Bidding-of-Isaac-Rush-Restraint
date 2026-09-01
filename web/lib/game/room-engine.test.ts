import { describe, expect, it } from 'vitest';

import { defaultRules } from './config';
import type { GeneratedRoom, ItemId, RuntimePlayerState } from './item-types';
import { createSeededRandom } from './random';
import { settleRuntimeRoom } from './room-engine';
import { createRuntimePlayer } from './runtime';

function player(id: string, ...itemIds: ItemId[]): RuntimePlayerState {
  const state = createRuntimePlayer({ id, money: 100, score: 0, isHuman: id === 'human' });
  state.items = itemIds.map((itemId, index) => ({
    instanceId: `${id}-${index}`,
    itemId,
    acquiredOrder: index + 1,
  }));
  return state;
}

const room: GeneratedRoom = {
  floorIndex: 0,
  roomIndex: 0,
  kind: 'normal',
  rewards: [
    { group: 'A', itemId: 'score_charm', hidden: false },
    { group: 'B', itemId: 'interest', hidden: false },
  ],
};

describe('runtime room settlement', () => {
  it('forms a baseline, deducts funds, scores and awards the winning item', () => {
    const result = settleRuntimeRoom(
      room,
      [player('human'), player('bot')],
      [
        { playerId: 'human', actions: [{ type: 'bid', group: 'A', amount: 40 }] },
        { playerId: 'bot', actions: [{ type: 'withdraw' }] },
      ],
      defaultRules,
      createSeededRandom(3),
    );
    expect(result.baseline?.participantCount).toBe(1);
    expect(result.players.find((candidate) => candidate.id === 'human')?.money).toBe(60);
    expect(result.awards).toContainEqual({ playerId: 'human', group: 'A', itemId: 'score_charm', copies: 1 });
  });

  it('refunds the failed part of a bid through a persistent shield', () => {
    const protectedPlayer = player('protected', 'wooden_cross');
    protectedPlayer.persistentShields = 1;
    const result = settleRuntimeRoom(
      room,
      [protectedPlayer, player('winner')],
      [
        { playerId: 'protected', actions: [{ type: 'bid', group: 'A', amount: 10 }] },
        { playerId: 'winner', actions: [{ type: 'bid', group: 'A', amount: 50 }] },
      ],
      defaultRules,
      createSeededRandom(9),
    );
    const protectedAfter = result.players.find((candidate) => candidate.id === 'protected');
    expect(protectedAfter?.money).toBe(100);
    expect(protectedAfter?.persistentShields).toBe(0);
  });

  it('treats More Options as two market samples but destroys one of two won rewards', () => {
    const result = settleRuntimeRoom(
      room,
      [player('dual', 'more_options')],
      [
        {
          playerId: 'dual',
          actions: [
            { type: 'bid', group: 'A', amount: 25 },
            { type: 'bid', group: 'B', amount: 25 },
          ],
        },
      ],
      defaultRules,
      createSeededRandom(12),
    );
    expect(result.baseline?.participantCount).toBe(2);
    expect(result.awards).toHaveLength(1);
    expect(result.players[0]?.money).toBe(50);
  });

  it('retroactively doubles the current boss score when Moms Heart is awarded', () => {
    const bossRoom: GeneratedRoom = {
      ...room,
      kind: 'boss',
      roomIndex: 4,
      rewards: [
        { group: 'A', itemId: 'moms_heart', hidden: false },
        { group: 'B', itemId: 'sacred_heart', hidden: false },
      ],
    };
    const result = settleRuntimeRoom(
      bossRoom,
      [player('p')],
      [{ playerId: 'p', actions: [{ type: 'bid', group: 'A', amount: 40 }] }],
      defaultRules,
      createSeededRandom(4),
    );
    const baseRoomScore = result.scoreBreakdowns.p?.score ?? 0;
    expect(result.players[0]?.score).toBeCloseTo(baseRoomScore * 2, 4);
  });

  it('lets Transcendence redeem both high-price and cooperation slots occupied by disruption', () => {
    const result = settleRuntimeRoom(
      room,
      [player('disruptor', 'transcendence'), player('bidder')],
      [
        { playerId: 'disruptor', actions: [{ type: 'disrupt', group: 'A', amount: 50 }] },
        { playerId: 'bidder', actions: [{ type: 'bid', group: 'A', amount: 40 }] },
      ],
      defaultRules,
      { next: () => 0 },
    );
    expect(result.highPricePlacements[0]).toEqual({
      group: 'A', playerId: 'disruptor', actionType: 'disrupt',
    });
    expect(result.transcendenceRedemptions).toEqual([
      { group: 'A', playerId: 'disruptor', slotType: 'highest' },
      { group: 'A', playerId: 'disruptor', slotType: 'cooperation' },
    ]);
    expect(result.awards).toContainEqual({
      playerId: 'disruptor', group: 'A', itemId: 'score_charm', copies: 1,
    });
  });
});
