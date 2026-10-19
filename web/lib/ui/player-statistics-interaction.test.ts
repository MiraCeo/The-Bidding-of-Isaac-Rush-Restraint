// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { GameApp } from '@/components/game/game-app';
import { PlayerStatistics } from '@/components/game/player-statistics';
import { createPlayerProfile, playerProfileKey } from './player-profile';
import {
  completionRegistryModule,
  registerCompletion,
  readCompletionRegistry,
  sumCounters,
} from './completion-registry';
import { completionRecordFixture } from './completion-registry.test-helper';
import { profileFileFixture } from './player-profile-file.test-helper';
import { notifyPlayerProfileChanged } from './profile-events';
import { createGameSession, reduceGameSession } from './game-session';
import { gameSaveKey, serializeGameCheckpoint } from './game-save';
import { activeModeKey, startSurvivalClient } from './survival-client';
import {
  survivalSaveKey,
  serializeSurvivalCheckpoint,
} from './survival-persistence';
import { playLongRun } from './survival-long-run';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root, container: HTMLDivElement;
beforeEach(() => {
  localStorage.clear();
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.restoreAllMocks();
});
function button(label: string) {
  const found = [
    ...container.querySelectorAll<HTMLButtonElement>('button'),
  ].find((b) => b.textContent?.trim() === label);
  if (!found) throw Error('Missing ' + label);
  return found;
}
const click = async (label: string) => act(async () => button(label).click());
async function change(label: string, value: string) {
  const select = container.querySelector<HTMLSelectElement>(
    `select[aria-label="${label}"]`,
  )!;
  await act(async () => {
    select.value = value;
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
}
const mount = async () => act(async () => root.render(createElement(GameApp)));
const completed = () =>
  container.querySelector('.statistics-cards article strong')!.textContent;
function registered() {
  let p = registerCompletion(
    createPlayerProfile(),
    { ...completionRecordFixture(0), rank: 1 },
    [],
    true,
  );
  p = registerCompletion(
    p,
    {
      ...completionRecordFixture(1, 'survival'),
      characterId: 'lost',
      aiDifficulty: 'highest',
      status: 'eliminated',
      eliminationFloorIndex: 0,
      rank: 20,
    },
    [],
    false,
  );
  p = registerCompletion(
    p,
    {
      ...completionRecordFixture(2, 'survival'),
      characterId: 'jacob_esau',
      aiDifficulty: 'easy',
      rank: 1,
    },
    [],
    true,
  );
  return p;
}
it('opens statistics from a no-game menu without creating a profile, receipt, save or match', async () => {
  await mount();
  await click('进度');
  await click('统计');
  expect(completed()).toBe('0');
  expect(container.textContent).toContain('尚未启用统一登记累计');
  await click('生存');
  expect(container.textContent).toContain('存活与淘汰');
  expect(localStorage.getItem(playerProfileKey)).toBeNull();
  expect(localStorage.getItem(gameSaveKey)).toBeNull();
  expect(localStorage.getItem(survivalSaveKey)).toBeNull();
});
it('keeps old retained history separate from uninitialized cumulative totals and never backfills during viewing', async () => {
  const source = JSON.stringify(profileFileFixture());
  localStorage.setItem(playerProfileKey, source);
  await mount();
  await click('进度');
  await click('统计');
  expect(completed()).toBe('0');
  await change('统计数据范围', 'history');
  expect(completed()).toBe('1');
  expect(container.textContent).toContain('这不是终身累计');
  await click('生存');
  await change('统计数据范围', 'history');
  expect(completed()).toBe('2');
  await change('统计角色', 'lost');
  expect(completed()).toBe('1');
  expect(
    container.querySelector('.statistics-elimination')!.textContent,
  ).toContain('第1层 1');
  await change('统计难度', 'easy');
  expect(completed()).toBe('0');
  expect(localStorage.getItem(playerProfileKey)).toBe(source);
});
it('shows registered mode/role/difficulty counters, survival rate and histogram without mixing classic scores', async () => {
  const source = JSON.stringify(registered());
  localStorage.setItem(playerProfileKey, source);
  await mount();
  await click('进度');
  await click('统计');
  expect(completed()).toBe('1');
  expect(container.textContent).toContain('两模式共 3 局');
  expect(container.querySelector('.statistics-cards')!.textContent).toContain(
    '冠军率 100.0%',
  );
  await click('生存');
  expect(completed()).toBe('2');
  expect(
    container.querySelector('.statistics-survival-rate')!.textContent,
  ).toContain('50.0%');
  expect(
    container.querySelector('.statistics-outcomes')!.textContent,
  ).toContain('存活 1 局');
  await change('统计难度', 'highest');
  expect(completed()).toBe('1');
  expect(
    container.querySelector('.statistics-outcomes')!.textContent,
  ).toContain('淘汰 1 局');
  expect(
    container.querySelector('.statistics-elimination')!.textContent,
  ).toContain('第1层 1');
  await change('统计难度', 'easy');
  expect(
    container.querySelector('.statistics-survival-rate')!.textContent,
  ).toContain('100.0%');
  expect(localStorage.getItem(playerProfileKey)).toBe(source);
});
it('preserves per-mode filters and both unsubmitted drafts when leaving and returning to statistics', async () => {
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
  await mount();
  const a = localStorage.getItem(gameSaveKey),
    b = localStorage.getItem(survivalSaveKey);
  await click('进度');
  await click('统计');
  await change('统计角色', 'lost');
  await change('统计数据范围', 'history');
  await click('生存');
  await change('统计角色', 'jacob_esau');
  await change('统计难度', 'easy');
  await click('设置');
  await click('进度');
  expect(button('统计').getAttribute('aria-current')).toBe('page');
  expect(
    container.querySelector<HTMLSelectElement>('select[aria-label="统计角色"]')!
      .value,
  ).toBe('jacob_esau');
  expect(
    container.querySelector<HTMLSelectElement>('select[aria-label="统计难度"]')!
      .value,
  ).toBe('easy');
  await click('经典');
  expect(
    container.querySelector<HTMLSelectElement>('select[aria-label="统计角色"]')!
      .value,
  ).toBe('lost');
  expect(
    container.querySelector<HTMLSelectElement>(
      'select[aria-label="统计数据范围"]',
    )!.value,
  ).toBe('history');
  expect(localStorage.getItem(gameSaveKey)).toBe(a);
  expect(localStorage.getItem(survivalSaveKey)).toBe(b);
});
it('refreshes statistics from profile notifications rather than event payloads, without altering matches', async () => {
  await mount();
  await click('进度');
  await click('统计');
  expect(completed()).toBe('0');
  await act(async () => {
    localStorage.setItem(playerProfileKey, JSON.stringify(registered()));
    notifyPlayerProfileChanged();
  });
  expect(completed()).toBe('1');
  await click('生存');
  expect(completed()).toBe('2');
  expect(localStorage.getItem(gameSaveKey)).toBeNull();
  expect(localStorage.getItem(survivalSaveKey)).toBeNull();
});
it('displays unreadable statistics as unknown, not a valid zero count, and preserves the original', async () => {
  const p = registered();
  (
    p.progression.modules[completionRegistryModule] as Record<string, unknown>
  ).version = 99;
  const source = JSON.stringify(p);
  localStorage.setItem(playerProfileKey, source);
  await mount();
  await click('进度');
  await click('统计');
  expect(container.textContent).toContain('不将读取失败显示为零局');
  expect(container.querySelector('.statistics-cards')).toBeNull();
  expect(localStorage.getItem(playerProfileKey)).toBe(source);
});
it('keeps valid cumulative data readable when old retained scores exceed the history aggregation bound', async () => {
  const p = registered();
  p.history[0]!.finalScore = 1e100;
  await act(async () =>
    root.render(
      createElement(PlayerStatistics, {
        profile: p,
        message: '',
        mode: 'classic',
        decimals: 4,
        onFiltersChange: () => {},
      }),
    ),
  );
  expect(completed()).toBe('1');
  expect(container.querySelector('.statistics-cards')!.textContent).toContain(
    '10.1234',
  );
  await change('统计数据范围', 'history');
  expect(container.textContent).toContain('超出累计统计安全范围');
  await change('统计数据范围', 'registered');
  expect(completed()).toBe('1');
});
it('registers AI-only continuation once while statistics stay open and keeps the eliminated human score frozen', async () => {
  const g = playLongRun(3).states.find(
    (g) => g.humanEliminatedAt !== null && g.phase !== 'competition_complete',
  )!;
  localStorage.setItem(activeModeKey, 'survival');
  localStorage.setItem(survivalSaveKey, serializeSurvivalCheckpoint(g));
  vi.useFakeTimers();
  await mount();
  await click('进度');
  await click('统计');
  expect(completed()).toBe('0');
  for (let i = 0; i < 80; i++)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30);
    });
  expect(completed()).toBe('1');
  const p = JSON.parse(localStorage.getItem(playerProfileKey)!);
  expect(p.history[0].status).toBe('eliminated');
  expect(p.history[0].eliminationFloorIndex).toBe(0);
  expect(
    sumCounters(Object.values(readCompletionRegistry(p)!.groups)).completed,
  ).toBe(1);
  const source = localStorage.getItem(playerProfileKey);
  await click('对局记录');
  await click('查看对局');
  await click('返回进度');
  await click('统计');
  expect(completed()).toBe('1');
  expect(localStorage.getItem(playerProfileKey)).toBe(source);
}, 20000);

it('separates independently computed best score and rank, units and averages without changing registry facts', async () => {
  let profile = registered();
  profile = registerCompletion(
    profile,
    { ...completionRecordFixture(3), rank: 4, finalScore: 900.9876 },
    [],
    false,
  );
  const before = JSON.stringify(profile),
    updates = vi.fn();
  await act(async () =>
    root.render(
      createElement(PlayerStatistics, {
        profile,
        message: '',
        mode: 'classic',
        decimals: 4,
        onFiltersChange: updates,
      }),
    ),
  );
  const metric = (key: string) =>
    container.querySelector(`[data-metric="${key}"]`)!;
  expect(container.querySelectorAll('.statistics-cards article')).toHaveLength(
    6,
  );
  expect(metric('best-score').querySelector('strong')!.textContent).toBe(
    '900.9876',
  );
  expect(metric('best-score').textContent).toContain('分');
  expect(metric('best-rank').querySelector('strong')!.textContent).toBe('#1');
  expect(metric('average-score').querySelector('strong')!.textContent).toBe(
    '455.5555',
  );
  expect(metric('average-rank').querySelector('strong')!.textContent).toBe(
    '2.50',
  );
  expect(
    container.querySelector<HTMLDetailsElement>('.statistics-methodology')!
      .open,
  ).toBe(false);
  expect(
    container.querySelector('.statistics-methodology')!.textContent,
  ).toContain('不代表来自同一局');
  expect(JSON.stringify(profile)).toBe(before);
  expect(updates).not.toHaveBeenCalled();
});
it('switches survival distribution rows under the same filters and exposes focusable overflow regions', async () => {
  const profile = registered(),
    before = JSON.stringify(profile),
    updates = vi.fn();
  await act(async () =>
    root.render(
      createElement(PlayerStatistics, {
        profile,
        message: '',
        mode: 'survival',
        decimals: 2,
        onFiltersChange: updates,
      }),
    ),
  );
  expect(
    container.querySelectorAll('.statistics-distribution tbody tr'),
  ).toHaveLength(2);
  expect(
    container.querySelectorAll('.statistics-row-name .character-art'),
  ).toHaveLength(2);
  const scroll = container.querySelector<HTMLElement>(
    '.statistics-table-wrap',
  )!;
  expect(scroll.tabIndex).toBe(0);
  expect(scroll.getAttribute('aria-label')).toContain('角色统计');
  await click('按难度');
  expect(button('按难度').getAttribute('aria-pressed')).toBe('true');
  expect(
    container.querySelectorAll('.statistics-distribution tbody tr'),
  ).toHaveLength(2);
  expect(
    container.querySelector('.statistics-distribution tbody')!.textContent,
  ).toContain('简单');
  expect(
    container.querySelector('.statistics-distribution tbody')!.textContent,
  ).toContain('最高');
  expect(scroll.getAttribute('aria-label')).toContain('难度统计');
  await change('统计角色', 'lost');
  expect(
    container.querySelectorAll('.statistics-distribution tbody tr'),
  ).toHaveLength(1);
  expect(completed()).toBe('1');
  expect(
    container.querySelector('.statistics-survival-rate')!.textContent,
  ).toContain('0.0%');
  await click('按角色');
  expect(
    container.querySelectorAll('.statistics-distribution tbody tr'),
  ).toHaveLength(1);
  expect(
    container.querySelector('.statistics-distribution tbody')!.textContent,
  ).toContain('游魂');
  expect(JSON.stringify(profile)).toBe(before);
});
it('clears role and difficulty without changing the chosen data source, preserves meaningful zero and unknown values', async () => {
  const profile = profileFileFixture(),
    updates = vi.fn();
  await act(async () =>
    root.render(
      createElement(PlayerStatistics, {
        profile,
        message: '',
        mode: 'survival',
        decimals: 2,
        initialFilters: { scope: 'history', role: 'isaac', difficulty: 'easy' },
        onFiltersChange: updates,
      }),
    ),
  );
  expect(completed()).toBe('0');
  expect(
    container.querySelector('[data-metric="best-score"] strong')!.textContent,
  ).toBe('—');
  expect(
    container.querySelector('[data-metric="average-rank"] strong')!.textContent,
  ).toBe('—');
  expect(
    container.querySelector('.statistics-survival-rate strong')!.textContent,
  ).toBe('—');
  expect(container.textContent).toContain('这不是终身累计');
  await click('清除筛选');
  expect(updates).toHaveBeenLastCalledWith({
    scope: 'history',
    role: 'all',
    difficulty: 'all',
  });
  expect(completed()).toBe('2');
  expect(
    container.querySelector<HTMLSelectElement>('[aria-label="统计数据范围"]')!
      .value,
  ).toBe('history');
  expect(
    container.querySelector('.statistics-outcomes')!.textContent,
  ).toContain('淘汰 1 局');
});
