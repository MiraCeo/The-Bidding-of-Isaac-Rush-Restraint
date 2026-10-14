// @vitest-environment happy-dom
import { IDBFactory } from 'fake-indexeddb';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeAll, beforeEach, afterEach, it, expect, vi } from 'vitest';
import { ReplayLibraryPanel } from '@/components/game/replay-library-panel';
import { GameApp } from '@/components/game/game-app';
import { useReplayArchive } from '@/components/game/use-replay-archive';
import {
  prepareLibraryReplay,
  replayLibrary,
  replaySource,
  newLibraryDocument,
  type LibraryReplay,
} from './replay-library';
import {
  createGameSession,
  reduceGameSession,
  type GameSession,
} from './game-session';
import { createSurvivalReplay } from './survival-record';
import { playLongRun } from './survival-long-run';
import { gameSaveKey, serializeGameCheckpoint } from './game-save';
import {
  survivalSaveKey,
  serializeSurvivalCheckpoint,
} from './survival-persistence';
import { startSurvivalClient, activeModeKey } from './survival-client';
import { playerProfileKey, createPlayerProfile } from './player-profile';
import { unpackDataFile } from './compressed-file';
import type { SurvivalGameState } from '../game/survival-session';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root,
  container: HTMLDivElement,
  classic: GameSession,
  survival: SurvivalGameState;
let classicDoc: LibraryReplay, survivalDoc: LibraryReplay;
beforeAll(() => {
  classic = reduceGameSession(createGameSession(42), {
    type: 'start_game',
    characterId: 'isaac',
  });
  for (let i = 0; i < 15; i++) {
    classic = reduceGameSession(classic, {
      type: 'submit_player_turn',
      turn: { playerId: 'human', actions: [{ type: 'withdraw' }] },
    });
    classic = reduceGameSession(classic, { type: 'advance_room' });
  }
  survival = playLongRun(3, 'lost', 'standard').game;
  classicDoc = newLibraryDocument({ mode: 'classic', replay: classic.replay! });
  survivalDoc = newLibraryDocument({
    mode: 'survival',
    replay: createSurvivalReplay(survival),
  });
});
beforeEach(() => {
  vi.stubGlobal('indexedDB', new IDBFactory());
  localStorage.clear();
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
function button(label: string) {
  const b = [...container.querySelectorAll<HTMLButtonElement>('button')].find(
    (b) => b.textContent?.trim() === label,
  );
  if (!b) throw Error('Missing ' + label);
  return b;
}
const click = async (label: string) => act(async () => button(label).click());
// IDB uses macrotasks. Keep successive waits within act, rather than silencing diagnostics.
async function waitForFileUi(check: () => void) {
  const deadline = performance.now() + 5000;
  while (true) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    try {
      check();
      return;
    } catch (error) {
      if (performance.now() >= deadline) throw error;
    }
  }
}
const rows = () => container.querySelectorAll('.replay-library tbody tr');
async function panel(
  mode: 'classic' | 'survival' = 'classic',
  onReplay = vi.fn(),
) {
  await act(async () =>
    root.render(
      createElement(ReplayLibraryPanel, {
        mode,
        current: classicDoc,
        recent: null,
        archiveStatus: '',
        onReplay,
      }),
    ),
  );
  await waitForFileUi(() =>
    expect(container.textContent).toContain('/ 100 局'),
  );
  return onReplay;
}
async function upload(source: string | Promise<string>) {
  const input = container.querySelector<HTMLInputElement>(
    'input[aria-label="导入回放库文件"]',
  )!;
  const file = new File(['json'], 'replay.json');
  Object.defineProperty(file, 'text', { value: () => Promise.resolve(source) });
  Object.defineProperty(input, 'files', { configurable: true, value: [file] });
  await act(async () =>
    input.dispatchEvent(new Event('change', { bubbles: true })),
  );
}
it('requires preview confirmation, deduplicates repeated imports and filters real full records by mode, role and difficulty', async () => {
  await panel();
  await upload(replaySource(classicDoc));
  await waitForFileUi(() => expect(button('确认入库')).toBeDefined());
  expect(await replayLibrary.list()).toHaveLength(0);
  await click('确认入库');
  await waitForFileUi(() => expect(rows()).toHaveLength(1));
  await upload(replaySource(classicDoc));
  await waitForFileUi(() => expect(button('确认入库')).toBeDefined());
  await click('确认入库');
  await waitForFileUi(() =>
    expect(container.textContent).toContain('未重复保存'),
  );
  expect(await replayLibrary.list()).toHaveLength(1);
  await act(async () => {
    await replayLibrary.add(
      await prepareLibraryReplay(replaySource(survivalDoc)),
    );
  });
  await waitForFileUi(() =>
    expect(container.textContent).toContain('2 / 100 局'),
  );
  expect(rows()).toHaveLength(1);
  await act(async () => root.unmount());
  root = createRoot(container);
  await panel('survival');
  expect(rows()).toHaveLength(1);
  const selector = container.querySelector<HTMLSelectElement>(
    'select[aria-label="回放库难度"]',
  )!;
  await act(async () => {
    selector.value = 'highest';
    selector.dispatchEvent(new Event('change', { bubbles: true }));
  });
  expect(rows()).toHaveLength(0);
  await act(async () => {
    selector.value = 'standard';
    selector.dispatchEvent(new Event('change', { bubbles: true }));
  });
  expect(rows()).toHaveLength(1);
  const role = container.querySelector<HTMLSelectElement>(
    'select[aria-label="回放库角色"]',
  )!;
  await act(async () => {
    role.value = 'isaac';
    role.dispatchEvent(new Event('change', { bubbles: true }));
  });
  expect(rows()).toHaveLength(0);
});
it('cancels the preview and delayed reads without writing and handles native file cancellation', async () => {
  await panel();
  await upload(replaySource(classicDoc));
  await waitForFileUi(() => expect(button('取消入库')).toBeDefined());
  await click('取消入库');
  expect(await replayLibrary.list()).toHaveLength(0);
  let finish!: (value: string) => void;
  const pending = new Promise<string>((resolve) => {
    finish = resolve;
  });
  await upload(pending);
  await click('取消读取回放');
  await act(async () => {
    finish(replaySource(classicDoc));
    await pending;
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 100));
  });
  expect(container.querySelector('[aria-label="回放入库预览"]')).toBeNull();
  expect(await replayLibrary.list()).toHaveLength(0);
  await act(async () =>
    container
      .querySelector('input[type="file"]')!
      .dispatchEvent(new Event('cancel')),
  );
  expect(container.textContent).toContain('已取消入库');
});
it('ignores late file results after switching modes/unmounting', async () => {
  await panel();
  let finish!: (value: string) => void;
  const pending = new Promise<string>((resolve) => {
    finish = resolve;
  });
  await upload(pending);
  await act(async () => root.render(createElement('p', null, '其他模式')));
  await act(async () => {
    finish(replaySource(survivalDoc));
    await pending;
  });
  expect(container.textContent).toBe('其他模式');
  expect(await replayLibrary.list()).toHaveLength(0);
});
it('exports a validated stored transport with exactly the original inner JSON', async () => {
  const source = '\uFEFF' + replaySource(classicDoc),
    prepared = await prepareLibraryReplay(source);
  await replayLibrary.add(prepared);
  await panel();
  let blob: Blob | undefined;
  vi.spyOn(URL, 'createObjectURL').mockImplementation((value) => {
    blob = value as Blob;
    return 'blob:test';
  });
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  await click('导出');
  await waitForFileUi(() => expect(blob).toBeDefined());
  expect((await unpackDataFile(await blob!.text())).source).toBe(source);
  expect(await replayLibrary.list()).toHaveLength(1);
});
it('confirms deletion and preserves both autosaves, profile and other library entries', async () => {
  const c = await prepareLibraryReplay(replaySource(classicDoc)),
    s = await prepareLibraryReplay(replaySource(survivalDoc));
  await replayLibrary.add(c);
  await replayLibrary.add(s);
  localStorage.setItem(gameSaveKey, 'unchanged-classic');
  localStorage.setItem(survivalSaveKey, 'unchanged-survival');
  localStorage.setItem(playerProfileKey, 'unchanged-profile');
  await panel();
  await click('删除');
  expect(await replayLibrary.list()).toHaveLength(2);
  await click('保留回放');
  expect(container.querySelector('[role="alertdialog"]')).toBeNull();
  expect(rows()).toHaveLength(1);
  await click('删除');
  await click('确认删除此回放');
  await waitForFileUi(() => expect(rows()).toHaveLength(0));
  expect((await replayLibrary.list()).map((e) => e.key)).toEqual([s.entry.key]);
  expect(localStorage.getItem(gameSaveKey)).toBe('unchanged-classic');
  expect(localStorage.getItem(survivalSaveKey)).toBe('unchanged-survival');
  expect(localStorage.getItem(playerProfileKey)).toBe('unchanged-profile');
});
function ArchiveProbe({ c, s }: { c?: GameSession; s?: SurvivalGameState }) {
  const status = useReplayArchive(c, s);
  return createElement('output', null, status.classic + status.survival);
}
it('automatically archives authoritative final games only, preserving local storage and deduplicating a refreshed session', async () => {
  const profile = JSON.stringify(createPlayerProfile());
  localStorage.setItem(playerProfileKey, profile);
  await act(async () =>
    root.render(createElement(ArchiveProbe, { c: classic, s: survival })),
  );
  await waitForFileUi(() =>
    expect(container.textContent?.match(/完整回放已入库/g)).toHaveLength(2),
  );
  expect(await replayLibrary.list()).toHaveLength(2);
  expect(localStorage.getItem(playerProfileKey)).toBe(profile);
  await act(async () =>
    root.render(
      createElement(ArchiveProbe, {
        c: structuredClone(classic),
        s: structuredClone(survival),
      }),
    ),
  );
  await waitForFileUi(() =>
    expect(container.textContent?.match(/完整回放已入库/g)).toHaveLength(2),
  );
  expect(await replayLibrary.list()).toHaveLength(2);
});
it('keeps auto-archive failure separate from a valid final checkpoint and allows manual retry', async () => {
  const spy = vi
    .spyOn(replayLibrary, 'add')
    .mockRejectedValue(Error('QuotaExceededError'));
  localStorage.setItem(activeModeKey, 'survival');
  localStorage.setItem(survivalSaveKey, serializeSurvivalCheckpoint(survival));
  await act(async () => root.render(createElement(GameApp)));
  await click('进度');
  await click('对局记录');
  await waitForFileUi(() =>
    expect(container.textContent).toContain('完整回放未入库'),
  );
  expect(localStorage.getItem(survivalSaveKey)).not.toBeNull();
  const before = localStorage.getItem(survivalSaveKey),
    p = localStorage.getItem(playerProfileKey);
  spy.mockRestore();
  await click('本局回放入库');
  await waitForFileUi(() => expect(rows()).toHaveLength(1));
  expect(localStorage.getItem(survivalSaveKey)).toBe(before);
  expect(localStorage.getItem(playerProfileKey)).toBe(p);
});
it('opens either library mode readonly, returns to the original classification and filters, and preserves both drafts and profile', async () => {
  const c = reduceGameSession(createGameSession(99), {
    type: 'start_game',
    characterId: 'lost',
  });
  c.draft!.amounts.A.bid = 17;
  const s = startSurvivalClient('eden', 99, 'easy');
  s.draft!.amounts.B.bid = 23;
  localStorage.setItem(gameSaveKey, serializeGameCheckpoint(c));
  localStorage.setItem(
    survivalSaveKey,
    serializeSurvivalCheckpoint(s.game, s.draft),
  );
  localStorage.setItem(activeModeKey, 'classic');
  localStorage.setItem(playerProfileKey, JSON.stringify(createPlayerProfile()));
  await replayLibrary.add(await prepareLibraryReplay(replaySource(classicDoc)));
  await replayLibrary.add(
    await prepareLibraryReplay(replaySource(survivalDoc)),
  );
  await act(async () => root.render(createElement(GameApp)));
  const beforeC = localStorage.getItem(gameSaveKey),
    beforeS = localStorage.getItem(survivalSaveKey),
    profile = localStorage.getItem(playerProfileKey);
  await click('进度');
  await click('对局记录');
  await waitForFileUi(() => expect(rows()).toHaveLength(1));
  await click('查看');
  await waitForFileUi(() =>
    expect(container.querySelector('.replay-library')).toBeNull(),
  );
  await click('返回进度');
  await waitForFileUi(() => expect(rows()).toHaveLength(1));
  await click('生存');
  await waitForFileUi(() => expect(rows()).toHaveLength(1));
  const role = container.querySelector<HTMLSelectElement>(
    'select[aria-label="回放库角色"]',
  )!;
  await act(async () => {
    role.value = 'lost';
    role.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await click('查看');
  await waitForFileUi(() =>
    expect(container.textContent).toContain('生存只读回放'),
  );
  await click('返回进度');
  await waitForFileUi(() =>
    expect(
      container.querySelector<HTMLSelectElement>(
        'select[aria-label="回放库角色"]',
      )!.value,
    ).toBe('lost'),
  );
  expect(button('对局记录').getAttribute('aria-current')).toBe('page');
  expect(localStorage.getItem(gameSaveKey)).toBe(beforeC);
  expect(localStorage.getItem(survivalSaveKey)).toBe(beforeS);
  expect(localStorage.getItem(playerProfileKey)).toBe(profile);
}, 20000);
it('shows an unavailable library without blocking other progress pages or inventing zero capacity', async () => {
  vi.stubGlobal('indexedDB', undefined);
  await act(async () => root.render(createElement(GameApp)));
  await click('进度');
  await click('对局记录');
  await waitForFileUi(() =>
    expect(container.textContent).toContain('无法使用IndexedDB'),
  );
  expect(container.textContent).toContain('容量暂不可读取');
  await click('存档与备份');
  expect(button('导入文件')).toBeDefined();
});
it('respects the score display preference without altering original facts or stored text', async () => {
  const prepared = await prepareLibraryReplay(replaySource(classicDoc));
  await replayLibrary.add(prepared);
  await act(async () =>
    root.render(
      createElement(ReplayLibraryPanel, {
        mode: 'classic',
        current: null,
        recent: null,
        archiveStatus: '',
        onReplay: vi.fn(),
        scoreDecimals: 4,
      }),
    ),
  );
  await waitForFileUi(() => expect(rows()).toHaveLength(1));
  expect(rows()[0]!.textContent).toContain('0.0000 分');
  expect((await replayLibrary.read(prepared.entry.key)).source).toBe(
    prepared.source,
  );
});
it('views either mode from an empty menu without fabricating a match, auto-archiving imported facts or registering a result', async () => {
  await replayLibrary.add(await prepareLibraryReplay(replaySource(classicDoc)));
  await replayLibrary.add(
    await prepareLibraryReplay(replaySource(survivalDoc)),
  );
  const profile = JSON.stringify(createPlayerProfile());
  localStorage.setItem(playerProfileKey, profile);
  await act(async () => root.render(createElement(GameApp)));
  await click('进度');
  await click('对局记录');
  await waitForFileUi(() => expect(rows()).toHaveLength(1));
  await click('查看');
  await waitForFileUi(() => expect(button('返回进度')).toBeDefined());
  await click('返回进度');
  await click('生存');
  await waitForFileUi(() => expect(rows()).toHaveLength(1));
  await click('查看');
  await waitForFileUi(() =>
    expect(container.textContent).toContain('生存只读回放'),
  );
  await click('返回进度');
  await waitForFileUi(() => expect(rows()).toHaveLength(1));
  expect(localStorage.getItem(gameSaveKey)).toBeNull();
  expect(localStorage.getItem(survivalSaveKey)).toBeNull();
  expect(localStorage.getItem(playerProfileKey)).toBe(profile);
  expect(await replayLibrary.list()).toHaveLength(2);
});
