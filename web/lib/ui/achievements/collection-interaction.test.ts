import { achievementNumber } from './numbering';
import { achievementCollectionNotes } from './collection-notes';
// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { AchievementProgress } from '@/components/game/achievement-progress';
import {
  createPlayerProfile,
  playerProfileKey,
  type PlayerProfile,
} from '../player-profile';
import { gameSaveKey } from '../game-save';
import {
  appendAchievementEvent,
  compactAchievementProfile,
  manuallyUnlockAchievementCharacters,
  readAchievementRegistry,
} from './registry';
import { decodeAchievementEvent } from './event-codec';
import { sha256Hex } from '../../shared/sha256';
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
  vi.restoreAllMocks();
});
const mount = async (profile = createPlayerProfile(), message = '') =>
  act(async () =>
    root.render(createElement(AchievementProgress, { profile, message })),
  );
const cards = () => [
  ...node.querySelectorAll<HTMLButtonElement>('.achievement-card'),
];
const select = async (index: number, value: string) =>
  act(async () => {
    const el = node.querySelectorAll('select')[index]!;
    el.value = value;
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
const click = async (el: HTMLElement) => act(async () => el.click());
const popup = () => document.querySelector<HTMLElement>('[role=dialog]')!;
const close = async () =>
  click(document.querySelector('[aria-label="关闭成就详情"]') as HTMLElement);
async function search(value: string) {
  await act(async () => {
    const input = node.querySelector<HTMLInputElement>('input[type=search]')!;
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value',
    )!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
function earned(): PlayerProfile {
  return appendAchievementEvent(
    createPlayerProfile(),
    {
      source: 'live',
      mode: 'classic',
      root: sha256Hex('ui-root'),
      parent: null,
      authorityHash: sha256Hex('ui-hash'),
      event: decodeAchievementEvent({
        stage: 'room',
        position: 0,
        values: [1, 0, 0, 0, 0],
      }),
    },
    new Date('2026-10-15T00:00:00Z'),
  );
}
it('shows saved global totals rather than filtered denominators; new entries are read-only without migration on browsing', async () => {
  const p = compactAchievementProfile(earned()),
    before = JSON.stringify(p);
  localStorage.setItem(playerProfileKey, before);
  await mount(p);
  expect(node.querySelector('.achievement-overview')!.textContent).toContain(
    '1 / 107',
  );
  expect(
    node.querySelector('.achievement-overview-caption')!.textContent,
  ).toContain('0.9%');
  expect(cards()).toHaveLength(57);
  expect(cards()[0]!.querySelector('progress')!.max).toBe(20);
  expect(cards()[0]!.querySelector('time')).toBeNull();
  expect(node.textContent).toContain('初出茅庐');
  await select(0, 'achieved');
  expect(cards().map((c) => c.id)).toEqual(['achievement-A01']);
  expect(node.querySelector('.achievement-overview')!.textContent).toContain(
    '1 / 107',
  );
  expect(localStorage.getItem(playerProfileKey)).toBe(before);
  expect(JSON.stringify(p)).toBe(before);
});
it('combines category/name/ID/status and offers empty reset without changing layout', async () => {
  await mount(earned());
  await search(achievementNumber('A10'));
  expect(cards().map((c) => c.id)).toEqual(['achievement-A10']);
  await search('礼物');
  expect(cards().map((c) => c.id)).toEqual(['achievement-E05']);
  await click(node.querySelector('#achievement-category-F') as HTMLElement);
  expect(cards()).toHaveLength(0);
  expect(node.textContent).toContain('没有符合条件的成就');
  await select(2, '2');
  await click(
    [...node.querySelectorAll('button')].find(
      (b) => b.textContent === '清除筛选',
    )!,
  );
  expect(cards()).toHaveLength(57);
  expect(
    node.querySelector('.achievement-grid')!.getAttribute('data-columns'),
  ).toBe('2');
  expect(localStorage.getItem(playerProfileKey)).toBeNull();
});
it('sorts actual saved progress without changing records', async () => {
  await mount(earned());
  await select(1, 'progress');
  expect(
    cards()
      .slice(0, 3)
      .map((c) => c.id),
  ).toEqual(['achievement-A01', 'achievement-A03', 'achievement-A05']);
  await select(0, 'pending');
  expect(cards()).toHaveLength(57);
  await select(1, 'recent');
  expect(cards()[0]!.id).toBe('achievement-A01');
  await select(0, 'all');
  expect(cards()[0]!.id).toBe('achievement-A01');
  expect(localStorage.getItem(playerProfileKey)).toBeNull();
});
it('persists only explicit columns, reloads them and preserves player/checkpoint/settings bytes', async () => {
  const p = earned(),
    raw = JSON.stringify(p);
  localStorage.setItem(playerProfileKey, raw);
  localStorage.setItem('bidding-ui-preferences-v1', 'keep');
  localStorage.setItem(gameSaveKey, 'keep');
  await mount(p);
  expect(localStorage.getItem(achievementLayoutKey)).toBeNull();
  await select(2, '3');
  expect(
    node.querySelector('.achievement-grid')!.getAttribute('data-columns'),
  ).toBe('3');
  await act(async () => root.render(null));
  await mount(p);
  expect(node.querySelectorAll('select')[2]!.value).toBe('3');
  expect(localStorage.getItem(playerProfileKey)).toBe(raw);
  expect(localStorage.getItem('bidding-ui-preferences-v1')).toBe('keep');
  expect(localStorage.getItem(gameSaveKey)).toBe('keep');
});
it('preference quota failures do not affect filtering or player data', async () => {
  const p = earned(),
    raw = JSON.stringify(p);
  localStorage.setItem(playerProfileKey, raw);
  const source = window.localStorage,
    descriptor = Object.getOwnPropertyDescriptor(window, 'localStorage')!;
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: {
      getItem: source.getItem.bind(source),
      setItem: () => {
        throw Error('quota');
      },
    },
  });
  try {
    await mount(p);
    await select(2, '1');
    expect(
      node.querySelector('.achievement-grid')!.getAttribute('data-columns'),
    ).toBe('1');
    expect(node.textContent).toContain('本地偏好未保存');
    await select(0, 'achieved');
    expect(cards()).toHaveLength(1);
    expect(source.getItem(playerProfileKey)).toBe(raw);
  } finally {
    Object.defineProperty(window, 'localStorage', descriptor);
  }
});
it('opens named modal with complete metadata and stable grid; close and Escape return focus', async () => {
  await mount(earned());
  const ids = cards().map((c) => c.id),
    origin = node.querySelector<HTMLButtonElement>('#achievement-A01')!;
  origin.focus();
  await click(origin);
  expect(popup().getAttribute('aria-labelledby')).toBeTruthy();
  expect(popup().getAttribute('aria-describedby')).toBeTruthy();
  expect(popup().textContent).toContain('A01');
  expect(popup().textContent).toContain('屏障退款仍计入');
  expect(popup().querySelector('time')!.dateTime).toBe(
    '2026-10-15T00:00:00.000Z',
  );
  expect(cards().map((c) => c.id)).toEqual(ids);
  expect(popup().contains(document.activeElement)).toBe(true);
  await close();
  expect(popup()).toBeNull();
  expect(document.activeElement).toBe(origin);
  await click(origin);
  await act(async () =>
    document.activeElement!.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
    ),
  );
  expect(popup()).toBeNull();
  expect(document.activeElement).toBe(origin);
});
it('role prerequisite links bypass active filters, then restore them without a grant', async () => {
  const p = manuallyUnlockAchievementCharacters(createPlayerProfile());
  await mount(p);
  await search(achievementNumber('F01'));
  expect(cards()).toHaveLength(1);
  const role = node.querySelector<HTMLButtonElement>(
    '.achievement-role li button',
  )!;
  role.focus();
  await click(role);
  expect(popup().textContent).toContain('E01');
  expect(popup().textContent).toContain('游魂');
  expect(popup().textContent).toContain('0 / 1');
  await close();
  expect(cards().map((c) => c.id)).toEqual(['achievement-F01']);
  expect(document.activeElement).toBe(role);
  expect(readAchievementRegistry(p)!.receipts).toHaveLength(0);
  expect(localStorage.getItem(playerProfileKey)).toBeNull();
});
it('open details reflect profile rollback; invalid profile removes the modal instead of a fake zero', async () => {
  await mount(earned());
  await click(node.querySelector('#achievement-A01') as HTMLElement);
  expect(popup().querySelector('time')).not.toBeNull();
  await mount(createPlayerProfile());
  expect(popup().querySelector('time')).toBeNull();
  expect(popup().textContent).toContain('未达成');
  await mount(createPlayerProfile(), '读取失败');
  expect(popup()).toBeNull();
  expect(node.querySelector('.achievement-overview')).toBeNull();
  expect(node.textContent).toContain('读取失败');
});

it('unlocks only the earned flavor text and hides it again on explicit rollback without writing a note flag', async () => {
  const p = earned(),
    raw = JSON.stringify(p);
  localStorage.setItem(playerProfileKey, raw);
  await mount(p);
  await click(node.querySelector('#achievement-A01') as HTMLElement);
  expect(popup().querySelector('.achievement-stage-note')!.textContent).toBe(
    achievementCollectionNotes.A01,
  );
  expect(popup().textContent).not.toContain('重复导入');
  await mount(createPlayerProfile());
  expect(popup().querySelector('.achievement-stage-note')).toBeNull();
  expect(popup().querySelector('.achievement-collection-note')).toBeNull();
  expect(popup().textContent).not.toContain('达成后解锁');
  expect(localStorage.getItem(playerProfileKey)).toBe(raw);
  expect(JSON.stringify(p)).toBe(raw);
});
it('moves common rules to one discoverable dialog and returns to the original achievement without losing filters', async () => {
  await mount(earned());
  await search(achievementNumber('A01'));
  const origin = node.querySelector<HTMLButtonElement>('#achievement-A01')!;
  origin.focus();
  await click(origin);
  expect(popup().textContent).toContain('屏障退款仍计入');
  expect(popup().textContent).not.toContain('重复恢复');
  await click(
    [...popup().querySelectorAll('button')].find(
      (b) => b.textContent === '查看通用统计规则',
    )!,
  );
  expect(popup().textContent).toContain('成就统计规则');
  expect(popup().textContent).toContain('重复恢复');
  expect(popup().textContent).toContain('0.5.3');
  expect(node.querySelectorAll('.achievement-card')).toHaveLength(1);
  await close();
  expect(document.activeElement).toBe(origin);
  expect(localStorage.getItem(playerProfileKey)).toBeNull();
  await click(
    [...node.querySelectorAll('button')].find(
      (b) => b.textContent === '成就统计规则',
    )!,
  );
  expect(popup().textContent).toContain('一键解锁全部角色');
  await close();
});

it('creates six independent category grids with separators and respects filtered category boundaries', async () => {
  await mount(earned());
  const groups = () => [...node.querySelectorAll('.achievement-section')];
  expect(groups().map((g) => g.querySelector('h4')!.textContent)).toEqual([
    '竞拍失败',
    '竞拍与策略',
    '扰乱与结算奇遇',
    '资金与道具',
    '角色道具与探索',
    '生存淘汰',
  ]);
  expect(
    groups().map((g) => g.querySelectorAll('.achievement-card').length),
  ).toEqual([5, 10, 9, 10, 14, 9]);
  expect(node.querySelectorAll('.achievement-section-rule')).toHaveLength(6);
  expect(node.querySelector('.achievement-section-count')).toBeNull();
  await select(2, '2');
  expect(
    [...node.querySelectorAll('.achievement-grid')].every(
      (g) => g.getAttribute('data-columns') === '2',
    ),
  ).toBe(true);
  await select(3, 'gold');
  expect(groups().map((g) => g.querySelector('h4')!.textContent)).toEqual([
    '竞拍失败',
    '竞拍与策略',
    '扰乱与结算奇遇',
    '资金与道具',
    '角色道具与探索',
    '生存淘汰',
  ]);
  expect(cards()).toHaveLength(33);
  await select(3, 'all');
  await search('B0');
  expect(groups()).toHaveLength(1);
  expect(cards()).toHaveLength(4);
  await search('不存在');
  expect(groups()).toHaveLength(0);
  expect(node.textContent).toContain('没有符合条件的成就');
  expect(localStorage.getItem(playerProfileKey)).toBeNull();
});
