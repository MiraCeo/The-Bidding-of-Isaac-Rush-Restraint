import { describe, expect, it, vi } from 'vitest';

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

  it.each([
    { rolls: [0.5, 0.5], copies: 2, existingHearts: 0 },
    { rolls: [0.9, 0.9], copies: 4, existingHearts: 0 },
    { rolls: [0, 0.5], copies: 1, existingHearts: 0 },
    { rolls: [0, 0], copies: 0, existingHearts: 0 },
    { rolls: [0.5, 0.5], copies: 2, existingHearts: 1 },
  ])('aggregates both heart groups after tail resolution: $copies copies, $existingHearts existing',
    ({ rolls, copies, existingHearts }) => {
      const participant = player('p', 'more_options_question', 'transcendence', 'guppys_tail',
        ...(existingHearts ? ['moms_heart' as const] : []));
      participant.score = 57.1234;
      const heartRoom: GeneratedRoom = {
        floorIndex: 2, roomIndex: 4, kind: 'boss',
        rewards: [
          { group: 'A', itemId: 'moms_heart', hidden: false },
          { group: 'B', itemId: 'moms_heart', hidden: false },
        ],
      };
      // Each group draws a ranking tie, high-slot redemption and cooperation tie.
      const values = [...Array<number>(6).fill(0), ...rolls];
      let index = 0;
      const result = settleRuntimeRoom(heartRoom, [participant], [{
        playerId: 'p', actions: [
          { type: 'disrupt', group: 'A', amount: 25 },
          { type: 'disrupt', group: 'B', amount: 25 },
        ],
      }], defaultRules, { next: () => values[index++] ?? 0.5 });
      const originalScore = result.scoreBreakdowns.p!.score;
      const expectedFinal = Math.round(originalScore * 2 ** copies * 10000) / 10000;
      expect(result.awards.reduce((sum, award) => sum + award.copies, 0)).toBe(copies);
      expect(result.players[0]!.score).toBeCloseTo(participant.score + expectedFinal, 4);
      expect(result.roomScoreSummaries.p).toEqual({
        initialScore: originalScore,
        retroactiveScore: Math.round((expectedFinal - originalScore) * 10000) / 10000,
        finalScore: expectedFinal,
        retroactiveMultiplier: 2 ** copies,
      });
      const heartEvents = result.events.filter((event) => event.type === 'score' && event.itemId === 'moms_heart');
      expect(heartEvents).toHaveLength(copies > 0 ? 1 : 0);
      expect(result.scoreBreakdowns.p!.multiplier).toBe(1.5 * 2 ** existingHearts);
    },
  );

  it('never rerolls D6 or Eternal D6 while applying heart retroactivity', () => {
    const participant = player('p', 'd6', 'eternal_d6');
    participant.score = 200;
    const random = { next: vi.fn(() => 0) };
    const result = settleRuntimeRoom({
      floorIndex: 0, roomIndex: 4, kind: 'boss',
      rewards: [
        { group: 'A', itemId: 'moms_heart', hidden: false },
        { group: 'B', itemId: 'sacred_heart', hidden: false },
      ],
    }, [participant], [{ playerId: 'p', actions: [{ type: 'bid', group: 'A', amount: 40 }] }],
    defaultRules, random);
    expect(result.scoreBreakdowns.p!.cleared).toBe(true);
    expect(result.roomScoreSummaries.p!.finalScore).toBe(0);
    expect(result.players[0]!.score).toBe(200);
    expect(random.next).toHaveBeenCalledTimes(4);
    expect(result.scoreBreakdowns.p!.triggers.filter((trigger) => trigger.itemId === 'd6')).toHaveLength(1);
  });

  it('does not apply newly awarded non-heart multipliers to the current score', () => {
    const result = settleRuntimeRoom({ ...room, kind: 'boss', rewards: [
      { group: 'A', itemId: 'sacred_heart', hidden: false },
      { group: 'B', itemId: 'moms_heart', hidden: false },
    ] }, [player('p')], [{ playerId: 'p', actions: [{ type: 'bid', group: 'A', amount: 40 }] }],
    defaultRules, { next: () => 0.5 });
    expect(result.roomScoreSummaries.p!.finalScore).toBe(result.scoreBreakdowns.p!.score);
    expect(result.roomScoreSummaries.p!.retroactiveScore).toBe(0);
    expect(result.players[0]!.score).toBe(result.scoreBreakdowns.p!.score);
  });

  it('reports zero room totals when every player withdraws', () => {
    const participant = player('p');
    participant.score = 123.4567;
    const result = settleRuntimeRoom(room, [participant], [
      { playerId: 'p', actions: [{ type: 'withdraw' }] },
    ], defaultRules, { next: () => 0.5 });
    expect(result.baseline).toBeNull();
    expect(result.roomScoreSummaries.p).toEqual({
      initialScore: 0, retroactiveScore: 0, finalScore: 0, retroactiveMultiplier: 1,
    });
    expect(result.players[0]!.score).toBe(participant.score);
  });

  it.each([0, 0.5, 0.99])('excludes a tail reward from its own effect at roll %s', (roll) => {
    const participant = player('p', 'guppys_tail');
    const random = { next: vi.fn(() => roll) };
    const result = settleRuntimeRoom({ ...room, rewards: [
      { group: 'A', itemId: 'guppys_tail', hidden: false },
      room.rewards[1],
    ] }, [participant], [{ playerId: 'p', actions: [{ type: 'bid', group: 'A', amount: 40 }] }],
    defaultRules, random);
    expect(result.awards).toEqual([{ playerId: 'p', group: 'A', itemId: 'guppys_tail', copies: 1 }]);
    expect(result.players[0]!.items.filter((item) => item.itemId === 'guppys_tail')).toHaveLength(2);
    expect(result.events.filter((event) => event.type === 'destroy' || event.type === 'duplicate')).toEqual([]);
    expect(random.next).toHaveBeenCalledTimes(2);
  });

  it.each([{ roll: 0, copies: 0 }, { roll: 0.5, copies: 1 }, { roll: 0.99, copies: 2 }])(
    'preserves one tail roll for other rewards with multiple tails: $copies copies', ({ roll, copies }) => {
      const random = { next: vi.fn(() => roll) };
      const result = settleRuntimeRoom(room, [player('p', 'guppys_tail', 'guppys_tail')], [
        { playerId: 'p', actions: [{ type: 'bid', group: 'A', amount: 40 }] },
      ], defaultRules, random);
      expect(result.awards.reduce((sum, award) => sum + award.copies, 0)).toBe(copies);
      expect(random.next).toHaveBeenCalledTimes(3);
    },
  );

  it('awards a Grab Bag through disruption but never refunds the disruption cost', () => {
    const result = settleRuntimeRoom({ ...room, rewards: [
      { group: 'A', itemId: 'grab_bag', hidden: false },
      room.rewards[1],
    ] }, [player('p', 'transcendence')], [
      { playerId: 'p', actions: [{ type: 'disrupt', group: 'A', amount: 40 }] },
    ], defaultRules, { next: () => 0 });
    expect(result.players[0]!.money).toBe(60);
    expect(result.awards).toContainEqual({ playerId: 'p', group: 'A', itemId: 'grab_bag', copies: 1 });
    expect(result.events.filter((event) => event.type === 'refund' && event.itemId === 'grab_bag'))
      .toEqual([]);
  });

  it('counts only the heart retained after More Options destroys one group', () => {
    const result = settleRuntimeRoom({
      floorIndex: 2, roomIndex: 4, kind: 'boss',
      rewards: [
        { group: 'A', itemId: 'moms_heart', hidden: false },
        { group: 'B', itemId: 'moms_heart', hidden: false },
      ],
    }, [player('p', 'more_options')], [{ playerId: 'p', actions: [
      { type: 'bid', group: 'A', amount: 25 },
      { type: 'bid', group: 'B', amount: 25 },
    ] }], defaultRules, { next: () => 0.5 });
    expect(result.awards).toHaveLength(1);
    expect(result.roomScoreSummaries.p!.retroactiveMultiplier).toBe(2);
    expect(result.players[0]!.score).toBeCloseTo(result.scoreBreakdowns.p!.score * 2, 4);
  });

  it('consumes temporary shields before persistent ones', () => {
    const participant = player('p', 'holy_mantle', 'wooden_cross');
    participant.temporaryShields = 1;
    participant.persistentShields = 1;
    const first = settleRuntimeRoom(room, [participant, player('winner')], [
      { playerId: 'p', actions: [{ type: 'bid', group: 'A', amount: 10 }] },
      { playerId: 'winner', actions: [{ type: 'bid', group: 'A', amount: 50 }] },
    ], defaultRules, { next: () => 0.5 });
    expect(first.players[0]!.temporaryShields).toBe(0);
    expect(first.players[0]!.persistentShields).toBe(1);
  });

  it('grants a first tail normally without triggering its own effect', () => {
    const random = { next: vi.fn(() => 0) };
    const tail = settleRuntimeRoom({ ...room, rewards: [
      { group: 'A', itemId: 'guppys_tail', hidden: false }, room.rewards[1],
    ] }, [player('new')], [
      { playerId: 'new', actions: [{ type: 'bid', group: 'A', amount: 40 }] },
    ], defaultRules, random);
    expect(tail.awards[0]?.copies).toBe(1);
    expect(random.next).toHaveBeenCalledTimes(2);
  });

  it.each([1, 2, 3])('grants only one lucky-foot reward with %s copies', (copies) => {
    const participant = player('p', ...Array<ItemId>(copies).fill('lucky_foot'));
    const result = settleRuntimeRoom(room, [player('winner'), participant], [
      { playerId: 'winner', actions: [{ type: 'bid', group: 'A', amount: 40 }] },
      { playerId: 'p', actions: [{ type: 'bid', group: 'A', amount: 20 }] },
    ], defaultRules, { next: () => 0.5 });
    expect(result.entitlements.find((entry) => entry.playerId === 'p')?.sources).toEqual(['lucky_foot']);
    expect(result.awards.filter((award) => award.playerId === 'p'))
      .toEqual([{ playerId: 'p', group: 'A', itemId: 'score_charm', copies: 1 }]);
    expect(result.players.find((entry) => entry.id === 'p')!.items
      .filter((item) => item.itemId === 'lucky_foot')).toHaveLength(copies);
  });

  it('keeps awarding a duplicate non-stacking item instead of deleting its inventory copy', () => {
    const result = settleRuntimeRoom({ ...room, rewards: [
      { group: 'A', itemId: 'lucky_foot', hidden: false }, room.rewards[1],
    ] }, [player('p', 'lucky_foot')], [
      { playerId: 'p', actions: [{ type: 'bid', group: 'A', amount: 30 }] },
    ], defaultRules, { next: () => 0.5 });
    expect(result.players[0]!.items.filter((item) => item.itemId === 'lucky_foot')).toHaveLength(2);
    expect(result.awards[0]?.copies).toBe(1);
  });

  it.each([
    { amount: 40, items: [] as ItemId[], cost: 40, refund: 30, money: 90 },
    { amount: 80, items: ['steam_sale'] as ItemId[], cost: 56, refund: 42, money: 86 },
  ])('refunds only the actual winning bid cost: $cost -> $refund', ({ amount, items, cost, refund, money }) => {
    const result = settleRuntimeRoom({ ...room, rewards: [
      { group: 'A', itemId: 'grab_bag', hidden: false }, room.rewards[1],
    ] }, [player('p', ...items)], [
      { playerId: 'p', actions: [{ type: 'bid', group: 'A', amount }] },
    ], defaultRules, { next: () => 0.5 });
    expect(result.resolvedActions[0]!.actualCost).toBe(cost);
    expect(result.players[0]!.money).toBe(money);
    expect(result.events.filter((event) => event.type === 'refund' && event.itemId === 'grab_bag'))
      .toEqual([expect.objectContaining({ amount: refund })]);
  });

  it('refunds each duplicated Grab Bag separately and can return more than the bid cost', () => {
    const result = settleRuntimeRoom({ ...room, rewards: [
      { group: 'A', itemId: 'grab_bag', hidden: false }, room.rewards[1],
    ] }, [player('p', 'guppys_tail')], [
      { playerId: 'p', actions: [{ type: 'bid', group: 'A', amount: 3 }] },
    ], defaultRules, { next: () => 0.99 });
    expect(result.awards[0]?.copies).toBe(2);
    expect(result.events.filter((event) => event.type === 'refund' && event.itemId === 'grab_bag')
      .map((event) => event.amount)).toEqual([2, 2]);
    expect(result.players[0]!.money).toBe(101);
  });

  it('never refunds a Grab Bag that disappears through the tail', () => {
    const result = settleRuntimeRoom({ ...room, rewards: [
      { group: 'A', itemId: 'grab_bag', hidden: false }, room.rewards[1],
    ] }, [player('p', 'guppys_tail')], [
      { playerId: 'p', actions: [{ type: 'bid', group: 'A', amount: 40 }] },
    ], defaultRules, { next: () => 0 });
    expect(result.awards).toEqual([]);
    expect(result.players[0]!.money).toBe(60);
    expect(result.events.filter((event) => event.type === 'refund')).toEqual([]);
  });

  it('does not refund a Grab Bag destroyed by More Options', () => {
    const result = settleRuntimeRoom({ ...room, rewards: [
      { group: 'A', itemId: 'interest', hidden: false },
      { group: 'B', itemId: 'grab_bag', hidden: false },
    ] }, [player('p', 'more_options')], [{ playerId: 'p', actions: [
      { type: 'bid', group: 'A', amount: 3 },
      { type: 'bid', group: 'B', amount: 4 },
    ] }], defaultRules, { next: () => 0.5 });
    expect(result.awards.map((award) => award.itemId)).toEqual(['interest']);
    expect(result.players[0]!.money).toBe(93);
    expect(result.events.filter((event) => event.type === 'refund')).toEqual([]);
  });

  it('uses the awarded group bid cost rather than the total double-bid cost', () => {
    const result = settleRuntimeRoom({ ...room, rewards: [
      { group: 'A', itemId: 'grab_bag', hidden: false },
      { group: 'B', itemId: 'interest', hidden: false },
    ] }, [player('p', 'more_options')], [{ playerId: 'p', actions: [
      { type: 'bid', group: 'A', amount: 3 },
      { type: 'bid', group: 'B', amount: 4 },
    ] }], defaultRules, { next: () => 0.5 });
    expect(result.players[0]!.money).toBe(95);
    expect(result.events.filter((event) => event.type === 'refund' && event.itemId === 'grab_bag')
      .map((event) => event.amount)).toEqual([2]);
  });

  it('never refunds either group of a double-disruption award', () => {
    const result = settleRuntimeRoom({ ...room, rewards: [
      { group: 'A', itemId: 'grab_bag', hidden: false }, room.rewards[1],
    ] }, [player('p', 'more_options_question', 'transcendence')], [{ playerId: 'p', actions: [
      { type: 'disrupt', group: 'A', amount: 40 },
      { type: 'disrupt', group: 'B', amount: 10 },
    ] }], defaultRules, { next: () => 0 });
    expect(result.awards.map((award) => award.itemId)).toEqual(['grab_bag', 'interest']);
    expect(result.players[0]!.money).toBe(50);
    expect(result.events.filter((event) => event.type === 'refund' && event.itemId === 'grab_bag'))
      .toEqual([]);
  });
});
