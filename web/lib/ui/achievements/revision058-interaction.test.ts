// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, it, expect } from 'vitest';
import { AchievementProgress } from '../../../components/game/achievement-progress';
import {
  createPlayerProfile,
  type PlayerProfile,
  playerProfileKey,
} from '../player-profile';
import {
  appendCf as append,
  cfRoom as room,
  cfLast as last,
  cfNow as now,
} from './revision058.test-helper';
(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
let node: HTMLDivElement, root: Root;
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
const mount = (p: PlayerProfile) =>
  act(async () =>
    root.render(createElement(AchievementProgress, { profile: p })),
  );
const card = (id: string) =>
  node.querySelector<HTMLButtonElement>('#achievement-' + id)!;
const click = (el: HTMLElement) => act(async () => el.click());
const dialog = () => document.querySelector<HTMLElement>('[role=dialog]')!;
it('shows 117 medals as 57 category-separated cards with current grades and never writes by browsing', async () => {
  const p = createPlayerProfile(now),
    raw = JSON.stringify(p);
  localStorage.setItem(playerProfileKey, raw);
  await mount(p);
  expect(node.querySelectorAll('.achievement-card')).toHaveLength(57);
  expect(node.querySelector('.achievement-overview')!.textContent).toContain(
    '0 / 117',
  );
  expect(node.querySelector('.achievement-tier-totals')!.textContent).toBe(
    '铜 0 / 39银 0 / 41金 0 / 37',
  );
  expect(card('C06').querySelector('progress')!.max).toBe(6);
  expect(card('F04').getAttribute('data-focused-id')).toBe('F15');
  expect(card('F04').querySelector('progress')!.max).toBe(1);
  expect(card('E08').getAttribute('data-tier')).toBe('silver');
  for (const id of ['C08', 'E11', 'F05'])
    expect(card(id).textContent).toContain('???');
  expect(localStorage.getItem(playerProfileKey)).toBe(raw);
});
it('shows the highest earned six/eighteen/sixty-six stage and reveals every child target in the detail modal', async () => {
  let p = createPlayerProfile(now);
  for (let i = 0; i < 6; i++) p = append(p, room(0, { mask: 256 }));
  await mount(p);
  expect(card('C06').textContent).toContain('已获 1 / 3');
  expect(card('C06').getAttribute('data-focused-id')).toBe('C06');
  expect(card('C06').querySelector('progress')!.max).toBe(18);
  await click(card('C06'));
  for (const [id, target] of [
    ['C06', 6],
    ['C14', 18],
    ['C15', 66],
  ] as const) {
    const child = dialog().querySelector('[data-achievement-id=' + id + ']')!;
    expect(child.textContent).toContain(String(target));
  }
  expect(
    dialog().querySelectorAll('.achievement-series-detail time'),
  ).toHaveLength(1);
});
it('does not reveal hidden redemption after one room and reveals only after the second same-branch room', async () => {
  let p = append(createPlayerProfile(now), room(0, { mask: 32, flags: 4 }), {
    root: 'redeem',
  });
  await mount(p);
  expect(card('C08').textContent).toContain('???');
  expect(card('C08').querySelector('progress')).toBeNull();
  p = append(p, room(1, { mask: 32, flags: 4 }), {
    root: 'redeem',
    parent: last(p),
  });
  await mount(p);
  expect(card('C08').textContent).toContain('反客为主');
  expect(card('C08').getAttribute('data-tier')).toBe('gold');
  await click(card('C08'));
  expect(dialog().textContent).toContain('两个不同房间');
});
it('keeps the role prerequisite on the three-copy bronze while the series continues toward ten and thirty', async () => {
  const p = append(createPlayerProfile(now), room(0, { copies: 3 }));
  await mount(p);
  expect(card('E05').textContent).toContain('已获 1 / 3');
  expect(card('E05').getAttribute('data-focused-id')).toBe('E05');
  expect(card('E05').querySelector('progress')!.max).toBe(10);
  expect(
    node.querySelector('[aria-label="角色解锁"]')?.textContent ??
      node.textContent,
  ).toContain('伊甸');
  await click(card('E05'));
  expect(dialog().textContent).toContain('伊甸的解锁前置仍只需第一级的3件');
});

it('keeps shared rules on the current catalog and explains tightened capital and gold difficulty without writing', async () => {
  const p = createPlayerProfile(now),
    raw = JSON.stringify(p);
  localStorage.setItem(playerProfileKey, raw);
  await mount(p);
  await click(
    [...node.querySelectorAll<HTMLButtonElement>('button')].find(
      (b) => b.textContent === '成就统计规则',
    )!,
  );
  expect(dialog().textContent).toContain('现有117枚');
  expect(dialog().textContent).toContain('30组单卡三级合为57张卡片');
  expect(dialog().textContent).toContain('50%');
  expect(dialog().textContent).toContain('金阶仅限困难或最高');
  expect(localStorage.getItem(playerProfileKey)).toBe(raw);
});
