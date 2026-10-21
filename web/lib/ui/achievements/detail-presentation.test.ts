import { expect, it } from 'vitest';
import { achievementCatalog } from './catalog';
import { achievementDetailPresentation } from './detail-presentation';
import { achievementSeries, seriesForAchievement } from './series';

it.each(achievementCatalog)(
  'preserves $id complete boundaries while factoring only its tier threshold',
  (a) => {
    const before = JSON.stringify(a),
      copy = achievementDetailPresentation(a);
    expect(copy.summary).toBeTruthy();
    expect(copy.rules.length).toBeGreaterThan(0);
    expect(new Set(copy.rules).size).toBe(copy.rules.length);
    const series = seriesForAchievement(a.id);
    if (series) {
      expect(copy.rules).toContain(
        series.id === 'S-FIRST-FLOORS'
          ? a.condition.replace(/前[135]层/, '前目标值层')
          : a.condition.replace(String(a.target), '目标值'),
      );
      expect(copy.unit).toBeTruthy();
    } else expect(copy.rules).toContain(a.condition);
    expect(JSON.stringify(a)).toBe(before);
  },
);
it('covers all 30 series without replacing unrelated rank, role or branch boundaries', () => {
  expect(achievementSeries).toHaveLength(30);
  for (const series of achievementSeries) {
    const copies = series.ids.map((id) =>
      achievementDetailPresentation(
        achievementCatalog.find((a) => a.id === id)!,
      ),
    );
    expect(
      copies.every(
        (copy) => JSON.stringify(copy) === JSON.stringify(copies[0]),
      ),
    ).toBe(true);
  }
  const rules = (id: string) =>
    achievementDetailPresentation(
      achievementCatalog.find((a) => a.id === id)!,
    ).rules.join('');
  expect(rules('A13')).toContain('同一父分支');
  expect(rules('E05')).toContain('第1级的3件');
  expect(rules('A11')).toContain('第6及以后');
});

it('retains the fixed first floor and factors the 1/3/5 tier goals, not the first digit', () => {
  const copy = achievementDetailPresentation(
    achievementCatalog.find((a) => a.id === 'F15')!,
  );
  expect(copy.summary).toContain('第1层');
  expect(copy.rules).toHaveLength(2);
  for (const rule of copy.rules) {
    expect(rule).toContain('从第1层起连续通过前目标值层');
    expect(rule).not.toContain('第目标值层');
    expect(rule).not.toMatch(/前[135]层/);
  }
  expect(copy.rules.filter((r) => r.includes('困难或最高AI难度'))).toHaveLength(
    1,
  );
});
