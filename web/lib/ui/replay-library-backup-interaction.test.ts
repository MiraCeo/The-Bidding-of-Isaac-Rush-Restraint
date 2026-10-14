// @vitest-environment happy-dom
import { IDBFactory } from 'fake-indexeddb';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeAll, beforeEach, afterEach, expect, it, vi } from 'vitest';
import { ReplayLibraryPanel } from '@/components/game/replay-library-panel';
import {
  replayLibrary,
  replayLibraryDatabase,
  replaySource,
  prepareLibraryReplay,
  newLibraryDocument,
  librarySha256,
  type PreparedReplay,
} from './replay-library';
import {
  parseLibraryBackup,
  serializeLibraryBackup,
  type LibraryRestorePreview,
} from './replay-library-backup-format';
import {
  equivalentPreparedFixture,
  classicEquivalentFixture,
  editLibraryStore,
} from './classic-library-equivalence.test-helper';
import { classicLibraryProof } from './classic-library-equivalence';
import { createSurvivalReplay } from './survival-record';
import { playLongRun } from './survival-long-run';
import { playerProfileKey } from './player-profile';
import { gameSaveKey } from './game-save';
import { survivalSaveKey } from './survival-persistence';
import { waitForFileUi } from './file-export.test-helper';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
let container: HTMLDivElement,
  root: Root,
  source: string,
  original: PreparedReplay,
  branch: PreparedReplay,
  survival: PreparedReplay;
beforeAll(async () => {
  original = await equivalentPreparedFixture();
  branch = await equivalentPreparedFixture(0, true);
  survival = await prepareLibraryReplay(
    replaySource(
      newLibraryDocument({
        mode: 'survival',
        replay: createSurvivalReplay(playLongRun(3).game),
      }),
    ),
  );
  source = (
    await serializeLibraryBackup({
      entries: [original.entry, survival.entry],
      payloads: [original, survival].map((p) => ({
        key: p.entry.key,
        source: p.source,
      })),
      removed: [
        { key: 'classic/' + 'e'.repeat(64), removedAt: '2026-10-09T00:00:00Z' },
        {
          key: branch.entry.key,
          removedAt: '2026-10-10T00:00:00Z',
          classicProof: await classicLibraryProof(
            classicEquivalentFixture(0, true).replay,
            librarySha256,
          ),
        },
      ],
    })
  ).source;
});
beforeEach(() => {
  vi.stubGlobal('indexedDB', new IDBFactory());
  localStorage.clear();
  localStorage.setItem(gameSaveKey, 'keep-classic');
  localStorage.setItem(survivalSaveKey, 'keep-survival');
  localStorage.setItem(playerProfileKey, 'keep-profile');
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
  const found = [
    ...container.querySelectorAll<HTMLButtonElement>('button'),
  ].find((b) => b.textContent?.trim() === label);
  if (!found) throw Error('Missing ' + label);
  return found;
}
const click = async (label: string) => act(async () => button(label).click());
const mount = async () => {
  await act(async () =>
    root.render(
      createElement(ReplayLibraryPanel, {
        mode: 'classic',
        current: null,
        recent: null,
        archiveStatus: '',
        onReplay: vi.fn(),
      }),
    ),
  );
  await waitForFileUi(() => expect(button('刷新回放库').disabled).toBe(false));
};
async function upload(text = source, size?: number) {
  const input = container.querySelector<HTMLInputElement>(
    'input[aria-label="读取整库备份文件"]',
  )!;
  const file = new File([text], '整库.json');
  if (size !== undefined) Object.defineProperty(file, 'size', { value: size });
  Object.defineProperty(input, 'files', { configurable: true, value: [file] });
  await act(async () =>
    input.dispatchEvent(new Event('change', { bubbles: true })),
  );
}
const acknowledge = async () =>
  act(async () =>
    container
      .querySelector<HTMLInputElement>(
        '.library-backup input[type="checkbox"]',
      )!
      .click(),
  );
function untouched() {
  expect(localStorage.getItem(gameSaveKey)).toBe('keep-classic');
  expect(localStorage.getItem(survivalSaveKey)).toBe('keep-survival');
  expect(localStorage.getItem(playerProfileKey)).toBe('keep-profile');
}
it('previews both modes and deletion evidence, requires explicit acknowledgement, then appends without registering a game', async () => {
  await mount();
  await upload();
  await waitForFileUi(() =>
    expect(
      container.querySelector('[aria-label="整库增量恢复预览"]'),
    ).not.toBeNull(),
  );
  expect(container.textContent).toContain('新增 2 份');
  expect(container.textContent).toContain('新增 2 条');
  expect(button('确认增量恢复整库').disabled).toBe(true);
  expect(await replayLibrary.list()).toHaveLength(0);
  untouched();
  await acknowledge();
  await click('确认增量恢复整库');
  await waitForFileUi(() =>
    expect(container.textContent).toContain('整库恢复完成'),
  );
  expect(await replayLibrary.list()).toHaveLength(2);
  untouched();
  await upload();
  await waitForFileUi(() =>
    expect(container.textContent).toContain('重复 2 份'),
  );
  expect(container.textContent).toContain('已有 2 条');
  await click('取消整库恢复');
  expect(await replayLibrary.list()).toHaveLength(2);
  untouched();
});
it('exports all modes rather than the visible filter and keeps exact stored sources and deletion markers', async () => {
  await replayLibrary.restoreBackup(await replayLibrary.previewBackup(source));
  await mount();
  let blob: Blob | undefined;
  vi.spyOn(URL, 'createObjectURL').mockImplementation((value) => {
    blob = value as Blob;
    return 'blob:bulk-test';
  });
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  await click('导出整库备份');
  await waitForFileUi(() => expect(blob).toBeDefined());
  const exported = await parseLibraryBackup(await blob!.text());
  expect(exported.entries.map((e) => e.mode).sort()).toEqual([
    'classic',
    'survival',
  ]);
  expect(exported.removed).toHaveLength(2);
  expect(
    exported.payloads.find((p) => p.key === original.entry.key)?.source,
  ).toBe(original.source);
  untouched();
});
it('invalidates the acknowledged plan after a library change and requires rechecking and a new acknowledgement', async () => {
  await mount();
  await upload();
  await waitForFileUi(() => expect(button('确认增量恢复整库')).toBeDefined());
  await acknowledge();
  await act(async () => {
    await replayLibrary.add(branch);
  });
  await waitForFileUi(() =>
    expect(container.textContent).toContain('此预览已失效'),
  );
  expect(button('确认增量恢复整库').disabled).toBe(true);
  await click('重新核对回放库');
  await waitForFileUi(() =>
    expect(container.textContent).toContain('本机存活冲突 1 条'),
  );
  expect(
    container.querySelector<HTMLInputElement>(
      '.library-backup input[type="checkbox"]',
    )!.checked,
  ).toBe(false);
  await acknowledge();
  await click('确认增量恢复整库');
  await waitForFileUi(() =>
    expect(container.textContent).toContain('整库恢复完成'),
  );
  expect((await replayLibrary.read(branch.entry.key)).source).toBe(
    branch.source,
  );
  untouched();
});
it('catches a payload-only change at final confirmation even if no change event was delivered', async () => {
  await replayLibrary.add(branch);
  await mount();
  await upload();
  await waitForFileUi(() => expect(button('确认增量恢复整库')).toBeDefined());
  await acknowledge();
  await editLibraryStore(
    indexedDB as unknown as IDBFactory,
    replayLibraryDatabase,
    'payload',
    (s) => s.put({ key: branch.entry.key, source: branch.source + ' ' }),
  );
  await click('确认增量恢复整库');
  await waitForFileUi(() =>
    expect(container.textContent).toContain('预览后回放库已变化'),
  );
  expect(await replayLibrary.list()).toHaveLength(1);
  untouched();
});
it('cancels a late read without applying it and releases other library controls', async () => {
  const prepared = await replayLibrary.previewBackup(source);
  await mount();
  let finish!: (preview: LibraryRestorePreview) => void;
  vi.spyOn(replayLibrary, 'previewBackup').mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  await upload();
  expect(button('刷新回放库').disabled).toBe(true);
  await click('取消整库操作');
  await act(async () => finish(prepared));
  expect(container.querySelector('[aria-label="整库增量恢复预览"]')).toBeNull();
  expect(button('刷新回放库').disabled).toBe(false);
  expect(await replayLibrary.list()).toHaveLength(0);
  untouched();
});
it('keeps the library unchanged on cancel, file chooser cancellation, malformed files or oversized file declarations', async () => {
  await mount();
  await upload();
  await waitForFileUi(() => expect(button('取消整库恢复')).toBeDefined());
  await act(async () =>
    container
      .querySelector('input[aria-label="读取整库备份文件"]')!
      .dispatchEvent(new Event('cancel')),
  );
  expect(container.querySelector('[aria-label="整库增量恢复预览"]')).toBeNull();
  await upload('broken');
  await waitForFileUi(() =>
    expect(container.textContent).toContain('本批0写入'),
  );
  await upload(source, 161 * 1024 * 1024);
  await waitForFileUi(() =>
    expect(container.textContent).toContain('超过160 MiB'),
  );
  expect(await replayLibrary.list()).toHaveLength(0);
  untouched();
});
it('reports a failed append without claiming success or clearing the original local library', async () => {
  await replayLibrary.add(branch);
  await mount();
  await upload();
  await waitForFileUi(() => expect(button('确认增量恢复整库')).toBeDefined());
  await acknowledge();
  vi.spyOn(replayLibrary, 'restoreBackup').mockRejectedValue(
    new DOMException('quota', 'QuotaExceededError'),
  );
  await click('确认增量恢复整库');
  await waitForFileUi(() =>
    expect(container.textContent).toContain('本批事务未提交'),
  );
  expect(container.textContent).not.toContain('整库恢复完成');
  expect(await replayLibrary.list()).toHaveLength(1);
  untouched();
});
