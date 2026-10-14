// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SurvivalReplayViewer } from '@/components/game/survival-replay-viewer';
import {
  startSurvivalGame,
  survivalGameReducer,
} from '../game/survival-session';
import { createSurvivalReplay } from './survival-record';
import * as ai from '../game/survival-ai';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root, container: HTMLDivElement;
function fixture() {
  let game = startSurvivalGame({
    seed: 42,
    characterId: 'isaac',
    cutLines: Array(7).fill(0),
  });
  while (game.phase !== 'competition_complete')
    game = survivalGameReducer(
      game,
      game.phase === 'room_action'
        ? game.activePlayerIds.includes('human')
          ? {
              type: 'submit_player_turn',
              turn: { playerId: 'human', actions: [{ type: 'withdraw' }] },
            }
          : { type: 'submit_ai_room' }
        : {
            type:
              game.phase === 'room_result' ? 'advance_room' : 'advance_floor',
          },
    );
  return createSurvivalReplay(game);
}
const log = fixture();
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
const button = (text: string) => {
  const b = [...container.querySelectorAll<HTMLButtonElement>('button')].find(
    (b) => b.textContent?.trim() === text,
  );
  if (!b) throw new Error('Missing ' + text);
  return b;
};
const click = async (text: string) => act(async () => button(text).click());
const mount = async (value = log) =>
  act(async () =>
    root.render(createElement(SurvivalReplayViewer, { log: value })),
  );
describe('survival replay parity with classic presentation and safe elimination handling', () => {
  it('starts in personal room review, with score chain, market, inventory and grouped events', async () => {
    await mount();
    expect(container.querySelector('.replay-room-panel')).not.toBeNull();
    expect(container.querySelector('.replay-sidebar')).not.toBeNull();
    expect(container.textContent).not.toContain('终局王冠');
    expect(container.querySelector('pre')).toBeNull();
    await click('查看这笔分数的计分过程 +');
    expect(
      container.querySelector('.replay-score-expanded')?.hasAttribute('hidden'),
    ).toBe(false);
    expect(container.textContent).toContain('实际计分取值');
    await click('下一房');
    expect(
      container.querySelector('.replay-selected-heading h3')?.textContent,
    ).toContain('F1-R2');
  });
  it('shows actual dynamic participants, supports inspecting another player and empty eliminated views', async () => {
    await mount();
    await click('全场明细');
    expect(
      container.querySelectorAll('.replay-table tbody tr').length,
    ).toBeGreaterThanOrEqual(20);
    const inspect = container.querySelector<HTMLButtonElement>(
      '.replay-table .replay-player-link',
    )!;
    await act(async () => inspect.click());
    expect(container.querySelector('.replay-room-panel')).not.toBeNull();
    const select = container.querySelector<HTMLSelectElement>(
      '[aria-label="生存回放查看玩家"]',
    )!;
    await act(async () => {
      select.value = 'human';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await click('整局概览');
    const rooms = container.querySelectorAll<HTMLButtonElement>(
      '.replay-table-wrap .replay-player-link',
    );
    await act(async () => rooms[rooms.length - 1]!.click());
    expect(container.textContent).toContain('已淘汰，不参与本房间');
    expect(container.querySelector('.replay-room-panel')).toBeNull();
    await click('全场明细');
    expect(container.textContent).toContain('全场行动与结算');
    await click('个人复盘');
    await click('定位最后参与房间');
    expect(container.querySelector('.replay-room-panel')).not.toBeNull();
  });
  it('provides match charts, one layer settlement selector and the unchanged total board without writes', async () => {
    const spy = vi.spyOn(ai, 'decideSurvivalAiTurn'),
      before = JSON.stringify(log);
    localStorage.setItem('sentinel', 'untouched');
    await mount();
    await click('整局概览');
    expect(
      container.querySelector('.replay-score-timeline svg'),
    ).not.toBeNull();
    expect(
      container.querySelector('.replay-money-timeline svg'),
    ).not.toBeNull();
    expect(container.textContent).toContain('累计新增积分');
    await click('层末结算');
    expect(
      container.querySelector('[aria-label="生存回放结算层"]'),
    ).not.toBeNull();
    expect(container.textContent).toContain('末位补淘汰');
    expect(container.textContent).toContain('距斩杀线');
    await click('生存总榜');
    expect(
      container.querySelectorAll('.survival-board-table tbody tr'),
    ).toHaveLength(20);
    expect(localStorage.length).toBe(1);
    expect(localStorage.getItem('sentinel')).toBe('untouched');
    expect(JSON.stringify(log)).toBe(before);
    expect(spy).not.toHaveBeenCalled();
  });
  it('does not invent future layers, outcomes or a total board for an empty or partial log', async () => {
    const empty = createSurvivalReplay(
      startSurvivalGame({
        seed: 42,
        characterId: 'isaac',
        cutLines: Array(7).fill(0),
      }),
    );
    await mount(empty);
    expect(container.textContent).toContain('还没有已结算房间');
    expect(button('整局概览').disabled).toBe(true);
    expect(button('层末结算').disabled).toBe(true);
    expect(button('生存总榜').disabled).toBe(true);
    expect(container.querySelector('.survival-board-table')).toBeNull();
  });
});
