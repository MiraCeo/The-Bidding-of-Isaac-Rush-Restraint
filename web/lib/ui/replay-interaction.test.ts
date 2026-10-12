// @vitest-environment happy-dom
import { act, createElement, StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GameApp } from '@/components/game/game-app';
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
  const input = element<HTMLInputElement>('input[aria-label="读取回放 JSON"]');
  Object.defineProperty(input, 'files', {
    configurable: true,
    value: [new File([source], 'replay.json', { type: 'application/json' })],
  });
  await act(async () =>
    input.dispatchEvent(new Event('change', { bubbles: true })),
  );
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
  it('groups rooms by floor and switches the three views without changing saved data or AI state', async () => {
    localStorage.setItem(gameSaveKey, serializeGameSave(gameWithRooms(7)));
    await mount();
    const before = localStorage.getItem(gameSaveKey);
    const decide = vi.spyOn(decisions, 'decideAiTurn');
    await click(button('设置', element('nav')));
    await click(button('查看本局回放'));
    expect(container.querySelectorAll('.replay-floor-group')).toHaveLength(2);
    await click(button('整局概览', element('nav[aria-label="回放视图"]')));
    expect(element('.replay-overview-panel').textContent).toContain(
      '结算资金轨迹',
    );
    expect(container.querySelector('.replay-room-panel')).toBeNull();
    const bar = element<HTMLButtonElement>(
      '.replay-trend-bars button[aria-label^="查看F2-R2积分"]',
    );
    await click(bar);
    expect(element('.replay-selected-heading').textContent).toContain('F2-R2');
    expect(container.querySelector('.replay-room-panel')).not.toBeNull();
    await click(button('全场明细', element('nav[aria-label="回放视图"]')));
    expect(
      element('.replay-field-panel .replay-table tbody').querySelectorAll('tr'),
    ).toHaveLength(20);
    await click(button('守夜人', element('.replay-field-panel')));
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
    expect(element('.replay-controls .save-message').textContent).toContain(
      'v2',
    );
    expect(localStorage.getItem(gameSaveKey)).toBe(before);
    await click(button('查看已读取回放'));
    expect(
      element('nav[aria-label="回放房间"]').querySelectorAll('button'),
    ).toHaveLength(1);
  });
  it('puts personal outcomes in the main pane and keeps technical and full-field details collapsed', async () => {
    localStorage.setItem(gameSaveKey, serializeGameSave(gameWithRooms()));
    await mount();
    await click(button('设置', element('nav')));
    await click(button('查看本局回放'));
    expect(element('.replay-sidebar nav[aria-label="回放房间"]')).toBeDefined();
    expect(element('.replay-main .replay-summary-grid').textContent).toContain(
      '实际获得',
    );
    expect(element<HTMLDetailsElement>('.replay-location').open).toBe(false);
    expect(
      element<HTMLDetailsElement>('.replay-calculation-details').open,
    ).toBe(false);
    expect(container.querySelectorAll('.replay-market svg')).toHaveLength(2);
    expect(element('.replay-score-chain').textContent).toContain('最终房分');
    await click(element<HTMLElement>('.replay-calculation-details summary'));
    expect(
      element<HTMLDetailsElement>('.replay-calculation-details').open,
    ).toBe(true);
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
    await click(button('导出完整备份'));
    const backup = parseGameSave(await blob!.text());
    expect(backup.kind).toBe('backup');
    expect(backup.profile).toEqual(profile);
    await click(button('导出续玩存档'));
    expect(parseGameSave(await blob!.text()).profile).toBeUndefined();
    expect(JSON.parse(await blob!.text())).not.toHaveProperty('replay');
  });
  it('does not replace profile data while previewing a backup or loading a checkpoint', async () => {
    const profile = createPlayerProfile();
    profile.progression.statistics.futureWins = 4;
    localStorage.setItem(playerProfileKey, JSON.stringify(profile));
    await mount();
    await click(button('设置', element('nav')));
    const input = element<HTMLInputElement>(
      'input[aria-label="读取 JSON 存档"]',
    );
    async function uploadSave(source: string) {
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
    await click(button('取消读取'));
    await uploadSave(serializeGameCheckpoint(gameWithRooms(1)));
    await click(button('载入此存档'));
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
    await click(button('查看最近完成对局'));
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
    expect(element('.replay-controls .save-message').textContent).toContain(
      '校验',
    );
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
    expect(button('查看本局回放').disabled).toBe(true);
    expect(button('导出回放 JSON').disabled).toBe(true);
    expect(
      element<HTMLInputElement>('input[aria-label="读取回放 JSON"]'),
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
    await click(button('查看本局回放'));
    expect(element('#room-utilities-title').textContent).toBe('逐房回放');
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
    await click(element<HTMLInputElement>('.replay-toggle input'));
    expect(element('.replay-events-grid').textContent).toContain('提交与结算');
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
    expect(element('.replay-identity').textContent).toContain('00000309');
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
    expect(element('#room-utilities-title').textContent).toBe('逐房回放');
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
    expect(element('.replay-controls .save-message').textContent).toContain(
      '保持不变',
    );
    expect(localStorage.getItem(gameSaveKey)).toBe(before);
    await click(button('查看已读取回放'));
    expect(element('.replay-identity').textContent).toContain('00000309');
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
    await click(button('导出回放 JSON'));
    expect(download).toHaveBeenCalledOnce();
    expect(fetch).not.toHaveBeenCalled();
    const doc = parseReplay(await blob!.text());
    expect(doc.replay.rooms).toHaveLength(2);
    expect(doc.replay.rooms[0]!.settlement.turns).toHaveLength(20);
    expect(doc.replay).not.toHaveProperty('draft');
  });
  it('shows a selectable feedback locator even when clipboard access is unavailable', async () => {
    localStorage.setItem(gameSaveKey, serializeGameSave(gameWithRooms()));
    await mount();
    await click(button('设置', element('nav')));
    await click(button('查看本局回放'));
    vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(
      new Error('blocked'),
    );
    await click(button('复制房间定位'));
    expect(element('.replay-page-content .save-message').textContent).toContain(
      '手动复制',
    );
    expect(element<HTMLInputElement>('#replay-locator').value).toMatch(
      /^ISAAC-.*\/F1-R1#[0-9a-f]{8}$/,
    );
    expect(element<HTMLInputElement>('#replay-locator').readOnly).toBe(true);
  });
  it('restores historical records on refresh and shows final ranking without a restart or advance button', async () => {
    localStorage.setItem(gameSaveKey, serializeGameSave(gameWithRooms(15)));
    await mount();
    const before = localStorage.getItem(gameSaveKey)!;
    await click(button('设置', element('nav')));
    await click(button('查看本局回放'));
    const roomButtons = element(
      'nav[aria-label="回放房间"]',
    ).querySelectorAll<HTMLButtonElement>('button');
    expect(roomButtons).toHaveLength(15);
    await click(roomButtons[14]!);
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
