import { describe, it, expect, vi } from 'vitest';
import { settleRuntimeRoom } from '../../game/room-engine';
import { createRuntimePlayer } from '../../game/runtime';
import type {
  ItemId,
  PlayerTurn,
  GeneratedRoom,
  CharacterId,
} from '../../game/item-types';
import { defaultRules } from '../../game/config';
import { extractMilestoneRoomFacts } from './milestone-room-facts';
import { extractAchievementRoomFacts } from './facts';
import { encodeAchievementEvent } from './event-codec';
const room: GeneratedRoom = {
  floorIndex: 0,
  roomIndex: 0,
  kind: 'normal',
  rewards: [
    { group: 'A', itemId: 'score_charm', hidden: false },
    { group: 'B', itemId: 'interest', hidden: false },
  ],
};
function settle(
  actions: PlayerTurn['actions'],
  others: PlayerTurn['actions'][] = [],
  items: ItemId[] = [],
  role: CharacterId = 'isaac',
  roll = 0.9,
  money = 200,
) {
  const players = Array.from(
    { length: Math.max(4, others.length + 1) },
    (_, i) =>
      createRuntimePlayer({
        id: i ? 'p' + i : 'human',
        isHuman: i === 0,
        money,
        score: 0,
      }),
  );
  players[0]!.characterId = role;
  players[0]!.items = items.map((itemId, i) => ({
    itemId,
    instanceId: 'initial-' + i,
    acquiredOrder: i + 1,
  }));
  const turns: PlayerTurn[] = players.map((p, i) => ({
    playerId: p.id,
    actions: i ? (others[i - 1] ?? [{ type: 'withdraw' }]) : actions,
  }));
  const next = vi.fn(() => roll),
    result = settleRuntimeRoom(room, players, turns, defaultRules, { next });
  return { record: { ...result, room, turns, playersBefore: players }, next };
}
const bid = (amount: number, group: 'A' | 'B' = 'A') => ({
  type: 'bid' as const,
  amount,
  group,
});
const disrupt = (amount: number, group: 'A' | 'B' = 'A') => ({
  type: 'disrupt' as const,
  amount,
  group,
});
describe('authority-only new room causes without rule/RNG changes', () => {
  it('uses the actual Nth placement including disruption, not the last normal winner', () => {
    const others = [
      [disrupt(50)],
      ...Array.from({ length: 8 }, () => [bid(10)]),
    ];
    const win = settle([bid(80)], others),
      notLast = settle([bid(200)], others);
    expect(
      win.record.highPricePlacements
        .filter((p) => p.group === 'A')
        .map((p) => p.playerId),
    ).toEqual(['p1', 'human']);
    expect(extractMilestoneRoomFacts(win.record).milestoneFlags & 1).toBe(1);
    expect(extractMilestoneRoomFacts(notLast.record).milestoneFlags & 1).toBe(
      0,
    );
  });
  it('requires cooperation delivery without highest qualification, even with a strictly higher market participant', () => {
    const good = settle([bid(40)], [[bid(60)], [bid(40)], [bid(40)]]);
    expect(extractMilestoneRoomFacts(good.record).milestoneFlags & 2).toBe(2);
    const destroyed = settle(
      [bid(40)],
      [[bid(60)], [bid(40)], [bid(40)]],
      ['guppys_tail'],
      'isaac',
      0,
    );
    expect(extractMilestoneRoomFacts(destroyed.record).milestoneFlags & 2).toBe(
      0,
    );
    const highest = settle([bid(100)], [[bid(60)], [bid(40)], [bid(40)]]);
    expect(extractMilestoneRoomFacts(highest.record).milestoneFlags & 2).toBe(
      0,
    );
  });
  it('supports two legal disruption groups, excludes redeemed slots and requires actual redemption delivery', () => {
    const empty = settle(
      [disrupt(10), disrupt(20, 'B')],
      [],
      ['more_options_question'],
    );
    expect(extractMilestoneRoomFacts(empty.record).milestoneFlags & 8).toBe(8);
    const redeemed = settle(
      [disrupt(10), disrupt(20, 'B')],
      [],
      ['more_options_question', 'transcendence'],
      'isaac',
      0,
    );
    expect(extractMilestoneRoomFacts(redeemed.record).milestoneFlags & 4).toBe(
      4,
    );
    expect(extractMilestoneRoomFacts(redeemed.record).milestoneFlags & 8).toBe(
      0,
    );
    const gone = settle(
      [disrupt(10), disrupt(20, 'B')],
      [],
      ['more_options_question', 'transcendence', 'guppys_tail'],
      'isaac',
      0,
    );
    expect(gone.record.transcendenceRedemptions.length).toBeGreaterThan(0);
    expect(
      extractAchievementRoomFacts(gone.record)!.transcendenceRedeemed,
    ).toBe(true);
    expect(
      gone.record.awards.filter((a) => a.playerId === 'human'),
    ).toHaveLength(0);
    expect(extractMilestoneRoomFacts(gone.record).milestoneFlags & 4).toBe(0);
    expect(() => settle([disrupt(10), disrupt(20, 'B')])).toThrow();
  });
  it('matches full nominal bidding to delivery, counts actual sale amount and never mistakes tail destruction for a win', () => {
    const sale = settle([bid(200)], [], ['steam_sale']);
    expect(extractMilestoneRoomFacts(sale.record).milestoneFlags & 16).toBe(16);
    expect(extractMilestoneRoomFacts(sale.record).saleSavings).toBe(60);
    const gone = settle([bid(200)], [], ['guppys_tail'], 'isaac', 0);
    expect(extractAchievementRoomFacts(gone.record)!.allInBid).toBe(true);
    expect(extractMilestoneRoomFacts(gone.record).milestoneFlags & 16).toBe(0);
  });
  it('accepts Jacob unequal dual bids with at least one delivery, excludes equal/other-role/no-delivery and keeps the 50-percent budget', () => {
    const good = settle(
      [bid(10), bid(20, 'B')],
      [],
      ['more_options'],
      'jacob_esau',
    );
    expect(
      good.record.awards.filter((a) => a.playerId === 'human'),
    ).toHaveLength(1);
    expect(extractMilestoneRoomFacts(good.record).milestoneFlags & 32).toBe(32);
    for (const r of [
      settle([bid(10), bid(10, 'B')], [], ['more_options'], 'jacob_esau'),
      settle([bid(10), bid(20, 'B')], [], ['more_options'], 'isaac'),
      settle(
        [bid(10), bid(20, 'B')],
        [],
        ['more_options', 'guppys_tail'],
        'jacob_esau',
        0,
      ),
    ])
      expect(extractMilestoneRoomFacts(r.record).milestoneFlags & 32).toBe(0);
    expect(() =>
      settle([bid(60), bid(60, 'B')], [], ['more_options'], 'jacob_esau'),
    ).toThrow();
  });
  it('is read-only and consumes no randomness, while new facts pass the single strict event codec', () => {
    const { record, next } = settle([bid(200)], [], ['steam_sale']),
      before = JSON.stringify(record),
      calls = next.mock.calls.length;
    const causes = extractMilestoneRoomFacts(record);
    expect(extractMilestoneRoomFacts(record)).toEqual(causes);
    expect(JSON.stringify(record)).toBe(before);
    expect(next.mock.calls).toHaveLength(calls);
    const f = extractAchievementRoomFacts(record)!;
    expect(
      encodeAchievementEvent({
        stage: 'room',
        facts: {
          ...f,
          missedCooperation: false,
          missedHighPrice: false,
          ...causes,
        },
      }).values,
    ).toHaveLength(8);
  });
});
