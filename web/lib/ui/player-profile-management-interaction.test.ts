// @vitest-environment happy-dom
import { act, createElement, Fragment } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { GameApp } from '@/components/game/game-app';
import {
  ClassicGameApp,
  type ClassicGameAppProps,
} from '@/components/game/classic-game-app';
import { PlayerProfileManagement } from '@/components/game/player-profile-management';
import type { SessionTools } from '@/components/game/session-context';
import { profileFileFixture } from './player-profile-file.test-helper';
import {
  serializePlayerProfileBackup,
  parsePlayerProfileBackup,
} from './player-profile-file';
import { profileReplacementEpochKey } from './profile-write-coordinator';
import { createPlayerProfile, playerProfileKey } from './player-profile';
import { notifyPlayerProfileChanged } from './profile-events';
import { packDataFile, unpackDataFile } from './compressed-file';
import * as codec from './compressed-file';
import * as storageAccess from './game-preferences';
import {
  gameSaveKey,
  serializeGameCheckpoint,
  parseGameSave,
} from './game-save';
import {
  survivalSaveKey,
  serializeSurvivalCheckpoint,
  parseSurvivalCheckpoint,
} from './survival-persistence';
import { createGameSession, reduceGameSession } from './game-session';
import { activeModeKey, startSurvivalClient } from './survival-client';
import {
  newLibraryDocument,
  prepareLibraryReplay,
  replayLibrary,
  replaySource,
} from './replay-library';
import { playLongRun } from './survival-long-run';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root, container: HTMLDivElement;
beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal('indexedDB', new IDBFactory());
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
function button(label: string) {
  const found = [
    ...container.querySelectorAll<HTMLButtonElement>('button'),
  ].find((b) => b.textContent?.trim() === label);
  if (!found) throw Error('Missing ' + label);
  return found;
}
const click = async (label: string) => act(async () => button(label).click());
async function waitUi(check: () => void) {
  const deadline = performance.now() + 8000;
  while (true) {
    await act(async () => {
      if (vi.isFakeTimers()) await vi.advanceTimersByTimeAsync(20);
      else await new Promise((resolve) => setTimeout(resolve, 20));
    });
    try {
      check();
      return;
    } catch (error) {
      if (performance.now() >= deadline) throw error;
    }
  }
}
async function mountApp() {
  await act(async () => root.render(createElement(GameApp)));
  await click('进度');
  await click('存档与备份');
}
async function upload(source: string | Promise<string>, size?: number) {
  const node = container.querySelector<HTMLInputElement>(
    'input[aria-label="读取玩家档案文件"]',
  )!;
  const file = new File(['json'], '玩家档案.json');
  Object.defineProperty(file, 'text', { value: () => Promise.resolve(source) });
  if (size !== undefined) Object.defineProperty(file, 'size', { value: size });
  Object.defineProperty(node, 'files', { configurable: true, value: [file] });
  await act(async () =>
    node.dispatchEvent(new Event('change', { bubbles: true })),
  );
}
async function preview(
  source = serializePlayerProfileBackup(profileFileFixture()),
) {
  await upload(source);
  await waitUi(() => expect(button('确认恢复玩家档案')).toBeDefined());
}
const acknowledge = async () =>
  act(async () =>
    container
      .querySelector<HTMLInputElement>('.profile-restore-ack input')!
      .click(),
  );
function existingMatches() {
  const c = reduceGameSession(createGameSession(42), {
    type: 'start_game',
    characterId: 'isaac',
  });
  c.draft!.amounts.A.bid = 17;
  const s = startSurvivalClient('lost', 99, 'easy');
  s.draft!.amounts.B.bid = 23;
  localStorage.setItem(gameSaveKey, serializeGameCheckpoint(c));
  localStorage.setItem(
    survivalSaveKey,
    serializeSurvivalCheckpoint(s.game, s.draft),
  );
  localStorage.setItem(activeModeKey, 'classic');
  return { c, s };
}
it('exports a valid standalone empty profile from a no-game menu without creating a profile or match', async () => {
  await mountApp();
  expect(button('导出玩家档案').disabled).toBe(false);
  expect(container.textContent).toContain('本机尚无已保存的档案');
  let blob: Blob | undefined;
  vi.spyOn(URL, 'createObjectURL').mockImplementation((value) => {
    blob = value as Blob;
    return 'blob:test';
  });
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  await click('导出玩家档案');
  await waitUi(() => expect(blob).toBeDefined());
  const doc = parsePlayerProfileBackup(
    (await unpackDataFile(await blob!.text())).source,
  );
  expect(doc.profile.history).toHaveLength(0);
  expect(localStorage.getItem(playerProfileKey)).toBeNull();
  expect(localStorage.getItem(gameSaveKey)).toBeNull();
  expect(localStorage.getItem(survivalSaveKey)).toBeNull();
});
it('restores only after acknowledgement and preserves both match states, drafts, preferences and library payloads', async () => {
  const matches = existingMatches(),
    original = JSON.stringify(createPlayerProfile());
  localStorage.setItem(playerProfileKey, original);
  const replay = reduceGameSession(matches.c, {
    type: 'submit_player_turn',
    turn: { playerId: 'human', actions: [{ type: 'withdraw' }] },
  });
  const prepared = await prepareLibraryReplay(
    replaySource(
      newLibraryDocument({ mode: 'classic', replay: replay.replay! }),
    ),
  );
  await replayLibrary.add(prepared);
  await mountApp();
  const beforeC = localStorage.getItem(gameSaveKey),
    beforeS = localStorage.getItem(survivalSaveKey),
    before = new Map(
      Object.keys(localStorage)
        .filter(
          (k) => k !== playerProfileKey && k !== profileReplacementEpochKey,
        )
        .map((k) => [k, localStorage.getItem(k)]),
    );
  await preview(
    (await packDataFile(serializePlayerProfileBackup(profileFileFixture())))
      .source,
  );
  expect(button('确认恢复玩家档案').disabled).toBe(true);
  expect(localStorage.getItem(playerProfileKey)).toBe(original);
  await click('确认恢复玩家档案');
  expect(localStorage.getItem(playerProfileKey)).toBe(original);
  await acknowledge();
  await click('确认恢复玩家档案');
  await waitUi(() => expect(container.textContent).toContain('已恢复玩家档案'));
  expect(localStorage.getItem(profileReplacementEpochKey)).toMatch(
    /^[a-f0-9]{64}$/,
  );
  expect(JSON.parse(localStorage.getItem(playerProfileKey)!)).toEqual(
    profileFileFixture(),
  );
  expect(
    new Map(
      Object.keys(localStorage)
        .filter(
          (k) => k !== playerProfileKey && k !== profileReplacementEpochKey,
        )
        .map((k) => [k, localStorage.getItem(k)]),
    ),
  ).toEqual(before);
  expect(parseGameSave(beforeC!).session).toEqual(matches.c);
  expect(parseSurvivalCheckpoint(beforeS!).draft).toEqual(matches.s.draft);
  expect((await replayLibrary.read(prepared.entry.key)).source).toBe(
    prepared.source,
  );
  expect(await replayLibrary.list()).toHaveLength(1);
  await click('总览');
  expect(
    container.querySelector('.overview-profile-metrics>div:last-child strong')!
      .textContent,
  ).toBe('3');
  expect(container.querySelectorAll('[data-overview-result]')).toHaveLength(3);
  await click('继续生存对局');
  expect(
    container.querySelector<HTMLInputElement>(
      'input[aria-label="竞拍奖励 B 的数值"]',
    )!.value,
  ).toBe('23');
  await click('进度');
  await click('继续经典对局');
  expect(
    container.querySelector<HTMLInputElement>(
      'input[aria-label="竞拍奖励 A 的数值"]',
    )!.value,
  ).toBe('17');
  expect(localStorage.getItem(gameSaveKey)).toBe(beforeC);
  expect(localStorage.getItem(survivalSaveKey)).toBe(beforeS);
});
it('cancels a preview, native file selection and escape without replacing the original profile', async () => {
  const original = JSON.stringify(profileFileFixture());
  localStorage.setItem(playerProfileKey, original);
  await mountApp();
  await preview(serializePlayerProfileBackup(createPlayerProfile()));
  await acknowledge();
  await click('取消恢复档案');
  expect(container.querySelector('.profile-candidate')).toBeNull();
  expect(localStorage.getItem(playerProfileKey)).toBe(original);
  await preview();
  await act(async () =>
    window.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
    ),
  );
  expect(container.querySelector('.profile-management')).not.toBeNull();
  expect(container.querySelector('.profile-candidate')).toBeNull();
  await act(async () =>
    container
      .querySelector('input[aria-label="读取玩家档案文件"]')!
      .dispatchEvent(new Event('cancel')),
  );
  expect(container.textContent).toContain('未替换本机档案');
  expect(localStorage.getItem(playerProfileKey)).toBe(original);
});
it('rejects invalid and oversized input without turning the file into a game or changing local data', async () => {
  const original = JSON.stringify(createPlayerProfile());
  localStorage.setItem(playerProfileKey, original);
  const { c } = existingMatches();
  await mountApp();
  const before = localStorage.getItem(gameSaveKey);
  await upload(serializeGameCheckpoint(c));
  await waitUi(() =>
    expect(container.textContent).toContain('仅支持独立玩家档案备份v1'),
  );
  await upload('broken');
  await waitUi(() => expect(container.textContent).toContain('不是有效的JSON'));
  await upload('{}', 8 * 1024 * 1024 + 1);
  await waitUi(() => expect(container.textContent).toContain('超过8 MiB'));
  expect(container.querySelector('.profile-candidate')).toBeNull();
  expect(localStorage.getItem(gameSaveKey)).toBe(before);
  expect(localStorage.getItem(playerProfileKey)).toBe(original);
});
it('invalidates an acknowledged preview after new completion data and requires a fresh acknowledgement', async () => {
  localStorage.setItem(playerProfileKey, JSON.stringify(createPlayerProfile()));
  await mountApp();
  await preview(
    serializePlayerProfileBackup(createPlayerProfile(new Date('2026-01-01'))),
  );
  await acknowledge();
  const updated = JSON.stringify(profileFileFixture());
  await act(async () => {
    localStorage.setItem(playerProfileKey, updated);
    notifyPlayerProfileChanged();
  });
  await waitUi(() =>
    expect(container.textContent).toContain('预览后本机档案已更新'),
  );
  expect(button('确认恢复玩家档案').disabled).toBe(true);
  expect(
    container.querySelector<HTMLInputElement>('.profile-restore-ack input')!
      .checked,
  ).toBe(false);
  await click('确认恢复玩家档案');
  expect(localStorage.getItem(playerProfileKey)).toBe(updated);
  await click('重新核对本机档案');
  expect(button('确认恢复玩家档案').disabled).toBe(true);
  await acknowledge();
  await click('确认恢复玩家档案');
  expect(
    JSON.parse(localStorage.getItem(playerProfileKey)!).history,
  ).toHaveLength(0);
});
it('keeps AI continuation running while a profile preview is open and protects its newly registered final result', async () => {
  vi.stubGlobal('indexedDB', undefined);
  const game = playLongRun(3).states.find(
    (g) => g.humanEliminatedAt !== null && g.phase !== 'competition_complete',
  )!;
  localStorage.setItem(survivalSaveKey, serializeSurvivalCheckpoint(game));
  localStorage.setItem(activeModeKey, 'survival');
  vi.useFakeTimers();
  await mountApp();
  await preview();
  await acknowledge();
  for (let i = 0; i < 80; i++)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30);
    });
  await waitUi(() =>
    expect(container.textContent).toContain('预览后本机档案已更新'),
  );
  const registered = localStorage.getItem(playerProfileKey)!;
  expect(JSON.parse(registered).history).toHaveLength(1);
  expect(button('确认恢复玩家档案').disabled).toBe(true);
  await click('取消恢复档案');
  expect(localStorage.getItem(playerProfileKey)).toBe(registered);
  expect(
    parseSurvivalCheckpoint(localStorage.getItem(survivalSaveKey)!).game.phase,
  ).toBe('competition_complete');
}, 30000);
it('preserves the original on a quota failure and retries explicitly without touching either match', async () => {
  existingMatches();
  const original = JSON.stringify(createPlayerProfile());
  localStorage.setItem(playerProfileKey, original);
  await mountApp();
  const beforeC = localStorage.getItem(gameSaveKey),
    beforeS = localStorage.getItem(survivalSaveKey);
  await preview();
  await acknowledge();
  const spy = vi.spyOn(storageAccess, 'getPreferenceStorage').mockReturnValue({
    get length() {
      return localStorage.length;
    },
    key: (i) => localStorage.key(i),
    clear: () => localStorage.clear(),
    getItem: (key) => localStorage.getItem(key),
    setItem: (key, value) => {
      if (key === playerProfileKey)
        throw new DOMException('full', 'QuotaExceededError');
      localStorage.setItem(key, value);
    },
    removeItem: (key) => localStorage.removeItem(key),
  });
  await click('确认恢复玩家档案');
  expect(container.textContent).toContain('玩家档案保存失败');
  expect(localStorage.getItem(playerProfileKey)).toBe(original);
  expect(container.querySelector('.profile-candidate')).not.toBeNull();
  spy.mockRestore();
  await click('确认恢复玩家档案');
  expect(JSON.parse(localStorage.getItem(playerProfileKey)!)).toEqual(
    profileFileFixture(),
  );
  expect(localStorage.getItem(gameSaveKey)).toBe(beforeC);
  expect(localStorage.getItem(survivalSaveKey)).toBe(beforeS);
});
it('reports unavailable local storage and does not export a fabricated empty profile or allow confirmation', async () => {
  await act(async () => {
    vi.spyOn(storageAccess, 'getPreferenceStorage').mockReturnValue(null);
    root.render(createElement(PlayerProfileManagement));
  });
  expect(button('导出玩家档案').disabled).toBe(true);
  expect(container.textContent).toContain('未用空档案代替');
  await preview();
  expect(button('确认恢复玩家档案').disabled).toBe(true);
  expect(
    container.querySelector<HTMLInputElement>('.profile-restore-ack input')!
      .disabled,
  ).toBe(true);
  expect(localStorage.getItem(playerProfileKey)).toBeNull();
});
it('keeps corrupt original text until an explicit validated replacement and never exports the loader fallback', async () => {
  localStorage.setItem(playerProfileKey, 'broken-original');
  await mountApp();
  expect(button('导出玩家档案').disabled).toBe(true);
  expect(container.querySelector('.profile-local')!.textContent).toContain(
    '无法核验',
  );
  await preview();
  await click('取消恢复档案');
  expect(localStorage.getItem(playerProfileKey)).toBe('broken-original');
  await click('总览');
  expect(container.querySelector('.overview-profile')!.textContent).toContain(
    '暂不可核验',
  );
  expect(container.querySelector('.overview-profile-metrics')).toBeNull();
  expect(
    container.querySelector('.overview-profile')!.textContent,
  ).not.toContain('已保留 0');
  await click('存档与备份');
  await preview();
  await acknowledge();
  await click('确认恢复玩家档案');
  await waitUi(() => expect(container.textContent).toContain('已恢复玩家档案'));
  expect(JSON.parse(localStorage.getItem(playerProfileKey)!)).toEqual(
    profileFileFixture(),
  );
  await click('总览');
  expect(container.textContent).not.toContain('玩家档案未读取');
});
it('ignores delayed reads after cancellation, mode switches and leaving the files page', async () => {
  await mountApp();
  for (const action of ['取消档案操作', '生存', '总览']) {
    if (!container.querySelector('.profile-management'))
      await click('存档与备份');
    let finish!: (value: string) => void;
    const pending = new Promise<string>((resolve) => {
      finish = resolve;
    });
    await upload(pending);
    await click(action);
    await act(async () => {
      finish(serializePlayerProfileBackup(profileFileFixture()));
      await pending;
    });
    expect(container.querySelector('.profile-candidate')).toBeNull();
    expect(localStorage.getItem(playerProfileKey)).toBeNull();
  }
});
it('cancels an export before the download request and ignores its late compression result', async () => {
  localStorage.setItem(playerProfileKey, JSON.stringify(profileFileFixture()));
  await mountApp();
  const packed = await packDataFile(
    serializePlayerProfileBackup(profileFileFixture()),
  );
  let finish!: (value: typeof packed) => void;
  const gate = new Promise<typeof packed>((resolve) => {
    finish = resolve;
  });
  vi.spyOn(codec, 'packDataFile').mockReturnValueOnce(gate);
  const download = vi.spyOn(URL, 'createObjectURL');
  await click('导出玩家档案');
  await click('取消档案操作');
  await act(async () => {
    finish(packed);
    await gate;
  });
  expect(download).not.toHaveBeenCalled();
  expect(container.textContent).toContain('未替换本机档案');
  expect(JSON.parse(localStorage.getItem(playerProfileKey)!)).toEqual(
    profileFileFixture(),
  );
});
it('updates dormant classic session tools after profile restoration without restarting or saving the match again', async () => {
  existingMatches();
  let tools: SessionTools | undefined;
  await act(async () =>
    root.render(
      createElement(
        Fragment,
        null,
        createElement<ClassicGameAppProps>(ClassicGameApp, {
          inactive: true,
          onToolsChange: (next) => {
            tools = next;
          },
        }),
        createElement(PlayerProfileManagement),
      ),
    ),
  );
  const session = tools!.session,
    before = localStorage.getItem(gameSaveKey);
  await preview();
  await acknowledge();
  await click('确认恢复玩家档案');
  await waitUi(() => expect(tools!.profile).toEqual(profileFileFixture()));
  expect(tools!.session).toBe(session);
  expect(localStorage.getItem(gameSaveKey)).toBe(before);
});
it('refreshes from actual local storage rather than trusting arbitrary storage event data', async () => {
  const original = JSON.stringify(createPlayerProfile());
  localStorage.setItem(playerProfileKey, original);
  await mountApp();
  await act(async () =>
    window.dispatchEvent(
      new StorageEvent('storage', {
        key: playerProfileKey,
        newValue: JSON.stringify(profileFileFixture()),
        storageArea: localStorage,
      }),
    ),
  );
  await waitUi(() =>
    expect(container.querySelector('.profile-local')!.textContent).toContain(
      '0 / 0',
    ),
  );
  await act(async () => {
    localStorage.setItem(
      playerProfileKey,
      JSON.stringify(profileFileFixture()),
    );
    window.dispatchEvent(
      new StorageEvent('storage', {
        key: playerProfileKey,
        newValue: 'untrusted-event-data',
        storageArea: localStorage,
      }),
    );
  });
  await waitUi(() =>
    expect(container.querySelector('.profile-local')!.textContent).toContain(
      '1 / 2',
    ),
  );
});
