// @vitest-environment happy-dom
import { decodedDownload } from './file-export.test-helper';
import { act, createElement, StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ClassicGameApp as GameApp } from '@/components/game/classic-game-app';
import { createGameSession, reduceGameSession } from './game-session';
import {
  parseGameSave,
  serializeGameCheckpoint,
  serializeGameBackup,
  persistGameSession,
  gameSaveKey,
  lastCompletedKey,
} from './game-save';
import { serializeSessionFixture as serializeGameSave } from './save-fixture.test-helper';
import { createPlayerProfile, playerProfileKey } from './player-profile';
import { parseReplay, serializeReplay } from './game-replay';
import { readBuildVersion } from './game-version';
import * as decisions from '../game/ai-decision';

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
  vi.restoreAllMocks();
});
function element<T extends Element>(selector: string): T {
  const value = container.querySelector<T>(selector);
  if (!value) throw new Error(`Missing ${selector}`);
  return value;
}
function button(label: string, scope: Element = container): HTMLButtonElement {
  const value = Array.from(scope.querySelectorAll('button')).find(
    (b) => b.textContent?.trim() === label,
  );
  if (!value) throw new Error(`Missing ${label}`);
  return value;
}
async function click(target: HTMLElement) {
  await act(async () => target.click());
}
async function mount() {
  await act(async () =>
    root.render(createElement(StrictMode, null, createElement(GameApp))),
  );
}
function gameWithRooms(count = 2, seed = 42) {
  let session = reduceGameSession(createGameSession(seed), {
    type: 'start_game',
    characterId: 'jacob_esau',
  });
  for (let i = 0; i < count; i++) {
    session = reduceGameSession(session, {
      type: 'submit_player_turn',
      turn: {
        playerId: 'human',
        actions: [{ type: 'bid', group: 'A', amount: 1 }],
      },
    });
    session = reduceGameSession(session, { type: 'advance_room' });
  }
  return session;
}
async function upload(source: string) {
  const entry = Array.from(container.querySelectorAll('button')).find(
    (b) => b.textContent?.trim() === '导入文件',
  );
  if (entry) await click(entry);
  const input = element<HTMLInputElement>('input[aria-label="导入对局文件"]');
  Object.defineProperty(input, 'files', {
    configurable: true,
    value: [new File([source], 'replay.json', { type: 'application/json' })],
  });
  await act(async () =>
    input.dispatchEvent(new Event('change', { bubbles: true })),
  );
  // Reading only previews. This helper explicitly confirms a valid replay as the user would.
  const open = Array.from(
    container.querySelectorAll('.data-candidate button'),
  ).find((b) => b.textContent?.trim() === '打开回放');
  if (open) await click(open as HTMLButtonElement);
}
async function changeSelect(value: string) {
  const select = element<HTMLSelectElement>(
    'select[aria-label="回放查看玩家"]',
  );
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLSelectElement.prototype,
      'value',
    )!.set!.call(select, value);
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

describe('read-only replay UI', () => {
  it('keeps reference-time changes inside match overview and moves to personal view only on an explicit point', async () => {
    localStorage.setItem(gameSaveKey, serializeGameSave(gameWithRooms(7)));
    await mount();
    const before = localStorage.getItem(gameSaveKey),
      decide = vi.spyOn(decisions, 'decideAiTurn');
    await click(button('设置', element('nav')));
    await click(button('查看回放'));
    await click(button('全场明细', element('nav[aria-label="本房视图"]')));
    expect(container.querySelector('.replay-score-timeline')).toBeNull();
    expect(container.querySelector('.replay-money-timeline')).toBeNull();
    await click(button('整局概览', element('nav[aria-label="回放范围"]')));
    const select = element<HTMLSelectElement>(
      'select[aria-label="走势参考房间"]',
    );
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLSelectElement.prototype,
        'value',
      )!.set!.call(select, '6');
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(element('.replay-selected-heading h3').textContent).toBe(
      '整局概览 · 你',
    );
    expect(
      element('.replay-timeline-leaderboard header').textContent,
    ).toContain('F2-R2');
    expect(container.querySelector('nav[aria-label="回放房间"]')).toBeNull();
    expect(container.querySelector('.replay-trend-bars')).toBeNull();
    await act(async () =>
      element('.replay-money-point[aria-label^="查看F2-R2"]').dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'Enter',
          bubbles: true,
          cancelable: true,
        }),
      ),
    );
    expect(element('.replay-selected-heading h3').textContent).toContain(
      'F2-R2',
    );
    expect(document.activeElement).toBe(element('.replay-selected-heading h3'));
    expect(decide).not.toHaveBeenCalled();
    expect(localStorage.getItem(gameSaveKey)).toBe(before);
  });
  it('measures the compact toolbar and positions navigation content below it without default focus scrolling', async () => {
    localStorage.setItem(gameSaveKey, serializeGameSave(gameWithRooms(2)));
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 1000,
      bottom: 86,
      width: 1000,
      height: 86,
      toJSON() {},
    });
    const scroll = vi.spyOn(HTMLElement.prototype, 'scrollIntoView');
    await mount();
    await click(button('设置', element('nav')));
    await click(button('查看回放'));
    expect(element('.replay-main').getAttribute('style')).toContain(
      '--replay-toolbar-height: 86px',
    );
    expect(
      element('.replay-selected-heading .replay-step-controls'),
    ).toBeDefined();
    expect(container.querySelector('.replay-toolbar .eyebrow')).toBeNull();
    await click(button('下一房'));
    expect(scroll).toHaveBeenLastCalledWith({
      block: 'start',
      behavior: 'instant',
    });
    expect(document.activeElement).toBe(element('.replay-selected-heading h3'));
  });
  it('renders one cumulative series per player over real room progression instead of a player-ranking polyline', async () => {
    const game = gameWithRooms(7);
    localStorage.setItem(gameSaveKey, serializeGameSave(game));
    await mount();
    await click(button('设置', element('nav')));
    await click(button('查看回放'));
    await click(button('全场明细', element('nav[aria-label="本房视图"]')));
    expect(
      container.querySelector('.replay-comparison-svg polyline'),
    ).toBeNull();
    expect(container.querySelectorAll('.replay-comparison-bar')).toHaveLength(
      20,
    );
    expect(container.querySelector('.replay-score-timeline')).toBeNull();
    await click(button('整局概览', element('nav[aria-label="回放范围"]')));
    const paths = container.querySelectorAll('.replay-player-series');
    expect(paths).toHaveLength(20);
    for (const path of paths)
      expect(path.getAttribute('d')!.match(/ L /g)).toHaveLength(7);
    expect(element('.replay-score-timeline').textContent).toContain(
      '横轴是房间进程',
    );
    expect(element('.replay-timeline-svg').textContent).not.toContain('F2-R3');
    expect(
      container.querySelectorAll('.replay-timeline-leaderboard li'),
    ).toHaveLength(20);
  });
  it('filters and focuses cumulative lines then inspects a real historical room without AI or storage writes', async () => {
    localStorage.setItem(gameSaveKey, serializeGameSave(gameWithRooms(7)));
    await mount();
    const before = localStorage.getItem(gameSaveKey),
      decide = vi.spyOn(decisions, 'decideAiTurn');
    await click(button('设置', element('nav')));
    await click(button('查看回放'));
    await click(button('整局概览', element('nav[aria-label="回放范围"]')));
    await click(
      element<HTMLInputElement>('input[aria-label="显示纸冠的积分线"]'),
    );
    expect(container.querySelectorAll('.replay-player-series')).toHaveLength(
      19,
    );
    await click(button('显示全部', element('.replay-score-timeline')));
    expect(container.querySelectorAll('.replay-player-series')).toHaveLength(
      20,
    );
    await click(button('仅看关注', element('.replay-score-timeline')));
    expect(container.querySelectorAll('.replay-player-series')).toHaveLength(1);
    await click(
      element<HTMLElement>('button[aria-label="关注守夜人的积分走势"]'),
    );
    expect(
      element('.replay-player-series').getAttribute('data-player-id'),
    ).toBe('ai-1');
    await act(async () =>
      element(
        '.replay-timeline-inspect-point[aria-label^="查看守夜人在F2-R2"]',
      ).dispatchEvent(
        new MouseEvent('click', { bubbles: true, cancelable: true }),
      ),
    );
    expect(element('.replay-selected-heading').textContent).toContain('F2-R2');
    expect(element('.replay-selected-heading').textContent).toContain('守夜人');
    expect(container.querySelector('.replay-room-panel')).not.toBeNull();
    expect(document.activeElement).toBe(element('.replay-selected-heading h3'));
    expect(decide).not.toHaveBeenCalled();
    expect(localStorage.getItem(gameSaveKey)).toBe(before);
  });
  it('combines both eligibility guides into each target canvas and preserves distinct paired positions', async () => {
    const game = gameWithRooms(2),
      r = game.replay!.rooms[0]!;
    localStorage.setItem(gameSaveKey, serializeGameSave(game));
    await mount();
    await click(button('设置', element('nav')));
    await click(button('查看回放'));
    const plots = container.querySelectorAll('.replay-market svg');
    expect(plots).toHaveLength(2);
    for (const plot of plots)
      expect(plot.querySelectorAll('.market-cooperation')).toHaveLength(1);
    expect(
      container.querySelectorAll('.replay-market [data-marker="market"]'),
    ).toHaveLength(r.settlement.baseline!.participantCount);
    const different = r.settlement.resolvedActions.filter(
      (a) =>
        a.marketEquivalent !== null &&
        a.scoringEquivalent !== null &&
        a.marketEquivalent !== a.scoringEquivalent,
    );
    expect(different.length).toBeGreaterThan(0);
    expect(container.querySelectorAll('.market-equivalence-link')).toHaveLength(
      different.length,
    );
    expect(
      container.querySelectorAll('.market-cooperation-marker'),
    ).toHaveLength(different.length);
  });
  it('separates whole-match scope from room navigation and restores the current room view', async () => {
    localStorage.setItem(gameSaveKey, serializeGameSave(gameWithRooms(7)));
    await mount();
    const saved = localStorage.getItem(gameSaveKey),
      decide = vi.spyOn(decisions, 'decideAiTurn');
    await click(button('设置', element('nav')));
    await click(button('查看回放'));
    await click(button('下一房'));
    await click(button('全场明细', element('nav[aria-label="本房视图"]')));
    await click(button('整局概览', element('nav[aria-label="回放范围"]')));
    expect(container.querySelector('.replay-sidebar')).toBeNull();
    expect(container.querySelector('nav[aria-label="本房视图"]')).toBeNull();
    expect(element('.replay-selected-heading').textContent).not.toContain(
      'F1-R2',
    );
    expect(container.querySelectorAll('.replay-money-point')).toHaveLength(7);
    expect(
      container.querySelectorAll('.replay-timeline-inspect-point'),
    ).toHaveLength(7);
    expect(
      container.querySelectorAll('.replay-floor-totals article'),
    ).toHaveLength(2);
    expect(element('.replay-toolbar').textContent).not.toContain('上一房');
    await click(button('本房复盘', element('nav[aria-label="回放范围"]')));
    expect(element('.replay-selected-heading').textContent).toContain('F1-R2');
    expect(container.querySelector('.replay-field-panel')).not.toBeNull();
    expect(decide).not.toHaveBeenCalled();
    expect(localStorage.getItem(gameSaveKey)).toBe(saved);
  });
  it('embeds score explanation, exposes room-end inventory and puts reward allocation only in field detail', async () => {
    const game = gameWithRooms(2),
      recorded = game.replay!.rooms[0]!;
    localStorage.setItem(gameSaveKey, serializeGameSave(game));
    await mount();
    await click(button('设置', element('nav')));
    await click(button('查看回放'));
    expect(
      element('.replay-score-toggle').closest('.replay-score-hero'),
    ).not.toBeNull();
    expect(container.querySelector('.replay-score-section')).toBeNull();
    expect(container.querySelector('.replay-reward-destinations')).toBeNull();
    expect(element('.replay-owned-items').closest('details')).toBeNull();
    expect(element('.replay-owned-items').textContent).toContain(
      '本房结算后快照',
    );
    expect(
      container.querySelectorAll(
        '.replay-owned-items .replay-inventory-chips > span',
      ),
    ).toHaveLength(
      new Set(recorded.settlement.players[0]!.items.map((i) => i.itemId)).size,
    );
    expect(
      container.querySelectorAll(
        '.replay-market [data-market-chart="combined"]',
      ),
    ).toHaveLength(2);
    expect(
      container.querySelectorAll('.replay-market .market-cooperation'),
    ).toHaveLength(2);
    expect(element('.market-own-actions').textContent).toContain(
      '实际计分取值',
    );
    await click(button('全场明细', element('nav[aria-label="本房视图"]')));
    expect(
      container.querySelectorAll('.replay-reward-groups > article'),
    ).toHaveLength(2);
    expect(
      container.querySelectorAll('.replay-award-recipients button'),
    ).toHaveLength(recorded.settlement.awards.length);
    expect(container.querySelector('.replay-score-hero')).toBeNull();
  });
  it('plots 20 factual player bars, changes units and retains the field metric on the next room', async () => {
    const game = gameWithRooms(2);
    localStorage.setItem(gameSaveKey, serializeGameSave(game));
    await mount();
    await click(button('设置', element('nav')));
    await click(button('查看回放'));
    const saved = localStorage.getItem(gameSaveKey),
      decide = vi.spyOn(decisions, 'decideAiTurn');
    await click(button('全场明细', element('nav[aria-label="本房视图"]')));
    expect(container.querySelectorAll('.replay-comparison-svg a')).toHaveLength(
      20,
    );
    expect(element('.replay-field-chart').textContent).toContain('不是时间');
    expect(
      container.querySelector('.replay-comparison-svg polyline'),
    ).toBeNull();
    expect(container.querySelectorAll('.replay-comparison-bar')).toHaveLength(
      20,
    );
    await click(
      button('结算资金', element('fieldset[aria-label="全场图表指标"]')),
    );
    expect(element('.replay-chart-readout b').textContent).toBe(
      String(game.replay!.rooms[0]!.settlement.players[0]!.money),
    );
    await click(button('下一房'));
    expect(element('.replay-selected-heading').textContent).toContain('F1-R2');
    expect(
      button(
        '结算资金',
        element('fieldset[aria-label="全场图表指标"]'),
      ).getAttribute('aria-pressed'),
    ).toBe('true');
    expect(element('.replay-chart-readout b').textContent).toBe(
      String(game.replay!.rooms[1]!.settlement.players[0]!.money),
    );
    expect(decide).not.toHaveBeenCalled();
    expect(localStorage.getItem(gameSaveKey)).toBe(saved);
  });
  it('supports mouse and keyboard point selection into the same room personal review', async () => {
    localStorage.setItem(gameSaveKey, serializeGameSave(gameWithRooms(2)));
    await mount();
    await click(button('设置', element('nav')));
    await click(button('查看回放'));
    await click(button('全场明细', element('nav[aria-label="本房视图"]')));
    await act(async () =>
      element(
        '.replay-comparison-svg a[aria-label^="查看守夜人"]',
      ).dispatchEvent(
        new MouseEvent('click', { bubbles: true, cancelable: true }),
      ),
    );
    expect(element('.replay-selected-heading').textContent).toContain('F1-R1');
    expect(element('.replay-selected-heading').textContent).toContain('守夜人');
    expect(container.querySelector('.replay-room-panel')).not.toBeNull();
    await click(button('全场明细', element('nav[aria-label="本房视图"]')));
    await act(async () =>
      element('.replay-comparison-svg a[aria-label^="查看纸冠"]').dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'Enter',
          bubbles: true,
          cancelable: true,
        }),
      ),
    );
    expect(element('.replay-selected-heading').textContent).toContain('纸冠');
    expect(document.activeElement).toBe(element('.replay-selected-heading h3'));
    expect(
      element<HTMLSelectElement>('select[aria-label="回放查看玩家"]').value,
    ).toBe('ai-2');
  });
  it('groups rooms by floor and switches the three views without changing saved data or AI state', async () => {
    localStorage.setItem(gameSaveKey, serializeGameSave(gameWithRooms(7)));
    await mount();
    const before = localStorage.getItem(gameSaveKey);
    const decide = vi.spyOn(decisions, 'decideAiTurn');
    await click(button('设置', element('nav')));
    await click(button('查看回放'));
    expect(container.querySelectorAll('.replay-floor-group')).toHaveLength(2);
    await click(button('整局概览', element('nav[aria-label="回放范围"]')));
    expect(element('.replay-overview-panel').textContent).toContain(
      '结算资金走势',
    );
    expect(container.querySelector('.replay-room-panel')).toBeNull();
    const point = element('.replay-money-point[aria-label^="查看F2-R2资金"]');
    await act(async () =>
      point.dispatchEvent(
        new MouseEvent('click', { bubbles: true, cancelable: true }),
      ),
    );
    expect(element('.replay-selected-heading').textContent).toContain('F2-R2');
    expect(container.querySelector('.replay-room-panel')).not.toBeNull();
    await click(button('全场明细', element('nav[aria-label="本房视图"]')));
    expect(
      element('.replay-field-panel .replay-table tbody').querySelectorAll('tr'),
    ).toHaveLength(20);
    await click(button('守夜人', element('.replay-field-table-section')));
    expect(element('.replay-selected-heading').textContent).toContain('守夜人');
    expect(
      element<HTMLSelectElement>('select[aria-label="回放查看玩家"]').value,
    ).toBe('ai-1');
    expect(decide).not.toHaveBeenCalled();
    expect(localStorage.getItem(gameSaveKey)).toBe(before);
  });
  it('rejects old v1 files without overwriting an active game or imported replay', async () => {
    localStorage.setItem(gameSaveKey, serializeGameSave(gameWithRooms(2)));
    await mount();
    const before = localStorage.getItem(gameSaveKey);
    await click(button('设置', element('nav')));
    const source = serializeReplay(gameWithRooms(1).replay!, 'known-v2');
    await upload(source);
    await click(button('设置', element('nav')));
    await upload(
      JSON.stringify({
        format: 'the-bidding-of-isaac-replay',
        version: 1,
        replay: gameWithRooms(1).replay,
      }),
    );
    expect(
      element('.game-settings-content .data-message').textContent,
    ).toContain('v2');
    expect(localStorage.getItem(gameSaveKey)).toBe(before);
    await click(button('返回设置'));
    await click(button('查看对局'));
    expect(
      element('nav[aria-label="回放房间"]').querySelectorAll('button'),
    ).toHaveLength(1);
  });
  it('puts personal outcomes in the main pane and keeps technical and full-field details collapsed', async () => {
    localStorage.setItem(gameSaveKey, serializeGameSave(gameWithRooms()));
    await mount();
    await click(button('设置', element('nav')));
    await click(button('查看回放'));
    expect(element('.replay-sidebar nav[aria-label="回放房间"]')).toBeDefined();
    expect(element('.replay-main .replay-summary-grid').textContent).toContain(
      '实际获得',
    );
    expect(container.querySelector('.replay-location')).toBeNull();
    expect(element('.replay-score-hero .replay-score-toggle')).toBeDefined();
    expect(element('.replay-owned-items').textContent).toContain(
      '本房结算后快照',
    );
    expect(element<HTMLElement>('.replay-calculation-details').hidden).toBe(
      true,
    );
    expect(container.querySelectorAll('.replay-market svg')).toHaveLength(2);
    expect(element('.replay-score-chain').textContent).toContain('最终房分');
    await click(element<HTMLElement>('.replay-score-toggle'));
    expect(element<HTMLElement>('.replay-calculation-details').hidden).toBe(
      false,
    );
    expect(element('.replay-calculation-details').parentElement).toBe(
      element('.replay-summary-grid'),
    );
    await click(button('收起', element('.replay-calculation-details')));
    expect(document.activeElement).toBe(element('.replay-score-toggle'));
  });
  it('exports progression reserves in full backup and leaves them out of the lightweight continuation file', async () => {
    const profile = createPlayerProfile(new Date('2026-10-12'));
    profile.progression.modules.future = {
      unlockConditions: ['complete-a-floor'],
    };
    profile.progression.achievements.test = { achievedAt: null, progress: 0.4 };
    localStorage.setItem(playerProfileKey, JSON.stringify(profile));
    localStorage.setItem(gameSaveKey, serializeGameSave(gameWithRooms()));
    await mount();
    await click(button('设置', element('nav')));
    let blob: Blob | undefined;
    vi.spyOn(URL, 'createObjectURL').mockImplementation((v) => {
      blob = v as Blob;
      return 'blob:backup';
    });
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    await click(button('完整备份'));
    await click(button('导出完整备份'));
    const backup = parseGameSave(await decodedDownload(() => blob));
    expect(backup.kind).toBe('backup');
    expect(backup.profile).toEqual(profile);
    await click(button('导出存档'));
    expect(
      parseGameSave(await decodedDownload(() => blob)).profile,
    ).toBeUndefined();
    expect(JSON.parse(await decodedDownload(() => blob))).not.toHaveProperty(
      'replay',
    );
  });
  it('does not replace profile data while previewing a backup or loading a checkpoint', async () => {
    const profile = createPlayerProfile();
    profile.progression.statistics.futureWins = 4;
    localStorage.setItem(playerProfileKey, JSON.stringify(profile));
    await mount();
    await click(button('设置', element('nav')));
    async function uploadSave(source: string) {
      const entry = Array.from(container.querySelectorAll('button')).find(
        (b) => b.textContent?.trim() === '导入文件',
      );
      if (entry) await click(entry);
      const input = element<HTMLInputElement>(
        'input[aria-label="导入对局文件"]',
      );
      Object.defineProperty(input, 'files', {
        configurable: true,
        value: [new File([source], 'save.json')],
      });
      await act(async () =>
        input.dispatchEvent(new Event('change', { bubbles: true })),
      );
    }
    const incoming = createPlayerProfile();
    incoming.progression.modules.newTree = { unlocked: true };
    await uploadSave(serializeGameBackup(gameWithRooms(1), incoming));
    expect(localStorage.getItem(playerProfileKey)).toBe(
      JSON.stringify(profile),
    );
    await click(button('取消'));
    await uploadSave(serializeGameCheckpoint(gameWithRooms(1)));
    await click(button('载入这局'));
    expect(localStorage.getItem(playerProfileKey)).toBe(
      JSON.stringify(profile),
    );
  });
  it('opens the separately archived completed game after restart without reviving it as an active match', async () => {
    persistGameSession(localStorage, gameWithRooms(15));
    persistGameSession(localStorage, createGameSession(19));
    const archive = localStorage.getItem(lastCompletedKey);
    await mount();
    await click(button('设置', element('nav')));
    await click(button('查看对局'));
    expect(element('.replay-main').textContent).toContain('最终房间积分');
    expect(localStorage.getItem(gameSaveKey)).toBeNull();
    expect(localStorage.getItem(lastCompletedKey)).toBe(archive);
    await click(button('返回游戏'));
    expect(container.textContent).toContain('选择角色');
  });
  it('does not navigate back to replay when file reading finishes after the user left settings', async () => {
    const source = serializeReplay(gameWithRooms(1).replay!, 'file-build');
    await mount();
    await click(button('设置', element('nav')));
    let resolveRead!: (value: string) => void;
    const reading = new Promise<string>((resolve) => {
      resolveRead = resolve;
    });
    vi.spyOn(File.prototype, 'text').mockReturnValue(reading);
    await upload(source);
    expect(
      element('.game-settings-content .data-message').textContent,
    ).toContain('校验');
    await click(button('游戏', element('nav')));
    await act(async () => {
      resolveRead(source);
      await reading;
    });
    expect(container.querySelector('#room-utilities-title')).toBeNull();
    expect(container.textContent).toContain('选择角色');
    expect(localStorage.getItem(gameSaveKey)).toBeNull();
  });
  it('provides a home-page file entry without starting a game, while current replay remains disabled', async () => {
    await mount();
    await click(button('设置', element('nav')));
    expect(
      Array.from(container.querySelectorAll('button')).some(
        (b) => b.textContent?.trim() === '查看回放',
      ),
    ).toBe(false);
    expect(
      Array.from(container.querySelectorAll('button')).some(
        (b) => b.textContent?.trim() === '导出回放',
      ),
    ).toBe(false);
    expect(
      element<HTMLInputElement>('input[aria-label="导入对局文件"]'),
    ).toBeDefined();
    expect(
      container.querySelectorAll('nav[aria-label="主导航"] button'),
    ).toHaveLength(4);
    expect(localStorage.getItem(gameSaveKey)).toBeNull();
  });
  it('visits published room snapshots and another player without generating AI or modifying the current draft', async () => {
    const session = gameWithRooms();
    session.draft!.amounts.A.bid = 17;
    localStorage.setItem(gameSaveKey, serializeGameSave(session));
    await mount();
    const originalInput = element<HTMLInputElement>(
      'input[aria-label="竞拍奖励 A 的数值"]',
    );
    const stored = localStorage.getItem(gameSaveKey)!;
    const decide = vi.spyOn(decisions, 'decideAiTurn');
    await click(button('设置', element('nav')));
    await click(button('查看回放'));
    expect(element('#room-utilities-title').textContent).toBe('对局回放');
    expect(element('.replay-selected-heading').textContent).toContain('F1-R1');
    expect(
      element('nav[aria-label="回放房间"]').querySelectorAll('button'),
    ).toHaveLength(2);
    expect(button('上一房').disabled).toBe(true);
    await click(button('下一房'));
    expect(element('.replay-selected-heading').textContent).toContain('F1-R2');
    expect(button('下一房').disabled).toBe(true);
    await changeSelect('ai-1');
    expect(element('.replay-selected-heading').textContent).toContain('守夜人');
    await click(button('全场明细', element('nav[aria-label="本房视图"]')));
    await click(
      element<HTMLElement>('.replay-field-panel .replay-event-details summary'),
    );
    expect(element('.replay-player-events').textContent).toContain(
      '提交与结算',
    );
    expect(decide).not.toHaveBeenCalled();
    expect(localStorage.getItem(gameSaveKey)).toBe(stored);
    await click(button('返回游戏'));
    expect(element('input[aria-label="竞拍奖励 A 的数值"]')).toBe(
      originalInput,
    );
    expect(originalInput.value).toBe('17');
    expect(parseGameSave(stored).session.game.phase).toBe('room_action');
  });
  it('imports another game for viewing without replacing or saving over the live game', async () => {
    localStorage.setItem(gameSaveKey, serializeGameSave(gameWithRooms(2, 11)));
    await mount();
    const before = localStorage.getItem(gameSaveKey)!;
    await click(button('设置', element('nav')));
    await upload(
      serializeReplay(gameWithRooms(1, 777).replay!, 'external-build'),
    );
    expect(element('.replay-source-tabs').textContent).toContain('文件只读');
    expect(
      element('.replay-identity').getAttribute('data-replay-id'),
    ).toContain('00000309');
    expect(
      element('nav[aria-label="回放房间"]').querySelectorAll('button'),
    ).toHaveLength(1);
    await click(button('本局记录'));
    expect(
      element('nav[aria-label="回放房间"]').querySelectorAll('button'),
    ).toHaveLength(2);
    expect(localStorage.getItem(gameSaveKey)).toBe(before);
    await click(button('读取的回放文件'));
    await act(async () =>
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
      ),
    );
    expect(element('.round-status').textContent).toContain('房间 3/5');
    expect(localStorage.getItem(gameSaveKey)).toBe(before);
  });
  it('opens an imported replay before choosing a character and returns to the unchanged home page', async () => {
    await mount();
    await click(
      element<HTMLInputElement>('input[name="character"][value="lost"]'),
    );
    await click(button('设置', element('nav')));
    await upload(serializeReplay(gameWithRooms(1).replay!, 'import-build'));
    expect(element('#room-utilities-title').textContent).toBe('对局回放');
    expect(localStorage.getItem(gameSaveKey)).toBeNull();
    await click(button('返回游戏'));
    expect(
      element<HTMLInputElement>('input[name="character"][value="lost"]')
        .checked,
    ).toBe(true);
    expect(container.textContent).toContain('选择角色');
  });
  it('keeps both the valid imported replay and game intact when another file fails validation', async () => {
    localStorage.setItem(gameSaveKey, serializeGameSave(gameWithRooms()));
    await mount();
    const before = localStorage.getItem(gameSaveKey)!;
    await click(button('设置', element('nav')));
    await upload(
      serializeReplay(gameWithRooms(1, 777).replay!, 'import-build'),
    );
    await click(button('设置', element('nav')));
    const corrupt = JSON.parse(
      serializeReplay(gameWithRooms(1).replay!, 'corrupt'),
    );
    corrupt.replay.initialPlayers[0].money = -1;
    await upload(JSON.stringify(corrupt));
    expect(
      element('.game-settings-content .data-message').textContent,
    ).toContain('保持不变');
    expect(localStorage.getItem(gameSaveKey)).toBe(before);
    await click(button('返回设置'));
    await click(button('查看对局'));
    expect(
      element('.replay-identity').getAttribute('data-replay-id'),
    ).toContain('00000309');
  });
  it('downloads the actual recorded replay as a separate blob with no network requests', async () => {
    localStorage.setItem(gameSaveKey, serializeGameSave(gameWithRooms()));
    await mount();
    await click(button('设置', element('nav')));
    let blob: Blob | undefined;
    vi.spyOn(URL, 'createObjectURL').mockImplementation((value) => {
      blob = value as Blob;
      return 'blob:replay-test';
    });
    const download = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => {});
    const fetch = vi.spyOn(globalThis, 'fetch');
    await click(button('查看回放'));
    await click(button('导出此回放'));
    const source = await decodedDownload(() => blob);
    expect(download).toHaveBeenCalledOnce();
    expect(fetch).not.toHaveBeenCalled();
    const doc = parseReplay(source);
    expect(doc.replay.rooms).toHaveLength(2);
    expect(doc.replay.rooms[0]!.settlement.turns).toHaveLength(20);
    expect(doc.replay).not.toHaveProperty('draft');
  });
  it('removes locator and build UI without removing identity from the exported replay', async () => {
    localStorage.setItem(gameSaveKey, serializeGameSave(gameWithRooms()));
    await mount();
    await click(button('设置', element('nav')));
    await click(button('查看回放'));
    const clipboard = vi
      .spyOn(navigator.clipboard, 'writeText')
      .mockRejectedValue(new Error('blocked'));
    expect(container.querySelector('#replay-locator')).toBeNull();
    expect(container.querySelector('.replay-location')).toBeNull();
    expect(element('.replay-page-content').textContent).not.toContain('构建：');
    expect(clipboard).not.toHaveBeenCalled();
    let blob: Blob | undefined;
    vi.spyOn(URL, 'createObjectURL').mockImplementation((v) => {
      blob = v as Blob;
      return 'blob:replay';
    });
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    await click(button('导出此回放'));
    expect(
      parseReplay(await decodedDownload(() => blob)).replay.rooms[0]!.locator,
    ).toMatch(/^ISAAC-.*\/F1-R1#[0-9a-f]{8}$/);
  });
  it('restores historical records on refresh and shows final ranking without a restart or advance button', async () => {
    localStorage.setItem(gameSaveKey, serializeGameSave(gameWithRooms(15)));
    await mount();
    const before = localStorage.getItem(gameSaveKey)!;
    await click(button('设置', element('nav')));
    await click(button('查看对局', element('[data-record-source="current"]')));
    const roomButtons = element(
      'nav[aria-label="回放房间"]',
    ).querySelectorAll<HTMLButtonElement>('button');
    expect(roomButtons).toHaveLength(15);
    await click(roomButtons[14]!);
    expect(container.querySelector('.replay-final-ranking')).toBeNull();
    await click(button('整局概览', element('nav[aria-label="回放范围"]')));
    expect(container.textContent).toContain('整局终局倍率与排行');
    expect(element('.replay-page-content').textContent).not.toContain(
      '重新开始',
    );
    expect(element('.replay-page-content').textContent).not.toContain(
      '进入下一房间',
    );
    expect(localStorage.getItem(gameSaveKey)).toBe(before);
  });
  it('reads actual offline build metadata instead of guessing the bundle version', () => {
    const meta = document.createElement('meta');
    meta.name = 'bidding-offline-build';
    meta.content = '0.1.0-deadbeef1234';
    document.head.append(meta);
    try {
      expect(readBuildVersion()).toBe('0.1.0-deadbeef1234');
    } finally {
      meta.remove();
    }
  });
});
