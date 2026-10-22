import { expect, it } from 'vitest';
import { selectMarketHistory, missingMarketLabel } from './market-history';
import { publishedMarket } from './market-history.test-helper';
import { defaultRules } from '../game/config';
import { canonicalJson } from '../shared/json-facts';
import { replayMarketModel } from './replay-market';
it('uses actual group high-price placements including a disruptor, never the awarded-item minimum', () => {
  const record = publishedMarket(),
    before = canonicalJson(record);
  const row = selectMarketHistory(
    [record],
    { floorIndex: 0, roomIndex: 1 },
    defaultRules,
  )[0]!;
  expect(row.groups.map((g) => g.cutoff)).toEqual([75, 10]);
  expect(
    record.highPricePlacements.find(
      (p) => p.group === 'A' && p.actionType === 'disrupt',
    ),
  ).toBeTruthy();
  expect(
    record.awards
      .filter((a) => a.group === 'A')
      .every((a) => a.playerId !== record.playersBefore[1]!.id),
  ).toBe(true);
  expect(row.target).toBe(record.baseline!.target);
  expect(row.upper! - row.target!).toBeCloseTo(10);
  expect(row.target! - row.lower!).toBeCloseTo(10);
  expect(canonicalJson(record)).toBe(before);
  expect(Object.keys(row).sort()).toEqual([
    'floorIndex',
    'groups',
    'lower',
    'playerCount',
    'roomIndex',
    'target',
    'upper',
  ]);
});
it('selects the three latest distinct rooms on the current floor by position, not input order', () => {
  const rows = [
    publishedMarket(2),
    publishedMarket(0),
    publishedMarket(4),
    publishedMarket(1),
    publishedMarket(3),
    publishedMarket(3),
    publishedMarket(0, 1),
  ];
  expect(
    selectMarketHistory(
      rows,
      { floorIndex: 0, roomIndex: 4 },
      defaultRules,
    ).map((r) => r.roomIndex),
  ).toEqual([3, 2, 1]);
  expect(
    selectMarketHistory(
      rows,
      { floorIndex: 0, roomIndex: 1 },
      defaultRules,
    ).map((r) => r.roomIndex),
  ).toEqual([0]);
  expect(
    selectMarketHistory(rows, { floorIndex: 1, roomIndex: 0 }, defaultRules),
  ).toEqual([]);
  expect(
    selectMarketHistory([], { floorIndex: 0, roomIndex: 0 }, defaultRules),
  ).toEqual([]);
});
it('filters other floors and current/future rooms before reading their market facts', () => {
  const current = publishedMarket(2),
    future = publishedMarket(4),
    other = publishedMarket(0, 1);
  for (const r of [current, future, other])
    Object.defineProperty(r, 'baseline', {
      get() {
        throw Error('must not inspect unpublished/out-of-scope record');
      },
    });
  expect(
    selectMarketHistory(
      [publishedMarket(0), current, future, other],
      { floorIndex: 0, roomIndex: 2 },
      defaultRules,
    ),
  ).toHaveLength(1);
});
it('uses the public base for each mode/floor, not character starting funds or current balances', () => {
  const record = publishedMarket(0, 1);
  record.playersBefore[0]!.money = 0;
  record.playersBefore[0]!.characterFloorStartingMoney = 600;
  const classic = selectMarketHistory(
    [record],
    { floorIndex: 1, roomIndex: 1 },
    defaultRules,
  )[0]!;
  expect(classic.upper! - classic.target!).toBeCloseTo(50);
  const survival = selectMarketHistory(
    [record],
    { floorIndex: 1, roomIndex: 1 },
    { floorStartingMoney: [1000, 1000], cooperationZoneRatio: 0.1 },
  )[0]!;
  expect(survival.upper! - survival.target!).toBeCloseTo(100);
});
it('preserves all-withdrawn and missing-group cases as absent facts rather than zeros', () => {
  const withdraw = selectMarketHistory(
    [publishedMarket(0, 0, true)],
    { floorIndex: 0, roomIndex: 1 },
    defaultRules,
  )[0]!;
  expect(withdraw.target).toBeNull();
  expect(
    withdraw.groups.every(
      (g) => g.cutoff === null && g.missing === 'no-actions',
    ),
  ).toBe(true);
  const record = publishedMarket();
  record.resolvedActions = record.resolvedActions.filter(
    (a) => a.action.type !== 'withdraw' && a.action.group === 'A',
  );
  record.highPricePlacements = [];
  const row = selectMarketHistory(
    [record],
    { floorIndex: 0, roomIndex: 1 },
    defaultRules,
  )[0]!;
  expect(row.groups[0]).toEqual({
    group: 'A',
    cutoff: null,
    missing: 'no-high-placement',
  });
  expect(row.groups[1]).toEqual({
    group: 'B',
    cutoff: null,
    missing: 'no-actions',
  });
  expect(missingMarketLabel(row.groups[0]!)).toBe('A组无高价名额');
});
it('keeps ties/full precision and agrees exactly with the published replay model', () => {
  const record = publishedMarket();
  const acts = record.resolvedActions.filter(
    (a) => a.action.type !== 'withdraw' && a.action.group === 'A',
  );
  for (const act of acts) act.marketEquivalent = 45.123456789;
  const row = selectMarketHistory(
    [record],
    { floorIndex: 0, roomIndex: 1 },
    defaultRules,
  )[0]!;
  expect(row.groups[0]!.cutoff).toBe(45.123456789);
  const replay = replayMarketModel({ settlement: record }, 10)!;
  expect(row.groups.map((g) => g.cutoff)).toEqual(
    replay.groups.map((g) => g.cutoff),
  );
});
