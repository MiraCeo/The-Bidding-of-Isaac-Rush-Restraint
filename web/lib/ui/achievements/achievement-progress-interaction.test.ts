// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import { AchievementProgress } from '@/components/game/achievement-progress';
import { GameApp } from '@/components/game/game-app';
import { ClassicGameApp } from '@/components/game/classic-game-app';
import { createPlayerProfile, playerProfileKey } from '../player-profile';
import {
  manuallyUnlockAchievementCharacters,
  appendAchievementEvent,
  readAchievementRegistry,
} from './registry';
import { decodeAchievementEvent } from './event-codec';
import { sha256Hex } from '../../shared/sha256';
import { gameSaveKey, serializeGameCheckpoint } from '../game-save';
import { createGameSession, reduceGameSession } from '../game-session';
import { beginClassicGrowth } from './lifecycle';
(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root,
  node: HTMLDivElement,
  descriptor: PropertyDescriptor | undefined;
beforeEach(() => {
  localStorage.clear();
  node = document.createElement('div');
  document.body.append(node);
  root = createRoot(node);
  descriptor = Object.getOwnPropertyDescriptor(navigator, 'locks');
});
afterEach(async () => {
  await act(async () => root.unmount());
  node.remove();
  vi.restoreAllMocks();
  if (descriptor) Object.defineProperty(navigator, 'locks', descriptor);
  else Reflect.deleteProperty(navigator, 'locks');
});
const mount = async (profile = createPlayerProfile(), message = '') =>
  act(async () =>
    root.render(createElement(AchievementProgress, { profile, message })),
  );
function button(text: string) {
  const b = [...node.querySelectorAll<HTMLButtonElement>('button')].find(
    (b) => b.textContent?.trim() === text,
  );
  if (!b) throw Error(text);
  return b;
}
const click = async (label: string) => act(async () => button(label).click());
function locks() {
  let tail = Promise.resolve<unknown>(undefined);
  Object.defineProperty(navigator, 'locks', {
    configurable: true,
    value: {
      request: (_n: string, _o: unknown, work: () => unknown) => {
        const next = tail.then(work);
        tail = next.catch(() => {});
        return next;
      },
    },
  });
}
function earned() {
  return appendAchievementEvent(
    createPlayerProfile(),
    {
      source: 'live',
      mode: 'classic',
      root: sha256Hex('root'),
      parent: null,
      authorityHash: sha256Hex('hash'),
      event: decodeAchievementEvent({
        stage: 'room',
        position: 0,
        values: [1, 0, 0, 0, 0],
      }),
    },
    new Date('2026-10-15T00:00:00.000Z'),
  );
}
it('shows exactly 30 catalog cards in six categories and six prerequisites versus 24 collection challenges without activating a profile', async () => {
  await mount();
  expect(node.querySelectorAll('.achievement-card')).toHaveLength(30);
  expect(node.querySelectorAll('[id^=achievement-category-]')).toHaveLength(6);
  expect(
    [...node.querySelectorAll('.achievement-meta')].filter((n) =>
      n.textContent?.includes('角色前置'),
    ),
  ).toHaveLength(6);
  expect(
    [...node.querySelectorAll('.achievement-meta')].filter((n) =>
      n.textContent?.includes('收藏挑战'),
    ),
  ).toHaveLength(24);
  expect(node.textContent).toContain('成就 · 0 / 30');
  expect(node.textContent).toContain('尚无0.5');
  expect(localStorage.length).toBe(0);
});
it('shows saved progress, exact ISO completion time, scope and same-match peak labels', async () => {
  await mount(earned());
  const card = node.querySelector('#achievement-A01')!;
  expect(card.textContent).toContain('已达成');
  expect(card.querySelector('time')!.dateTime).toBe('2026-10-15T00:00:00.000Z');
  expect(node.querySelector('#achievement-A02')!.textContent).toContain(
    '1 / 10',
  );
  expect(node.querySelector('#achievement-A03')!.textContent).toContain(
    '单局最高进度',
  );
  expect(node.querySelector('#achievement-F02')!.textContent).toContain(
    '仅生存',
  );
});
it('manual authorization opens all role cards but marks none of their prerequisites complete', async () => {
  const p = manuallyUnlockAchievementCharacters(createPlayerProfile());
  await mount(p);
  expect(
    node.querySelectorAll('.achievement-role[data-unlocked=true]'),
  ).toHaveLength(5);
  expect(
    node.querySelectorAll('.achievement-card[data-achieved=true]'),
  ).toHaveLength(0);
  expect(node.textContent).toContain('手动授权；不代表下列成就已完成');
  expect(node.querySelectorAll('.achievement-role a')).toHaveLength(6);
});
it('unreadable or unknown profile is not displayed as zero and does not reset the source', async () => {
  const p = createPlayerProfile();
  p.progression.modules.achievementRegistryV1 = { version: 99 };
  const source = JSON.stringify(p);
  localStorage.setItem(playerProfileKey, source);
  await mount(p);
  expect(node.textContent).toContain('成就暂不可核验');
  expect(node.querySelector('.achievement-card')).toBeNull();
  expect(localStorage.getItem(playerProfileKey)).toBe(source);
  await mount(createPlayerProfile(), '档案读取失败');
  expect(node.textContent).toContain('档案读取失败');
  expect(node.textContent).not.toContain('0 / 30');
});
it('shared progress achievement tab is read-only until explicit grant, then reloads current role permissions without awarding', async () => {
  locks();
  await act(async () => root.render(createElement(GameApp)));
  await click('进度');
  await click('成就');
  expect(node.querySelectorAll('.achievement-card')).toHaveLength(30);
  expect(localStorage.getItem(playerProfileKey)).toBeNull();
  expect(node.querySelector('.progress-mode-tabs')).toBeNull();
  await click('一键解锁全部角色');
  expect(
    node.querySelectorAll('.achievement-role[data-unlocked=true]'),
  ).toHaveLength(5);
  expect(
    readAchievementRegistry(
      JSON.parse(localStorage.getItem(playerProfileKey)!),
    )!.receipts,
  ).toHaveLength(0);
  await click('总览');
  await click('成就');
  expect(
    node.querySelectorAll('.achievement-role[data-unlocked=true]'),
  ).toHaveLength(5);
});
it('explicit profile rollback updates displayed achievement completion and permissions', async () => {
  localStorage.setItem(playerProfileKey, JSON.stringify(earned()));
  await act(async () => root.render(createElement(GameApp)));
  await click('进度');
  await click('成就');
  expect(node.querySelector('#achievement-A01')!.textContent).toContain(
    '已达成',
  );
  const p = createPlayerProfile();
  localStorage.setItem(playerProfileKey, JSON.stringify(p));
  await act(async () =>
    window.dispatchEvent(
      new StorageEvent('storage', {
        key: playerProfileKey,
        storageArea: localStorage,
      }),
    ),
  );
  expect(
    node.querySelectorAll('.achievement-card[data-achieved=true]'),
  ).toHaveLength(0);
  expect(
    node.querySelectorAll('.achievement-role[data-unlocked=true]'),
  ).toHaveLength(1);
});
function settled() {
  const s = beginClassicGrowth(
    reduceGameSession(createGameSession(42), {
      type: 'start_game',
      characterId: 'lost',
    }),
  );
  if (s.game.phase === 'character_selection') throw Error();
  return reduceGameSession(s, {
    type: 'submit_player_turn',
    turn: {
      playerId: 'human',
      actions: [{ type: 'bid', group: 'A', amount: s.game.players[0]!.money }],
    },
  });
}
it('success-only notice survives acknowledgement render, can be dismissed, and never repeats on ordinary reload', async () => {
  locks();
  localStorage.setItem(gameSaveKey, serializeGameCheckpoint(settled()));
  await act(async () => root.render(createElement(ClassicGameApp)));
  expect(node.querySelector('.achievement-notice')!.textContent).toContain(
    '成就已保存',
  );
  await click('知道了');
  expect(node.querySelector('.achievement-notice')).toBeNull();
  await act(async () => root.render(null));
  await act(async () => root.render(createElement(ClassicGameApp)));
  expect(node.querySelector('.achievement-notice')).toBeNull();
});
it('quota failure keeps the notice absent until explicit successful retry', async () => {
  locks();
  localStorage.setItem(gameSaveKey, serializeGameCheckpoint(settled()));
  const base = localStorage.setItem.bind(localStorage);
  let failed = true;
  vi.spyOn(localStorage, 'setItem').mockImplementation((k, v) => {
    if (k === playerProfileKey && failed) throw Error('quota');
    base(k, v);
  });
  await act(async () => root.render(createElement(ClassicGameApp)));
  expect(node.querySelector('.achievement-notice')).toBeNull();
  failed = false;
  await click('重试保存');
  expect(node.querySelector('.achievement-notice')!.textContent).toContain(
    '成就已保存',
  );
});
