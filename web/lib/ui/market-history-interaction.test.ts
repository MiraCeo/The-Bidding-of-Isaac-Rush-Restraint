// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { MarketImpactPreview } from '@/components/game/market-impact-preview';
import { GameApp } from '@/components/game/game-app';
import { RoomPrototype } from '@/components/game/room-prototype';
import { defaultGamePreferences } from './game-preferences';
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
  const comparison = node.querySelector('.market-quote-comparison')!;
  expect(comparison.querySelectorAll('thead th')).toHaveLength(3);
  const values = [...comparison.querySelectorAll('tbody tr')].map(
    (row) => row.textContent,
  );
  expect(values).toEqual([
    '当前市场2537.5',
    '历史高价线7510',
    '市场差值−50+27.5',
    '计分等价2030',
  ]);
  expect(node.querySelectorAll('.market-shared-zone')).toHaveLength(1);
  expect(
    node.querySelectorAll('.market-history thead [data-active="true"]'),
  ).toHaveLength(2);
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
  expect(node.querySelector('.market-score-range')!.textContent).toBe(
    '80 – 125',
  );
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
    const replayButton = node.querySelector<HTMLButtonElement>(
      '.market-history-replay',
    )!;
    replayButton.focus();
    node.querySelector<HTMLElement>('#market-drawer')!.scrollTop = 17;
    await click('查看已结算回放');
    expect(node.querySelector('#room-utilities')!.textContent).toContain(
      '回放',
    );
    expect(
      node.querySelector('.replay-selected-heading h3')!.textContent,
    ).toContain('F1-R2');
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
    expect(document.activeElement).toBe(replayButton);
    expect(node.querySelector<HTMLElement>('#market-drawer')!.scrollTop).toBe(
      17,
    );
    replayButton.focus();
    await click('查看已结算回放');
    await act(async () =>
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
      ),
    );
    expect(document.activeElement).toBe(replayButton);
    expect(node.querySelector<HTMLElement>('.room-game-content')!.hidden).toBe(
      false,
    );
    expect(node.querySelectorAll('.market-history tbody tr')).toHaveLength(2);
    expect(
      localStorage.getItem(mode === 'classic' ? gameSaveKey : survivalSaveKey),
    ).toBe(before);
    expect(localStorage.getItem(playerProfileKey)).toBe(profile);
  },
);

it('reaches the market heading on an explicit narrow-screen open, and Escape returns to its trigger without submitting', async () => {
  vi.spyOn(window, 'matchMedia').mockReturnValue({
    matches: true,
  } as MediaQueryList);
  const scroll = vi.spyOn(HTMLElement.prototype, 'scrollIntoView');
  const submit = vi.fn();
  await render(
    createElement(RoomPrototype, {
      game: startClientGame('isaac', 42),
      onSubmit: submit,
      preferences: defaultGamePreferences,
      preferenceSaveStatus: 'unchanged',
      onPreferencesChange: vi.fn(),
    }),
  );
  const button = node.querySelector<HTMLButtonElement>(
    '[aria-controls="market-drawer"]',
  )!;
  button.focus();
  await act(async () => button.click());
  const title = node.querySelector('#market-reference-title')!;
  expect(document.activeElement).toBe(title);
  expect(scroll).toHaveBeenCalledWith({ block: 'start', behavior: 'instant' });
  await act(async () =>
    title.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
    ),
  );
  expect(document.activeElement).toBe(button);
  expect(button.getAttribute('aria-expanded')).toBe('false');
  expect(submit).not.toHaveBeenCalled();
});

it('keeps missing high-price boundaries as missing, and raw precision readable without hovering', async () => {
  const game = startClientGame('isaac', 42),
    p = game.players.find((p) => p.isHuman)!;
  const history = selectMarketHistory(
    [publishedMarket(0, 0, true)],
    { floorIndex: 0, roomIndex: 1 },
    defaultRules,
  );
  await render(
    createElement(MarketImpactPreview, {
      player: p,
      turn: {
        playerId: 'human',
        actions: [{ type: 'disrupt', group: 'A', amount: 20 }],
      },
      kind: 'disrupt',
      capacity: getQuoteCapacity(p, defaultRules),
      rules: defaultRules,
      history,
    }),
  );
  const comparison = node.querySelector('.market-quote-comparison')!;
  expect(
    [...comparison.querySelectorAll('tbody td')].map((td) => td.textContent),
  ).toEqual(['50', '—', '—', '25']);
  expect(node.querySelector('.market-history-exact')!.textContent).toContain(
    '全场观望',
  );
  expect(node.querySelector('.market-shared-zone')!.textContent).toContain(
    '无市场基准',
  );
  history[0]!.target = 30.31578947368421;
  await render(
    createElement(MarketImpactPreview, {
      player: p,
      turn: {
        playerId: 'human',
        actions: [{ type: 'bid', group: 'A', amount: 20 }],
      },
      kind: 'bid',
      capacity: getQuoteCapacity(p, defaultRules),
      rules: defaultRules,
      history,
    }),
  );
  expect(node.querySelector('.market-history tbody')!.textContent).toContain(
    '30.32',
  );
  expect(node.querySelector('.market-history-exact')!.textContent).toContain(
    '30.31578947368421',
  );
});
