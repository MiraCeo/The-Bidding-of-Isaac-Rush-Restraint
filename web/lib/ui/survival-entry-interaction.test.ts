// @vitest-environment happy-dom
import { act, createElement, StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GameApp } from '@/components/game/game-app';
import {
  startSurvivalClient,
  reduceSurvivalClient,
  activeModeKey,
  survivalEntryCutLines,
  type SurvivalClientSession,
} from './survival-client';
import {
  serializeSurvivalCheckpoint,
  parseSurvivalCheckpoint,
  serializeSurvivalReplay,
  survivalSaveKey,
  survivalLastCompletedKey,
} from './survival-persistence';
import { createSurvivalReplay } from './survival-record';
import { createGameSession, reduceGameSession } from './game-session';
import { gameSaveKey, serializeGameCheckpoint } from './game-save';
import { playerProfileKey, createPlayerProfile } from './player-profile';
import { serializeReplay } from './game-replay';
import * as preferenceStorage from './game-preferences';
import * as kernel from '../game/survival-session';
import * as ai from '../game/ai-decision';
import { serializeSurvivalBackup } from './survival-backup';
import { SurvivalDataManagement } from '@/components/game/survival-data-management';
import { notifyPlayerProfileChanged } from './profile-events';
import { serializeGameBackup } from './game-save';

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
it.each(['classic', 'survival'] as const)(
  'protects the survival file picker against a stale %s profile preview',
  async (mode) => {
    const onImport = vi.fn(),
      session = startSurvivalClient('isaac', 42);
    await act(async () =>
      root.render(
        createElement(SurvivalDataManagement, {
          session,
          imported: null,
          onImport,
          onReplay: vi.fn(),
        }),
      ),
    );
    const incoming = createPlayerProfile();
    const classic = reduceGameSession(createGameSession(70), {
      type: 'start_game',
      characterId: 'isaac',
    });
    await upload(
      mode === 'classic'
        ? serializeGameBackup(classic, incoming)
        : serializeSurvivalBackup(session.game, session.draft, incoming),
    );
    await click(
      node<HTMLInputElement>('.data-candidate input[type="checkbox"]'),
    );
    const changed = JSON.stringify(createPlayerProfile());
    localStorage.setItem(playerProfileKey, changed);
    await act(async () => notifyPlayerProfileChanged());
    const label = mode === 'classic' ? '确认载入经典对局' : '载入生存对局';
    expect(button(label).disabled).toBe(true);
    expect(container.textContent).toContain('预览后本机玩家档案已变化');
    await click(button(label));
    expect(onImport).not.toHaveBeenCalled();
    await click(button('重新核对本机档案'));
    expect(
      node<HTMLInputElement>('.data-candidate input[type="checkbox"]').checked,
    ).toBe(false);
    await click(
      node<HTMLInputElement>('.data-candidate input[type="checkbox"]'),
    );
    await click(button(label));
    expect(onImport).toHaveBeenCalledWith(
      expect.anything(),
      true,
      changed,
      expect.any(AbortSignal),
    );
  },
);
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.restoreAllMocks();
});
function node<T extends Element = HTMLElement>(selector: string): T {
  const value = container.querySelector<T>(selector);
  if (!value) throw new Error('Missing ' + selector);
  return value;
}
function button(label: string, scope: Element = container) {
  const found = [...scope.querySelectorAll<HTMLButtonElement>('button')].find(
    (b) => b.textContent?.trim() === label,
  );
  if (!found) throw new Error('Missing ' + label);
  return found;
}
const click = async (element: HTMLElement) => {
  await act(async () => element.click());
};
const mount = async () => {
  await act(async () =>
    root.render(createElement(StrictMode, null, createElement(GameApp))),
  );
};
async function start() {
  await mount();
  await click(button('生存模式'));
  await click(node<HTMLInputElement>('input[value="isaac"]'));
  await click(button('开始游戏'));
}
function seeded(session = startSurvivalClient('isaac', 42)) {
  localStorage.setItem(activeModeKey, 'survival');
  localStorage.setItem(
    survivalSaveKey,
    serializeSurvivalCheckpoint(session.game, session.draft),
  );
  return session;
}
function withdraw(session: SurvivalClientSession) {
  return reduceSurvivalClient(session, {
    type: 'submit_player_turn',
    turn: { playerId: 'human', actions: [{ type: 'withdraw' }] },
  });
}
async function upload(source: string) {
  const input = node<HTMLInputElement>('input[type="file"]');
  Object.defineProperty(input, 'files', {
    configurable: true,
    value: [new File([source], 'input.json')],
  });
  await act(async () =>
    input.dispatchEvent(new Event('change', { bubbles: true })),
  );
}
async function settings() {
  await click(button('进度', node('nav[aria-label="主导航"]')));
  await click(button('存档与备份'));
}

describe('formal independent survival entry', () => {
  it('cancelling a pending file chooser clears reading state and invalidates the older read', async () => {
    seeded();
    await mount();
    await settings();
    const source = serializeSurvivalCheckpoint(
      startSurvivalClient('lost', 99).game,
    );
    let finish!: (source: string) => void;
    const file = new File(['pending'], 'pending.json');
    Object.defineProperty(file, 'text', {
      value: () =>
        new Promise<string>((resolve) => {
          finish = resolve;
        }),
    });
    const input = node<HTMLInputElement>('input[type="file"]');
    Object.defineProperty(input, 'files', {
      configurable: true,
      value: [file],
    });
    await act(async () =>
      input.dispatchEvent(new Event('change', { bubbles: true })),
    );
    expect(container.textContent).toContain('正在验证文件');
    Object.defineProperty(input, 'files', { configurable: true, value: [] });
    await act(async () =>
      input.dispatchEvent(new Event('change', { bubbles: true })),
    );
    expect(container.textContent).not.toContain('正在验证文件');
    await act(async () => finish(source));
    expect(container.querySelector('.data-candidate')).toBeNull();
    expect(
      parseSurvivalCheckpoint(localStorage.getItem(survivalSaveKey)!).game.seed,
    ).toBe(42);
  });
  it('settings mounted before AI completion exposes the completed replay without reopening settings', async () => {
    let completed = startSurvivalClient('isaac', 42);
    while (completed.game.phase !== 'competition_complete')
      completed = reduceSurvivalClient(
        completed,
        completed.game.phase === 'room_action'
          ? completed.game.activePlayerIds.includes('human')
            ? {
                type: 'submit_player_turn',
                turn: { playerId: 'human', actions: [{ type: 'withdraw' }] },
              }
            : { type: 'submit_ai_room' }
          : {
              type:
                completed.game.phase === 'room_result'
                  ? 'advance_room'
                  : 'advance_floor',
            },
      );
    const onReplay = vi.fn(),
      onImport = vi.fn(),
      render = (session: SurvivalClientSession) =>
        root.render(
          createElement(SurvivalDataManagement, {
            session,
            imported: null,
            onReplay,
            onImport,
          }),
        );
    await act(async () => render(startSurvivalClient('lost', 99)));
    expect(container.textContent).not.toContain('查看最近完成的生存回放');
    await act(async () => render(completed));
    await click(button('查看最近完成的生存回放'));
    expect(onReplay).toHaveBeenCalledTimes(1);
    expect(onReplay.mock.calls[0]![0].replay.seed).toBe(42);
    expect(onReplay.mock.calls[0]![0].replay.final.ranking).toEqual(
      completed.game.finalRanking,
    );
  });
  it('explicit backup profile restore failure keeps the original match and profile with an actionable error', async () => {
    seeded();
    const original = createPlayerProfile();
    localStorage.setItem(playerProfileKey, JSON.stringify(original));
    await mount();
    await settings();
    const before = localStorage.getItem(survivalSaveKey),
      incoming = createPlayerProfile();
    incoming.progression.statistics.example = 123;
    await upload(
      serializeSurvivalBackup(
        startSurvivalClient('lost', 99).game,
        null,
        incoming,
      ),
    );
    await click(
      node<HTMLInputElement>('.data-candidate input[type="checkbox"]'),
    );
    vi.spyOn(preferenceStorage, 'getPreferenceStorage').mockReturnValue({
      getItem: (key: string) => localStorage.getItem(key),
      setItem: (key: string, value: string) => {
        if (key === playerProfileKey) throw new Error('quota');
        localStorage.setItem(key, value);
      },
      removeItem: (key: string) => localStorage.removeItem(key),
    } as unknown as Storage);
    await click(button('载入生存对局'));
    expect(container.textContent).toContain('已恢复原存储');
    expect(localStorage.getItem(survivalSaveKey)).toBe(before);
    expect(JSON.parse(localStorage.getItem(playerProfileKey)!)).toEqual(
      original,
    );
    expect(button('载入生存对局')).toBeTruthy();
  });
  it('same-seed checkpoint import resets stale replay UI and restores the incoming room and difficulty', async () => {
    seeded();
    await mount();
    await settings();
    const incoming = withdraw(startSurvivalClient('lost', 42, 'easy'));
    await upload(serializeSurvivalCheckpoint(incoming.game));
    await click(button('载入生存对局'));
    expect(
      container.querySelector('.settlement-status-facts')?.textContent,
    ).toContain('难度简单');
    expect(container.querySelector('.survival-replay')).toBeNull();
    expect(button('积分排行')).toBeTruthy();
    expect(
      parseSurvivalCheckpoint(localStorage.getItem(survivalSaveKey)!).game
        .selectedCharacter,
    ).toBe('lost');
  });
  it('import success does not hide later auto-save failure', async () => {
    seeded();
    await mount();
    await settings();
    await upload(
      serializeSurvivalCheckpoint(startSurvivalClient('lost', 99).game),
    );
    await click(button('载入生存对局'));
    const before = localStorage.getItem(survivalSaveKey);
    vi.spyOn(preferenceStorage, 'getPreferenceStorage').mockReturnValue({
      getItem: (key: string) => localStorage.getItem(key),
      setItem: () => {
        throw new Error('quota');
      },
      removeItem: () => {},
    } as unknown as Storage);
    await click(button('出价竞拍'));
    expect(container.textContent).toContain('自动保存失败');
    expect(localStorage.getItem(survivalSaveKey)).toBe(before);
  });
  it('returns a classic replay to its survival source without switching the active marker or losing draft', async () => {
    seeded();
    let classic = reduceGameSession(createGameSession(77), {
      type: 'start_game',
      characterId: 'lost',
    });
    classic = reduceGameSession(classic, {
      type: 'submit_player_turn',
      turn: { playerId: 'human', actions: [{ type: 'withdraw' }] },
    });
    await mount();
    await settings();
    const before = localStorage.getItem(survivalSaveKey);
    await upload(serializeReplay(classic.replay!, 'p0-test'));
    await click(button('确认打开回放'));
    await click(button('返回进度'));
    await click(button('返回游戏'));
    expect(container.querySelector('[aria-label="房间行动区"]')).not.toBeNull();
    expect(
      node<HTMLInputElement>('input[aria-label="竞拍奖励 A 的数值"]').value,
    ).toBe('250');
    expect(localStorage.getItem(activeModeKey)).toBe('survival');
    expect(localStorage.getItem(survivalSaveKey)).toBe(before);
  });
  it('returns a survival replay to the classic settings where it was opened', async () => {
    await mount();
    await click(button('经典模式'));
    await settings();
    await click(button('导入文件'));
    await upload(
      serializeSurvivalReplay(
        createSurvivalReplay(withdraw(startSurvivalClient('isaac', 42)).game),
      ),
    );
    await click(button('打开生存回放'));
    expect(container.textContent).toContain('生存事实回放');
    await click(button('返回进度'));
    expect(container.textContent).toContain('设置');
    expect(container.querySelector('.survival-replay')).toBeNull();
    expect(localStorage.getItem(activeModeKey)).toBe('classic');
  });
  it('failed checkpoint deletion does not abandon the match and then resurrect an older game on refresh', async () => {
    seeded();
    await mount();
    const before = localStorage.getItem(survivalSaveKey);
    vi.spyOn(preferenceStorage, 'getPreferenceStorage').mockReturnValue({
      getItem: (key: string) => localStorage.getItem(key),
      setItem: (key: string, value: string) => localStorage.setItem(key, value),
      removeItem: () => {
        throw new Error('blocked');
      },
    } as unknown as Storage);
    await click(button('重新选角'));
    await click(button('确认重新开始'));
    expect(container.textContent).toContain('未放弃当前局');
    expect(button('出价竞拍')).toBeTruthy();
    expect(localStorage.getItem(survivalSaveKey)).toBe(before);
  });
  it('routes the two result buttons to distinct room tabs, with a separate live survival tab', async () => {
    const session = withdraw(startSurvivalClient('isaac', 42, 'highest'));
    seeded(session);
    await mount();
    const before = localStorage.getItem(survivalSaveKey);
    await click(button('积分排行'));
    expect(node('[role="tab"][aria-selected="true"]').textContent).toBe(
      '积分排行',
    );
    expect(node('.survival-utility h2').textContent).toBe('排行');
    expect(node('.survival-utility .ranking-table').textContent).toContain(
      '本房积分',
    );
    expect(
      container.querySelector('.survival-utility .survival-board-table'),
    ).toBeNull();
    await click(button('返回游戏'));
    await click(button('争夺榜'));
    expect(node('[role="tab"][aria-selected="true"]').textContent).toBe(
      '争夺榜',
    );
    expect(node('.survival-utility h2').textContent).toBe('排行');
    expect(
      container.querySelectorAll('.survival-utility .contest-panel'),
    ).toHaveLength(2);
    const survivalTab = [
      ...container.querySelectorAll<HTMLButtonElement>('[role="tab"]'),
    ].find((t) => t.textContent === '生存榜')!;
    await click(survivalTab);
    expect(node('.survival-board-table thead').textContent).toContain(
      '玩家状态累计分数第 1 层进行中',
    );
    for (const player of session.game.players) {
      const row = node(`[data-player-id="${player.id}"]`),
        score = session.game.currentFloorRoomScores[player.id]!.reduce(
          (sum, n) => sum + n,
          0,
        ).toFixed(2);
      expect(row.querySelector('[data-floor="0"] strong')?.textContent).toBe(
        score,
      );
      expect(row.querySelector('[data-total] strong')?.textContent).toBe(score);
    }
    expect(localStorage.getItem(survivalSaveKey)).toBe(before);
    await click(button('进入下一房间', node('.survival-ranking-actions')));
    expect(container.querySelector('.survival-utility')).toBeNull();
    expect(node('[aria-label="房间行动区"]')).toBeTruthy();
  });
  it('opens the live board from navigation before submitting and disables hidden room outcomes', async () => {
    seeded();
    await mount();
    await click(button('排行', node('nav')));
    expect(
      node('.survival-board-table tbody').querySelectorAll('tr'),
    ).toHaveLength(20);
    const tabs = container.querySelectorAll<HTMLButtonElement>('[role="tab"]');
    expect(tabs[0]!.disabled).toBe(true);
    expect(tabs[1]!.disabled).toBe(true);
    expect(tabs[2]!.getAttribute('aria-selected')).toBe('true');
    expect(container.querySelector('.contest-panel')).toBeNull();
    await click(button('返回游戏'));
    expect(
      node<HTMLInputElement>('input[aria-label="竞拍奖励 A 的数值"]').value,
    ).toBe('250');
  });
  it('offers four tiers, defaults to standard and locks the selected tier after start', async () => {
    await mount();
    await click(button('生存模式'));
    const radios = container.querySelectorAll<HTMLInputElement>(
      '.survival-difficulty-options input',
    );
    expect([...radios].find((r) => r.checked)!.value).toBe('standard');
    expect([...radios].map((r) => r.parentElement!.textContent)).toEqual([
      '简单',
      '标准',
      '困难',
      '最高',
    ]);
    await click(
      node<HTMLInputElement>('.survival-difficulty-options input[value=easy]'),
    );
    await click(button('返回主菜单'));
    await click(button('生存模式'));
    expect(
      node<HTMLInputElement>('.survival-difficulty-options input:checked')
        .value,
    ).toBe('easy');
    await click(node<HTMLInputElement>('input[value="isaac"]'));
    await click(button('开始游戏'));
    expect(container.querySelector('.survival-difficulty-options')).toBeNull();
    expect(container.textContent).toContain('难度 简单');
    expect(
      parseSurvivalCheckpoint(localStorage.getItem(survivalSaveKey)!).game
        .aiDifficulty,
    ).toBe('easy');
  });
  it('restores saved difficulty without silently upgrading it to the new default', async () => {
    seeded(startSurvivalClient('lost', 42, 'highest'));
    await mount();
    expect(container.textContent).toContain('难度 最高');
    expect(
      parseSurvivalCheckpoint(localStorage.getItem(survivalSaveKey)!).game
        .aiDifficulty,
    ).toBe('highest');
  });
  it('never offers survival difficulty in classic selection', async () => {
    await mount();
    await click(button('经典模式'));
    expect(container.querySelector('[aria-label="生存AI难度设置"]')).toBeNull();
    const picker = node<HTMLElement>('.classic-difficulty-picker');
    expect(picker.querySelectorAll('input[type="radio"]')).toHaveLength(4);
    expect(picker.querySelector<HTMLInputElement>('input:checked')!.value).toBe(
      'highest',
    );
  });
  it('opens three entries without starting a world, and tutorial remains isolated', async () => {
    const spy = vi.spyOn(kernel, 'startSurvivalGame');
    await mount();
    expect(container.textContent).toContain('选择你的竞合方式');
    expect(button('经典模式')).toBeTruthy();
    expect(button('生存模式')).toBeTruthy();
    expect(spy).not.toHaveBeenCalled();
    await click(button('新手教程'));
    expect(container.textContent).toContain('独立');
    expect(spy).not.toHaveBeenCalled();
    expect(localStorage.getItem(survivalSaveKey)).toBeNull();
  });
  it('opens survival selection without generating a match and explains Eden exclusions', async () => {
    const spy = vi.spyOn(kernel, 'startSurvivalGame');
    await mount();
    await click(button('生存模式'));
    expect(container.textContent).toContain('不含福袋与黑王子之冠');
    expect(button('开始游戏').disabled).toBe(true);
    expect(spy).not.toHaveBeenCalled();
    await click(button('返回主菜单'));
    expect(container.textContent).toContain('选择你的竞合方式');
  });
  it('starts the fixed preset, keeps 20 players and creates only the first floor', async () => {
    await start();
    const doc = parseSurvivalCheckpoint(localStorage.getItem(survivalSaveKey)!);
    expect(doc.game.mode).toBe('survival');
    expect(doc.game.players).toHaveLength(20);
    expect(doc.game.rooms).toHaveLength(1);
    expect(doc.game.cutLines).toEqual([...survivalEntryCutLines]);
    expect(node('.survival-status').textContent).toContain('斩杀线 200');
    expect(doc.game.rules.floorStartingMoney).toBe(1000);
    expect(
      node('.page-context-bar .status-chip-money strong').textContent,
    ).toBe(String(doc.game.players[0]!.money));
  });
  it('preserves the same draft across settings, main menu, classic and refresh', async () => {
    const session = seeded();
    session.draft!.amounts.A.bid = 333;
    localStorage.setItem(
      survivalSaveKey,
      serializeSurvivalCheckpoint(session.game, session.draft),
    );
    await mount();
    expect(
      node<HTMLInputElement>('input[aria-label="竞拍奖励 A 的数值"]').value,
    ).toBe('333');
    await settings();
    await click(button('游戏', node('nav')));
    await click(button('返回主菜单'));
    await click(button('经典模式'));
    expect(container.textContent).toContain('选择角色');
    await click(button('返回主菜单'));
    await click(button('继续生存模式'));
    expect(
      node<HTMLInputElement>('input[aria-label="竞拍奖励 A 的数值"]').value,
    ).toBe('333');
    await act(async () => root.unmount());
    root = createRoot(container);
    await mount();
    expect(
      node<HTMLInputElement>('input[aria-label="竞拍奖励 A 的数值"]').value,
    ).toBe('333');
  });
  it('keeps existing classic autosave and opens it without a mode marker', async () => {
    const classic = reduceGameSession(createGameSession(99), {
      type: 'start_game',
      characterId: 'lost',
    });
    localStorage.setItem(gameSaveKey, serializeGameCheckpoint(classic));
    await mount();
    const source = localStorage.getItem(gameSaveKey);
    expect(container.textContent).toContain('房间');
    await click(button('返回主菜单'));
    await click(button('生存模式'));
    expect(localStorage.getItem(gameSaveKey)).toBe(source);
  });
  it('shows survival-only rules and a crown-free build without NaN', async () => {
    seeded();
    await mount();
    await click(button('规则', node('nav')));
    expect(container.textContent).toContain('S = R');
    await click(button('道具图鉴', node('.rules-tabs')));
    expect(container.querySelectorAll('.rule-item-card')).toHaveLength(25);
    await click(button('玩法规则', node('.rules-tabs')));
    expect(container.textContent).toContain('不提供黑王子之冠');
    await click(button('游戏', node('nav[aria-label="主导航"]')));
    await click(node('[aria-label="查看构筑与当前状态"]'));
    expect(container.textContent).not.toContain('终局王冠倍率');
    expect(container.textContent).not.toContain('NaN');
  });
  it('shows a living human the floor components and advances into a fresh 1000-base layer', async () => {
    let session = startSurvivalClient('isaac', 42);
    for (let i = 0; i < 5; i++) {
      const amount = Math.floor(session.game.players[0]!.money / (5 - i));
      session = reduceSurvivalClient(session, {
        type: 'submit_player_turn',
        turn: {
          playerId: 'human',
          actions: [{ type: 'bid', group: i % 2 ? 'B' : 'A', amount }],
        },
      });
      if (i < 4)
        session = reduceSurvivalClient(session, { type: 'advance_room' });
    }
    seeded(session);
    await mount();
    await click(button('查看层末结算'));
    expect(container.textContent).toContain('层末生存结算');
    expect(container.textContent).toContain('余额兑换');
    expect(container.textContent).toContain('继承分');
    const doc = parseSurvivalCheckpoint(localStorage.getItem(survivalSaveKey)!);
    expect(doc.game.activePlayerIds).toContain('human');
    expect(
      doc.game.floorRecords[0]!.plan.eliminations.length,
    ).toBeGreaterThanOrEqual(2);
    await click(button('进入下一层'));
    const next = parseSurvivalCheckpoint(
      localStorage.getItem(survivalSaveKey)!,
    );
    expect(next.game.floorIndex).toBe(1);
    expect(next.game.players[0]!.characterFloorStartingMoney).toBe(1100);
    expect(container.querySelector('.game-stage')).not.toBeNull();
  });
  it('previews v4 imports, cancellation does not replace the current checkpoint', async () => {
    seeded();
    await mount();
    await settings();
    const before = localStorage.getItem(survivalSaveKey);
    await upload(
      serializeSurvivalCheckpoint(startSurvivalClient('lost', 99).game),
    );
    expect(container.textContent).toContain('续玩检查点');
    expect(localStorage.getItem(survivalSaveKey)).toBe(before);
    await click(button('取消'));
    expect(localStorage.getItem(survivalSaveKey)).toBe(before);
  });
  it('loads a confirmed survival checkpoint, retaining independent classic data', async () => {
    seeded();
    const classic = reduceGameSession(createGameSession(55), {
      type: 'start_game',
      characterId: 'lost',
    });
    localStorage.setItem(gameSaveKey, serializeGameCheckpoint(classic));
    await mount();
    await settings();
    const classicBefore = localStorage.getItem(gameSaveKey);
    await upload(
      serializeSurvivalCheckpoint(startSurvivalClient('lost', 99).game),
    );
    await click(button('载入生存对局'));
    expect(
      parseSurvivalCheckpoint(localStorage.getItem(survivalSaveKey)!).game.seed,
    ).toBe(99);
    expect(localStorage.getItem(gameSaveKey)).toBe(classicBefore);
  });
  it('reads factual replay without AI execution, replacement or profile registration', async () => {
    seeded();
    const recorded = withdraw(startSurvivalClient('lost', 99));
    await mount();
    await settings();
    const before = localStorage.getItem(survivalSaveKey);
    const profile = localStorage.getItem(playerProfileKey);
    const spy = vi.spyOn(ai, 'decideAiTurn');
    await upload(serializeSurvivalReplay(createSurvivalReplay(recorded.game)));
    expect(spy).not.toHaveBeenCalled();
    await click(button('打开生存回放'));
    expect(container.textContent).toContain('生存事实回放');
    expect(container.textContent).toContain('不重新运行 AI');
    expect(localStorage.getItem(survivalSaveKey)).toBe(before);
    expect(localStorage.getItem(playerProfileKey)).toBe(profile);
    expect(spy).not.toHaveBeenCalled();
    await click(button('返回进度'));
    await click(button('返回游戏'));
    expect(container.querySelector('.game-stage')).not.toBeNull();
  });
  it('preserves corrupted survival storage while selection remains usable', async () => {
    localStorage.setItem(activeModeKey, 'survival');
    localStorage.setItem(survivalSaveKey, 'broken');
    await mount();
    await click(button('生存模式'));
    expect(localStorage.getItem(survivalSaveKey)).toBe('broken');
    expect(container.textContent).toContain('未读取');
    await click(node<HTMLInputElement>('input[value="isaac"]'));
    await click(button('开始游戏'));
    expect(
      parseSurvivalCheckpoint(localStorage.getItem(survivalSaveKey)!).game.mode,
    ).toBe('survival');
  });
  it('keeps backup profile restoration off by default', async () => {
    seeded();
    const profile = createPlayerProfile();
    profile.progression.statistics.example = 123;
    await mount();
    await settings();
    const before = localStorage.getItem(playerProfileKey);
    await upload(
      serializeSurvivalBackup(
        startSurvivalClient('lost', 99).game,
        null,
        profile,
      ),
    );
    const checkbox = node<HTMLInputElement>(
      '.data-candidate input[type="checkbox"]',
    );
    expect(checkbox.checked).toBe(false);
    await click(button('载入生存对局'));
    expect(localStorage.getItem(playerProfileKey)).toBe(before);
    expect(
      parseSurvivalCheckpoint(localStorage.getItem(survivalSaveKey)!).game.seed,
    ).toBe(99);
  });
  it('imports v4 through the classic settings preview without touching classic progress', async () => {
    await mount();
    await click(button('经典模式'));
    await settings();
    await click(button('导入文件'));
    await upload(
      serializeSurvivalCheckpoint(startSurvivalClient('lost', 99).game),
    );
    expect(container.textContent).toContain('续玩检查点');
    await click(button('载入生存对局'));
    expect(
      parseSurvivalCheckpoint(localStorage.getItem(survivalSaveKey)!).game.seed,
    ).toBe(99);
    expect(container.querySelector('.game-stage')).not.toBeNull();
  });
  it('switches to an explicitly imported classic checkpoint without deleting survival', async () => {
    seeded();
    const classic = reduceGameSession(createGameSession(77), {
      type: 'start_game',
      characterId: 'lost',
    });
    await mount();
    await settings();
    const before = localStorage.getItem(survivalSaveKey);
    await upload(serializeGameCheckpoint(classic));
    await click(button('确认载入经典对局'));
    expect(localStorage.getItem(activeModeKey)).toBe('classic');
    expect(container.textContent).toContain('游魂');
    expect(localStorage.getItem(survivalSaveKey)).toBe(before);
    await click(button('返回主菜单'));
    await click(button('继续生存模式'));
    expect(node('.survival-status')).toBeTruthy();
  });
  it('opens a classic replay from survival as read-only and returns to the saved survival match', async () => {
    seeded();
    let classic = reduceGameSession(createGameSession(77), {
      type: 'start_game',
      characterId: 'lost',
    });
    classic = reduceGameSession(classic, {
      type: 'submit_player_turn',
      turn: { playerId: 'human', actions: [{ type: 'withdraw' }] },
    });
    await mount();
    await settings();
    const before = localStorage.getItem(survivalSaveKey);
    await upload(serializeReplay(classic.replay!, 'entry-ui-test'));
    await click(button('确认打开回放'));
    expect(container.textContent).toContain('文件只读查看，不替换当前对局');
    expect(localStorage.getItem(survivalSaveKey)).toBe(before);
    expect(localStorage.getItem(playerProfileKey)).toBeNull();
    await click(button('返回主菜单'));
    await click(button('继续生存模式'));
    expect(node('.survival-status')).toBeTruthy();
  });
  it('requires explicit restart confirmation and clears only the survival checkpoint', async () => {
    seeded();
    await mount();
    const before = localStorage.getItem(survivalSaveKey);
    await click(button('重新选角'));
    expect(node('dialog').textContent).toContain('结束当前对局');
    await click(button('取消'));
    expect(localStorage.getItem(survivalSaveKey)).toBe(before);
    await click(button('重新选角'));
    await click(button('确认重新开始'));
    expect(container.textContent).toContain('选择角色');
    expect(localStorage.getItem(survivalSaveKey)).toBeNull();
    await act(async () => root.unmount());
    root = createRoot(container);
    await mount();
    expect(container.textContent).toContain('选择你的竞合方式');
  });
  it('applies explicitly checked backup profile restoration', async () => {
    seeded();
    const profile = createPlayerProfile();
    profile.progression.statistics.example = 123;
    await mount();
    await settings();
    await upload(
      serializeSurvivalBackup(
        startSurvivalClient('lost', 99).game,
        null,
        profile,
      ),
    );
    await click(
      node<HTMLInputElement>('.data-candidate input[type="checkbox"]'),
    );
    await click(button('载入生存对局'));
    expect(JSON.parse(localStorage.getItem(playerProfileKey)!)).toEqual(
      profile,
    );
  });
  it('reports storage failure while allowing the current survival game to continue in memory', async () => {
    vi.spyOn(preferenceStorage, 'getPreferenceStorage').mockReturnValue({
      getItem: () => null,
      removeItem: () => {},
      setItem: () => {
        throw new Error('quota');
      },
    } as unknown as Storage);
    await start();
    expect(container.textContent).toContain('当前仅在本页运行');
    expect(container.querySelector('.game-stage')).not.toBeNull();
    expect(button('出价竞拍').disabled).toBe(false);
  });
  it('carries human elimination through AI completion, preserving frozen personal facts and a full total board', async () => {
    vi.useFakeTimers();
    let session = startSurvivalClient('isaac', 42);
    for (let i = 0; i < 5; i++) {
      session = withdraw(session);
      if (i < 4)
        session = reduceSurvivalClient(session, { type: 'advance_room' });
    }
    seeded(session);
    await mount();
    await click(button('查看层末结算'));
    expect(container.textContent).toContain('个人结果已冻结');
    let doc = parseSurvivalCheckpoint(localStorage.getItem(survivalSaveKey)!);
    const frozen = structuredClone(doc.game.players[0]);
    for (let i = 0; i < 80 && doc.game.phase !== 'competition_complete'; i++) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(30);
      });
      doc = parseSurvivalCheckpoint(localStorage.getItem(survivalSaveKey)!);
    }
    expect(doc.game.phase).toBe('competition_complete');
    expect(doc.game.finalRanking).toHaveLength(20);
    expect(doc.game.players[0]).toEqual(frozen);
    expect(
      doc.game.roomRecords
        .slice(5)
        .every((record) =>
          record.turns.every((turn) => turn.playerId !== 'human'),
        ),
    ).toBe(true);
    expect(container.textContent).toContain('你的最终名次');
    expect(
      container.querySelectorAll('.survival-board-table tbody tr'),
    ).toHaveLength(20);
    expect(localStorage.getItem(survivalLastCompletedKey)).not.toBeNull();
  }, 30000);
});
