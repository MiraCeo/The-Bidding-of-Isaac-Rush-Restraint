// @vitest-environment happy-dom
import { achievementNumber } from './numbering';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import {
  achievementCatalog,
  characterAchievementRequirements,
} from './catalog';
import { characterCatalog } from '@/lib/game';
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
async function closeDialog() {
  await act(async () =>
    (
      document.querySelector('[aria-label="关闭成就详情"]') as HTMLButtonElement
    ).click(),
  );
}
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
it('shows 107 badges as 57 cards in six categories with six prerequisites and 101 collection badges without activating a profile', async () => {
  await mount();
  expect(node.querySelectorAll('.achievement-card')).toHaveLength(57);
  expect(node.querySelectorAll('[id^=achievement-category-]')).toHaveLength(6);
  expect(node.querySelectorAll('.achievement-badge')).toHaveLength(57);
  expect(node.querySelectorAll('.achievement-card progress')).toHaveLength(29);
  expect(node.textContent).toContain('成就总览0 / 107');
  expect(node.textContent).toContain('尚无0.5');
  expect(localStorage.length).toBe(0);
});
it.each(achievementCatalog)(
  'preserves $id full metadata in a detail modal without activation',
  async (a) => {
    await mount();
    await act(async () => {
      const input = node.querySelector<HTMLInputElement>('input[type=search]')!;
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        'value',
      )!.set!.call(input, achievementNumber(a.id));
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () =>
      (node.querySelector('.achievement-card') as HTMLButtonElement).click(),
    );
    const dialog = document.querySelector('[role="dialog"]')!;
    expect(dialog.querySelector('.achievement-eyebrow')!.textContent).toContain(
      achievementNumber(a.id) + ' ·',
    );
    expect(
      node
        .querySelector('.achievement-card')!
        .getAttribute('data-achievement-number'),
    ).toBe(achievementNumber(a.id));
    expect(dialog.textContent).toContain(a.condition);
    expect(dialog.textContent).toContain(
      a.scope === 'shared'
        ? '正式经典 / 生存通用'
        : a.scope === 'classic'
          ? '仅正式经典模式'
          : '仅正式生存模式',
    );
    expect(dialog.textContent).toContain(a.target.toString());
    expect(dialog.textContent).toContain(
      characterCatalog.some((c) =>
        characterAchievementRequirements[c.id].includes(a.id),
      )
        ? '前置：'
        : '无 · 收藏挑战',
    );
    await closeDialog();
    expect(localStorage.length).toBe(0);
  },
);
it('shows saved progress, exact ISO completion time, scope and same-match peak labels', async () => {
  await mount(earned());
  const card = node.querySelector('#achievement-A01')!;
  expect(card.textContent).toContain('已获 1 / 3');
  expect(card.querySelector('time')).toBeNull();
  expect(card.querySelector('progress')!.max).toBe(1);
  await act(async () => (card as HTMLButtonElement).click());
  expect(
    document.querySelector('[role="dialog"] time')!.getAttribute('datetime'),
  ).toBe('2026-10-15T00:00:00.000Z');
  await closeDialog();
  expect(node.querySelector('#achievement-A10')!.textContent).toContain(
    '0 / 5',
  );
  expect(node.querySelector('#achievement-A03')!.textContent).toContain(
    '屡战屡败',
  );
  expect(node.querySelector('#achievement-A03 progress')).not.toBeNull();
  await act(async () =>
    (node.querySelector('#achievement-A03') as HTMLButtonElement).click(),
  );
  expect(document.querySelector('[role=dialog]')!.textContent).toContain(
    '单局最高进度',
  );
  await closeDialog();
  await act(async () =>
    (node.querySelector('#achievement-F02') as HTMLButtonElement).click(),
  );
  expect(document.querySelector('[role="dialog"]')!.textContent).toContain(
    '仅正式生存模式',
  );
  await closeDialog();
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
  expect(node.querySelectorAll('.achievement-role-state')).toHaveLength(5);
  expect(
    [...node.querySelectorAll('.achievement-role-state')].filter(
      (n) => n.textContent === '手动授权',
    ),
  ).toHaveLength(4);
  expect(node.querySelectorAll('.achievement-role li button')).toHaveLength(6);
  await act(async () =>
    (
      node.querySelector('.achievement-role li button') as HTMLButtonElement
    ).click(),
  );
  expect(document.querySelector('[role=dialog]')!.textContent).toContain(
    '游魂前置：E01 非将军之过 + A08 屡败屡战 I',
  );
  await closeDialog();
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
  expect(node.textContent).not.toContain('0 / 60');
});
it('shared progress achievement tab is read-only until explicit grant, then reloads current role permissions without awarding', async () => {
  locks();
  await act(async () => root.render(createElement(GameApp)));
  await click('进度');
  await click('成就');
  expect(node.querySelectorAll('.achievement-card')).toHaveLength(57);
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
    '已获 1 / 3',
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
