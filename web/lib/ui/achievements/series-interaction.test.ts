// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, it, expect } from 'vitest';
import { AchievementProgress } from '@/components/game/achievement-progress';
import {
  createPlayerProfile,
  playerProfileKey,
  type PlayerProfile,
} from '../player-profile';
import { appendAchievementEvent, projectAchievementRegistry } from './registry';
import { decodeAchievementEvent } from './event-codec';
import { sha256Hex } from '../../shared/sha256';
import { achievementCollectionNotes } from './collection-notes';
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
const oldAt = new Date('2026-10-15T00:00:00.000Z'),
  now = new Date('2026-10-15T16:00:00.000Z');
const mount = async (p = createPlayerProfile(now)) =>
  act(async () =>
    root.render(createElement(AchievementProgress, { profile: p })),
  );
const card = () => node.querySelector<HTMLButtonElement>('#achievement-B02')!;
const click = async (n: HTMLElement) => act(async () => n.click());
const popup = () => document.querySelector<HTMLElement>('[role=dialog]')!;
const close = () =>
  click(popup().querySelector('[aria-label="关闭成就详情"]')!);
async function search(q: string) {
  await act(async () => {
    const input = node.querySelector<HTMLInputElement>('input[type=search]')!;
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value',
    )!.set!.call(input, q);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
async function select(index: number, value: string) {
  await act(async () => {
    const el = node.querySelectorAll('select')[index]!;
    el.value = value;
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
}
function legacy() {
  let p = createPlayerProfile(oldAt);
  for (let i = 0; i < 5; i++)
    p = appendAchievementEvent(
      p,
      {
        source: 'live',
        mode: 'classic',
        root: sha256Hex('legacy-' + i),
        parent: null,
        authorityHash: sha256Hex('high-' + i),
        event: decodeAchievementEvent({
          stage: 'room',
          position: 0,
          values: [6, 0, 2, 0, null],
        }),
      },
      oldAt,
    );
  return p;
}
function activate(p: PlayerProfile) {
  return appendAchievementEvent(
    p,
    {
      source: 'live',
      mode: 'classic',
      root: sha256Hex('fresh'),
      parent: null,
      authorityHash: sha256Hex('entry'),
      event: decodeAchievementEvent({
        stage: 'entry',
        position: 0,
        values: [0, 0, 1],
      }),
    },
    now,
  );
}
it('renders 54 cards for 60 badges and keeps a legacy silver without inventing a bronze or changing its timestamp', async () => {
  const p = legacy(),
    raw = JSON.stringify(p);
  localStorage.setItem(playerProfileKey, raw);
  await mount(p);
  expect(node.querySelectorAll('.achievement-card')).toHaveLength(54);
  expect(node.textContent).toContain('54 张卡片，涵盖 60 / 60 枚徽章');
  expect(card().textContent).toContain('已获 1 / 3');
  expect(card().textContent).toContain('待新正式结算确认');
  expect(card().getAttribute('data-focused-id')).toBe('B07');
  expect(card().getAttribute('data-achieved')).toBe('false');
  await click(card());
  const levels = popup().querySelectorAll('.achievement-series-detail li');
  expect(levels).toHaveLength(3);
  expect(levels[0]!.textContent).toContain('未达成');
  expect(levels[1]!.querySelector('time')!.getAttribute('datetime')).toBe(
    oldAt.toISOString(),
  );
  expect(levels[0]!.querySelector('blockquote')).toBeNull();
  expect(levels[1]!.querySelector('blockquote')!.textContent).toBe(
    achievementCollectionNotes.B02,
  );
  expect(levels[2]!.querySelector('blockquote')).toBeNull();
  await close();
  expect(localStorage.getItem(playerProfileKey)).toBe(raw);
  expect(JSON.stringify(p)).toBe(raw);
});
it('updates independent times after confirmed inheritance and relocks new grades on explicit rollback', async () => {
  const old = legacy(),
    p = activate(old);
  await mount(p);
  expect(card().textContent).toContain('已获 2 / 3');
  expect(card().getAttribute('data-focused-id')).toBe('B08');
  await click(card());
  let levels = popup().querySelectorAll('.achievement-series-detail li');
  expect(levels[0]!.querySelector('time')!.getAttribute('datetime')).toBe(
    now.toISOString(),
  );
  expect(levels[1]!.querySelector('time')!.getAttribute('datetime')).toBe(
    oldAt.toISOString(),
  );
  expect(levels[2]!.textContent).toContain('未达成');
  await mount(old);
  levels = popup().querySelectorAll('.achievement-series-detail li');
  expect(levels[0]!.querySelector('blockquote')).toBeNull();
  expect(levels[1]!.querySelector('blockquote')).not.toBeNull();
  expect(projectAchievementRegistry(old)!.achievedAt.B07).toBeUndefined();
  expect(localStorage.length).toBe(0);
});
it('finds every child ID through the one stable card and intersects tier/status without borrowing another stage', async () => {
  const p = activate(legacy());
  await mount(p);
  await search('b08');
  expect(node.querySelectorAll('.achievement-card')).toHaveLength(1);
  expect(card().getAttribute('data-focused-id')).toBe('B08');
  await click(card());
  expect(popup().textContent).toContain(
    '累计通过最高价资格实际获得50次奖励机会',
  );
  await close();
  await search('B07');
  await select(3, 'silver');
  expect(node.querySelectorAll('.achievement-card')).toHaveLength(0);
  await search('B02');
  await select(0, 'pending');
  expect(node.querySelectorAll('.achievement-card')).toHaveLength(0);
  await select(0, 'achieved');
  expect(node.querySelectorAll('.achievement-card')).toHaveLength(1);
  expect(localStorage.length).toBe(0);
});
it('keeps the two new hidden challenges concealed while leaving all cumulative stages public', async () => {
  await mount();
  for (const id of ['C09', 'F12']) {
    const c = node.querySelector<HTMLElement>('#achievement-' + id)!;
    expect(c.textContent).toContain('???');
    expect(c.querySelector('.achievement-badge-rank')!.textContent).toBe('金');
  }
  await search('两处空席');
  expect(node.querySelectorAll('.achievement-card')).toHaveLength(0);
  await search('C09');
  expect(node.querySelectorAll('.achievement-card')).toHaveLength(1);
  await click(node.querySelector('.achievement-card')!);
  expect(popup().textContent).toContain('两处空席');
  await close();
  await search('F09');
  expect(node.textContent).toContain('生存历程');
  expect(node.textContent).not.toContain('???');
});
