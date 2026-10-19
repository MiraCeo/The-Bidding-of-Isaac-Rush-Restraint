// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { it, expect, vi } from 'vitest';
import { SurvivalRecordCard } from '@/components/game/survival-record-card';
import { RecordContextCard } from '@/components/game/record-context-card';
import { renderToStaticMarkup } from 'react-dom/server';
import { playLongRun } from './survival-long-run';
import { createSurvivalReplay } from './survival-record';
import { parseSurvivalReplay } from './survival-persistence';
import * as downloads from './json-download';
import { DataManagement } from '@/components/game/data-management';
import type { DataManagementController } from '@/components/game/use-data-management';
import { classicCompletionFixture } from './completion-registry.test-helper';
(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
it('uses one heading and save-status frame without changing its mode-owned content', () => {
  const el = document.createElement('div');
  el.innerHTML = renderToStaticMarkup(
    createElement(
      RecordContextCard,
      { status: '原始保存状态' },
      createElement('p', null, '模式实际信息'),
    ),
  );
  expect(el.querySelector('h3')!.textContent).toBe('对局与记录');
  expect(el.querySelector('details')!.open).toBe(false);
  expect(el.querySelector('summary')!.textContent).toBe('保存状态');
  expect(el.textContent).toContain('原始保存状态');
  expect(el.textContent).toContain('模式实际信息');
});
it('keeps a failed classic final save visible outside the folded status details', () => {
  const session = classicCompletionFixture();
  const data = {
    task: 'settings',
    activeSession: session,
    ongoing: false,
    recent: { document: null, error: '' },
    showRecent: false,
    showImported: false,
    tools: {
      autoSaveStatus: 'session',
      restoreMessage: '',
      importedReplay: null,
    },
  } as unknown as DataManagementController;
  const el = document.createElement('div');
  el.innerHTML = renderToStaticMarkup(
    createElement(DataManagement, { data, scope: 'records' }),
  );
  const warning = el.querySelector('.data-autosave-unavailable')!;
  expect(warning.textContent).toContain('请导出回放');
  expect(warning.closest('details')).toBeNull();
  expect(el.querySelector('details')!.open).toBe(false);
});
it('exports the same current v5 survival replay facts without changing the session or profile', async () => {
  const log = createSurvivalReplay(playLongRun(3, 'isaac', 'standard').game),
    before = structuredClone(log);
  let raw = '';
  const save = vi
    .spyOn(downloads, 'downloadPortableJsonFile')
    .mockImplementation(async (source) => {
      raw = source;
      return {} as Awaited<
        ReturnType<typeof downloads.downloadPortableJsonFile>
      >;
    });
  const el = document.createElement('div');
  document.body.append(el);
  const root = createRoot(el);
  localStorage.setItem('context-test-sentinel', 'unchanged');
  try {
    await act(async () =>
      root.render(
        createElement(SurvivalRecordCard, {
          log,
          recent: null,
          error: '',
          saveStatus: '生存进度已自动保存。',
          onReplay: vi.fn(),
          onReturnGame: vi.fn(),
        }),
      ),
    );
    expect(
      [...el.querySelectorAll('.data-actions button')].map(
        (e) => e.textContent,
      ),
    ).toEqual(['查看对局', '导出回放']);
    await act(async () =>
      [...el.querySelectorAll<HTMLButtonElement>('button')]
        .find((e) => e.textContent === '导出回放')!
        .click(),
    );
    expect(save).toHaveBeenCalledOnce();
    expect(parseSurvivalReplay(raw).replay).toEqual(before);
    expect(log).toEqual(before);
    expect(localStorage.getItem('context-test-sentinel')).toBe('unchanged');
  } finally {
    await act(async () => root.unmount());
    el.remove();
    save.mockRestore();
    localStorage.removeItem('context-test-sentinel');
  }
});
it('aborts a pending context export when the mode card is unmounted', async () => {
  const log = createSurvivalReplay(playLongRun(3, 'isaac', 'standard').game);
  let finish!: () => void, signal: AbortSignal | undefined;
  const save = vi
    .spyOn(downloads, 'downloadPortableJsonFile')
    .mockImplementation((_source, _name, options) => {
      signal = options?.signal;
      return new Promise((resolve) => {
        finish = () =>
          resolve(
            {} as Awaited<
              ReturnType<typeof downloads.downloadPortableJsonFile>
            >,
          );
      });
    });
  const el = document.createElement('div');
  document.body.append(el);
  const root = createRoot(el);
  try {
    await act(async () =>
      root.render(
        createElement(SurvivalRecordCard, {
          log,
          recent: null,
          error: '',
          saveStatus: '生存进度已自动保存。',
          onReplay: vi.fn(),
          onReturnGame: vi.fn(),
        }),
      ),
    );
    await act(async () =>
      [...el.querySelectorAll<HTMLButtonElement>('button')]
        .find((e) => e.textContent === '导出回放')!
        .click(),
    );
    expect(signal?.aborted).toBe(false);
    await act(async () => root.unmount());
    expect(signal?.aborted).toBe(true);
    await act(async () => finish());
  } finally {
    el.remove();
    save.mockRestore();
  }
});
