// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import { GameApp } from '@/components/game/game-app';
import { ClassicGameApp } from '@/components/game/classic-game-app';
import { playerProfileKey, createPlayerProfile } from '../player-profile';
import {
  manuallyUnlockAchievementCharacters,
  readAchievementRegistry,
  projectAchievementRegistry,
} from './registry';
import { gameSaveKey, serializeGameCheckpoint } from '../game-save';
import { activeModeKey } from '../survival-client';
import { createGameSession, reduceGameSession } from '../game-session';
import { notifyPlayerProfileChanged } from '../profile-events';
import * as rooms from '../../game/rooms';
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
const radio = (id: string) =>
  node.querySelector<HTMLInputElement>(`input[name=character][value=${id}]`)!;
function button(text: string) {
  const b = [...node.querySelectorAll<HTMLButtonElement>('button')].find(
    (b) => b.textContent?.trim() === text,
  );
  if (!b) throw Error(text);
  return b;
}
const click = async (b: HTMLElement) => act(async () => b.click());
function granted() {
  localStorage.setItem(
    playerProfileKey,
    JSON.stringify(manuallyUnlockAchievementCharacters(createPlayerProfile())),
  );
}
it.each(['classic', 'survival'] as const)(
  'formal %s selection defaults to Isaac and leaves the four role requirements visible',
  async (mode) => {
    await act(async () => root.render(createElement(GameApp)));
    await click(button(mode === 'classic' ? '经典模式' : '生存模式'));
    expect(radio('isaac').disabled).toBe(false);
    for (const id of ['lost', 'azazel', 'eden', 'jacob_esau'])
      expect(radio(id).disabled).toBe(true);
    expect(node.textContent).toContain('非将军之过 + 屡败屡战');
    expect(node.textContent).toContain('厚积薄发 + 硫磺火？');
    await click(radio('isaac'));
    await click(button('开始游戏'));
    expect(node.querySelector('.game-stage')).not.toBeNull();
  },
);
it('manual unlock UI persists independent authorization and no achievements; ordinary remount keeps it', async () => {
  locks();
  await act(async () => root.render(createElement(ClassicGameApp)));
  const before = JSON.parse(localStorage.getItem(playerProfileKey)!);
  await click(button('一键解锁全部角色'));
  const after = JSON.parse(localStorage.getItem(playerProfileKey)!);
  expect(projectAchievementRegistry(after)!.achievedAt).toEqual(
    projectAchievementRegistry(before)!.achievedAt,
  );
  expect(readAchievementRegistry(after)!.receipts).toEqual([]);
  expect(radio('lost').disabled).toBe(false);
  const at = readAchievementRegistry(after)!.manualUnlockAllAt;
  await act(async () => root.render(null));
  await act(async () => root.render(createElement(ClassicGameApp)));
  expect(radio('lost').disabled).toBe(false);
  expect(
    readAchievementRegistry(
      JSON.parse(localStorage.getItem(playerProfileKey)!),
    )!.manualUnlockAllAt,
  ).toBe(at);
});
it('no coordinator and quota failures do not fake a saved manual grant; explicit retry can succeed', async () => {
  await act(async () => root.render(createElement(ClassicGameApp)));
  await click(button('一键解锁全部角色'));
  expect(radio('lost').disabled).toBe(true);
  expect(localStorage.getItem(playerProfileKey)).toBeNull();
  locks();
  const base = localStorage.setItem.bind(localStorage);
  let fail = true;
  vi.spyOn(localStorage, 'setItem').mockImplementation((k, v) => {
    if (k === playerProfileKey && fail) throw Error('quota');
    base(k, v);
  });
  await click(button('一键解锁全部角色'));
  expect(radio('lost').disabled).toBe(true);
  expect(node.textContent).toContain('quota');
  fail = false;
  await click(button('一键解锁全部角色'));
  expect(radio('lost').disabled).toBe(false);
});
it.each(['classic', 'survival'] as const)(
  'formal %s start guard rejects a silently revoked stale selection before room generation',
  async (mode) => {
    granted();
    await act(async () => root.render(createElement(GameApp)));
    await click(button(mode === 'classic' ? '经典模式' : '生存模式'));
    await click(radio('lost'));
    localStorage.setItem(
      playerProfileKey,
      JSON.stringify(createPlayerProfile()),
    );
    const generate = vi.spyOn(rooms, 'generateFloor');
    await click(button('开始游戏'));
    expect(generate).not.toHaveBeenCalled();
    expect(node.querySelector('.character-page')).not.toBeNull();
    expect(node.textContent).toContain('角色尚未解锁');
    expect(localStorage.getItem(gameSaveKey)).toBeNull();
  },
);
it('profile replacement notification revokes selected role and disables starting it without changing history', async () => {
  granted();
  await act(async () => root.render(createElement(ClassicGameApp)));
  await click(radio('lost'));
  const p = createPlayerProfile();
  localStorage.setItem(playerProfileKey, JSON.stringify(p));
  await act(async () => notifyPlayerProfileChanged());
  expect(radio('lost').checked).toBe(false);
  expect(button('开始游戏').disabled).toBe(true);
  expect(JSON.parse(localStorage.getItem(playerProfileKey)!)).toEqual(p);
});
it('legacy active Lost game continues while new selections are locked; tutorials stay accessible', async () => {
  const s = reduceGameSession(createGameSession(42), {
    type: 'start_game',
    characterId: 'lost',
  });
  localStorage.setItem(gameSaveKey, serializeGameCheckpoint(s));
  localStorage.setItem(activeModeKey, 'classic');
  await act(async () => root.render(createElement(GameApp)));
  await click(button('静观其变'));
  expect(node.textContent).toContain('游魂');
  expect(node.querySelector('.character-page')).toBeNull();
});
it('unknown module is preserved byte-exact and blocks selection and manual grant', async () => {
  const p = createPlayerProfile();
  p.progression.modules.achievementRegistryV1 = { version: 99 };
  const source = JSON.stringify(p);
  localStorage.setItem(playerProfileKey, source);
  await act(async () => root.render(createElement(ClassicGameApp)));
  expect(radio('isaac').disabled).toBe(true);
  expect(button('一键解锁全部角色').disabled).toBe(true);
  expect(localStorage.getItem(playerProfileKey)).toBe(source);
});
