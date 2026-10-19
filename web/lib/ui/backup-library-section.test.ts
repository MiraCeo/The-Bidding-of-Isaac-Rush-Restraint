// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeAll, beforeEach, afterEach, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { BackupLibrarySection } from '@/components/game/backup-library-section';
import {
  replayLibrary,
  replayLibraryChanged,
  prepareLibraryReplay,
  newLibraryDocument,
  replaySource,
  type PreparedReplay,
} from './replay-library';
import { classicCompletionFixture } from './completion-registry.test-helper';
(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root,
  container: HTMLDivElement,
  first: PreparedReplay,
  second: PreparedReplay;
beforeAll(async () => {
  first = await prepareLibraryReplay(
    replaySource(
      newLibraryDocument({
        mode: 'classic',
        replay: classicCompletionFixture(42).replay!,
      }),
    ),
  );
  second = await prepareLibraryReplay(
    replaySource(
      newLibraryDocument({
        mode: 'classic',
        replay: classicCompletionFixture(43).replay!,
      }),
    ),
  );
});
beforeEach(() => {
  vi.stubGlobal('indexedDB', new IDBFactory());
  localStorage.clear();
  localStorage.setItem('test-profile-sentinel', 'unchanged');
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
const mount = () =>
  act(async () =>
    root.render(createElement(BackupLibrarySection, { onRecords: vi.fn() })),
  );
async function wait(check: () => void) {
  await vi.waitFor(async () => {
    await act(async () => {
      await Promise.resolve();
    });
    check();
  });
}
const bytesText = (n: number) =>
  n < 1024
    ? `${n} B`
    : n < 1024 * 1024
      ? `${(n / 1024).toFixed(1)} KiB`
      : `${(n / 1024 / 1024).toFixed(2)} MiB`;
it('reads actual all-library index counts and payload bytes and refreshes after a library change without altering facts', async () => {
  await replayLibrary.add(first);
  const initial = await replayLibrary.list();
  await mount();
  await wait(() =>
    expect(
      container.querySelector('.backup-library-summary')!.textContent,
    ).toContain('全库记录 1 / 100 份'),
  );
  expect(
    container.querySelector('.backup-library-summary')!.textContent,
  ).toContain(bytesText(first.entry.bytes));
  expect(await replayLibrary.list()).toEqual(initial);
  await act(async () => {
    await replayLibrary.add(second);
  });
  await wait(() =>
    expect(
      container.querySelector('.backup-library-summary')!.textContent,
    ).toContain('全库记录 2 / 100 份'),
  );
  expect(
    container.querySelector('.backup-library-summary')!.textContent,
  ).toContain(bytesText(first.entry.bytes + second.entry.bytes));
  expect(localStorage.getItem('test-profile-sentinel')).toBe('unchanged');
  expect(container.querySelector('.library-backup>.utility-notice')).toBeNull();
  expect(
    container.querySelector('.library-backup .data-technical')!.textContent,
  ).toContain('不含索引／删除证据');
});
it('shows read errors as unavailable rather than zero, and can retry to a genuinely empty library', async () => {
  const list = vi
    .spyOn(replayLibrary, 'list')
    .mockRejectedValue(Error('测试：索引不可读取'));
  await mount();
  await wait(() => expect(container.textContent).toContain('库状态未能读取'));
  expect(
    container.querySelector('.backup-library-summary')!.textContent,
  ).not.toContain('0 / 100');
  list.mockResolvedValue([]);
  await act(async () =>
    [...container.querySelectorAll('button')]
      .find((e) => e.textContent === '重试读取库状态')!
      .click(),
  );
  await wait(() =>
    expect(
      container.querySelector('.backup-library-summary')!.textContent,
    ).toContain('全库记录 0 / 100 份'),
  );
  expect(
    container.querySelector('.backup-library-summary')!.textContent,
  ).toContain('0 B');
});
it('does not let an older pending index response overwrite the latest library status', async () => {
  let old!: (rows: (typeof first.entry)[]) => void,
    latest!: (rows: (typeof first.entry)[]) => void;
  vi.spyOn(replayLibrary, 'list')
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          old = resolve;
        }),
    )
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          latest = resolve;
        }),
    );
  await mount();
  await act(async () => window.dispatchEvent(new Event(replayLibraryChanged)));
  await act(async () => latest([first.entry]));
  expect(
    container.querySelector('.backup-library-summary')!.textContent,
  ).toContain('全库记录 1 / 100 份');
  await act(async () => old([]));
  expect(
    container.querySelector('.backup-library-summary')!.textContent,
  ).toContain('全库记录 1 / 100 份');
});
