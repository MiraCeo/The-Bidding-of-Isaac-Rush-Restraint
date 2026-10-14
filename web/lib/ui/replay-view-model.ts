import type { RewardGroup } from '../game/types';
import type { ReplayLog, ReplayRoomRecord } from './replay-record';
import { replayEventRelatedTo, replayPlayerRows } from './replay-display';

export type ReplayFieldMetric = 'roomScore' | 'score' | 'money';
/** Each score is the recorded cumulative total at a real room boundary, not a recomputation. */
export function replayAllPlayerTimeline(log: ReplayLog) {
  const first = log.rooms[0];
  if (!first) return { series: [], maximum: 1, rooms: [] };
  const rooms = log.rooms.map((r, index) => ({
    index,
    location: r.location,
    floor: r.settlement.room.floorIndex,
  }));
  const series = first.settlement.playersBefore.map((p) => ({
    playerId: p.id,
    points: [
      { roomIndex: -1, location: '入场', value: p.score },
      ...log.rooms.map((r, roomIndex) => ({
        roomIndex,
        location: r.location,
        value: r.settlement.players.find((after) => after.id === p.id)!.score,
      })),
    ],
  }));
  return {
    series,
    rooms,
    maximum: Math.max(
      1,
      ...series.flatMap((s) => s.points.map((p) => p.value)),
    ),
  };
}
/** One room, one unit, one point per player. Sorting is display-only, never a tie break. */
export function replayFieldComparison(
  record: ReplayRoomRecord,
  metric: ReplayFieldMetric,
) {
  const points = record.settlement.players
    .map((p, order) => {
      const before = record.settlement.playersBefore.find(
        (b) => b.id === p.id,
      )!;
      const result = replaySelectedResult(record, p.id);
      const value =
        metric === 'roomScore'
          ? record.settlement.roomScoreSummaries[p.id]!.finalScore
          : p[metric];
      const previous = metric === 'roomScore' ? 0 : before[metric];
      return {
        playerId: p.id,
        value,
        before: previous,
        change: value - previous,
        cost: result.cost,
        refund: result.refund,
        otherMoneyChange: result.otherMoneyChange,
        order,
      };
    })
    .sort((a, b) => b.value - a.value || a.order - b.order);
  return {
    metric,
    maximum: Math.max(1, ...points.flatMap((p) => [p.value, p.before])),
    points: points.map((p) => ({
      ...p,
      rank: 1 + points.filter((other) => other.value > p.value).length,
    })),
  };
}
export function replayOwnedItems(record: ReplayRoomRecord, playerId: string) {
  const after = record.settlement.players.find((p) => p.id === playerId)!;
  const before = record.settlement.playersBefore.find(
    (p) => p.id === playerId,
  )!;
  return [...new Set(after.items.map((i) => i.itemId))].map((itemId) => ({
    itemId,
    copies: after.items.filter((i) => i.itemId === itemId).length,
    gained: after.items.filter(
      (i) =>
        i.itemId === itemId &&
        !before.items.some((old) => old.instanceId === i.instanceId),
    ).length,
  }));
}
/** Money snapshots form separate floor segments; a reset is never connected as ordinary gain. */
export function replayMoneyTimeline(log: ReplayLog, playerId: string) {
  const segments = replayFloorGroups(log, playerId).map((floor) => {
    const first = floor.rooms[0]!;
    const before = first.record.settlement.playersBefore.find(
      (p) => p.id === playerId,
    )!;
    const atEntry = first.record.settlement.room.roomIndex === 0;
    return {
      floor: floor.floor,
      startIndex: first.index,
      reset: atEntry && floor.floor > 0,
      initialKnown: atEntry && before.characterFloorStartingMoney !== null,
      startingMoney: atEntry
        ? (before.characterFloorStartingMoney ?? before.money)
        : before.money,
      entryMoney: before.money,
      points: floor.rooms.map(({ record, index }) => {
        const row = replaySelectedResult(record, playerId);
        return {
          index,
          location: record.location,
          before: row.before.money,
          money: row.after.money,
          cost: row.cost,
          refund: row.refund,
          otherMoneyChange: row.otherMoneyChange,
        };
      }),
    };
  });
  return {
    segments,
    maximum: Math.max(
      1,
      ...segments.flatMap((s) => [
        s.startingMoney,
        s.entryMoney,
        ...s.points.flatMap((p) => [p.before, p.money]),
      ]),
    ),
  };
}

/** Display-only projections. No RNG, AI, settlement or live-session writes. */
export function replayFloorGroups(log: ReplayLog, playerId: string) {
  const floors = new Map<
    number,
    Array<{
      record: ReplayRoomRecord;
      index: number;
      score: number;
      awards: number;
    }>
  >();
  log.rooms.forEach((record, index) => {
    const floor = record.settlement.room.floorIndex;
    const rooms = floors.get(floor) ?? [];
    rooms.push({
      record,
      index,
      score: record.settlement.roomScoreSummaries[playerId]?.finalScore ?? 0,
      awards: record.settlement.awards
        .filter((a) => a.playerId === playerId)
        .reduce((sum, a) => sum + a.copies, 0),
    });
    floors.set(floor, rooms);
  });
  return [...floors].map(([floor, rooms]) => ({
    floor,
    rooms,
    total: rooms.reduce((sum, r) => sum + r.score, 0),
  }));
}
export function replaySelectedResult(
  record: ReplayRoomRecord,
  playerId: string,
) {
  const row = replayPlayerRows(record).find((r) => r.after.id === playerId);
  if (!row) throw new Error('回放中没有这个玩家。');
  const actions = record.settlement.resolvedActions.filter(
    (a) => a.playerId === playerId,
  );
  const cost = actions.reduce((sum, a) => sum + a.actualCost, 0);
  const refund = record.settlement.events
    .filter((e) => e.playerId === playerId && e.type === 'refund')
    .reduce((sum, e) => sum + (e.amount ?? 0), 0);
  return {
    ...row,
    actions,
    cost,
    refund,
    otherMoneyChange: row.moneyDelta + cost - refund,
    entryChange: row.previous ? row.before.money - row.previous.money : null,
    floorReset: !!row.previous && record.settlement.room.roomIndex === 0,
    breakdown: record.settlement.scoreBreakdowns[playerId],
  };
}
export function replayRewardVerdict(
  record: ReplayRoomRecord,
  playerId: string,
  group: RewardGroup,
) {
  const s = record.settlement;
  const reward = s.room.rewards.find((r) => r.group === group)!;
  const actions = s.resolvedActions.filter(
    (a) =>
      a.playerId === playerId &&
      a.action.type !== 'withdraw' &&
      a.action.group === group,
  );
  const entitlement = s.entitlements.find(
    (e) => e.playerId === playerId && e.group === group,
  );
  const award = s.awards.find(
    (a) => a.playerId === playerId && a.group === group,
  );
  const placements = [
    ...s.highPricePlacements,
    ...s.cooperationPlacements,
  ].filter((p) => p.playerId === playerId && p.group === group);
  const causes = s.events.filter(
    (e) =>
      e.playerId === playerId &&
      e.group === group &&
      (e.type === 'destroy' || e.type === 'duplicate'),
  );
  const status = award
    ? 'awarded'
    : entitlement
      ? 'undelivered'
      : placements.some((p) => p.actionType === 'disrupt')
        ? 'occupied'
        : 'unqualified';
  return { reward, actions, entitlement, award, causes, status };
}
export function replayEventStages(
  record: ReplayRoomRecord,
  playerId: string,
  allEvents: boolean,
) {
  return [
    { title: '进入本房', events: record.entryEvents },
    { title: '提交与结算', events: record.settlement.events },
  ].map((stage) => ({
    ...stage,
    events: stage.events.filter(
      (e) =>
        allEvents ||
        (replayEventRelatedTo(e, playerId) &&
          e.type !== 'cost' &&
          e.type !== 'entitlement' &&
          (e.type !== 'score' || !!e.itemId || !!e.effectItemId)),
    ),
  }));
}
/** Shared events may appear for both parties, but retain one original sequence identity. */
export function replayPlayerEventGroups(record: ReplayRoomRecord) {
  let sequence = 0;
  const stages = replayEventStages(record, '', true).map((stage) => ({
    title: stage.title,
    events: stage.events.map((event) => ({ event, sequence: ++sequence })),
  }));
  return {
    total: sequence,
    stages,
    players: record.settlement.players.map((p) => {
      const related = stages.map((stage) => ({
        title: stage.title,
        events: stage.events.filter(({ event }) =>
          replayEventRelatedTo(event, p.id),
        ),
      }));
      return {
        playerId: p.id,
        stages: related,
        count: related.reduce((sum, s) => sum + s.events.length, 0),
        result: replaySelectedResult(record, p.id),
      };
    }),
  };
}
export function replayOverview(log: ReplayLog, playerId: string) {
  const points = log.rooms.map((r, index) => {
    const row = replaySelectedResult(r, playerId);
    return {
      index,
      location: r.location,
      floor: r.settlement.room.floorIndex,
      score: row.after.score,
      money: row.after.money,
      roomScore: row.score.finalScore,
      cost: row.cost,
      refund: row.refund,
      awards: row.awards.reduce((sum, a) => sum + a.copies, 0),
    };
  });
  const final = log.final?.ranking.find((p) => p.playerId === playerId);
  return {
    points,
    cumulative: points.at(-1)?.score ?? 0,
    cost: points.reduce((sum, p) => sum + p.cost, 0),
    refund: points.reduce((sum, p) => sum + p.refund, 0),
    awards: points.reduce((sum, p) => sum + p.awards, 0),
    finalScore: final?.finalScore ?? null,
    rank: final
      ? 1 +
        log.final!.ranking.filter((p) => p.finalScore > final.finalScore).length
      : null,
  };
}
