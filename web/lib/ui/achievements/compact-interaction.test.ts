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
it('uses three compact rows, matching stage dots and one rule section; notes stay gated and browsing stays byte-identical', async () => {
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
    card().querySelector('.achievement-stage-dots')!.getAttribute('aria-label'),
  ).toBe('已获 1 / 3');
  expect(
    card().querySelectorAll('.achievement-stage-dots [data-earned=true]'),
  ).toHaveLength(1);
  expect(card().querySelector('.achievement-summary')!.textContent).toBe(
    '下一阶：累计正常竞拍失败20次',
  );
  expect(node.querySelector('.achievement-section-count')).toBeNull();
  await click(card());
  expect(popup().querySelector('h2')!.textContent).toBe('失败乃成功之母');
  expect(
    popup().querySelectorAll('.achievement-series-detail li'),
  ).toHaveLength(3);
  expect(popup().querySelector('.achievement-detail-facts')).toBeNull();
  expect(popup().textContent!.split('屏障退款仍计入')).toHaveLength(2);
  const rules = popup().querySelector<HTMLDetailsElement>(
    '.achievement-detail-note',
  )!;
  const notes = popup().querySelector<HTMLDetailsElement>(
    '.achievement-collection-note',
  )!;
  expect(rules.open).toBe(false);
  expect(notes.open).toBe(false);
  expect(popup().querySelector('time')!.dateTime).toBe(cfNow.toISOString());
  expect(
    popup().querySelector<HTMLDetailsElement>('.achievement-time')!.open,
  ).toBe(false);
  expect(popup().querySelector('.achievement-exact-time')!.textContent).toBe(
    cfNow.toLocaleString('zh-CN'),
  );
  expect(notes.querySelector('blockquote')!.textContent).toBe(
    achievementCollectionNotes.A01,
  );
  const choices = notes.querySelectorAll<HTMLButtonElement>('button');
  await click(choices[2]!);
  expect(choices[2]!.getAttribute('aria-pressed')).toBe('true');
  expect(notes.querySelector('blockquote')).toBeNull();
  expect(notes.textContent).toContain('达成后解锁');
  await click(choices[0]!);
  expect(notes.querySelector('blockquote')!.textContent).toBe(
    achievementCollectionNotes.A01,
  );
  await act(async () =>
    root.render(
      createElement(AchievementProgress, {
        profile: createPlayerProfile(cfNow),
      }),
    ),
  );
  expect(notes.querySelector('blockquote')).toBeNull();
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
