// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useMatchScroll } from '@/components/game/use-match-scroll';
import { RoomResult } from '@/components/game/room-result';
import { GameResult } from '@/components/game/game-result';
import { clientGameReducer, startClientGame } from '../game/client-session';
(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root, node: HTMLDivElement;
beforeEach(() => {
  node = document.createElement('div');
  document.body.append(node);
  root = createRoot(node);
});
afterEach(async () => {
  await act(async () => root.unmount());
  node.remove();
  vi.restoreAllMocks();
});
function Stage({
  stage,
  enabled = true,
  panel = false,
}: {
  stage: string;
  enabled?: boolean;
  panel?: boolean;
}) {
  useMatchScroll(stage, enabled);
  return createElement('p', null, String(panel));
}
it('resets scroll on actual room transitions, not utility rerenders or inactive saves', async () => {
  const scroll = vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  const show = async (stage: string, panel = false, enabled = true) =>
    act(async () =>
      root.render(createElement(Stage, { stage, panel, enabled })),
    );
  await show('42:room_action:0:0');
  expect(scroll).toHaveBeenCalledExactlyOnceWith(0, 0);
  scroll.mockClear();
  await show('42:room_action:0:0', true);
  await show('42:room_action:0:0', false);
  expect(scroll).not.toHaveBeenCalled();
  await show('42:room_action:0:0', false, false);
  await show('42:room_action:0:0', false, true);
  expect(scroll).not.toHaveBeenCalled();
  await show('42:room_result:0:0');
  expect(scroll).toHaveBeenCalledExactlyOnceWith(0, 0);
  scroll.mockClear();
  await show('42:room_action:0:1');
  expect(scroll).toHaveBeenCalledExactlyOnceWith(0, 0);
  scroll.mockClear();
  await show('42:room_result:0:1', false, false);
  expect(scroll).not.toHaveBeenCalled();
});
it('translates award item IDs only in presentation, retaining full names and saved facts', async () => {
  const game = clientGameReducer(startClientGame('isaac', 42), {
    type: 'submit_player_turn',
    turn: {
      playerId: 'human',
      actions: [{ type: 'bid', group: 'A', amount: 25 }],
    },
  });
  if (game.phase !== 'room_result') throw Error('Expected settlement');
  game.roomSettlement!.events.push({
    type: 'award',
    playerId: 'human',
    itemId: 'interest',
    message: '获得道具 interest。',
  });
  for (const profile of Object.values(game.aiProfiles))
    profile.name = '长名称_ABCDEFGHIJKLMNOPQRSTUVWXYZ_不省略事实';
  const before = structuredClone(game);
  await act(async () =>
    root.render(
      createElement(RoomResult, {
        game,
        onShowRanking: () => {},
        onAdvance: () => {},
        scoreDecimals: 4,
      }),
    ),
  );
  expect(node.querySelector('.event-list')!.textContent).toContain(
    '获得道具 利息。',
  );
  expect(node.querySelector('.event-list')!.textContent).not.toContain(
    'interest',
  );
  expect(node.querySelector('.reward-settlement')!.textContent).toContain(
    '长名称_ABCDEFGHIJKLMNOPQRSTUVWXYZ_不省略事实',
  );
  expect(game).toEqual(before);
});
it('labels final ranking columns and retains every player and score', async () => {
  let game: ReturnType<typeof clientGameReducer> = startClientGame('isaac', 42);
  while (game.phase !== 'game_result')
    game = clientGameReducer(
      game,
      game.phase === 'room_action'
        ? {
            type: 'submit_player_turn',
            turn: { playerId: 'human', actions: [{ type: 'withdraw' }] },
          }
        : { type: 'advance_room' },
    );
  const before = structuredClone(game);
  await act(async () =>
    root.render(
      createElement(GameResult, {
        game,
        onRestart: () => {},
        scoreDecimals: 4,
      }),
    ),
  );
  const table = node.querySelector('table[aria-label="整局最终排行"]')!;
  expect(table.querySelectorAll('thead th[scope="col"]')).toHaveLength(8);
  expect(table.querySelectorAll('tbody tr')).toHaveLength(20);
  expect(node.querySelector('.final-actions button')!.textContent).toContain(
    '重新开始',
  );
  expect(game).toEqual(before);
});
