import { describe, expect, it, vi } from 'vitest';
import { createGameSession, reduceGameSession } from './game-session';
import { canonicalJson, copySnapshot } from './replay-record';
import {
  replayFloorGroups,
  replaySelectedResult,
  replayEventStages,
  replayRewardVerdict,
  replayOverview,
  replayFieldComparison,
  replayOwnedItems,
  replayAllPlayerTimeline,
  replayPlayerEventGroups,
  replayMoneyTimeline,
} from './replay-view-model';
import { replayMarketModel } from './replay-market';
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
  it('uses one unconnected money segment per observed floor and preserves entry effects', () => {
    const l = log(7),
      before = canonicalJson(l),
      model = replayMoneyTimeline(l, 'human');
    expect(model.segments).toHaveLength(2);
    expect(model.segments.map((s) => s.points.length)).toEqual([5, 2]);
    for (const s of model.segments) {
      const first = l.rooms[s.startIndex]!.settlement.playersBefore[0]!;
      expect(s.startingMoney).toBe(first.characterFloorStartingMoney);
      expect(s.entryMoney).toBe(first.money);
      for (const p of s.points)
        expect(p.money).toBe(l.rooms[p.index]!.settlement.players[0]!.money);
    }
    expect(model.segments[0]!.reset).toBe(false);
    expect(model.segments[1]!.reset).toBe(true);
    expect(canonicalJson(l)).toBe(before);
  });
  it('does not invent missing starting funds or future money segments', () => {
    const l = copySnapshot(log(1));
    l.rooms[0]!.settlement.playersBefore[0]!.characterFloorStartingMoney = null;
    const model = replayMoneyTimeline(l, 'human');
    expect(model.segments[0]!.initialKnown).toBe(false);
    expect(model.segments[0]!.startingMoney).toBe(
      l.rooms[0]!.settlement.playersBefore[0]!.money,
    );
    expect(replayMoneyTimeline(log(0), 'human')).toEqual({
      segments: [],
      maximum: 1,
    });
  });
  it('builds one chronological cumulative-score series per player across actual room boundaries', () => {
    const l = log(7),
      model = replayAllPlayerTimeline(l);
    expect(model.series).toHaveLength(20);
    expect(model.rooms.map((r) => r.location)).toEqual(
      l.rooms.map((r) => r.location),
    );
    for (const series of model.series) {
      expect(series.points).toHaveLength(8);
      expect(series.points[0]!.value).toBe(
        l.rooms[0]!.settlement.playersBefore.find(
          (p) => p.id === series.playerId,
        )!.score,
      );
      series.points.slice(1).forEach((p, i) => {
        expect(p.roomIndex).toBe(i);
        expect(p.value).toBe(
          l.rooms[i]!.settlement.players.find((p) => p.id === series.playerId)!
            .score,
        );
      });
    }
    expect(model.maximum).toBeGreaterThanOrEqual(1);
  });
  it('keeps the timeline empty before settlement and does not invent future rooms', () => {
    expect(replayAllPlayerTimeline(log(0))).toEqual({
      series: [],
      rooms: [],
      maximum: 1,
    });
    const model = replayAllPlayerTimeline(log(2));
    expect(model.rooms).toHaveLength(2);
    expect(
      model.series.every((s) => s.points.at(-1)!.location === 'F1-R2'),
    ).toBe(true);
  });
  it('reads the real entry total and excludes final crown adjustments from the cumulative timeline', () => {
    const l = copySnapshot(log(15));
    l.rooms[0]!.settlement.playersBefore[0]!.score = 23;
    l.final!.ranking[0]!.finalScore += 1000;
    const series = replayAllPlayerTimeline(l).series[0]!;
    expect(series.points[0]!.value).toBe(23);
    expect(series.points.at(-1)!.value).toBe(
      l.rooms[14]!.settlement.players[0]!.score,
    );
  });
  it.each(['roomScore', 'score', 'money'] as const)(
    'compares each player once using only this room: %s',
    (metric) => {
      const r = log(2).rooms[0]!,
        before = canonicalJson(r);
      const model = replayFieldComparison(r, metric);
      expect(model.points).toHaveLength(20);
      expect(new Set(model.points.map((p) => p.playerId)).size).toBe(20);
      for (const point of model.points)
        expect(point.value).toBe(
          metric === 'roomScore'
            ? r.settlement.roomScoreSummaries[point.playerId]!.finalScore
            : r.settlement.players.find((p) => p.id === point.playerId)![
                metric
              ],
        );
      expect(
        model.points.every(
          (p, i) => !i || model.points[i - 1]!.value >= p.value,
        ),
      ).toBe(true);
      expect(canonicalJson(r)).toBe(before);
    },
  );
  it('keeps exact ties tied and all-zero charts finite without a random tie-break', () => {
    const r = copySnapshot(log(1).rooms[0]!);
    for (const s of Object.values(r.settlement.roomScoreSummaries))
      s.finalScore = 0;
    const zero = replayFieldComparison(r, 'roomScore');
    expect(zero.maximum).toBe(1);
    expect(zero.points.every((p) => p.rank === 1 && p.value === 0)).toBe(true);
    r.settlement.roomScoreSummaries.human!.finalScore = 10;
    r.settlement.roomScoreSummaries['ai-1']!.finalScore = 10;
    const tied = replayFieldComparison(r, 'roomScore');
    expect(tied.points.slice(0, 2).map((p) => [p.playerId, p.rank])).toEqual([
      ['human', 1],
      ['ai-1', 1],
    ]);
    expect(tied.points[2]!.rank).toBe(3);
  });
  it('splits saved cumulative totals into before and actual increase, including retroactive score', () => {
    const r = copySnapshot(log(2).rooms[1]!);
    const before = r.settlement.playersBefore[0]!,
      after = r.settlement.players[0]!;
    before.score = 88.99;
    after.score = 226.45;
    r.settlement.roomScoreSummaries.human!.initialScore = 125;
    r.settlement.roomScoreSummaries.human!.retroactiveScore = 12.46;
    const p = replayFieldComparison(r, 'score').points.find(
      (p) => p.playerId === 'human',
    )!;
    expect(p.before).toBe(88.99);
    expect(p.change).toBeCloseTo(137.46, 8);
    expect(p.value).toBe(226.45);
    expect(p.before + p.change).toBe(p.value);
  });
  it('uses actual entry money after floor reset and scales to both balances rather than their sum', () => {
    const r = copySnapshot(log(6).rooms[5]!);
    r.previousPlayers![0]!.money = 1;
    r.settlement.playersBefore[0]!.money = 500;
    r.settlement.players[0]!.money = 25;
    const model = replayFieldComparison(r, 'money');
    const p = model.points.find((p) => p.playerId === 'human')!;
    expect([p.before, p.value, p.change]).toEqual([500, 25, -475]);
    expect(model.maximum).toBe(
      Math.max(1, ...model.points.flatMap((p) => [p.before, p.value])),
    );
  });
  it('keeps money increases, refunds and zero changes separate from gross action cost', () => {
    const r = copySnapshot(log(1).rooms[0]!);
    r.settlement.players[0]!.money = r.settlement.playersBefore[0]!.money + 7;
    r.settlement.events.push({
      type: 'refund',
      playerId: 'human',
      amount: 3,
      message: '返款。',
    });
    const p = replayFieldComparison(r, 'money').points.find(
      (p) => p.playerId === 'human',
    )!;
    expect(p.change).toBe(7);
    expect(p.refund).toBe(3);
    expect(p.before - p.cost + p.refund + p.otherMoneyChange).toBe(p.value);
    expect(p.cost).not.toBe(-p.change);
  });
  it('groups every original event by affected players, retaining stage and shared transfer identity', () => {
    const r = copySnapshot(log(1).rooms[0]!);
    r.entryEvents.push({
      type: 'money',
      itemId: 'money_bag',
      playerId: 'ai-2',
      amount: 4,
      message: '偷钱袋从 ai-1 窃取 4 资金。',
    });
    const before = canonicalJson(r),
      model = replayPlayerEventGroups(r);
    expect(model.players).toHaveLength(20);
    expect(model.total).toBe(r.entryEvents.length + r.settlement.events.length);
    expect(
      model.stages.flatMap((s) => s.events.map((e) => e.sequence)),
    ).toEqual(Array.from({ length: model.total }, (_, i) => i + 1));
    const transfer = model.stages[0]!.events.at(-1)!;
    for (const playerId of ['ai-1', 'ai-2']) {
      const p = model.players.find((p) => p.playerId === playerId)!;
      expect(p.stages[0]!.events).toContain(transfer);
      expect(p.count).toBe(p.stages.reduce((n, s) => n + s.events.length, 0));
      for (const stage of p.stages)
        expect(stage.events.map((e) => e.sequence)).toEqual(
          stage.events.map((e) => e.sequence).sort((a, b) => a - b),
        );
    }
    expect(canonicalJson(r)).toBe(before);
  });
  it('retains a compact zero-event player group instead of inventing events', () => {
    const r = copySnapshot(log(1).rooms[0]!);
    r.entryEvents = [];
    r.settlement.events = [];
    const model = replayPlayerEventGroups(r);
    expect(model.total).toBe(0);
    expect(model.players).toHaveLength(20);
    expect(model.players.every((p) => p.count === 0)).toBe(true);
  });
  it('groups end-of-room inventory, counts copies, and identifies genuinely new instances', () => {
    const r = copySnapshot(log(1).rooms[0]!);
    const before = r.settlement.playersBefore[0]!;
    const item = before.items[0]!;
    r.settlement.players[0]!.items = [
      ...before.items,
      { ...item, instanceId: 'ui-new-instance', acquiredOrder: 50 },
    ];
    const grouped = replayOwnedItems(r, 'human').find(
      (p) => p.itemId === item.itemId,
    )!;
    expect(grouped.copies).toBe(
      before.items.filter((i) => i.itemId === item.itemId).length + 1,
    );
    expect(grouped.gained).toBe(1);
  });
  it('keeps market impact, raw cooperation input and adjusted scoring input distinct', () => {
    const r = copySnapshot(log(1).rooms[0]!);
    const action = r.settlement.resolvedActions.find(
      (a) => a.playerId === 'human',
    )!;
    action.action = { type: 'disrupt', group: 'A', amount: 30 };
    action.marketEquivalent = 75;
    action.scoringEquivalent = 37.5;
    r.settlement.scoreBreakdowns.human!.actions[0]!.scoringValue = 5;
    const p = replayMarketModel(r, 10)!.groups[0]!.points.find(
      (p) => p.playerId === 'human',
    )!;
    expect([
      p.nominalAmount,
      p.value,
      p.scoringEquivalent,
      p.scoringValue,
    ]).toEqual([30, 75, 37.5, 5]);
  });
  it('plots both genuine double actions and omits withdrawn turns instead of making zero bids', () => {
    let s = reduceGameSession(createGameSession(42), {
      type: 'start_game',
      characterId: 'jacob_esau',
    });
    s = reduceGameSession(s, {
      type: 'submit_player_turn',
      turn: {
        playerId: 'human',
        actions: [
          { type: 'bid', group: 'A', amount: 10 },
          { type: 'bid', group: 'B', amount: 11 },
        ],
      },
    });
    const record = s.replay!.rooms[0]!,
      model = replayMarketModel(record, 10)!;
    expect(
      model.groups
        .flatMap((g) => g.points)
        .filter((p) => p.playerId === 'human'),
    ).toHaveLength(2);
    expect(model.groups.flatMap((g) => g.points)).toHaveLength(
      record.settlement.baseline!.participantCount,
    );
    const withdrawn = copySnapshot(record);
    withdrawn.settlement.baseline = null;
    expect(replayMarketModel(withdrawn, 10)).toBeNull();
  });
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
    replayAllPlayerTimeline(l);
    replayMoneyTimeline(l, 'human');
    for (const r of l.rooms) {
      replaySelectedResult(r, 'human');
      replayOwnedItems(r, 'human');
      replayFieldComparison(r, 'roomScore');
      replayFieldComparison(r, 'money');
      replayMarketModel(r, 10);
      replayRewardVerdict(r, 'human', 'A');
      replayEventStages(r, 'human', true);
      replayPlayerEventGroups(r);
    }
    expect(canonicalJson(l)).toBe(before);
    expect(random).not.toHaveBeenCalled();
    random.mockRestore();
  });
});
