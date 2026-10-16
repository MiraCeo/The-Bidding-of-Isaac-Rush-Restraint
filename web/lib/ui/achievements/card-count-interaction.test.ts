// @vitest-environment happy-dom
import { achievementNumber } from './numbering';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, it, expect } from 'vitest';
import { AchievementProgress } from '../../../components/game/achievement-progress';
import {
  createPlayerProfile,
  playerProfileKey,
  type PlayerProfile,
} from '../player-profile';
import { appendCf, cfRoom, cfNow } from './revision058.test-helper';
import { gameSaveKey } from '../game-save';
(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root, node: HTMLDivElement;
beforeEach(() => {
  localStorage.clear();
  node = document.createElement('div');
  document.body.append(node);
  root = createRoot(node);
});
afterEach(async () => {
  await act(async () => root.unmount());
  node.remove();
});
function partialProfile() {
  let p = appendCf(createPlayerProfile(cfNow), cfRoom(0, { code: 1 }));
  for (let i = 0; i < 18; i++) p = appendCf(p, cfRoom(0, { mask: 256 }));
  return p; // A01 bronze plus C06 bronze / C14 silver: 3 badges on 2 cards.
}
const mount = (profile: PlayerProfile) =>
  act(async () => root.render(createElement(AchievementProgress, { profile })));
const facet = (id: string) =>
  node.querySelector<HTMLButtonElement>(
    '.achievement-categories [data-category="' + id + '"]',
  )!;
const count = (id: string) => ({
  earned: Number(facet(id).dataset.earned),
  total: Number(facet(id).dataset.total),
});
const click = (el: HTMLElement) => act(async () => el.click());
const cards = () => [
  ...node.querySelectorAll<HTMLButtonElement>('.achievement-card'),
];
async function select(index: number, value: string) {
  await act(async () => {
    const el = node.querySelectorAll('select')[index]!;
    el.value = value;
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
}
async function search(value: string) {
  await act(async () => {
    const el = node.querySelector<HTMLInputElement>('input[type=search]')!;
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value',
    )!.set!.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
it('shows default 2/57 cards instead of 3/107 badges in category navigation while keeping the global badge overview', async () => {
  await mount(partialProfile());
  expect(count('all')).toEqual({ earned: 2, total: 57 });
  expect(['A', 'B', 'C', 'D', 'E', 'F'].map((id) => count(id))).toEqual([
    { earned: 1, total: 5 },
    { earned: 0, total: 10 },
    { earned: 1, total: 9 },
    { earned: 0, total: 10 },
    { earned: 0, total: 14 },
    { earned: 0, total: 9 },
  ]);
  expect(facet('all').textContent).toContain('2/57');
  expect(node.querySelector('.achievement-overview')!.textContent).toContain(
    '3 / 117',
  );
  expect(node.querySelector('.achievement-section-count')).toBeNull();
  expect(cards()).toHaveLength(57);
});
it('updates status and tier facets using the same matching child, including partially earned cards', async () => {
  await mount(partialProfile());
  await select(0, 'achieved');
  expect(count('all')).toEqual({ earned: 2, total: 2 });
  expect(cards()).toHaveLength(2);
  expect(count('A')).toEqual({ earned: 1, total: 1 });
  expect(count('C')).toEqual({ earned: 1, total: 1 });
  expect(count('B')).toEqual({ earned: 0, total: 0 });
  await select(3, 'silver');
  expect(count('all')).toEqual({ earned: 1, total: 1 });
  expect(count('A')).toEqual({ earned: 0, total: 0 });
  expect(count('C')).toEqual({ earned: 1, total: 1 });
  expect(cards()[0]!.dataset.focusedId).toBe('C14');
  await select(0, 'pending');
  expect(count('all')).toEqual({ earned: 0, total: 40 });
  expect(count('C')).toEqual({ earned: 0, total: 5 });
  expect(cards().some((c) => c.id === 'achievement-C06')).toBe(false);
  await select(3, 'all');
  expect(count('all')).toEqual({ earned: 0, total: 57 });
  expect(
    cards().find((c) => c.id === 'achievement-C06')!.dataset.focusedId,
  ).toBe('C15');
});
it('keeps other category facets available when one category is selected and matches section counts to the visible cards', async () => {
  await mount(partialProfile());
  await select(3, 'silver');
  await click(facet('A'));
  expect(count('all')).toEqual({ earned: 1, total: 41 });
  expect(count('C')).toEqual({ earned: 1, total: 6 });
  expect(count('A')).toEqual({ earned: 0, total: 5 });
  expect(cards()).toHaveLength(5);
  expect(node.querySelector('.achievement-section-count')).toBeNull();
  await click(facet('C'));
  expect(cards()).toHaveLength(6);
  expect(count('A')).toEqual({ earned: 0, total: 5 });
  expect(node.querySelector('.achievement-section-count')).toBeNull();
});
it('updates all facets for names and child IDs, preserves hidden names, handles zero results and resets to 57', async () => {
  await mount(partialProfile());
  await search(achievementNumber('C15'));
  expect(count('all')).toEqual({ earned: 0, total: 1 });
  expect(count('C')).toEqual({ earned: 0, total: 1 });
  expect(count('A')).toEqual({ earned: 0, total: 0 });
  await select(3, 'bronze');
  expect(count('all')).toEqual({ earned: 0, total: 0 });
  expect(cards()).toHaveLength(0);
  await select(3, 'all');
  await search('祸不单行');
  expect(count('all')).toEqual({ earned: 0, total: 0 });
  await search(achievementNumber('C07'));
  expect(count('C')).toEqual({ earned: 0, total: 1 });
  expect(cards()[0]!.textContent).toContain('???');
  await search('不存在');
  expect(
    ['all', 'A', 'B', 'C', 'D', 'E', 'F'].every((id) => count(id).total === 0),
  ).toBe(true);
  await select(2, '2');
  await click(
    [...node.querySelectorAll('button')].find(
      (b) => b.textContent === '清除筛选',
    )!,
  );
  expect(count('all')).toEqual({ earned: 2, total: 57 });
  expect(cards()).toHaveLength(57);
  expect(node.querySelectorAll('select')[2]!.value).toBe('2');
});
it('does not write progress or checkpoints, alter the global overview or change counts for sort and layout', async () => {
  const p = partialProfile(),
    raw = JSON.stringify(p);
  localStorage.setItem(playerProfileKey, raw);
  localStorage.setItem(gameSaveKey, 'keep');
  await mount(p);
  const overview = node.querySelector('.achievement-overview')!.textContent;
  await select(1, 'recent');
  await select(2, '3');
  expect(count('all')).toEqual({ earned: 2, total: 57 });
  await select(3, 'gold');
  expect(count('all')).toEqual({ earned: 0, total: 38 });
  await select(0, 'achieved');
  expect(count('all')).toEqual({ earned: 0, total: 0 });
  expect(node.querySelector('.achievement-overview')!.textContent).toBe(
    overview,
  );
  expect(localStorage.getItem(playerProfileKey)).toBe(raw);
  expect(localStorage.getItem(gameSaveKey)).toBe('keep');
  expect(JSON.stringify(p)).toBe(raw);
});
it('refreshes category numerators on explicit profile rollback without modifying either profile', async () => {
  const p = partialProfile(),
    raw = JSON.stringify(p);
  await mount(p);
  await select(0, 'achieved');
  expect(count('all')).toEqual({ earned: 2, total: 2 });
  await mount(createPlayerProfile(cfNow));
  expect(count('all')).toEqual({ earned: 0, total: 0 });
  expect(cards()).toHaveLength(0);
  expect(JSON.stringify(p)).toBe(raw);
  expect(localStorage.length).toBe(0);
});
