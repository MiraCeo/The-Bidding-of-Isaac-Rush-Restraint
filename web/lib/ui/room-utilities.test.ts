// @vitest-environment happy-dom
import { decodedDownload } from './file-export.test-helper';

import { act, createElement, useState, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ClassicGameApp as GameApp } from '@/components/game/classic-game-app';
import { GameApp as ManagedGameApp } from '@/components/game/game-app';
import { RoomPrototype } from '@/components/game/room-prototype';
import * as roomGeneration from '../game/rooms';
import * as aiDecision from '../game/ai-decision';
import * as preferenceStorage from './game-preferences';
import {
  gameSaveKey,
  lastCompletedKey,
  loadAutoSave,
  parseGameSave,
} from './game-save';
import { serializeSessionFixture as serializeGameSave } from './save-fixture.test-helper';
import { parseReplay } from './game-replay';
import { createGameSession, reduceGameSession } from './game-session';
import {
  startClientGame,
  type ActiveClientGameState,
} from '../game/client-session';
import {
  defaultGamePreferences,
  gamePreferencesKey,
  type GamePreferences,
} from './game-preferences';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  localStorage.clear();
  window.scrollTo(0, 0);
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

async function mount(node: ReactNode) {
  await act(async () => root.render(node));
}

function element<T extends Element>(selector: string): T {
  const found = container.querySelector<T>(selector);
  if (!found) throw new Error(`Missing element ${selector}`);
  return found;
}

function button(text: string, scope: Element = container): HTMLButtonElement {
  const found = Array.from(scope.querySelectorAll('button')).find(
    (candidate) => candidate.textContent?.trim() === text,
  );
  if (!found) throw new Error(`Missing button ${text}`);
  return found;
}

async function click(target: HTMLElement) {
  await act(async () => target.click());
}

async function setInput(selector: string, value: string) {
  const input = element<HTMLInputElement>(selector);
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value',
    )!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

function savedSession(characterId: 'lost' | 'jacob_esau' = 'lost', seed = 42) {
  return reduceGameSession(createGameSession(seed), {
    type: 'start_game',
    characterId,
  });
}

async function mountManaged(key?: string) {
  await mount(createElement(ManagedGameApp, { key }));
  const classic = [
    ...container.querySelectorAll<HTMLButtonElement>('button'),
  ].find((b) => b.textContent?.trim() === '经典模式');
  if (classic) await click(classic);
}
async function openData() {
  await click(button('进度', element('nav[aria-label="主导航"]')));
  await click(button('存档与备份'));
}
async function upload(source: string) {
  const entry = Array.from(container.querySelectorAll('button')).find(
    (b) => b.textContent?.trim() === '导入文件',
  );
  if (entry) await click(entry);
  const input = element<HTMLInputElement>('input[aria-label="导入对局文件"]');
  const file = new File([source], 'save.json', { type: 'application/json' });
  Object.defineProperty(input, 'files', { configurable: true, value: [file] });
  await act(async () => {
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

function Harness({
  game,
  onSubmit = () => {},
}: {
  game: ActiveClientGameState;
  onSubmit?: () => void;
}) {
  const [preferences, setPreferences] = useState<GamePreferences>({
    ...defaultGamePreferences,
  });
  return createElement(RoomPrototype, {
    game,
    onSubmit,
    preferences,
    preferenceSaveStatus: 'unchanged',
    onPreferencesChange: setPreferences,
  });
}

describe('room utility interaction without a real browser', () => {
  it('reselects a character only after confirmation on the game page and leaves preferences separate', async () => {
    const source = serializeGameSave(savedSession());
    localStorage.setItem(gameSaveKey, source);
    localStorage.setItem(
      gamePreferencesKey,
      JSON.stringify({
        version: 1,
        preferences: { ...defaultGamePreferences, scoreDecimals: 4 },
      }),
    );
    await mount(createElement(GameApp));
    await click(button('设置', element('nav')));
    expect(element('#room-utilities').textContent).not.toContain('重新选角');
    await click(button('游戏', element('nav')));
    await click(button('重新选角'));
    expect(localStorage.getItem(gameSaveKey)).not.toBeNull();
    await click(button('保留当前对局'));
    expect(container.querySelector('.match-restart-confirm')).toBeNull();
    await click(button('重新选角'));
    await click(button('确认重新选角'));
    expect(container.textContent).toContain('选择角色');
    expect(localStorage.getItem(gameSaveKey)).toBeNull();
    expect(
      JSON.parse(localStorage.getItem(gamePreferencesKey)!).preferences
        .scoreDecimals,
    ).toBe(4);
    expect(parseGameSave(source).session.game.phase).toBe('room_action');
  });
  it('does not silently erase an unreadable automatic save while showing the initial page', async () => {
    localStorage.setItem(gameSaveKey, 'broken');
    await mountManaged();
    expect(container.textContent).toContain('选择角色');
    expect(localStorage.getItem(gameSaveKey)).toBe('broken');
    await openData();
    expect(element('.save-panel').textContent).toContain('自动存档未读取');
    await upload(serializeGameSave(savedSession()));
    await click(button('载入这局'));
    expect(
      parseGameSave(localStorage.getItem(gameSaveKey)!).session.game.phase,
    ).toBe('room_action');
  });
  it('opens the build page from either agreed position and retains the editable draft', async () => {
    localStorage.setItem(
      gameSaveKey,
      serializeGameSave(savedSession('jacob_esau')),
    );
    await mount(createElement(GameApp));
    await setInput('input[aria-label="竞拍奖励 A 的数值"]', '19');
    const original = element('input[aria-label="竞拍奖励 A 的数值"]');
    await click(element<HTMLButtonElement>('[aria-label="查看角色构筑"]'));
    expect(element('#room-utilities-title').textContent).toBe('构筑与当前状态');
    expect(
      container.querySelectorAll('.player-build-content .build-item'),
    ).toHaveLength(2);
    expect(element('.player-build-content').textContent).toContain(
      '双行动积分 ×1',
    );
    expect(element('.room-game-content').hasAttribute('hidden')).toBe(true);
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    await click(button('返回游戏'));
    expect(element('input[aria-label="竞拍奖励 A 的数值"]')).toBe(original);
    expect(
      element<HTMLInputElement>('input[aria-label="竞拍奖励 A 的数值"]').value,
    ).toBe('19');
    await click(
      element<HTMLButtonElement>('[aria-label="查看构筑与当前状态"]'),
    );
    expect(element('#room-utilities-title').textContent).toContain('构筑');
    await act(async () =>
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
      ),
    );
    expect(
      element<HTMLInputElement>('input[aria-label="竞拍奖励 A 的数值"]').value,
    ).toBe('19');
    expect(loadAutoSave(localStorage).session!.draft!.amounts.A.bid).toBe(19);
  });

  it('automatically resumes unsubmitted amounts after a fresh mount without changing items or money', async () => {
    const session = savedSession('jacob_esau');
    localStorage.setItem(gameSaveKey, serializeGameSave(session));
    await mountManaged();
    await setInput('input[aria-label="竞拍奖励 A 的数值"]', '19');
    await setInput('input[aria-label="竞拍奖励 B 的数值"]', '21');
    const stored = loadAutoSave(localStorage).session;
    await mountManaged('refresh');
    expect(
      element<HTMLInputElement>('input[aria-label="竞拍奖励 A 的数值"]').value,
    ).toBe('19');
    expect(
      element<HTMLInputElement>('input[aria-label="竞拍奖励 B 的数值"]').value,
    ).toBe('21');
    const recovered = loadAutoSave(localStorage).session!;
    expect(recovered).toEqual(stored);
    expect(recovered.game).toEqual(session.game);
    await openData();
    expect(element('.save-panel').textContent).toContain('已恢复浏览器');
  });

  it('previews valid files before replacing a game and leaves the live game intact on failure or cancel', async () => {
    localStorage.setItem(gameSaveKey, serializeGameSave(savedSession()));
    await mountManaged();
    await setInput('input[aria-label="竞拍奖励 A 的数值"]', '17');
    const before = localStorage.getItem(gameSaveKey)!;
    await openData();
    await upload('{bad');
    expect(element('.save-message').textContent).toContain('JSON');
    expect(localStorage.getItem(gameSaveKey)).toBe(before);
    const candidate = savedSession('jacob_esau', 777);
    candidate.draft!.amounts.B.bid = 22;
    await upload(serializeGameSave(candidate));
    expect(element('.save-candidate').textContent).toContain('雅阁和以扫');
    expect(localStorage.getItem(gameSaveKey)).toBe(before);
    await click(button('取消'));
    expect(container.querySelector('.save-candidate')).toBeNull();
    expect(localStorage.getItem(gameSaveKey)).toBe(before);
    await upload(serializeGameSave(candidate));
    await click(button('载入这局'));
    expect(
      element<HTMLInputElement>('input[aria-label="竞拍奖励 B 的数值"]').value,
    ).toBe('22');
    expect(element('.round-status').textContent).toContain('雅阁和以扫');
    expect(parseGameSave(localStorage.getItem(gameSaveKey)!).session).toEqual(
      candidate,
    );
  });

  it('loads a file from initial settings without requiring a new game first', async () => {
    await mountManaged();
    await openData();
    expect(
      Array.from(container.querySelectorAll('button')).some(
        (b) => b.textContent?.trim() === '导出存档',
      ),
    ).toBe(false);
    await upload(serializeGameSave(savedSession('jacob_esau')));
    await click(button('载入这局'));
    expect(element('.round-status').textContent).toContain('雅阁和以扫');
    expect(element('.game-stage').getAttribute('aria-label')).toBe(
      '房间行动区',
    );
  });

  it('exports a JSON blob containing the exact live draft without any network request', async () => {
    localStorage.setItem(gameSaveKey, serializeGameSave(savedSession()));
    await mountManaged();
    await setInput('input[aria-label="竞拍奖励 B 的数值"]', '23');
    await openData();
    let blob: Blob | undefined;
    const download = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => {});
    vi.spyOn(URL, 'createObjectURL').mockImplementation((value) => {
      blob = value as Blob;
      return 'blob:test-save';
    });
    const request = vi.spyOn(globalThis, 'fetch');
    await click(button('导出存档'));
    const source = await decodedDownload(() => blob);
    expect(download).toHaveBeenCalledOnce();
    expect(parseGameSave(source).session.draft!.amounts.B.bid).toBe(23);
    expect(request).not.toHaveBeenCalled();
  });

  it('keeps file saving available with blocked storage and does not reset the game from display settings', async () => {
    vi.spyOn(preferenceStorage, 'getPreferenceStorage').mockReturnValue(null);
    await mountManaged();
    await click(
      element<HTMLInputElement>('input[name="character"][value="isaac"]'),
    );
    await click(button('开始游戏'));
    await setInput('input[aria-label="竞拍奖励 A 的数值"]', '12');
    await openData();
    expect(element('.save-panel').textContent).toContain('尚未保存到浏览器');
    expect(button('导出存档').disabled).toBe(false);
    await click(button('设置', element('nav[aria-label="主导航"]')));
    await click(button('恢复默认设置'));
    await click(button('返回游戏'));
    expect(
      element<HTMLInputElement>('input[aria-label="竞拍奖励 A 的数值"]').value,
    ).toBe('12');
  });

  it.each(['room_result', 'room_ranking', 'game_result'] as const)(
    'preserves %s when navigating settings, rules and build',
    async (phase) => {
      let session = savedSession();
      const rooms = phase === 'game_result' ? 15 : 1;
      for (let i = 0; i < rooms; i++) {
        session = reduceGameSession(session, {
          type: 'submit_player_turn',
          turn: { playerId: 'human', actions: [{ type: 'withdraw' }] },
        });
        if (i < rooms - 1)
          session = reduceGameSession(session, { type: 'advance_room' });
      }
      if (phase === 'room_ranking')
        session = reduceGameSession(session, {
          type: 'show_room_ranking',
          view: 'contest',
        });
      if (phase === 'game_result')
        session = reduceGameSession(session, { type: 'advance_room' });
      localStorage.setItem(gameSaveKey, serializeGameSave(session));
      await mount(createElement(GameApp));
      expect(container.querySelectorAll('.topbar')).toHaveLength(1);
      const before = localStorage.getItem(gameSaveKey)!;
      await click(button('设置', element('nav')));
      if (phase === 'game_result')
        expect(
          Array.from(container.querySelectorAll('button')).some(
            (b) => b.textContent?.trim() === '导出存档',
          ),
        ).toBe(false);
      else expect(container.querySelector('.data-management')).toBeNull();
      await click(button('规则', element('nav')));
      await click(element<HTMLButtonElement>('[aria-label="查看角色构筑"]'));
      await click(button('返回游戏'));
      expect(localStorage.getItem(gameSaveKey)).toBe(before);
      if (phase !== 'game_result')
        expect(parseGameSave(before).session.game.phase).toBe(phase);
      if (phase === 'game_result') {
        expect(
          parseReplay(localStorage.getItem(lastCompletedKey)!).replay.final,
        ).toBeTruthy();
        expect(before).toBeNull();
        await click(button('重新开始'));
        expect(localStorage.getItem(gameSaveKey)).toBeNull();
        expect(container.textContent).toContain('选择角色');
      }
    },
  );
  it('provides four working home-page tabs before choosing a character without creating a game', async () => {
    const generate = vi.spyOn(roomGeneration, 'generateFloor');
    const decide = vi.spyOn(aiDecision, 'decideAiTurn');
    await mount(createElement(GameApp));
    const nav = element('nav[aria-label="主导航"]');
    expect(
      Array.from(nav.querySelectorAll('button')).map((entry) =>
        entry.textContent?.trim(),
      ),
    ).toEqual(['游戏', '排行', '进度', '设置', '规则']);
    expect(element<HTMLButtonElement>('.character-start-button').disabled).toBe(
      true,
    );
    await click(button('规则', nav));
    expect(element('#room-utilities-title').textContent).toBe('规则');
    expect(container.querySelectorAll('.rule-item-card')).toHaveLength(26);
    expect(element<HTMLDivElement>('.character-stage').hidden).toBe(true);
    await click(button('设置', nav));
    expect(element('#room-utilities-title').textContent).toBe('设置');
    expect(container.querySelectorAll('fieldset.settings-group')).toHaveLength(
      1,
    );
    expect(container.querySelector('.save-panel')).toBeNull();
    await click(button('排行', nav));
    expect(element('.empty-ranking-state').textContent).toContain('暂无排行');
    expect(container.querySelector('.ranking-table')).toBeNull();
    expect(element('#room-utilities').textContent).not.toContain(
      '你的积分排名',
    );
    await click(button('游戏', nav));
    expect(element<HTMLDivElement>('.character-stage').hidden).toBe(false);
    expect(element('.character-footer').textContent).toContain('尚未选择角色');
    expect(container.querySelectorAll('.character-card')).toHaveLength(5);
    expect(generate).not.toHaveBeenCalled();
    expect(decide).not.toHaveBeenCalled();
  });

  it('preserves the chosen home-page character and only initializes the game after an explicit start', async () => {
    const generate = vi.spyOn(roomGeneration, 'generateFloor');
    await mount(createElement(GameApp));
    const selected = element<HTMLInputElement>(
      'input[name="character"][value="azazel"]',
    );
    await click(selected);
    for (const page of ['规则', '排行', '设置']) {
      await click(button(page, element('nav[aria-label="主导航"]')));
      expect(
        element<HTMLButtonElement>('.character-start-button').disabled,
      ).toBe(true);
      await click(element<HTMLButtonElement>('.character-start-button'));
      expect(generate).not.toHaveBeenCalled();
      await click(button('返回游戏'));
      expect(
        element<HTMLInputElement>('input[name="character"][value="azazel"]'),
      ).toBe(selected);
      expect(selected.checked).toBe(true);
      expect(
        element<HTMLButtonElement>('.character-start-button').disabled,
      ).toBe(false);
    }
    await click(button('开始游戏'));
    expect(generate).toHaveBeenCalledTimes(3);
    expect(element('.round-status').textContent).toContain('阿撒泻勒');
    expect(element('.round-status').textContent).toContain('房间 1/5');
  });

  it('applies settings chosen before starting to the later game and its ranking display', async () => {
    await mount(createElement(GameApp));
    await click(button('设置', element('nav[aria-label="主导航"]')));
    await click(
      element<HTMLInputElement>('label[aria-label="默认展开资金排行"] input'),
    );
    await click(
      element<HTMLInputElement>('label[aria-label="默认展开共同市场"] input'),
    );
    await click(
      element<HTMLInputElement>('label[aria-label="减少界面动效"] input'),
    );
    const precision = element<HTMLSelectElement>('.setting-select select');
    await act(async () => {
      precision.value = '4';
      precision.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(element('.game-client').getAttribute('data-reduce-motion')).toBe(
      'true',
    );
    expect(localStorage.length).toBe(1);
    await click(button('游戏', element('nav[aria-label="主导航"]')));
    await click(
      element<HTMLInputElement>('input[name="character"][value="isaac"]'),
    );
    await click(button('开始游戏'));
    expect(element('#ranking-drawer').getAttribute('aria-hidden')).toBe(
      'false',
    );
    expect(element('#market-drawer').getAttribute('aria-hidden')).toBe('false');
    await click(button('排行', element('nav[aria-label="主导航"]')));
    expect(container.querySelectorAll('.ranking-table tbody tr')).toHaveLength(
      20,
    );
    expect(element('.ranking-table tbody td:nth-child(4)').textContent).toBe(
      '0.0000',
    );
  });

  it('restores the home-page selection and scroll position after reading rules with Escape', async () => {
    await mount(createElement(GameApp));
    await click(
      element<HTMLInputElement>('input[name="character"][value="eden"]'),
    );
    window.scrollTo(0, 280);
    await click(button('规则', element('nav[aria-label="主导航"]')));
    expect(window.scrollY).toBe(0);
    await act(async () => {
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }),
      );
    });
    expect(window.scrollY).toBe(280);
    expect(
      element<HTMLInputElement>('input[name="character"][value="eden"]')
        .checked,
    ).toBe(true);
    expect(element<HTMLDivElement>('.character-stage').hidden).toBe(false);
    expect(container.querySelector('.round-status')).toBeNull();
  });

  it('keeps pregame display settings usable when browser storage is blocked', async () => {
    vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => {
      throw new Error('blocked');
    });
    await mount(createElement(GameApp));
    await click(button('设置', element('nav[aria-label="主导航"]')));
    await click(
      element<HTMLInputElement>('label[aria-label="默认展开资金排行"] input'),
    );
    expect(element('.settings-footer output').textContent).toContain(
      '当前会话',
    );
    await click(button('返回游戏'));
    await click(
      element<HTMLInputElement>('input[name="character"][value="isaac"]'),
    );
    await click(button('开始游戏'));
    expect(element('#ranking-drawer').getAttribute('aria-hidden')).toBe(
      'false',
    );
  });

  it('switches full-size secondary pages using the original header and preserves the room instance', async () => {
    await mount(createElement(Harness, { game: startClientGame('isaac', 42) }));
    const originalInput = element<HTMLInputElement>('#bid-A');
    for (const name of ['排行', '设置', '规则']) {
      const trigger = button(name, element('nav[aria-label="主导航"]'));
      expect(trigger.disabled).toBe(false);
      await click(trigger);
      expect(container.querySelector('dialog')).toBeNull();
      expect(
        element('#room-utilities').classList.contains('ranking-stage'),
      ).toBe(true);
      expect(element<HTMLDivElement>('.room-game-content').hidden).toBe(true);
      expect(element('#room-utilities-title').textContent).toBe(
        name === '排行' ? '当前公开排行' : name,
      );
      expect(document.activeElement).toBe(element('#room-utilities-title'));
      expect(container.querySelectorAll('.topbar')).toHaveLength(1);
      await click(button('返回游戏'));
      expect(container.querySelector('#room-utilities')).toBeNull();
      expect(element<HTMLDivElement>('.room-game-content').hidden).toBe(false);
      expect(element<HTMLInputElement>('#bid-A')).toBe(originalInput);
      expect(element('section[aria-label="房间行动区"]')).toBeTruthy();
    }
  });

  it('retains a changed B bid through rules, settings and public ranking without a submit or mutation', async () => {
    const game = startClientGame('isaac', 42);
    const before = structuredClone(game);
    const submit = vi.fn();
    await mount(createElement(Harness, { game, onSubmit: submit }));
    await click(element<HTMLInputElement>('#bid-B'));
    await setInput(
      'input[type="number"][aria-label="竞拍奖励 B 的数值"]',
      '31',
    );
    await click(button('规则', element('nav[aria-label="主导航"]')));
    await click(button('设置', element('nav[aria-label="主导航"]')));
    await click(
      element<HTMLInputElement>('label[aria-label="默认展开资金排行"] input'),
    );
    await click(button('排行', element('nav[aria-label="主导航"]')));
    await click(button('资金排行'));
    await click(button('返回游戏'));
    expect(element<HTMLInputElement>('#bid-B').checked).toBe(true);
    expect(
      element<HTMLInputElement>(
        'input[type="number"][aria-label="竞拍奖励 B 的数值"]',
      ).value,
    ).toBe('31');
    expect(submit).not.toHaveBeenCalled();
    expect(game).toEqual(before);
    await click(element<HTMLButtonElement>('.confirm-button'));
    expect(submit).toHaveBeenCalledExactlyOnceWith({
      playerId: 'human',
      actions: [{ type: 'bid', group: 'B', amount: 31 }],
    });
  });

  it('starts each secondary page at the top and restores the game scroll position and header focus', async () => {
    await mount(createElement(Harness, { game: startClientGame('isaac', 42) }));
    window.scrollTo(0, 340);
    await click(button('规则', element('nav[aria-label="主导航"]')));
    expect(window.scrollY).toBe(0);
    window.scrollTo(0, 760);
    await click(button('设置', element('nav[aria-label="主导航"]')));
    expect(window.scrollY).toBe(0);
    await click(button('返回游戏'));
    expect(window.scrollY).toBe(340);
    expect(document.activeElement).toBe(
      button('游戏', element('nav[aria-label="主导航"]')),
    );
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    expect(element<HTMLDivElement>('.room-game-content').hidden).toBe(false);
  });

  it('retains both action groups and amounts for Jacob and Esau when returning with Escape', async () => {
    await mount(
      createElement(Harness, { game: startClientGame('jacob_esau', 7) }),
    );
    await click(element<HTMLInputElement>('#bid-B'));
    await setInput(
      'input[type="number"][aria-label="竞拍奖励 A 的数值"]',
      '19',
    );
    await setInput(
      'input[type="number"][aria-label="竞拍奖励 B 的数值"]',
      '21',
    );
    await click(button('规则', element('nav[aria-label="主导航"]')));
    await act(async () => {
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }),
      );
    });
    expect(container.querySelector('#room-utilities')).toBeNull();
    expect(element<HTMLInputElement>('#bid-A').checked).toBe(true);
    expect(element<HTMLInputElement>('#bid-B').checked).toBe(true);
    expect(
      element<HTMLInputElement>('input[aria-label="竞拍奖励 A 的数值"]').value,
    ).toBe('19');
    expect(
      element<HTMLInputElement>('input[aria-label="竞拍奖励 B 的数值"]').value,
    ).toBe('21');
  });

  it('can search rules and never exposes the room-specific hidden item or future rooms', async () => {
    const game = startClientGame('isaac', 7);
    game.rooms[0]![0]!.rewards[1].hidden = true;
    await mount(createElement(Harness, { game }));
    expect(container.textContent).toContain('未知道具');
    await click(button('排行', element('nav[aria-label="主导航"]')));
    expect(element('#room-utilities').textContent).not.toMatch(
      /当前隐藏|未来房间|争夺人数/,
    );
    expect(container.querySelectorAll('.ranking-table tbody tr')).toHaveLength(
      20,
    );
    expect(container.querySelectorAll('.ranking-table th')).toHaveLength(5);
    await click(button('规则', element('nav[aria-label="主导航"]')));
    await click(
      element<HTMLAnchorElement>('.rules-contents a[href="#rule-items"]'),
    );
    expect(element<HTMLDetailsElement>('.rule-catalog').open).toBe(true);
    await setInput('input[type="search"]', '福袋');
    expect(container.querySelectorAll('.rule-item-card')).toHaveLength(1);
    expect(element('.rule-item-card').textContent).toContain('扰乱获得不返款');
    await setInput('input[type="search"]', '没有这个道具');
    expect(element('.rule-item-grid output').textContent).toContain('没有匹配');
  });

  it('opens the optional item catalog from the rule directory without starting a game', async () => {
    const generate = vi.spyOn(roomGeneration, 'generateFloor');
    await mount(createElement(GameApp));
    await click(button('规则', element('nav[aria-label="主导航"]')));
    expect(element<HTMLDetailsElement>('.rule-catalog').open).toBe(false);
    expect(container.querySelectorAll('.rules-contents a')).toHaveLength(10);
    await click(
      element<HTMLAnchorElement>('.rules-contents a[href="#rule-items"]'),
    );
    expect(element<HTMLDetailsElement>('.rule-catalog').open).toBe(true);
    await setInput('input[type="search"]', '屏障');
    expect(container.querySelectorAll('.rule-item-card')).toHaveLength(2);
    await setInput('input[type="search"]', '积分加算');
    expect(container.querySelectorAll('.rule-item-card')).toHaveLength(4);
    await setInput('input[type="search"]', '效果不叠加');
    expect(container.querySelectorAll('.rule-item-card')).toHaveLength(7);
    await click(button('游戏', element('nav[aria-label="主导航"]')));
    expect(element<HTMLButtonElement>('.character-start-button').disabled).toBe(
      true,
    );
    expect(generate).not.toHaveBeenCalled();
  });

  it('returns through the original game tab without submitting the observation draft', async () => {
    const submit = vi.fn();
    await mount(
      createElement(Harness, {
        game: startClientGame('lost', 9),
        onSubmit: submit,
      }),
    );
    await click(button('静观其变'));
    await click(button('排行', element('nav[aria-label="主导航"]')));
    await click(button('游戏', element('nav[aria-label="主导航"]')));
    expect(element('.action-summary').textContent).toContain('静观其变');
    expect(submit).not.toHaveBeenCalled();
  });

  it('persists only preferences across rooms and applies score precision to results and rankings', async () => {
    await mount(createElement(GameApp));
    await click(
      element<HTMLInputElement>('input[name="character"][value="isaac"]'),
    );
    await click(button('开始游戏'));
    await click(button('设置', element('nav[aria-label="主导航"]')));
    await click(
      element<HTMLInputElement>('label[aria-label="默认展开资金排行"] input'),
    );
    await click(
      element<HTMLInputElement>('label[aria-label="减少界面动效"] input'),
    );
    const precision = element<HTMLSelectElement>('.setting-select select');
    await act(async () => {
      precision.value = '4';
      precision.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(
      JSON.parse(localStorage.getItem(gamePreferencesKey)!).preferences
        .scoreDecimals,
    ).toBe(4);
    expect(element('.game-client').getAttribute('data-reduce-motion')).toBe(
      'true',
    );
    await click(button('返回游戏'));
    await click(button('扰乱', element('.action-mode-switch')));
    await click(element<HTMLInputElement>('#disrupt-B'));
    await click(element<HTMLButtonElement>('.confirm-button'));
    expect(element('.result-summary-grid .summary-score').textContent).toMatch(
      /^\+\d+\.\d{4}$/,
    );
    await click(button('积分排行'));
    expect(element('.ranking-table tbody td:nth-child(7)').textContent).toMatch(
      /^\d+\.\d{4}$/,
    );
    await click(button('进入下一房间'));
    expect(element('#ranking-drawer').getAttribute('aria-hidden')).toBe(
      'false',
    );
    expect(element('.game-client').getAttribute('data-reduce-motion')).toBe(
      'true',
    );
  });

  it('handles blocked storage and resetting preferences without resetting the game', async () => {
    vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => {
      throw new Error('blocked');
    });
    await mount(createElement(GameApp));
    await click(
      element<HTMLInputElement>('input[name="character"][value="isaac"]'),
    );
    await click(button('开始游戏'));
    const statusBefore = element('.round-status').textContent;
    await click(button('设置', element('nav[aria-label="主导航"]')));
    await click(
      element<HTMLInputElement>('label[aria-label="默认展开资金排行"] input'),
    );
    expect(element('.settings-footer output').textContent).toContain(
      '当前会话',
    );
    await click(button('恢复默认设置'));
    expect(
      element<HTMLInputElement>('label[aria-label="默认展开资金排行"] input')
        .checked,
    ).toBe(false);
    await click(button('返回游戏'));
    expect(element('.round-status').textContent).toBe(statusBefore);
    expect(element('#ranking-drawer').getAttribute('aria-hidden')).toBe('true');
  });

  it('loads display preferences but does not claim to restore a saved game', async () => {
    localStorage.setItem(
      gamePreferencesKey,
      JSON.stringify({
        version: 1,
        preferences: {
          ...defaultGamePreferences,
          rankingInitiallyOpen: true,
          marketInitiallyOpen: true,
          reduceMotion: true,
        },
      }),
    );
    await mount(createElement(GameApp));
    expect(container.textContent).toContain('选择角色');
    await click(
      element<HTMLInputElement>('input[name="character"][value="isaac"]'),
    );
    await click(button('开始游戏'));
    expect(element('#ranking-drawer').getAttribute('aria-hidden')).toBe(
      'false',
    );
    expect(element('#market-drawer').getAttribute('aria-hidden')).toBe('false');
    expect(element('.round-status').textContent).toContain('房间 1/5');
    expect(element('.game-client').getAttribute('data-reduce-motion')).toBe(
      'true',
    );
    expect(localStorage.length).toBe(4); // Preferences, checkpoint, independent draft and replay.
    expect(localStorage.getItem(gameSaveKey)).not.toBeNull();
  });
});
