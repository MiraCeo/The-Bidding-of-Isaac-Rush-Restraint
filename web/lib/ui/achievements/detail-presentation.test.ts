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
    if (seriesForAchievement(a.id)) {
      expect(copy.rules).toContain(
        a.condition.replace(String(a.target), '目标值'),
      );
      expect(copy.unit).toBeTruthy();
    } else expect(copy.rules).toContain(a.condition);
    expect(JSON.stringify(a)).toBe(before);
  },
);
it('covers all 25 series without replacing unrelated rank, role or branch boundaries', () => {
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
  expect(rules('E05')).toContain('第一级的3件');
  expect(rules('A11')).toContain('第6及以后');
});
