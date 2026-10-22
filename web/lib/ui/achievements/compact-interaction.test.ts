// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { AchievementProgress } from '../../../components/game/achievement-progress';
import { createPlayerProfile, playerProfileKey } from '../player-profile';
import { gameSaveKey } from '../game-save';
import { appendCf, cfRoom, cfNow } from './revision058.test-helper';
import { achievementCollectionNotes } from './collection-notes';
import { achievementLayoutKey } from './layout-preferences';
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
const click = (element: HTMLElement) => act(async () => element.click());
const popup = () => document.querySelector<HTMLElement>('[role=dialog]')!;
const card = () => node.querySelector<HTMLButtonElement>('#achievement-A01')!;
it('uses three compact rows, no redundant stage dots and one rule section; notes stay gated and browsing stays byte-identical', async () => {
  const p = appendCf(createPlayerProfile(cfNow), cfRoom(0, { code: 1 })),
    raw = JSON.stringify(p);
  localStorage.setItem(playerProfileKey, raw);
  localStorage.setItem(gameSaveKey, 'keep');
  await act(async () =>
    root.render(createElement(AchievementProgress, { profile: p })),
  );
  expect(card().querySelector('.achievement-card-copy')!.children).toHaveLength(
    3,
  );
  expect(
    card()
      .querySelector('.achievement-card-status')!
      .getAttribute('aria-label'),
  ).toBe('已获 1 / 3');
  expect(
    card().querySelectorAll('.achievement-stage-dots [data-earned=true]'),
  ).toHaveLength(0);
  expect(card().querySelector('.achievement-summary')!.textContent).toBe(
    '累计正常竞拍失败20次',
  );
  expect(card().querySelector('.achievement-goal-tier')).toBeNull();
  expect(node.textContent).not.toContain('冲刺');
  expect(card().querySelector('.achievement-stage-dots')).toBeNull();
  expect(node.querySelector('.achievement-section-count')).toBeNull();
  await click(card());
  expect(popup().querySelector('h2')!.textContent).toBe('失败乃成功之母');
  expect(
    popup().querySelectorAll('.achievement-series-detail li'),
  ).toHaveLength(3);
  expect(popup().querySelector('.achievement-detail-facts')).toBeNull();
  expect(popup().querySelector('.achievement-level-head')).toBeNull();
  expect(popup().querySelectorAll('.achievement-level-target')).toHaveLength(1);
  expect(
    popup().querySelector(
      '[data-achievement-id=A01] .achievement-level-target',
    )!.textContent,
  ).toBe('目标：1次');
  expect(
    popup()
      .querySelector('[data-achievement-id=A01] .achievement-level-target')!
      .classList.contains('sr-only'),
  ).toBe(false);
  expect(
    [...popup().querySelectorAll('.achievement-series-detail li')].map((li) => [
      li.getAttribute('data-tier'),
      li.getAttribute('data-achieved'),
      li.getAttribute('data-selected'),
    ]),
  ).toEqual([
    ['bronze', 'true', 'true'],
    ['silver', 'false', 'false'],
    ['gold', 'false', 'false'],
  ]);
  expect(
    popup().querySelector('[data-achievement-id=A01] progress'),
  ).toBeNull();
  expect(
    popup().querySelector<HTMLProgressElement>(
      '[data-achievement-id=A08] progress',
    )!.max,
  ).toBe(20);
  expect(
    popup().querySelector<HTMLProgressElement>(
      '[data-achievement-id=A09] progress',
    )!.value,
  ).toBe(1);
  expect(
    card().querySelector('.achievement-card-heading .achievement-card-state'),
  ).toBeNull();
  expect(
    popup().querySelector(
      '.achievement-detail-footer .achievement-detail-done',
    )!.textContent,
  ).toBe('关闭');
  expect(popup().textContent!.split('屏障退款仍计入')).toHaveLength(2);
  const rules = popup().querySelector<HTMLDetailsElement>(
    '.achievement-detail-note',
  )!;
  expect(popup().querySelector('.achievement-collection-note')).toBeNull();
  expect(popup().querySelector('.achievement-note-selector')).toBeNull();
  expect(rules.open).toBe(false);
  expect(popup().querySelector('time')!.dateTime).toBe(cfNow.toISOString());
  expect(
    popup().querySelector<HTMLDetailsElement>('.achievement-time')!.open,
  ).toBe(false);
  expect(popup().querySelector('.achievement-exact-time')!.textContent).toBe(
    cfNow.toLocaleString('zh-CN'),
  );
  const levels = [...popup().querySelectorAll('.achievement-series-detail li')];
  expect(levels.map((li) => li.querySelector('h3')!.textContent)).toEqual(
    Array(3).fill('失败乃成功之母'),
  );
  expect(
    levels.map((li) =>
      li.querySelector('.achievement-badge')!.getAttribute('data-tier'),
    ),
  ).toEqual(['bronze', 'silver', 'gold']);
  expect(levels[0]!.querySelector('blockquote')!.textContent).toBe(
    achievementCollectionNotes.A01,
  );
  expect(levels[1]!.querySelector('blockquote')).toBeNull();
  expect(levels[2]!.querySelector('blockquote')).toBeNull();
  expect(
    levels.every((li) => !li.querySelector('h3')!.textContent!.includes('A0')),
  ).toBe(true);
  expect(popup().textContent).not.toContain('收藏札记');
  expect(popup().textContent).not.toContain('达成后解锁');
  await act(async () =>
    root.render(
      createElement(AchievementProgress, {
        profile: createPlayerProfile(cfNow),
      }),
    ),
  );
  expect(popup().querySelector('blockquote')).toBeNull();
  expect(popup().querySelector('time')).toBeNull();
  await click(popup().querySelector('[aria-label="关闭成就详情"]')!);
  expect(document.activeElement).toBe(card());
  expect(localStorage.getItem(playerProfileKey)).toBe(raw);
  expect(localStorage.getItem(gameSaveKey)).toBe('keep');
  expect(JSON.stringify(p)).toBe(raw);
});
it('persists explicit four-column preference without five columns or player/checkpoint writes', async () => {
  const profile = createPlayerProfile(cfNow),
    raw = JSON.stringify(profile);
  localStorage.setItem(playerProfileKey, raw);
  localStorage.setItem(gameSaveKey, 'keep');
  const mount = () =>
    act(async () =>
      root.render(createElement(AchievementProgress, { profile })),
    );
  await mount();
  const select = node.querySelectorAll('select')[2]!;
  expect([...select.options].map((o) => o.value)).toEqual([
    'auto',
    '1',
    '2',
    '3',
    '4',
  ]);
  await act(async () => {
    select.value = '4';
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
  expect(JSON.parse(localStorage.getItem(achievementLayoutKey)!).columns).toBe(
    '4',
  );
  await act(async () => root.render(null));
  await mount();
  expect(node.querySelectorAll('select')[2]!.value).toBe('4');
  expect(
    node.querySelector('.achievement-grid')!.getAttribute('data-columns'),
  ).toBe('4');
  expect(localStorage.getItem(playerProfileKey)).toBe(raw);
  expect(localStorage.getItem(gameSaveKey)).toBe('keep');
});
it('shows each earned stage own text at the same time and removes only the rolled-back stage without note state', async () => {
  const bronze = appendCf(createPlayerProfile(cfNow), cfRoom(0, { code: 1 }));
  let silver = bronze;
  for (let i = 1; i < 20; i++)
    silver = appendCf(silver, cfRoom(0, { code: 1 }));
  const raw = JSON.stringify(silver);
  localStorage.setItem(playerProfileKey, raw);
  await act(async () =>
    root.render(createElement(AchievementProgress, { profile: silver })),
  );
  await click(card());
  const notes = () =>
    [...popup().querySelectorAll<HTMLElement>('.achievement-stage-note')].map(
      (el) => [el.dataset.noteId, el.textContent],
    );
  expect(notes()).toEqual([
    ['A01', achievementCollectionNotes.A01],
    ['A08', achievementCollectionNotes.A08],
  ]);
  expect(
    popup().querySelector('[data-achievement-id=A09] blockquote'),
  ).toBeNull();
  expect(
    popup().querySelector('[data-achievement-id=A01] .achievement-badge svg'),
  ).not.toBeNull();
  expect(
    popup()
      .querySelector('[data-achievement-id=A08] time')!
      .getAttribute('datetime'),
  ).toBe(cfNow.toISOString());
  await act(async () =>
    root.render(createElement(AchievementProgress, { profile: bronze })),
  );
  expect(notes()).toEqual([['A01', achievementCollectionNotes.A01]]);
  expect(popup().querySelector('[data-achievement-id=A08] time')).toBeNull();
  expect(
    popup().querySelector('[data-achievement-id=A08] progress'),
  ).not.toBeNull();
  expect(localStorage.getItem(playerProfileKey)).toBe(raw);
  expect(JSON.stringify(silver)).toBe(raw);
});
