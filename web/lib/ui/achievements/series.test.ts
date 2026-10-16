import { it, expect } from 'vitest';
import {
  selectAchievementCards,
  groupAchievementCards,
  achievementSeries,
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
it('keeps 87 independent badges as 57 cards and preserves the original three series orders', () => {
  expect(achievementCatalog).toHaveLength(87);
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
    selectAchievementCards({ ...all, query: 'b08' }, p, earned).map((c) => [
      c.id,
      c.definition.id,
    ]),
  ).toEqual([['B02', 'B08']]);
  expect(
    selectAchievementCards({ ...all, query: 'B08', tier: 'bronze' }, p, earned),
  ).toHaveLength(0);
  expect(
    selectAchievementCards(all, p, earned).find((c) => c.id === 'B02')!
      .completed,
  ).toBe(1);
});
it('shows the next unmatched stage, retains an old silver without inventing bronze, and never treats partial as fully complete', () => {
  const p = { B02: 15, B07: 15, B08: 15 };
  const legacy = selectAchievementCards(all, p, { B02: at }).find(
    (c) => c.id === 'B02',
  )!;
  expect(legacy.definition.id).toBe('B07');
  expect(legacy.completed).toBe(1);
  const partial = selectAchievementCards(all, p, { B07: at, B02: at }).find(
    (c) => c.id === 'B02',
  )!;
  expect(partial.definition.id).toBe('B08');
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
