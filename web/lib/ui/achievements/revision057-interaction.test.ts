// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { it, expect, beforeEach, afterEach } from 'vitest';
import { AchievementProgress } from '@/components/game/achievement-progress';
import {
  createPlayerProfile,
  playerProfileKey,
  type PlayerProfile,
} from '../player-profile';
import {
  appendAchievementEvent,
  projectAchievementRegistry,
  readAchievementRegistry,
} from './registry';
import {
  decodeAchievementEvent,
  type EncodedAchievementEvent,
} from './event-codec';
import { sha256Hex } from '../../shared/sha256';
(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root,
  node: HTMLDivElement,
  serial = 0;
const oldAt = new Date('2026-10-15T00:00:00Z'),
  now = new Date('2026-10-16T02:00:00Z');
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
const click = (el: HTMLElement) => act(async () => el.click());
const card = (id: string) =>
  node.querySelector<HTMLButtonElement>('#achievement-' + id)!;
const dialog = () => document.querySelector<HTMLElement>('[role=dialog]')!;
function append(
  p: PlayerProfile,
  e: EncodedAchievementEvent,
  options: { root?: string; parent?: string | null; at?: Date } = {},
) {
  return appendAchievementEvent(
    p,
    {
      source: 'live',
      mode: 'classic',
      root: sha256Hex(options.root ?? 'root' + serial),
      parent: options.parent ?? null,
      authorityHash: sha256Hex('unit' + serial++),
      event: decodeAchievementEvent(e),
    },
    options.at ?? now,
  );
}

it('shows the revised 117/57 catalog without writing and publicly exposes the streak series', async () => {
  const p = createPlayerProfile(),
    before = JSON.stringify(p);
  localStorage.setItem(playerProfileKey, before);
  await mount(p);
  expect(node.querySelectorAll('.achievement-card')).toHaveLength(57);
  expect(node.querySelector('.achievement-overview')!.textContent).toContain(
    '0 / 117',
  );
  expect(card('A03').textContent).toContain('屡战屡败');
  expect(card('A03').textContent).not.toContain('???');
  expect(card('A03').getAttribute('data-focused-id')).toBe('A06');
  expect(card('A03').querySelector('progress')!.max).toBe(3);
  expect(card('A02')).toBeNull();
  expect(card('A04')).toBeNull();
  expect(localStorage.getItem(playerProfileKey)).toBe(before);
});
it('keeps an old five-loss time on the silver stage, confirms the new bronze separately and does not conceal the series on rollback', async () => {
  let p = createPlayerProfile(oldAt),
    parent: string | null = null;
  for (let i = 0; i < 5; i++) {
    p = append(
      p,
      { stage: 'room', position: i, values: [1, 0, 0, 0, null] },
      { root: 'streak', parent, at: oldAt },
    );
    parent = readAchievementRegistry(p)!.receipts.at(-1)!.key;
  }
  const before = JSON.stringify(p);
  await mount(p);
  expect(card('A03').textContent).toContain('已获 1 / 3');
  await click(card('A03'));
  const silver = dialog().querySelector<HTMLLIElement>(
    '[data-achievement-id=A03]',
  )!;
  expect(silver.dataset.tier).toBe('silver');
  expect(silver.querySelector('time')!.dateTime).toBe(oldAt.toISOString());
  expect(dialog().querySelector('[data-achievement-id=A06] time')).toBeNull();
  expect(JSON.stringify(p)).toBe(before);
  await click(dialog().querySelector('[aria-label="关闭成就详情"]')!);
  p = append(p, { stage: 'entry', position: 0, values: [0, 0, 1, 1] });
  await mount(p);
  expect(card('A03').textContent).toContain('已获 2 / 3');
  await click(card('A03'));
  expect(
    dialog().querySelector<HTMLTimeElement>('[data-achievement-id=A06] time')!
      .dateTime,
  ).toBe(now.toISOString());
  expect(
    dialog().querySelector<HTMLTimeElement>('[data-achievement-id=A03] time')!
      .dateTime,
  ).toBe(oldAt.toISOString());
  await click(dialog().querySelector('[aria-label="关闭成就详情"]')!);
  await mount(createPlayerProfile());
  expect(card('A03').textContent).not.toContain('???');
  expect(card('A03').textContent).toContain('已获 0 / 3');
  expect(localStorage.length).toBe(0);
});
it('preserves retired history and the already earned Lost permission without inventing losing matches', async () => {
  let p = createPlayerProfile(oldAt);
  for (let i = 0; i < 10; i++)
    p = append(
      p,
      { stage: 'room', position: 0, values: [1, 2 ** 9, 0, 0, 10] },
      { at: oldAt },
    );
  const before = JSON.stringify(p);
  await mount(p);
  expect(
    node.querySelector('[aria-label="旧版成就纪念"]')!.textContent,
  ).toContain('A02');
  expect(
    node.querySelector('[aria-label="旧版成就纪念"]')!.textContent,
  ).toContain('不转换为新版失败对局数');
  const lost = [...node.querySelectorAll('.achievement-role')].find((r) =>
    r.textContent!.includes('游魂'),
  )!;
  expect(lost.getAttribute('data-unlocked')).toBe('true');
  expect(lost.textContent).toContain('旧版成就解锁（保留）');
  expect(card('A10').textContent).toContain('0 / 5');
  expect(projectAchievementRegistry(p)!.achievedAt.A10).toBeUndefined();
  expect(node.querySelector('.achievement-overview')!.textContent).toContain(
    '2 / 117',
  );
  expect(JSON.stringify(p)).toBe(before);
  expect(localStorage.length).toBe(0);
});
it('shows the earned bronze and retains both group misses in the silver detail instead of changing the card metal', async () => {
  const p = append(createPlayerProfile(), {
    stage: 'room',
    position: 0,
    values: [3, 0, 0, 0, null, 3, 0, 0, 0, 2, 2, 0, 0, 0],
  });
  await mount(p);
  expect(card('B05').textContent).toContain('已获 1 / 3');
  expect(card('B05').getAttribute('data-focused-id')).toBe('B05');
  expect(card('B06').getAttribute('data-focused-id')).toBe('B06');
  expect(projectAchievementRegistry(p)!.progress.B18).toBe(2);
  expect(projectAchievementRegistry(p)!.progress.B20).toBe(2);
  await click(card('B05'));
  expect(
    dialog().querySelector('[data-achievement-id=B18]')!.textContent,
  ).toContain('2 / 10');
});
it('keeps new vacancy medals hidden until a saved fact, then reveals both with distinct metal grades', async () => {
  await mount(createPlayerProfile());
  expect(card('B12').textContent).toContain('???');
  expect(card('B13').textContent).toContain('???');
  const p = append(createPlayerProfile(), {
    stage: 'room',
    position: 0,
    values: [0, 0, 0, 0, null, 0, 0, 0, 0, 0, 0, 0, 0, 3],
  });
  await mount(p);
  expect(card('B12').textContent).toContain('两败俱伤');
  expect(
    card('B12').querySelector('.achievement-badge-rank')!.textContent,
  ).toBe('铜');
  expect(card('B13').textContent).toContain('全军覆没');
  expect(
    card('B13').querySelector('.achievement-badge-rank')!.textContent,
  ).toBe('银');
});
