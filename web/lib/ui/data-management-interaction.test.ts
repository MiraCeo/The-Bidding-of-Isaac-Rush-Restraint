// @vitest-environment happy-dom
import { decodedDownload } from './file-export.test-helper';
import { act, createElement, StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GameApp } from '@/components/game/game-app';
import { activeModeKey } from './survival-client';
import { createGameSession, reduceGameSession } from './game-session';
import {
  gameSaveKey,
  lastCompletedKey,
  persistGameSession,
  serializeGameBackup,
  serializeGameCheckpoint,
  parseGameSave,
} from './game-save';
import { parseReplay, serializeReplay } from './game-replay';
import { createPlayerProfile, playerProfileKey } from './player-profile';
import { serializeSessionFixture } from './save-fixture.test-helper';
import * as preferences from './game-preferences';
import * as decisions from '../game/ai-decision';
import { startSurvivalClient } from './survival-client';
import { serializeSurvivalBackup } from './survival-backup';
import { survivalSaveKey } from './survival-persistence';
(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root, container: HTMLDivElement;
beforeEach(() => {
  localStorage.clear();
  localStorage.setItem(activeModeKey, 'classic');
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});
function game(count = 2, seed = 42) {
  let s = reduceGameSession(createGameSession(seed), {
    type: 'start_game',
    characterId: 'lost',
  });
  for (let i = 0; i < count; i++) {
    s = reduceGameSession(s, {
      type: 'submit_player_turn',
      turn: { playerId: 'human', actions: [{ type: 'withdraw' }] },
    });
    s = reduceGameSession(s, { type: 'advance_room' });
  }
  return s;
}
function node<T extends Element = HTMLElement>(selector: string): T {
  const n = container.querySelector<T>(selector);
  if (!n) throw new Error('Missing ' + selector);
  return n;
}
function button(label: string, scope: Element = container) {
  const b = [...scope.querySelectorAll('button')].find(
    (b) => b.textContent?.trim() === label,
  );
  if (!b) throw new Error('Missing ' + label);
  return b;
}
const labels = (scope: Element = container) =>
  [...scope.querySelectorAll('button')].map((b) => b.textContent?.trim());
async function click(n: HTMLElement) {
  await act(async () => n.click());
}
async function mount() {
  await act(async () =>
    root.render(createElement(StrictMode, null, createElement(GameApp))),
  );
}
async function settings() {
  await openData();
}
async function openData() {
  await click(
    button('进度', container.querySelector('nav[aria-label="主导航"]')!),
  );
  await click(button('存档与备份'));
}
async function upload(source: string, filename = 'example.json') {
  if (labels().includes('导入文件')) await click(button('导入文件'));
  const input = node<HTMLInputElement>('input[aria-label="导入对局文件"]');
  Object.defineProperty(input, 'files', {
    configurable: true,
    value: [new File([source], filename, { type: 'application/json' })],
  });
  await act(async () =>
    input.dispatchEvent(new Event('change', { bubbles: true })),
  );
}
function downloads() {
  let blob: Blob | undefined;
  vi.spyOn(URL, 'createObjectURL').mockImplementation((v) => {
    blob = v as Blob;
    return 'blob:managed-file';
  });
  const download = vi
    .spyOn(HTMLAnchorElement.prototype, 'click')
    .mockImplementation(() => {});
  return { download, text: async () => decodedDownload(() => blob) };
}
describe('specific data layouts and confirmation flows', () => {
  it.each(['classic', 'survival'] as const)(
    'invalidates an opted-in %s backup after another page changes the profile',
    async (mode) => {
      localStorage.setItem(gameSaveKey, serializeSessionFixture(game(1)));
      const incoming = createPlayerProfile();
      await mount();
      await settings();
      await upload(
        mode === 'classic'
          ? serializeGameBackup(game(1, 70), incoming)
          : serializeSurvivalBackup(
              startSurvivalClient('isaac', 70).game,
              null,
              incoming,
            ),
      );
      await click(
        node<HTMLInputElement>('.data-candidate input[type="checkbox"]'),
      );
      const before = localStorage.getItem(gameSaveKey);
      const newProfile = createPlayerProfile();
      newProfile.progression.statistics.completed = 1;
      const changed = JSON.stringify(newProfile);
      localStorage.setItem(playerProfileKey, changed);
      await act(async () =>
        window.dispatchEvent(
          new StorageEvent('storage', {
            key: playerProfileKey,
            newValue: changed,
            storageArea: localStorage,
          }),
        ),
      );
      const confirm = button(
        mode === 'classic' ? '恢复完整备份' : '载入生存对局',
      );
      expect(confirm.disabled).toBe(true);
      expect(node('.data-candidate').textContent).toContain(
        '预览后本机玩家档案已变化',
      );
      await click(confirm);
      expect(localStorage.getItem(playerProfileKey)).toBe(changed);
      expect(localStorage.getItem(gameSaveKey)).toBe(before);
      expect(localStorage.getItem(survivalSaveKey)).toBeNull();
    },
  );
  it('does not replace the profile if the paired classic checkpoint cannot be saved', async () => {
    localStorage.setItem(gameSaveKey, serializeSessionFixture(game(1)));
    const p = JSON.stringify(createPlayerProfile());
    localStorage.setItem(playerProfileKey, p);
    await mount();
    await settings();
    const before = localStorage.getItem(gameSaveKey);
    await upload(serializeGameBackup(game(1, 99), createPlayerProfile()));
    await click(node<HTMLInputElement>('.data-profile-choice input'));
    vi.spyOn(preferences, 'getPreferenceStorage').mockReturnValue({
      get length() {
        return localStorage.length;
      },
      key: (i) => localStorage.key(i),
      clear: () => localStorage.clear(),
      getItem: (k) => localStorage.getItem(k),
      removeItem: (k) => localStorage.removeItem(k),
      setItem: (k, v) => {
        if (k === gameSaveKey)
          throw new DOMException('full', 'QuotaExceededError');
        localStorage.setItem(k, v);
      },
    });
    await click(button('恢复完整备份'));
    expect(localStorage.getItem(playerProfileKey)).toBe(p);
    expect(localStorage.getItem(gameSaveKey)).toBe(before);
    expect(container.querySelector('.data-candidate')).not.toBeNull();
    expect(node('.data-message').textContent).toContain('备份载入失败');
  });
  it.each(['classic', 'survival'] as const)(
    'requires a fresh opt-in after rechecking %s backup and preserves profile when unchecked',
    async (mode) => {
      await mount();
      await settings();
      const incoming = createPlayerProfile();
      await upload(
        mode === 'classic'
          ? serializeGameBackup(game(1, 70), incoming)
          : serializeSurvivalBackup(
              startSurvivalClient('isaac', 70).game,
              null,
              incoming,
            ),
      );
      await click(
        node<HTMLInputElement>('.data-candidate input[type="checkbox"]'),
      );
      const newProfile = JSON.stringify(createPlayerProfile());
      localStorage.setItem(playerProfileKey, newProfile);
      // No storage notification: final synchronous comparison must still refuse.
      await click(button(mode === 'classic' ? '恢复完整备份' : '载入生存对局'));
      expect(localStorage.getItem(playerProfileKey)).toBe(newProfile);
      expect(container.querySelector('.data-candidate')).not.toBeNull();
      await click(button('重新核对本机档案', node('.data-candidate')));
      expect(
        node<HTMLInputElement>('.data-candidate input[type="checkbox"]')
          .checked,
      ).toBe(false);
      await click(button(mode === 'classic' ? '载入这局' : '载入生存对局'));
      expect(localStorage.getItem(playerProfileKey)).toBe(newProfile);
    },
  );
  it('prioritizes replay export when a finished game could not be archived', async () => {
    const source = serializeSessionFixture(game(15));
    vi.spyOn(preferences, 'getPreferenceStorage').mockReturnValue({
      length: 1,
      clear: () => {},
      key: () => gameSaveKey,
      getItem: (k) => (k === gameSaveKey ? source : null),
      setItem: () => {
        throw new Error('unavailable');
      },
      removeItem: () => {},
    });
    await mount();
    await settings();
    expect(button('导出回放').className).toContain('bg-primary');
    expect(button('查看对局').className).toContain('bg-secondary');
    expect(labels()).not.toContain('导出存档');
  });
  it('rejects corrupted recent records during directory validation and leaves local bytes and the current game untouched', async () => {
    const raw = JSON.parse(serializeReplay(game(15, 12).replay!, 'original'));
    raw.replay.final.ranking[0].finalScore++;
    const source = JSON.stringify(raw);
    localStorage.setItem(lastCompletedKey, source);
    localStorage.setItem(gameSaveKey, serializeSessionFixture(game(1, 33)));
    await mount();
    await settings();
    const before = localStorage.getItem(gameSaveKey);
    expect(container.querySelector('[data-record-source="recent"]')).toBeNull();
    expect(node('.data-records').textContent).toContain('原记录保留');
    expect(node('.data-records').textContent).toContain('不一致');
    expect(localStorage.getItem(lastCompletedKey)).toBe(source);
    expect(localStorage.getItem(gameSaveKey)).toBe(before);
    expect(node('#progress-title').textContent).toBe('进度');
  });
  it('has distinct game, profile and library imports, with no empty game backup/replay controls', async () => {
    await mount();
    await settings();
    expect(
      container.querySelectorAll('input[aria-label="导入对局文件"]'),
    ).toHaveLength(1);
    expect(
      container.querySelectorAll('input[aria-label="读取玩家档案文件"]'),
    ).toHaveLength(1);
    expect(
      container.querySelectorAll('input[aria-label="读取整库备份文件"]'),
    ).toHaveLength(1);
    expect(container.querySelectorAll('input[type="file"]')).toHaveLength(3);
    expect(labels()).toContain('导入文件');
    expect(labels()).not.toContain('完整备份');
    expect(labels()).not.toContain('导出存档');
    expect(labels()).not.toContain('查看回放');
    expect(node('.data-records').textContent).toContain('没有进行中的对局');
    expect(container.querySelector('.profile-reservation')).toBeNull();
  });
  it('shows the recent archive alone before a new game, without doing AI work while opening settings', async () => {
    persistGameSession(localStorage, game(15));
    persistGameSession(localStorage, createGameSession(18));
    await mount();
    const decide = vi.spyOn(decisions, 'decideAiTurn');
    await settings();
    expect(container.querySelectorAll('.data-record-row')).toHaveLength(1);
    expect(node('[data-record-source="recent"]').textContent).toContain(
      '最近对局',
    );
    expect(labels()).toContain('查看对局');
    expect(labels()).not.toContain('导出存档');
    expect(decide).not.toHaveBeenCalled();
  });
  it('shows current play actions without exposing restart as a file operation', async () => {
    localStorage.setItem(gameSaveKey, serializeSessionFixture(game(2)));
    await mount();
    await settings();
    expect(labels(node('.data-records'))).toEqual([
      '返回游戏',
      '导出存档',
      '查看回放',
    ]);
    expect(labels(node('.progress-stage'))).not.toContain('重新选角');
    expect(labels()).not.toContain('开始新对局');
    expect(node('.data-autosave').textContent).toContain('已自动保存');
  });
  it('hides a current replay with zero settled rooms instead of showing a meaningless disabled button', async () => {
    localStorage.setItem(gameSaveKey, serializeSessionFixture(game(0)));
    await mount();
    await settings();
    expect(labels(node('.data-records'))).toEqual(['返回游戏', '导出存档']);
  });
  it('deduplicates the same completed current/recent game and never exports it as a continuation', async () => {
    localStorage.setItem(gameSaveKey, serializeSessionFixture(game(15)));
    await mount();
    await settings();
    expect(container.querySelectorAll('.data-record-row')).toHaveLength(1);
    expect(container.querySelector('[data-record-source="recent"]')).toBeNull();
    expect(labels(node('.data-records'))).toEqual(['查看对局', '导出回放']);
    expect(labels()).not.toContain('导出存档');
  });
  it('keeps a new game and the previous completed game as two explicitly different rows', async () => {
    persistGameSession(localStorage, game(15, 12));
    persistGameSession(localStorage, createGameSession(19));
    localStorage.setItem(gameSaveKey, serializeSessionFixture(game(0, 21)));
    await mount();
    await settings();
    expect(container.querySelectorAll('.data-record-row')).toHaveLength(2);
    expect(node('[data-record-source="recent"]').textContent).toContain(
      '上一局',
    );
    expect(labels(node('[data-record-source="current"]'))).toEqual([
      '返回游戏',
      '导出存档',
    ]);
  });
  it('prioritizes explicit saving when automatic storage is unavailable', async () => {
    const source = serializeSessionFixture(game(1));
    vi.spyOn(preferences, 'getPreferenceStorage').mockReturnValue({
      length: 1,
      clear: () => {},
      key: () => gameSaveKey,
      getItem: (k) => (k === gameSaveKey ? source : null),
      setItem: () => {
        throw new Error('unavailable');
      },
      removeItem: () => {},
    });
    await mount();
    await settings();
    expect(node('.data-autosave').textContent).toContain('尚未保存到浏览器');
    expect(button('导出存档').className).toContain('bg-primary');
    expect(button('返回游戏').className).toContain('bg-secondary');
    const file = downloads();
    await click(button('导出存档'));
    expect(parseGameSave(await file.text()).kind).toBe('checkpoint');
  });
  it('puts file preview on an independent page and does not restore before confirmation', async () => {
    const scroll = vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
    localStorage.setItem(gameSaveKey, serializeSessionFixture(game(2)));
    await mount();
    await settings();
    const before = localStorage.getItem(gameSaveKey);
    await upload(serializeGameCheckpoint(game(1, 777)), '迁移.json');
    expect(node('#progress-title').textContent).toBe('载入对局');
    expect(scroll).toHaveBeenCalledWith(0, 0);
    expect(document.activeElement).toBe(node('#progress-title'));
    expect(container.querySelector('.settings-display')).toBeNull();
    expect(container.querySelector('.data-records')).toBeNull();
    expect(node('.data-candidate').textContent).toContain('迁移.json');
    expect(localStorage.getItem(gameSaveKey)).toBe(before);
    await click(button('取消'));
    expect(node('#progress-title').textContent).toBe('进度');
    expect(localStorage.getItem(gameSaveKey)).toBe(before);
  });
  it('loads a checkpoint through the same entry without changing player progression', async () => {
    const p = createPlayerProfile();
    p.progression.modules.future = { unlock: 1 };
    localStorage.setItem(playerProfileKey, JSON.stringify(p));
    await mount();
    await settings();
    await upload(serializeGameCheckpoint(game(1, 33)));
    await click(button('载入这局'));
    expect(
      parseGameSave(localStorage.getItem(gameSaveKey)!).session.game.seed,
    ).toBe(33);
    expect(localStorage.getItem(playerProfileKey)).toBe(JSON.stringify(p));
  });
  it('only opens an imported replay after confirmation and never replaces the live game', async () => {
    localStorage.setItem(gameSaveKey, serializeSessionFixture(game(2)));
    await mount();
    await settings();
    const before = localStorage.getItem(gameSaveKey);
    await upload(serializeReplay(game(1, 99).replay!, 'origin'));
    expect(node('#progress-title').textContent).toBe('查看回放');
    expect(container.querySelector('.replay-page-content')).toBeNull();
    await click(button('打开回放'));
    expect(node('#room-utilities-title').textContent).toBe('对局回放');
    expect(localStorage.getItem(gameSaveKey)).toBe(before);
  });
  it.each([false, true])(
    'restores backup player progression only when opted in: %s',
    async (restore) => {
      const original = createPlayerProfile();
      original.progression.statistics.wins = 4;
      localStorage.setItem(playerProfileKey, JSON.stringify(original));
      const incoming = createPlayerProfile();
      incoming.progression.modules.tree = { unlocked: true };
      await mount();
      await settings();
      await upload(serializeGameBackup(game(1, 70), incoming));
      const toggle = node<HTMLInputElement>('.data-profile-choice input');
      expect(toggle.checked).toBe(false);
      if (restore) await click(toggle);
      if (restore) {
        expect(node('.data-profile-choice').textContent).toContain(
          '完成记录、累计统计、去重凭据',
        );
        expect(node('.data-profile-choice').textContent).not.toContain(
          '包含解锁、成就',
        );
      }
      expect(localStorage.getItem(playerProfileKey)).toBe(
        JSON.stringify(original),
      );
      await click(button(restore ? '恢复完整备份' : '载入这局'));
      expect(JSON.parse(localStorage.getItem(playerProfileKey)!)).toEqual(
        restore ? incoming : original,
      );
      expect(
        parseGameSave(localStorage.getItem(gameSaveKey)!).session.game.seed,
      ).toBe(70);
    },
  );
  it('resets the opt-in checkbox when another file is selected', async () => {
    const incoming = createPlayerProfile();
    await mount();
    await settings();
    await upload(serializeGameBackup(game(1), incoming));
    await click(node<HTMLInputElement>('.data-profile-choice input'));
    await upload(serializeGameBackup(game(2, 100), incoming));
    expect(node<HTMLInputElement>('.data-profile-choice input').checked).toBe(
      false,
    );
  });
  it('keeps game and profile unchanged if an opted-in profile write is blocked', async () => {
    localStorage.setItem(gameSaveKey, serializeSessionFixture(game(1)));
    await mount();
    await settings();
    const before = localStorage.getItem(gameSaveKey);
    await upload(serializeGameBackup(game(1, 99), createPlayerProfile()));
    await click(node<HTMLInputElement>('.data-profile-choice input'));
    const original = localStorage.setItem.bind(localStorage);
    vi.spyOn(localStorage, 'setItem').mockImplementation((k, v) => {
      if (k === playerProfileKey) throw new Error('profile write blocked');
      original(k, v);
    });
    await click(button('恢复完整备份'));
    expect(node('.data-message').textContent).toContain(
      '备份载入失败，已恢复原存储',
    );
    expect(localStorage.getItem(gameSaveKey)).toBe(before);
  });
  it('previews a full backup before downloading and includes each document only once', async () => {
    localStorage.setItem(gameSaveKey, serializeSessionFixture(game(3)));
    await mount();
    await settings();
    const file = downloads();
    await click(button('完整备份'));
    expect(node('#progress-title').textContent).toBe('完整备份');
    expect(file.download).not.toHaveBeenCalled();
    await click(button('导出完整备份'));
    const raw = JSON.parse(await file.text());
    expect(raw.checkpoint).not.toHaveProperty('replay');
    expect(raw.replay.rooms).toHaveLength(3);
    expect(raw.profile).toHaveProperty('progression');
    expect(node('#progress-title').textContent).toBe('进度');
  });
  it('backs up the recent completed archive on the home page without starting a live game', async () => {
    persistGameSession(localStorage, game(15));
    persistGameSession(localStorage, createGameSession(123));
    await mount();
    await settings();
    const file = downloads();
    await click(button('完整备份'));
    expect(node('.data-backup-preview').textContent).toContain('最近对局');
    expect(localStorage.getItem(gameSaveKey)).toBeNull();
    await click(button('导出完整备份'));
    const doc = parseGameSave(await file.text());
    expect(doc.session.game.phase).toBe('game_result');
    expect(localStorage.getItem(gameSaveKey)).toBeNull();
  });
  it('clearly excludes the previous replay from a current-game backup', async () => {
    persistGameSession(localStorage, game(15, 8));
    persistGameSession(localStorage, createGameSession(1));
    localStorage.setItem(gameSaveKey, serializeSessionFixture(game(1, 11)));
    await mount();
    await settings();
    const file = downloads();
    await click(button('完整备份'));
    expect(node('.data-impact').textContent).toContain('上一局完整回放不在');
    await click(button('导出完整备份'));
    expect(parseGameSave(await file.text()).session.game.seed).toBe(11);
  });
  it('allows exporting the previous replay from its own row while a new game is active', async () => {
    persistGameSession(localStorage, game(15, 8));
    persistGameSession(localStorage, createGameSession(1));
    localStorage.setItem(gameSaveKey, serializeSessionFixture(game(0, 11)));
    await mount();
    await settings();
    const file = downloads();
    await click(button('导出回放', node('[data-record-source="recent"]')));
    expect(parseReplay(await file.text()).replay.seed).toBe(8);
    expect(
      parseGameSave(localStorage.getItem(gameSaveKey)!).session.game.seed,
    ).toBe(11);
  });
  it.each([
    'broken',
    JSON.stringify({ format: 'the-bidding-of-isaac-save', version: 1 }),
  ])('keeps valid data when an import is rejected: %s', async (source) => {
    localStorage.setItem(gameSaveKey, serializeSessionFixture(game(2)));
    await mount();
    await settings();
    const before = localStorage.getItem(gameSaveKey);
    await upload(source);
    expect(node('.data-message').textContent).toContain('保持不变');
    expect(container.querySelector('.data-candidate')).toBeNull();
    expect(localStorage.getItem(gameSaveKey)).toBe(before);
  });
  it('cancels a pending read when returning to settings and ignores its later result', async () => {
    await mount();
    await settings();
    let resolve!: (source: string) => void;
    const reading = new Promise<string>((r) => {
      resolve = r;
    });
    vi.spyOn(File.prototype, 'text').mockReturnValue(reading);
    await upload('pending');
    expect(node('.data-message').textContent).toContain('校验');
    await click(button('返回进度'));
    await act(async () => {
      resolve(serializeGameCheckpoint(game(1)));
      await reading;
    });
    expect(node('#progress-title').textContent).toBe('进度');
    expect(localStorage.getItem(gameSaveKey)).toBeNull();
  });
  it('returns to settings on Esc within an import page, preserving the live draft', async () => {
    const s = game(1);
    s.draft!.amounts.A.bid = 17;
    localStorage.setItem(gameSaveKey, serializeSessionFixture(s));
    await mount();
    await settings();
    await upload(serializeGameCheckpoint(game(1, 78)));
    await act(async () =>
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
      ),
    );
    expect(node('#progress-title').textContent).toBe('进度');
    expect(
      parseGameSave(localStorage.getItem(gameSaveKey)!).session.game.seed,
    ).toBe(42);
    await click(button('返回游戏'));
    expect(
      node<HTMLInputElement>('input[aria-label="竞拍奖励 A 的数值"]').value,
    ).toBe('17');
  });
});
