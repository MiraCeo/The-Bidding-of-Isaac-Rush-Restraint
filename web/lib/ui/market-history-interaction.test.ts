// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { MarketImpactPreview } from '@/components/game/market-impact-preview';
import { GameApp } from '@/components/game/game-app';
import { getQuoteCapacity } from './quote-capacity';
import { selectMarketHistory } from './market-history';
import { publishedMarket } from './market-history.test-helper';
import { defaultRules } from '../game/config';
import { startClientGame } from '../game/client-session';
import { grantItemInstance } from '../game/runtime';
import { createGameSession, reduceGameSession } from './game-session';
import { gameSaveKey, serializeGameCheckpoint } from './game-save';
import {
  activeModeKey,
  startSurvivalClient,
  reduceSurvivalClient,
} from './survival-client';
import {
  survivalSaveKey,
  serializeSurvivalCheckpoint,
} from './survival-persistence';
import { playerProfileKey } from './player-profile';
import type { PlayerTurn } from '../game/item-types';
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
const render = async (e: ReturnType<typeof createElement>) =>
  act(async () => root.render(e));
const click = async (label: string, scope: Element = node) =>
  act(async () => {
    const b = [...scope.querySelectorAll<HTMLButtonElement>('button')].find(
      (b) => b.textContent?.trim() === label,
    );
    if (!b) throw Error('Missing ' + label);
    b.click();
  });
it('shows compact public history, keeps both own comparisons separate, and opens replay only on explicit request', async () => {
  const game = startClientGame('jacob_esau', 42),
    p = game.players.find((p) => p.isHuman)!,
    onViewReplay = vi.fn();
  grantItemInstance(p, {
    itemId: 'twenty_twenty',
    instanceId: 'vision',
    acquiredOrder: 2,
  });
  grantItemInstance(p, {
    itemId: 'steam_sale',
    instanceId: 'sale',
    acquiredOrder: 3,
  });
  const history = selectMarketHistory(
      [publishedMarket()],
      { floorIndex: 0, roomIndex: 1 },
      defaultRules,
    ),
    snapshot = structuredClone(history);
  const turn: PlayerTurn = {
    playerId: 'human',
    actions: [
      { type: 'bid', group: 'A', amount: 20 },
      { type: 'bid', group: 'B', amount: 30 },
    ],
  };
  await render(
    createElement(MarketImpactPreview, {
      player: p,
      turn,
      kind: 'bid',
      capacity: getQuoteCapacity(p, defaultRules),
      rules: defaultRules,
      history,
      onViewReplay,
    }),
  );
  expect(node.querySelectorAll('.market-history tbody tr')).toHaveLength(1);
  const actions = node.querySelectorAll('.market-impact-action');
  expect(actions).toHaveLength(2);
  expect(actions[0]!.textContent).toContain('市场 25');
  expect(actions[0]!.textContent).toContain('历史A高价线75');
  expect(actions[1]!.textContent).toContain('市场 37.5');
  expect(actions[1]!.textContent).toContain('历史B高价线10');
  expect(node.textContent).toContain('计分等价 20');
  expect(node.textContent).toContain('不等于获奖价');
  expect(onViewReplay).not.toHaveBeenCalled();
  await click('查看已结算回放');
  expect(onViewReplay).toHaveBeenCalledOnce();
  expect(history).toEqual(snapshot);
});
it('shows brimstone scoring as a range, never a predicted score against an unknown current baseline', async () => {
  const game = startClientGame('azazel', 42),
    p = game.players.find((p) => p.isHuman)!;
  await render(
    createElement(MarketImpactPreview, {
      player: p,
      turn: {
        playerId: 'human',
        actions: [{ type: 'bid', group: 'A', amount: 100 }],
      },
      kind: 'bid',
      capacity: getQuoteCapacity(p, defaultRules),
      rules: defaultRules,
    }),
  );
  expect(node.textContent).toContain('计分区间 80 – 125');
  expect(node.textContent).toContain('本层尚无已结算市场');
  expect(node.querySelector('.market-reference-comparison')).toBeNull();
});
it.each(['classic', 'survival'] as const)(
  'wires only the %s current session settlements and preserves draft/storage through replay',
  async (mode) => {
    if (mode === 'classic') {
      let s = reduceGameSession(createGameSession(42), {
        type: 'start_game',
        characterId: 'isaac',
      });
      for (let i = 0; i < 2; i++) {
        s = reduceGameSession(s, {
          type: 'submit_player_turn',
          turn: {
            playerId: 'human',
            actions: [{ type: 'bid', group: 'A', amount: 1 }],
          },
        });
        s = reduceGameSession(s, { type: 'advance_room' });
      }
      localStorage.setItem(gameSaveKey, serializeGameCheckpoint(s));
    } else {
      let s = startSurvivalClient('isaac', 42, 'highest');
      for (let i = 0; i < 2; i++) {
        s = reduceSurvivalClient(s, {
          type: 'submit_player_turn',
          turn: {
            playerId: 'human',
            actions: [{ type: 'bid', group: 'A', amount: 1 }],
          },
        });
        s = reduceSurvivalClient(s, { type: 'advance_room' });
      }
      localStorage.setItem(
        survivalSaveKey,
        serializeSurvivalCheckpoint(s.game, s.draft),
      );
    }
    localStorage.setItem(activeModeKey, mode);
    await render(createElement(GameApp));
    const before = localStorage.getItem(
        mode === 'classic' ? gameSaveKey : survivalSaveKey,
      ),
      profile = localStorage.getItem(playerProfileKey);
    const input = node.querySelector<HTMLInputElement>(
        'input[aria-label="竞拍奖励 A 的数值"]',
      )!,
      amount = input.value;
    await click('市场', node.querySelector('.room-panel-controls')!);
    const rows = node.querySelectorAll('.market-history tbody tr');
    expect(rows).toHaveLength(2);
    expect(rows[0]!.querySelector('th')!.textContent).toMatch(/^2/);
    expect(rows[1]!.querySelector('th')!.textContent).toMatch(/^1/);
    await click('查看已结算回放');
    expect(node.querySelector('#room-utilities')!.textContent).toContain(
      '回放',
    );
    const back = [
      ...node.querySelectorAll<HTMLButtonElement>('#room-utilities button'),
    ].find((b) => b.textContent?.includes('返回游戏'))!;
    await act(async () => back.click());
    expect(
      node.querySelector<HTMLInputElement>(
        'input[aria-label="竞拍奖励 A 的数值"]',
      ),
    ).toBe(input);
    expect(input.value).toBe(amount);
    expect(node.querySelectorAll('.market-history tbody tr')).toHaveLength(2);
    expect(
      localStorage.getItem(mode === 'classic' ? gameSaveKey : survivalSaveKey),
    ).toBe(before);
    expect(localStorage.getItem(playerProfileKey)).toBe(profile);
  },
);
