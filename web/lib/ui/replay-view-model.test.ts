import { describe, expect, it, vi } from 'vitest';
import { createGameSession, reduceGameSession } from './game-session';
import { canonicalJson, copySnapshot } from './replay-record';
import {
  replayFloorGroups,
  replaySelectedResult,
  replayEventStages,
  replayRewardVerdict,
  replayOverview,
} from './replay-view-model';
function log(count = 15) {
  let s = reduceGameSession(createGameSession(42), {
    type: 'start_game',
    characterId: 'isaac',
  });
  for (let i = 0; i < count; i++) {
    s = reduceGameSession(s, {
      type: 'submit_player_turn',
      turn: { playerId: 'human', actions: [{ type: 'withdraw' }] },
    });
    s = reduceGameSession(s, { type: 'advance_room' });
  }
  return s.replay!;
}
describe('read-only replay projections', () => {
  it('groups exactly the recorded rooms by floor, with stable flat indices', () => {
    const groups = replayFloorGroups(log(7), 'human');
    expect(groups.map((f) => f.rooms.length)).toEqual([5, 2]);
    expect(groups.flatMap((f) => f.rooms.map((r) => r.index))).toEqual([
      0, 1, 2, 3, 4, 5, 6,
    ]);
    expect(groups.some((f) => f.floor === 2)).toBe(false);
  });
  it('separates floor-reset entry changes from settlement net money changes', () => {
    const l = log();
    const first = replaySelectedResult(l.rooms[0]!, 'human');
    expect(first.entryChange).toBeNull();
    expect(first.floorReset).toBe(false);
    const nextFloor = replaySelectedResult(l.rooms[5]!, 'human');
    expect(nextFloor.floorReset).toBe(true);
    expect(nextFloor.entryChange).toBe(
      nextFloor.before.money - nextFloor.previous!.money,
    );
    expect(nextFloor.moneyDelta).toBe(
      nextFloor.after.money - nextFloor.before.money,
    );
  });
  it('accounts for refunds and other money effects without labeling them as extra bid cost', () => {
    for (const r of log().rooms)
      for (const p of r.settlement.players) {
        const row = replaySelectedResult(r, p.id);
        expect(row.after.money).toBeCloseTo(
          row.before.money - row.cost + row.refund + row.otherMoneyChange,
          6,
        );
      }
  });
  it('shows special score events such as heart retrospection in the key timeline', () => {
    const r = copySnapshot(log(1).rooms[0]!);
    r.settlement.events.push({
      type: 'score',
      playerId: 'human',
      itemId: 'moms_heart',
      amount: 12,
      message: '心脏追溯增加12分。',
    });
    r.settlement.events.push({
      type: 'score',
      playerId: 'human',
      amount: 0,
      message: '普通积分事件',
    });
    const events = replayEventStages(r, 'human', false).flatMap(
      (s) => s.events,
    );
    expect(events.some((e) => e.itemId === 'moms_heart')).toBe(true);
    expect(events.some((e) => e.message === '普通积分事件')).toBe(false);
  });
  it('distinguishes eligibility from actual destruction and delivery', () => {
    const r = copySnapshot(log(1).rooms[0]!);
    r.settlement.entitlements.push({
      playerId: 'human',
      group: 'A',
      sources: ['highest'],
    });
    r.settlement.events.push({
      type: 'destroy',
      playerId: 'human',
      group: 'A',
      message: '奖励消失',
    });
    expect(replayRewardVerdict(r, 'human', 'A').status).toBe('undelivered');
    r.settlement.awards.push({
      playerId: 'human',
      group: 'A',
      itemId: r.settlement.room.rewards[0].itemId,
      copies: 2,
    });
    expect(replayRewardVerdict(r, 'human', 'A').award!.copies).toBe(2);
    expect(replayRewardVerdict(r, 'human', 'A').status).toBe('awarded');
  });
  it('uses stored final results, and keeps partial games without a fake final score or rank', () => {
    const partial = replayOverview(log(3), 'human');
    expect(partial.finalScore).toBeNull();
    expect(partial.rank).toBeNull();
    expect(partial.points).toHaveLength(3);
    const full = log();
    const overview = replayOverview(full, 'human');
    expect(overview.cumulative).toBe(
      full.rooms.at(-1)!.settlement.players.find((p) => p.id === 'human')!
        .score,
    );
    expect(overview.finalScore).toBe(
      full.final!.ranking.find((p) => p.playerId === 'human')!.finalScore,
    );
  });
  it('does not mutate archive data or invoke randomness while building any view', () => {
    const l = log();
    const before = canonicalJson(l);
    const random = vi.spyOn(Math, 'random');
    replayFloorGroups(l, 'human');
    replayOverview(l, 'ai-1');
    for (const r of l.rooms) {
      replaySelectedResult(r, 'human');
      replayRewardVerdict(r, 'human', 'A');
      replayEventStages(r, 'human', true);
    }
    expect(canonicalJson(l)).toBe(before);
    expect(random).not.toHaveBeenCalled();
    random.mockRestore();
  });
});
