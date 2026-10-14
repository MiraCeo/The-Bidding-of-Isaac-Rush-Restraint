// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { it, expect, vi, beforeEach, afterEach } from 'vitest';
import { StorageDiagnostics } from '@/components/game/storage-diagnostics';
import { GameApp } from '@/components/game/game-app';
import { startSurvivalClient, activeModeKey } from './survival-client';
import {
  serializeSurvivalCheckpoint,
  survivalSaveKey,
} from './survival-persistence';
import { playerProfileKey, createPlayerProfile } from './player-profile';
import * as storageAccess from './game-preferences';
import * as inspection from './storage-inspection';
import {
  resetPersistenceMetrics,
  persistenceMetrics,
} from './persistence-metrics';
import { waitForFileUi } from './file-export.test-helper';
(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root, container: HTMLDivElement;
beforeEach(() => {
  localStorage.clear();
  resetPersistenceMetrics();
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  resetPersistenceMetrics();
});
function button(label: string) {
  const b = [...container.querySelectorAll<HTMLButtonElement>('button')].find(
    (b) => b.textContent?.trim() === label,
  );
  if (!b) throw Error('Missing ' + label);
  return b;
}
const click = async (label: string) => act(async () => button(label).click());
it('refreshes a read-only footprint with old cache visibility and never stores the report or changes user data', async () => {
  const session = startSurvivalClient('isaac', 42),
    source = serializeSurvivalCheckpoint(session.game, session.draft),
    profile = JSON.stringify(createPlayerProfile());
  localStorage.setItem(survivalSaveKey, source);
  localStorage.setItem(playerProfileKey, profile);
  localStorage.setItem('bidding-survival-checkpoint-v4', 'private-old-value');
  const writes = vi.spyOn(Storage.prototype, 'setItem'),
    removes = vi.spyOn(Storage.prototype, 'removeItem');
  await act(async () => root.render(createElement(StorageDiagnostics)));
  expect(container.querySelectorAll('table')).toHaveLength(0);
  await click('刷新存储测量');
  await waitForFileUi(() =>
    expect(button('刷新存储测量').disabled).toBe(false),
  );
  expect(container.textContent).toContain('旧开发缓存也占用');
  expect(container.textContent).toContain('不是localStorage');
  expect(container.textContent).not.toContain('private-old-value');
  expect(container.querySelector('table')!.textContent).toContain(
    '生存续玩检查点',
  );
  expect(localStorage.getItem(survivalSaveKey)).toBe(source);
  expect(localStorage.getItem(playerProfileKey)).toBe(profile);
  expect(writes).not.toHaveBeenCalled();
  expect(removes).not.toHaveBeenCalled();
});
it('shows unavailable instead of a fake zero capacity when storage is blocked', async () => {
  vi.spyOn(storageAccess, 'getPreferenceStorage').mockReturnValue(null);
  await act(async () => root.render(createElement(StorageDiagnostics)));
  await click('刷新存储测量');
  await waitForFileUi(() =>
    expect(container.textContent).toContain('存储不可读取'),
  );
  expect(
    container.querySelector('.storage-diagnostics-metrics')!.textContent,
  ).toContain('不可用');
  expect(localStorage.length).toBe(0);
});
it('discards a delayed site estimate after leaving the panel', async () => {
  let finish!: (value: inspection.SiteEstimate) => void;
  const pending = new Promise<inspection.SiteEstimate>((resolve) => {
    finish = resolve;
  });
  vi.spyOn(inspection, 'siteStorageEstimate').mockReturnValue(pending);
  await act(async () => root.render(createElement(StorageDiagnostics)));
  await click('刷新存储测量');
  await act(async () => root.render(createElement('p', null, '其他页面')));
  await act(async () => {
    finish({ usageBytes: 1, quotaBytes: 2, message: 'late-estimate' });
    await pending;
  });
  expect(container.textContent).toBe('其他页面');
});
it('opens diagnostics through progress and preserves the survival phase, draft and automatic save bytes', async () => {
  const session = startSurvivalClient('lost', 99, 'easy');
  session.draft!.amounts.A.bid = 23;
  localStorage.setItem(activeModeKey, 'survival');
  localStorage.setItem(
    survivalSaveKey,
    serializeSurvivalCheckpoint(session.game, session.draft),
  );
  await act(async () => root.render(createElement(GameApp)));
  const before = localStorage.getItem(survivalSaveKey);
  await click('进度');
  await click('存档与备份');
  expect(container.querySelector('.storage-diagnostics')).not.toBeNull();
  await click('刷新存储测量');
  await waitForFileUi(() =>
    expect(button('刷新存储测量').disabled).toBe(false),
  );
  expect(container.textContent).toContain('行动草稿');
  expect(
    persistenceMetrics().some(
      (metric) => metric.mode === 'survival' && metric.operation === 'save',
    ),
  ).toBe(true);
  await click('返回游戏');
  expect(
    container.querySelector<HTMLInputElement>(
      'input[aria-label="竞拍奖励 A 的数值"]',
    )!.value,
  ).toBe('23');
  expect(localStorage.getItem(survivalSaveKey)).toBe(before);
});
