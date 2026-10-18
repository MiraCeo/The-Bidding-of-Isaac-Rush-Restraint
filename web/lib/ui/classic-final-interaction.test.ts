// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { it, expect, beforeEach, afterEach, vi } from 'vitest';
import { GameResult } from '@/components/game/game-result';
import { GameApp } from '@/components/game/game-app';
import { createGameSession, reduceGameSession } from './game-session';
import { serializeGameCheckpoint, gameSaveKey } from './game-save';
(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root, node: HTMLDivElement;
beforeEach(() => {
  localStorage.clear();
  node = document.createElement('div');
  document.body.append(node);
  root = createRoot(node);
});
afterEach(async () => {
  await act(async () => root.unmount());
  node.remove();
  vi.restoreAllMocks();
});
const show = async (v: Parameters<Root['render']>[0]) =>
  act(async () => root.render(v));
const click = async (e: HTMLElement) => act(async () => e.click());
const button = (s: string) => {
  const b = [...node.querySelectorAll<HTMLButtonElement>('button')].find(
    (b) => b.textContent?.trim() === s,
  );
  if (!b) throw Error(s);
  return b;
};
function completed() {
  let s = reduceGameSession(createGameSession(42), {
    type: 'start_game',
    characterId: 'isaac',
  });
  while (s.game.phase !== 'game_result') {
    s = reduceGameSession(
      s,
      s.game.phase === 'room_action'
        ? {
            type: 'submit_player_turn',
            turn: { playerId: 'human', actions: [{ type: 'withdraw' }] },
          }
        : { type: 'advance_room' },
    );
  }
  return s;
}
it('keeps recorded final order, full table and compact podium at selected precision, without invoking restart while reading', async () => {
  const s = completed(),
    game = s.game,
    before = structuredClone(game),
    restart = vi.fn();
  if (game.phase !== 'game_result') throw Error('final');
  await show(
    createElement(GameResult, {
      game,
      onRestart: restart,
      embedded: true,
      scoreDecimals: 4,
    }),
  );
  expect(node.querySelectorAll('h2')).toHaveLength(1);
  const rows = [...node.querySelectorAll<HTMLElement>('tbody tr')];
  expect(rows).toHaveLength(20);
  expect(rows.map((r) => r.dataset.playerId)).toEqual(
    game.finalRanking.map((r) => r.playerId),
  );
  for (const [i, row] of rows.entries()) {
    const entry = game.finalRanking[i]!,
      p = game.players.find((p) => p.id === entry.playerId)!;
    expect(row.children[0]!.textContent).toBe(String(i + 1));
    expect(row.querySelector('.ranking-metric-primary')!.textContent).toBe(
      entry.finalScore.toFixed(4),
    );
    expect(row.children[3]!.textContent).toBe(String(p.money));
    expect(row.children[4]!.textContent).toBe(String(p.items.length));
  }
  expect(
    [...node.querySelectorAll('.podium-card>strong')].map((e) => e.textContent),
  ).toEqual(game.finalRanking.slice(0, 3).map((e) => e.finalScore.toFixed(4)));
  const own = game.finalRanking.find((e) => e.playerId === 'human')!;
  expect(node.querySelector('[data-classic-final-score]')!.textContent).toBe(
    own.finalScore.toFixed(4),
  );
  const self = node.querySelector<HTMLElement>('[data-ranking-self="true"]')!,
    scroll = vi.fn();
  Object.defineProperty(self, 'scrollIntoView', { value: scroll });
  await click(button('定位本人'));
  expect(document.activeElement).toBe(self);
  expect(scroll).toHaveBeenCalledOnce();
  expect(restart).not.toHaveBeenCalled();
  expect(game).toEqual(before);
  await click(button('重新开始'));
  expect(restart).toHaveBeenCalledOnce();
});
it('retains terminal phase through build/replay/settings navigation and moves real restart to the summary', async () => {
  const s = completed();
  localStorage.setItem(gameSaveKey, serializeGameCheckpoint(s));
  await show(createElement(GameApp));
  const before = localStorage.getItem(gameSaveKey);
  expect(node.querySelector('.topbar .settlement-status')).not.toBeNull();
  expect(node.querySelector('.page-context-bar')).toBeNull();
  expect(node.querySelector('.settled-toolbar')).toBeNull();
  expect(node.querySelector('.classic-final-lifecycle')!.textContent).toContain(
    '返回主菜单',
  );
  for (const name of ['查看构筑', '本局回放']) {
    await click(button(name));
    await click(button('返回游戏'));
    expect(localStorage.getItem(gameSaveKey)).toBe(before);
  }
  await click(button('设置'));
  await click(button('游戏'));
  expect(localStorage.getItem(gameSaveKey)).toBe(before);
  await click(button('重新开始'));
  expect(node.textContent).toContain('选择角色');
});
