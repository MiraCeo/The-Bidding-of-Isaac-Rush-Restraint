// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { it, expect, vi, afterEach, beforeEach } from 'vitest';
import { GameApp } from '@/components/game/game-app';
import { startSurvivalClient, activeModeKey } from './survival-client';
import {
  survivalSaveKey,
  serializeSurvivalCheckpoint,
  parseSurvivalCheckpoint,
} from './survival-persistence';
import { playerProfileKey } from './player-profile';
import { waitForFileUi } from './file-export.test-helper';
import * as modeData from './mode-data';
import { SurvivalReplayViewer } from '@/components/game/survival-replay-viewer';
import { survivalGameReducer } from '../game/survival-session';
import { createSurvivalReplay } from './survival-record';
import {
  packDataFile,
  unpackDataFile,
  compressedFileFormat,
} from './compressed-file';
(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
let container: HTMLDivElement, root: Root;
beforeEach(() => {
  localStorage.clear();
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});
function button(label: string) {
  const b = [...container.querySelectorAll<HTMLButtonElement>('button')].find(
    (b) => b.textContent?.trim() === label,
  );
  if (!b) throw new Error('Missing ' + label);
  return b;
}
const click = async (label: string) => act(async () => button(label).click());
async function mount() {
  const session = startSurvivalClient('isaac', 42);
  localStorage.setItem(activeModeKey, 'survival');
  localStorage.setItem(
    survivalSaveKey,
    serializeSurvivalCheckpoint(session.game, session.draft),
  );
  await act(async () => root.render(createElement(GameApp)));
  await click('设置');
}
async function upload(source: string) {
  const input =
    container.querySelector<HTMLInputElement>('input[type="file"]')!;
  Object.defineProperty(input, 'files', {
    configurable: true,
    value: [new File([source], 'compressed.json')],
  });
  await act(async () =>
    input.dispatchEvent(new Event('change', { bubbles: true })),
  );
}
it('exports a compressed download without changing automatic storage and imports it only after confirmation', async () => {
  await mount();
  const before = localStorage.getItem(survivalSaveKey),
    profile = localStorage.getItem(playerProfileKey);
  let blob: Blob | undefined;
  vi.spyOn(URL, 'createObjectURL').mockImplementation((value) => {
    blob = value as Blob;
    return 'blob:small-file';
  });
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  await click('导出生存续玩存档');
  await waitForFileUi(() => expect(blob).toBeDefined());
  const source = await blob!.text();
  expect(JSON.parse(source).format).toBe(compressedFileFormat);
  expect(source.length).toBeLessThan(before!.length);
  expect((await unpackDataFile(source)).source).toContain('survival-client-4');
  expect(localStorage.getItem(survivalSaveKey)).toBe(before);
  await upload(source);
  await waitForFileUi(() => expect(button('载入生存对局')).toBeDefined());
  expect(localStorage.getItem(survivalSaveKey)).toBe(before);
  expect(localStorage.getItem(playerProfileKey)).toBe(profile);
  await click('载入生存对局');
  expect(
    parseSurvivalCheckpoint(localStorage.getItem(survivalSaveKey)!).game.seed,
  ).toBe(42);
});
it('rejects damaged compressed files without replacing match or profile, and allows a new valid compressed import', async () => {
  await mount();
  const before = localStorage.getItem(survivalSaveKey),
    profile = localStorage.getItem(playerProfileKey),
    incoming = startSurvivalClient('lost', 99, 'easy'),
    packed = await packDataFile(
      serializeSurvivalCheckpoint(incoming.game, incoming.draft),
    );
  const corrupt = JSON.parse(packed.source);
  corrupt.data = corrupt.data.slice(0, -8);
  await upload(JSON.stringify(corrupt));
  await waitForFileUi(() => expect(container.textContent).toContain('损坏'));
  expect(localStorage.getItem(survivalSaveKey)).toBe(before);
  expect(localStorage.getItem(playerProfileKey)).toBe(profile);
  expect(container.querySelector('.data-candidate')).toBeNull();
  await upload(packed.source);
  await waitForFileUi(() => expect(button('载入生存对局')).toBeDefined());
  await click('取消');
  expect(localStorage.getItem(survivalSaveKey)).toBe(before);
  await upload(packed.source);
  await waitForFileUi(() => expect(button('载入生存对局')).toBeDefined());
  await click('载入生存对局');
  expect(
    parseSurvivalCheckpoint(localStorage.getItem(survivalSaveKey)!).game.seed,
  ).toBe(99);
});
it('cancels an in-flight compressed import and never installs a late preview', async () => {
  await mount();
  const before = localStorage.getItem(survivalSaveKey),
    profile = localStorage.getItem(playerProfileKey),
    packed = await packDataFile(before!),
    original = modeData.readModeDataFile;
  let release!: () => void, signal: AbortSignal | undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  vi.spyOn(modeData, 'readModeDataFile').mockImplementation(
    async (source, filename, options) => {
      signal = options?.signal;
      await gate;
      return original(source, filename, options);
    },
  );
  await upload(packed.source);
  await click('取消读取');
  expect(signal?.aborted).toBe(true);
  await act(async () => {
    release();
    await gate;
  });
  expect(container.querySelector('.data-candidate')).toBeNull();
  expect(container.textContent).not.toContain('正在验证文件');
  expect(localStorage.getItem(survivalSaveKey)).toBe(before);
  expect(localStorage.getItem(playerProfileKey)).toBe(profile);
});
it('compresses a directly exported survival replay and restores all recorded facts without playing AI', async () => {
  const session = startSurvivalClient('isaac', 42),
    game = survivalGameReducer(session.game, {
      type: 'submit_player_turn',
      turn: { playerId: 'human', actions: [{ type: 'withdraw' }] },
    }),
    log = createSurvivalReplay(game);
  await act(async () =>
    root.render(createElement(SurvivalReplayViewer, { log })),
  );
  let blob: Blob | undefined;
  vi.spyOn(URL, 'createObjectURL').mockImplementation((value) => {
    blob = value as Blob;
    return 'blob:survival-replay';
  });
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  const before = localStorage.getItem(survivalSaveKey);
  await click('导出此回放');
  await waitForFileUi(() => {
    expect(blob).toBeDefined();
    expect(container.textContent).toContain('无损压缩');
    expect(button('导出此回放').disabled).toBe(false);
  });
  const candidate = await modeData.readModeDataFile(
    await blob!.text(),
    'replay.json',
  );
  expect(candidate.kind).toBe('survival-replay');
  if (candidate.kind === 'survival-replay')
    expect(candidate.document.replay).toEqual(log);
  expect(localStorage.getItem(survivalSaveKey)).toBe(before);
});
