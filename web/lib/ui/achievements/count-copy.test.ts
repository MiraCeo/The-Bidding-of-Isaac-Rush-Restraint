import { expect, it } from 'vitest';
import { achievementCatalog } from './catalog';
import { revision066Catalog } from './revision066-catalog';
import { achievementPresentation } from './presentation';
import { achievementDetailPresentation } from './detail-presentation';

// Numeric quantities/ordinals only. Proper names (六面骰、背水一战),
// references (同一局、另一组), and mechanic terms (双竞拍) are not counts.
const chineseCount =
  /第[一二两三四五六七八九十]+(?:名|位|层|级)|[一二两三四五六七八九十]+(?:次(?!性)|件|份|条|种|房|名角色|种角色|个(?:不同房间|奖励名额|名额))|(?:大于|小于)零|(?:零分|四位精度)|至少一组/u;

it.each(achievementCatalog)(
  'uses Arabic counts throughout $id descriptions',
  (a) => {
    const copy = achievementPresentation[a.id];
    const detail = achievementDetailPresentation(a);
    for (const text of [
      a.condition,
      copy.summary,
      copy.note,
      detail.summary,
      ...detail.rules,
    ])
      expect(text).not.toMatch(chineseCount);
  },
);

it('preserves every scope/kind/ID/category and all numeric targets except the exact five approved 0.8 closeout values', () => {
  // Independent approved expectations, not read back from runtime config.
  const approved: Record<string, number> = {
    E10: 10,
    F09: 10,
    B16: 5,
    B17: 10,
    E22: 10,
  };
  const facts = (catalog: typeof achievementCatalog) =>
    catalog.map(({ id, target, scope, kind, category }) => ({
      id,
      target,
      scope,
      kind,
      category,
    }));
  expect(facts(achievementCatalog)).toEqual(
    facts(revision066Catalog).map((a) => ({
      ...a,
      target: approved[a.id] ?? a.target,
    })),
  );
});

it('keeps idiomatic achievement names, item names and Roman tier suffixes', () => {
  const name = (id: string) =>
    achievementCatalog.find((a) => a.id === id)!.name;
  expect(name('B12')).toBe('两败俱伤');
  expect(name('C09')).toBe('两处空席');
  expect(name('D06')).toBe('孤注一掷');
  expect(name('D09')).toBe('背水一战 I');
  expect(achievementPresentation.E21.summary).toContain('永恒六面骰');
});

it('keeps quantities explicit in standalone conditions and shared tier boundaries', () => {
  const condition = (id: string) =>
    achievementCatalog.find((a) => a.id === id)!.condition;
  expect(condition('C08')).toContain('2个不同房间');
  expect(condition('B03')).toContain('失去1件');
  expect(condition('E08')).toContain('5名角色');
  expect(condition('E07')).toContain('并列第1也计入');
  expect(condition('E05')).toContain('第1级的3件');
  expect(condition('E01')).toContain('4位精度');
  expect(condition('E01')).toContain('大于0');
});
