// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, expect, it } from 'vitest';
import { AchievementProgress } from '../../../components/game/achievement-progress';
import { createPlayerProfile, playerProfileKey } from '../player-profile';
import { appendCf, cfNow, cfRoom } from './revision058.test-helper';
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
const ids = () =>
  [...node.querySelectorAll('.achievement-section')]
    .find((s) => s.querySelector('h4')!.textContent === '竞拍与策略')!
    .querySelectorAll<HTMLButtonElement>('.achievement-card');
it('defaults to fixed collection ordering, retains explicit number ordering, and never activates by browsing', async () => {
  const p = createPlayerProfile(cfNow),
    raw = JSON.stringify(p);
  localStorage.setItem(playerProfileKey, raw);
  await act(async () =>
    root.render(createElement(AchievementProgress, { profile: p })),
  );
  const sort = node.querySelectorAll('select')[1]!;
  expect(sort.value).toBe('collection');
  expect([...ids()].map((b) => b.id)).toEqual(
    ['B01', 'B02', 'B04', 'B05', 'B06', 'B09', 'B11', 'B03', 'B12', 'B13'].map(
      (id) => 'achievement-' + id,
    ),
  );
  await act(async () => {
    sort.value = 'catalog';
    sort.dispatchEvent(new Event('change', { bubbles: true }));
  });
  expect([...ids()].slice(0, 4).map((b) => b.id)).toEqual(
    ['B01', 'B02', 'B03', 'B04'].map((id) => 'achievement-' + id),
  );
  expect(node.querySelectorAll('.achievement-card')).toHaveLength(57);
  expect(node.querySelector('.achievement-overview')!.textContent).toContain(
    '0 / 117',
  );
  expect(localStorage.getItem(playerProfileKey)).toBe(raw);
  expect(JSON.stringify(p)).toBe(raw);
});
it('uses the new bronze room counter for the next silver target and keeps pending gold unearned', async () => {
  const p = appendCf(createPlayerProfile(cfNow), cfRoom(0, { mask: 64 })),
    raw = JSON.stringify(p);
  localStorage.setItem(playerProfileKey, raw);
  await act(async () =>
    root.render(createElement(AchievementProgress, { profile: p })),
  );
  const card = () => node.querySelector<HTMLButtonElement>('#achievement-C04')!;
  expect(card().dataset.tier).toBe('bronze');
  expect(card().dataset.achieved).toBe('true');
  expect(card().querySelector('progress')!.max).toBe(5);
  expect(card().querySelector('progress')!.value).toBe(1);
  const tier = node.querySelectorAll('select')[3]!;
  await act(async () => {
    tier.value = 'gold';
    tier.dispatchEvent(new Event('change', { bubbles: true }));
  });
  expect(card().dataset.focusedId).toBe('C17');
  expect(card().dataset.achieved).toBe('false');
  expect(card().querySelector('progress')!.max).toBe(10);
  await act(async () => card().click());
  const dialog = document.querySelector('[role=dialog]')!;
  expect(dialog.querySelectorAll('.achievement-series-detail li')).toHaveLength(
    3,
  );
  expect(
    dialog.querySelector('[data-achievement-id=C04] blockquote'),
  ).not.toBeNull();
  expect(
    dialog.querySelector('[data-achievement-id=C17] blockquote'),
  ).toBeNull();
  await act(async () =>
    (
      dialog.querySelector('[aria-label="关闭成就详情"]') as HTMLElement
    ).click(),
  );
  expect(document.activeElement).toBe(card());
  expect(localStorage.getItem(playerProfileKey)).toBe(raw);
});
