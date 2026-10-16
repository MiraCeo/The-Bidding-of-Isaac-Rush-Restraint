// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import { AchievementBaselineMaintenance } from '../../../components/game/achievement-baseline-maintenance';
import { AchievementProgress } from '../../../components/game/achievement-progress';
import { playerProfileKey, readPlayerProfile } from '../player-profile';
import {
  achievementBaselineModule,
  hasCurrentAchievementBaseline,
} from './baseline';
import { oldAchievementProfile } from './baseline.test-helper';
import {
  readAchievementRegistry,
  projectAchievementRegistry,
} from './registry';
import { notifyPlayerProfileChanged } from '../profile-events';
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
  Object.defineProperty(navigator, 'locks', {
    configurable: true,
    value: {
      request: async (_name: string, _o: unknown, work: () => unknown) =>
        work(),
    },
  });
}
const mount = () =>
  act(async () => {
    root.render(createElement(AchievementBaselineMaintenance));
  });
it('runs startup cleanup under the shared lock, preserves manual roles and non-profile keys, and is stable after refresh', async () => {
  locks();
  const old = oldAchievementProfile(true);
  localStorage.setItem(playerProfileKey, JSON.stringify(old));
  localStorage.setItem('bidding-ui-preferences-v1', 'keep');
  localStorage.setItem('bidding-classic-checkpoint-v5', 'keep-core');
  await mount();
  const p = readPlayerProfile(
    JSON.parse(localStorage.getItem(playerProfileKey)!),
  );
  expect(hasCurrentAchievementBaseline(p)).toBe(true);
  expect(readAchievementRegistry(p)!.receipts).toEqual([]);
  expect(projectAchievementRegistry(p)!.achievedAt).toEqual({});
  expect(
    Object.keys(projectAchievementRegistry(p)!.characterUnlocks),
  ).toHaveLength(5);
  expect(localStorage.getItem('bidding-ui-preferences-v1')).toBe('keep');
  expect(localStorage.getItem('bidding-classic-checkpoint-v5')).toBe(
    'keep-core',
  );
  const saved = localStorage.getItem(playerProfileKey);
  await act(async () => notifyPlayerProfileChanged());
  expect(localStorage.getItem(playerProfileKey)).toBe(saved);
  expect(node.textContent).toBe('');
});
it('shows an explicit failure without altering old data if coordination is absent, then succeeds on retry', async () => {
  Object.defineProperty(navigator, 'locks', {
    configurable: true,
    value: undefined,
  });
  const old = oldAchievementProfile(),
    raw = JSON.stringify(old);
  localStorage.setItem(playerProfileKey, raw);
  await mount();
  expect(node.textContent).toContain('旧版本成就清理未保存');
  expect(localStorage.getItem(playerProfileKey)).toBe(raw);
  locks();
  await act(async () => {
    node.querySelector<HTMLButtonElement>('button')!.click();
  });
  expect(
    hasCurrentAchievementBaseline(
      readPlayerProfile(JSON.parse(localStorage.getItem(playerProfileKey)!)),
    ),
  ).toBe(true);
});
it('cleans a subsequently restored old profile on the profile event, but never erases already marked progress', async () => {
  locks();
  await mount();
  const old = oldAchievementProfile();
  localStorage.setItem(playerProfileKey, JSON.stringify(old));
  await act(async () => notifyPlayerProfileChanged());
  const first = localStorage.getItem(playerProfileKey);
  expect(
    hasCurrentAchievementBaseline(readPlayerProfile(JSON.parse(first!))),
  ).toBe(true);
  await act(async () => window.dispatchEvent(new Event('focus')));
  expect(localStorage.getItem(playerProfileKey)).toBe(first);
});
it('does not reset an unknown baseline and reports that the source is retained', async () => {
  locks();
  const p = oldAchievementProfile();
  p.progression.modules[achievementBaselineModule] = { version: 99 };
  const raw = JSON.stringify(p);
  localStorage.setItem(playerProfileKey, raw);
  await mount();
  expect(node.textContent).toContain('清理未保存');
  expect(node.textContent).toContain('基线');
  expect(localStorage.getItem(playerProfileKey)).toBe(raw);
});
it('makes the read-only achievement preview explicitly pending rather than falsely claiming physical cleanup', async () => {
  const p = oldAchievementProfile(),
    raw = JSON.stringify(p);
  await act(async () =>
    root.render(createElement(AchievementProgress, { profile: p })),
  );
  expect(node.textContent).toContain('清理尚待成功保存');
  expect(node.querySelector('.achievement-overview')!.textContent).toContain(
    '0 / 107',
  );
  expect(node.textContent).not.toContain('旧版成就纪念');
  expect(JSON.stringify(p)).toBe(raw);
  expect(localStorage.getItem(playerProfileKey)).toBeNull();
});
