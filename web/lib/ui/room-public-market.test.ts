// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { RoomResult } from '@/components/game/room-result';
import {
  startClientGame,
  clientGameReducer,
  getCurrentRoom,
  type ActiveClientGameState,
} from '../game/client-session';
import { settleRuntimeRoom } from '../game/room-engine';
import { defaultRules } from '../game/config';
import { createSeededRandom } from '../game/random';
import type { PlayerTurn } from '../game/item-types';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root, node: HTMLDivElement;
beforeEach(() => {
  node = document.createElement('div');
  document.body.append(node);
  root = createRoot(node);
  localStorage.clear();
});
afterEach(async () => {
  await act(async () => root.unmount());
  node.remove();
});
const mount = async (
  game: ActiveClientGameState,
  onAdvance = vi.fn(),
  onShowRanking = vi.fn(),
) =>
  act(async () =>
    root.render(createElement(RoomResult, { game, onAdvance, onShowRanking })),
  );

it('expands only already-settled shared market data and preserves both score semantics and all results', async () => {
  const game = clientGameReducer(startClientGame('isaac', 42), {
    type: 'submit_player_turn',
    turn: {
      playerId: 'human',
      actions: [{ type: 'bid', group: 'A', amount: 25 }],
    },
  });
  if (game.phase !== 'room_result') throw Error('Expected settled room');
  const before = structuredClone(game),
    advance = vi.fn(),
    ranking = vi.fn();
  await mount(game, advance, ranking);
  const details = node.querySelector<HTMLDetailsElement>(
      '.result-market-details',
    )!,
    summary = details.querySelector('summary')!;
  expect(details.open).toBe(false);
  expect(details.querySelector('svg')).toBeNull();
  await act(async () => {
    summary.click();
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
  expect(details.open).toBe(true);
  expect(details.querySelectorAll('[data-market-chart=combined]')).toHaveLength(
    2,
  );
  expect(details.textContent).toContain('高价看实心位置，合作区看空心位置');
  expect(details.textContent).toContain('以原结算记录为准');
  expect(details.textContent).toContain(
    String(Number(game.roomSettlement!.baseline!.target.toFixed(4))),
  );
  expect(game).toEqual(before);
  expect(localStorage.length).toBe(0);
  expect(advance).not.toHaveBeenCalled();
  expect(ranking).not.toHaveBeenCalled();
  await act(async () => {
    summary.click();
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
  expect(details.querySelector('svg')).toBeNull();
});
it('explains an all-withdraw room without fabricating a baseline or plot', async () => {
  const game = startClientGame('isaac', 42),
    room = getCurrentRoom(game);
  const turns: PlayerTurn[] = game.players.map((p) => ({
    playerId: p.id,
    actions: [{ type: 'withdraw' }],
  }));
  const settlement = {
    ...settleRuntimeRoom(
      room,
      game.players,
      turns,
      defaultRules,
      createSeededRandom(42),
    ),
    room,
    turns,
    playersBefore: game.players,
  };
  await mount({
    ...game,
    phase: 'room_result',
    players: settlement.players,
    roomSettlement: settlement,
  });
  await act(async () => {
    node.querySelector<HTMLElement>('.result-market-details summary')!.click();
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
  expect(node.querySelector('.result-market-details')!.textContent).toContain(
    '全场观望',
  );
  expect(node.querySelector('.result-market-details svg')).toBeNull();
});
