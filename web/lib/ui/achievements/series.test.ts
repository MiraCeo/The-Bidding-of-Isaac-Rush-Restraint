import { achievementNumber } from './numbering';
import { it, expect } from 'vitest';
import {
  selectAchievementCards,
  groupAchievementCards,
  achievementSeries,
  summarizeAchievementCards,
} from './series';
import { achievementCatalog } from './catalog';
import type { AchievementFilters } from './presentation';
const all: AchievementFilters = {
  query: '',
  category: 'all',
  status: 'all',
  sort: 'catalog',
  tier: 'all',
};
const at = '2026-10-15T00:00:00.000Z';
it('keeps 107 independent badges as 57 cards and preserves the original three series orders', () => {
  expect(achievementCatalog).toHaveLength(107);
  const cards = selectAchievementCards(all, {}, {});
  expect(cards).toHaveLength(57);
  expect(groupAchievementCards(cards).map((g) => g.items.length)).toEqual([
    5, 10, 9, 10, 14, 9,
  ]);
  expect(achievementSeries.slice(0, 3).map((s) => s.ids)).toEqual([
    ['B07', 'B02', 'B08'],
    ['D07', 'D03', 'D08'],
    ['F07', 'F08', 'F09'],
  ]);
  expect(cards.find((c) => c.id === 'B02')!.definition.id).toBe('B07');
});
it('requires the same child badge to satisfy tier/status/query intersections', () => {
  const p = { B07: 1, B02: 1, B08: 1 },
    earned = { B07: at };
  expect(
    selectAchievementCards(
      { ...all, tier: 'silver', status: 'achieved' },
      p,
      earned,
    ).some((c) => c.id === 'B02'),
  ).toBe(false);
  expect(
    selectAchievementCards(
      { ...all, tier: 'silver', status: 'pending' },
      p,
      earned,
    ).find((c) => c.id === 'B02')!.definition.id,
  ).toBe('B02');
  expect(
    selectAchievementCards(
      { ...all, query: achievementNumber('B08').toLowerCase() },
      p,
      earned,
    ).map((c) => [c.id, c.definition.id]),
  ).toEqual([['B02', 'B08']]);
  expect(
    selectAchievementCards(
      { ...all, query: achievementNumber('B08'), tier: 'bronze' },
      p,
      earned,
    ),
  ).toHaveLength(0);
  expect(
    selectAchievementCards(all, p, earned).find((c) => c.id === 'B02')!
      .completed,
  ).toBe(1);
});
it('shows the highest earned matching stage, retains an old silver without inventing bronze, and keeps total earned stages separate', () => {
  const p = { B02: 15, B07: 15, B08: 15 };
  const legacy = selectAchievementCards(all, p, { B02: at }).find(
    (c) => c.id === 'B02',
  )!;
  expect(legacy.definition.id).toBe('B02');
  expect(legacy.completed).toBe(1);
  const partial = selectAchievementCards(all, p, { B07: at, B02: at }).find(
    (c) => c.id === 'B02',
  )!;
  expect(partial.definition.id).toBe('B02');
  expect(partial.completed).toBe(2);
  const complete = selectAchievementCards(all, p, {
    B07: at,
    B02: at,
    B08: at,
  }).find((c) => c.id === 'B02')!;
  expect(complete.completed).toBe(3);
});
it('keeps selectors read-only and uses matching achievement dates rather than another hidden stage to sort', () => {
  const progress = Object.freeze({ B07: 1, B02: 5, B08: 5 }),
    earned = Object.freeze({ B07: at, B02: '2026-10-16T00:00:00.000Z' });
  const card = selectAchievementCards(
    { ...all, tier: 'bronze', status: 'achieved', sort: 'recent' },
    progress,
    earned,
  ).find((c) => c.id === 'B02')!;
  expect(card.matchingIds).toEqual(['B07']);
  expect(card.definition.id).toBe('B07');
  expect(progress.B02).toBe(5);
});
it('counts one card for any number of earned stages, with exact default per-category card totals', () => {
  const earned = Object.freeze({ B07: at, B02: at, B08: at, E06: at });
  const cards = selectAchievementCards(all, {}, earned);
  expect(summarizeAchievementCards(cards, earned)).toEqual({
    earned: 2,
    total: 57,
  });
  expect(
    groupAchievementCards(cards).map((g) =>
      summarizeAchievementCards(g.items, earned),
    ),
  ).toEqual([
    { earned: 0, total: 5 },
    { earned: 1, total: 10 },
    { earned: 0, total: 9 },
    { earned: 0, total: 10 },
    { earned: 1, total: 14 },
    { earned: 0, total: 9 },
  ]);
});
it('includes a partially collected card once but never borrows an earned bronze for silver or pending counts', () => {
  const earned = Object.freeze({ B07: at });
  const count = (filter: Partial<AchievementFilters>) =>
    summarizeAchievementCards(
      selectAchievementCards(
        { ...all, query: achievementNumber('B02'), ...filter },
        {},
        earned,
      ),
      earned,
    );
  // B02 is a child ID: its bronze sibling does not satisfy this query.
  expect(count({})).toEqual({ earned: 0, total: 1 });
  expect(count({ query: '财大气粗' })).toEqual({ earned: 1, total: 1 });
  expect(count({ query: '财大气粗', status: 'achieved' })).toEqual({
    earned: 1,
    total: 1,
  });
  expect(count({ query: '财大气粗', status: 'pending' })).toEqual({
    earned: 0,
    total: 1,
  });
  expect(count({ query: '财大气粗', tier: 'silver' })).toEqual({
    earned: 0,
    total: 1,
  });
  expect(count({ tier: 'silver', status: 'achieved' })).toEqual({
    earned: 0,
    total: 0,
  });
});
it('keeps hidden names concealed and applies query, tier and status before counting cards', () => {
  const earned = Object.freeze({ B07: at, B02: at });
  const count = (filters: Partial<AchievementFilters>) =>
    summarizeAchievementCards(
      selectAchievementCards({ ...all, ...filters }, {}, earned),
      earned,
    );
  expect(count({ query: '不存在' })).toEqual({ earned: 0, total: 0 });
  expect(count({ query: '祸不单行' })).toEqual({ earned: 0, total: 0 });
  expect(count({ query: achievementNumber('C07') })).toEqual({
    earned: 0,
    total: 1,
  });
  expect(count({ query: achievementNumber('B08'), tier: 'bronze' })).toEqual({
    earned: 0,
    total: 0,
  });
  expect(count({ tier: 'silver', status: 'achieved' })).toEqual({
    earned: 1,
    total: 1,
  });
  expect(count({ tier: 'gold', status: 'achieved' })).toEqual({
    earned: 0,
    total: 0,
  });
});
it('does not change counts when only ordering changes and never mutates the matching card list', () => {
  const earned = Object.freeze({ B07: at, B02: at }),
    progress = Object.freeze({ B08: 17 });
  for (const sort of ['catalog', 'recent', 'progress'] as const) {
    const cards = selectAchievementCards({ ...all, sort }, progress, earned);
    const before = JSON.stringify(cards);
    expect(summarizeAchievementCards(cards, earned)).toEqual({
      earned: 1,
      total: 57,
    });
    expect(JSON.stringify(cards)).toBe(before);
  }
  expect(progress).toEqual({ B08: 17 });
  expect(earned).toEqual({ B07: at, B02: at });
});
it('chooses the highest earned matching tier independently of sort order and never previews a future owned tier', () => {
  for (const sort of ['catalog', 'recent', 'progress'] as const) {
    for (const [earned, focus] of [
      [{}, 'A01'],
      [{ A01: at }, 'A01'],
      [{ A01: at, A08: at }, 'A08'],
      [{ A01: at, A08: at, A09: at }, 'A09'],
      [{ A08: at }, 'A08'],
    ] as const) {
      const card = selectAchievementCards(
        { ...all, query: '失败乃成功之母', sort },
        { A01: 100, A08: 100, A09: 100 },
        earned,
      )[0]!;
      expect(card.definition.id).toBe(focus);
      expect(card.matchingCompleted).toBe(Object.keys(earned).length);
      expect(card.completed).toBe(Object.keys(earned).length);
    }
  }
});
it('keeps matching earned count separate from global collection when a tier, child ID or pending filter is applied', () => {
  const earned = { A01: at, A08: at };
  const select = (f: Partial<AchievementFilters>) =>
    selectAchievementCards(
      { ...all, query: '失败乃成功之母', ...f },
      {},
      earned,
    )[0]!;
  expect(select({ tier: 'gold' })).toMatchObject({
    definition: { id: 'A09' },
    matchingIds: ['A09'],
    matchingCompleted: 0,
    completed: 2,
  });
  expect(select({ tier: 'silver' })).toMatchObject({
    definition: { id: 'A08' },
    matchingIds: ['A08'],
    matchingCompleted: 1,
    completed: 2,
  });
  expect(select({ status: 'pending' })).toMatchObject({
    definition: { id: 'A09' },
    matchingCompleted: 0,
    completed: 2,
  });
  expect(select({ query: achievementNumber('A09') })).toMatchObject({
    definition: { id: 'A09' },
    matchingCompleted: 0,
  });
  expect(select({ query: achievementNumber('A01') })).toMatchObject({
    definition: { id: 'A01' },
    matchingCompleted: 1,
  });
  expect(
    selectAchievementCards(
      { ...all, query: achievementNumber('A09'), status: 'achieved' },
      {},
      earned,
    ),
  ).toHaveLength(0);
});
