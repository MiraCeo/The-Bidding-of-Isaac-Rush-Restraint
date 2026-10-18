// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { PublicRanking } from '@/components/game/public-ranking';
import { RoomRanking } from '@/components/game/room-ranking';
import { SurvivalScoreBoard } from '@/components/game/survival-score-board';
import { GameResult } from '@/components/game/game-result';
import {
  clientGameReducer,
  startClientGame,
  type ActiveClientGameState,
} from '../game/client-session';
import {
  startSurvivalGame,
  survivalGameReducer,
  type SurvivalGameState,
} from '../game/survival-session';
import { currentSurvivalBoard, finalSurvivalBoard } from './survival-board';
import { createSurvivalReplay } from './survival-record';
import { getPublicPlayerRanking } from './public-ranking';
import { survivalRoomView } from './survival-client';

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
const render = async (view: Parameters<Root['render']>[0]) =>
  act(async () => root.render(view));
const click = async (button: HTMLElement) => act(async () => button.click());
const button = (text: string, scope: Element = node) => {
  const b = [...scope.querySelectorAll<HTMLButtonElement>('button')].find(
    (b) => b.textContent?.trim() === text,
  );
  if (!b) throw Error('Missing button ' + text);
  return b;
};
const rows = (selector: string) => [
  ...node.querySelectorAll<HTMLElement>(selector),
];
const room = () =>
  clientGameReducer(startClientGame('jacob_esau', 42), {
    type: 'submit_player_turn',
    turn: {
      playerId: 'human',
      actions: [
        { type: 'bid', group: 'A', amount: 20 },
        { type: 'bid', group: 'B', amount: 21 },
      ],
    },
  }) as ActiveClientGameState;
const next = (g: SurvivalGameState) =>
  survivalGameReducer(
    g,
    g.phase === 'room_action'
      ? g.activePlayerIds.includes('human')
        ? {
            type: 'submit_player_turn',
            turn: { playerId: 'human', actions: [{ type: 'withdraw' }] },
          }
        : { type: 'submit_ai_room' }
      : { type: g.phase === 'room_result' ? 'advance_room' : 'advance_floor' },
  );

it('keeps public shared ranks, actual sort precision and role facts while prioritizing the selected metric', async () => {
  const game = startClientGame('isaac', 42);
  game.players.forEach((p, i) => {
    p.score = i;
    p.money = i;
  });
  game.players[0]!.score = 123.45671;
  game.players[1]!.score = 123.45672;
  game.players[2]!.score = 123.45672;
  game.aiProfiles['ai-1']!.name = '超长名字'.repeat(30);
  game.players[0]!.money = 123456789012;
  const before = structuredClone(game);
  await render(createElement(PublicRanking, { game, scoreDecimals: 2 }));
  expect(
    rows('.ranking-table tbody tr').map((r) => r.dataset.playerId),
  ).toEqual(getPublicPlayerRanking(game, 'score').map((r) => r.playerId));
  expect(
    rows('.ranking-table tbody tr')
      .slice(0, 3)
      .map((r) => r.firstElementChild!.textContent),
  ).toEqual(['1', '1', '3']);
  expect(node.querySelector('th[aria-sort]')!.textContent).toContain(
    '累计积分',
  );
  expect(node.querySelector('.ranking-player-cell')!.textContent).toContain(
    '超长名字'.repeat(30),
  );
  expect(rows('.ranking-player-cell small')).toHaveLength(20);
  expect(node.querySelector('.ranking-action-cell')).toBeNull();
  await click(button('资金排行'));
  expect(node.querySelector('th[aria-sort]')!.textContent).toContain(
    '当前资金',
  );
  expect(
    node.querySelector('.ranking-table tbody .ranking-metric-primary')!
      .textContent,
  ).toBe('123456789012');
  expect(
    rows('.ranking-table tbody tr').map((r) => r.dataset.playerId),
  ).toEqual(getPublicPlayerRanking(game, 'money').map((r) => r.playerId));
  expect(game).toEqual(before);
});

it('never reads private actions, analysis or future reward rooms on either public tab', async () => {
  const game = startClientGame('isaac', 42);
  for (const key of [
    'pendingRoomTurns',
    'submittedPlayerTurn',
    'revealedAiDecisions',
    'rooms',
  ]) {
    Object.defineProperty(game, key, {
      get() {
        throw Error('private access: ' + key);
      },
    });
  }
  await render(createElement(PublicRanking, { game, scoreDecimals: 4 }));
  await click(button('资金排行'));
  expect(rows('.ranking-table tbody tr')).toHaveLength(20);
  expect(node.textContent).not.toMatch(/quoteProfile|道具资格|名义出价/);
});

it('locates the human only inside the clicked board and does not autoscroll on opening', async () => {
  const game = startClientGame('isaac', 42);
  const model = currentSurvivalBoard(
    startSurvivalGame({
      seed: 42,
      characterId: 'isaac',
      cutLines: Array(7).fill(0),
    }),
  );
  const before = structuredClone({ game, model });
  await render(
    createElement(
      'div',
      null,
      createElement(PublicRanking, { game, scoreDecimals: 2 }),
      createElement(SurvivalScoreBoard, { model }),
    ),
  );
  const selfRows = rows('[data-ranking-self="true"]');
  expect(selfRows).toHaveLength(2);
  const spies = selfRows.map((row) => {
    const fn = vi.fn();
    Object.defineProperty(row, 'scrollIntoView', { value: fn });
    return fn;
  });
  expect(spies.every((spy) => spy.mock.calls.length === 0)).toBe(true);
  await click(button('定位本人', node.querySelector('.survival-score-board')!));
  expect(spies[0]).not.toHaveBeenCalled();
  expect(spies[1]).toHaveBeenCalledWith({
    block: 'nearest',
    inline: 'nearest',
  });
  expect(document.activeElement).toBe(selfRows[1]);
  expect({ game, model }).toEqual(before);
});

it('keeps settled cumulative order and every single/double action, gain and award instead of sorting by the room gain', async () => {
  const game = room(),
    before = structuredClone(game);
  await render(
    createElement(RoomRanking, {
      game,
      embedded: true,
      onSwitch: () => {},
      onAdvance: () => {},
      scoreDecimals: 4,
    }),
  );
  const expected = [...game.roomSettlement!.players].sort(
    (a, b) => b.score - a.score || a.id.localeCompare(b.id),
  );
  expect(
    rows('.ranking-table tbody tr').map((r) => r.dataset.playerId),
  ).toEqual(expected.map((p) => p.id));
  expect(node.querySelector('th[aria-sort]')!.textContent).toContain(
    '累计积分',
  );
  const self = node.querySelector('[data-ranking-self="true"]')!;
  expect(self.querySelector('.ranking-action-cell')!.textContent).toBe(
    '竞拍 A · 20 / 竞拍 B · 21',
  );
  for (const row of rows('.ranking-table tbody tr')) {
    const player = expected.find((p) => p.id === row.dataset.playerId)!;
    const old = game.roomSettlement!.playersBefore.find(
      (p) => p.id === player.id,
    )!;
    const delta = player.score - old.score;
    expect(row.children[4]!.textContent).toBe(
      (delta >= 0 ? '+' : '') + delta.toFixed(4),
    );
    expect(row.children[3]!.textContent).toBe(String(player.money));
  }
  expect(game).toEqual(before);
});

it('keeps A/B market ordering, both human targets and authoritative award/disruption tags in semantic tables', async () => {
  const game = { ...room(), roomRankingView: 'contest' as const },
    before = structuredClone(game);
  await render(
    createElement(RoomRanking, {
      game,
      embedded: true,
      onSwitch: () => {},
      onAdvance: () => {},
    }),
  );
  const tables = rows('.contest-ranking-table');
  expect(tables).toHaveLength(2);
  for (const [i, group] of (['A', 'B'] as const).entries()) {
    const expected = game
      .roomSettlement!.resolvedActions.filter(
        (e) => e.action.type !== 'withdraw' && e.action.group === group,
      )
      .sort(
        (a, b) =>
          (b.marketEquivalent ?? 0) - (a.marketEquivalent ?? 0) ||
          a.playerId.localeCompare(b.playerId),
      );
    const actual = [
      ...tables[i]!.querySelectorAll<HTMLElement>('tbody .contest-result-row'),
    ];
    expect(
      actual.map((r) => [r.dataset.playerId, Number(r.dataset.actionIndex)]),
    ).toEqual(expected.map((e) => [e.playerId, e.actionIndex]));
    expect(tables[i]!.querySelector('th[aria-sort]')!.textContent).toContain(
      '市场等价',
    );
    expect(
      tables[i]!.querySelectorAll('[data-ranking-self="true"]'),
    ).toHaveLength(1);
    for (const [index, e] of expected.entries()) {
      expect(actual[index]!.children[1]!.getAttribute('title')).toBe(
        String(e.marketEquivalent ?? '—'),
      );
      const copies = game
        .roomSettlement!.awards.filter(
          (a) => a.group === group && a.playerId === e.playerId,
        )
        .reduce((n, a) => n + a.copies, 0);
      expect(
        actual[index]!.querySelector('.contest-badge-awarded') !== null,
      ).toBe(copies > 0);
      const disrupted = [
        ...game.roomSettlement!.highPricePlacements,
        ...game.roomSettlement!.cooperationPlacements,
      ].some(
        (p) =>
          p.group === group &&
          p.playerId === e.playerId &&
          p.actionType === 'disrupt',
      );
      expect(
        actual[index]!.querySelector('.contest-badge-disrupted') !== null,
      ).toBe(disrupted);
    }
  }
  expect(game).toEqual(before);
});

it('shows empty contests honestly without a fake self rank or locate target', async () => {
  const game = room();
  const shown = {
    ...game,
    roomRankingView: 'contest' as const,
    roomSettlement: { ...game.roomSettlement!, resolvedActions: [] },
  };
  await render(
    createElement(RoomRanking, {
      game: shown,
      embedded: true,
      onSwitch: () => {},
      onAdvance: () => {},
    }),
  );
  expect(rows('.contest-empty')).toHaveLength(2);
  expect(rows('.contest-panel button')).toHaveLength(0);
  expect(rows('.contest-panel [data-ranking-self="true"]')).toHaveLength(0);
  expect(node.textContent).toContain('你未参与本组争夺');
});

it('distinguishes live room sums, exchanged floor additions, inherited S and cumulative totals without modifying the model', async () => {
  let game = startSurvivalGame({
    seed: 42,
    characterId: 'isaac',
    cutLines: Array(7).fill(0),
  });
  game = next(game);
  const live = currentSurvivalBoard(game),
    before = structuredClone(live);
  await render(createElement(SurvivalScoreBoard, { model: live, decimals: 4 }));
  expect(
    node.querySelector('.survival-board-table thead')!.textContent,
  ).toContain('玩家状态累计分数第 1 层进行中');
  expect(node.textContent).toContain('当前顺位不是最终名次');
  expect(node.textContent).toContain('房间分 · 1/5 房');
  expect(node.querySelector('.ranking-reading-help')!.textContent).toContain(
    '不重复计入继承分',
  );
  expect(live).toEqual(before);
  while (game.phase !== 'floor_result') game = next(game);
  game = next(game);
  while (game.phase !== 'floor_result') game = next(game);
  const model = currentSurvivalBoard(game),
    snapshot = structuredClone(model);
  await render(createElement(SurvivalScoreBoard, { model, decimals: 4 }));
  expect(
    model.rows.some(
      (r) => r.floors[1] && r.floors[1].survivalScore !== r.floors[1].score,
    ),
  ).toBe(true);
  for (const row of model.rows) {
    const tr = node.querySelector(`[data-player-id="${row.playerId}"]`)!;
    expect(tr.querySelector('[data-total]')!.textContent).toBe(
      row.total.toFixed(4),
    );
    for (const [i, cell] of row.floors.entries()) {
      if (cell)
        expect(tr.querySelector(`[data-floor="${i}"]`)!.textContent).toContain(
          `生存分 S ${cell.survivalScore!.toFixed(4)}`,
        );
    }
  }
  expect(model).toEqual(snapshot);
});

it('preserves authoritative survival final order including wipeout and factual replay identities', async () => {
  let game = startSurvivalGame({
    seed: 42,
    characterId: 'isaac',
    cutLines: Array(7).fill(1000000),
  });
  while (game.phase !== 'competition_complete') game = next(game);
  const model = finalSurvivalBoard(createSurvivalReplay(game)),
    before = structuredClone(model);
  await render(createElement(SurvivalScoreBoard, { model }));
  expect(
    rows('.survival-board-table tbody tr').map((r) => r.dataset.playerId),
  ).toEqual(game.finalRanking.map((r) => r.playerId));
  expect(node.textContent).toContain('你的最终名次');
  expect(node.textContent).not.toContain('当前顺位不是最终名次');
  expect(rows('tr[data-eliminated="true"]')).toHaveLength(20);
  expect(model).toEqual(before);
});

it('labels the survival room leaderboard as all-floor room-only points, not this-floor points or exchanged cumulative scores', async () => {
  let game = startSurvivalGame({
    seed: 42,
    characterId: 'isaac',
    cutLines: Array(7).fill(0),
  });
  while (game.phase !== 'floor_result') game = next(game);
  game = next(next(game));
  expect(game.floorIndex).toBe(1);
  expect(game.phase).toBe('room_result');
  const shown = survivalRoomView(game),
    before = structuredClone(game);
  await render(
    createElement(RoomRanking, {
      game: shown,
      embedded: true,
      scoreScope: 'survival',
      onSwitch: () => {},
      onAdvance: () => {},
      scoreDecimals: 4,
    }),
  );
  expect(node.querySelector('th[aria-sort]')!.textContent).toContain(
    '累计房间分',
  );
  expect(node.textContent).toContain('不等同于生存榜累计分数');
  const sorted = [...game.roomSettlement!.players].sort(
    (a, b) => b.score - a.score || a.id.localeCompare(b.id),
  );
  expect(
    rows('.ranking-table tbody tr').map((r) => r.dataset.playerId),
  ).toEqual(sorted.map((p) => p.id));
  expect(
    sorted.some(
      (p) =>
        p.score >
        (game.currentFloorRoomScores[p.id] ?? []).reduce((a, b) => a + b, 0),
    ),
  ).toBe(true);
  for (const row of rows('.ranking-table tbody tr')) {
    const p = sorted.find((p) => p.id === row.dataset.playerId)!;
    expect(row.querySelector('.ranking-metric-primary')!.textContent).toBe(
      p.score.toFixed(4),
    );
  }
  expect(game).toEqual(before);
});

it('preserves classic final scores/order and all AI information while demoting auxiliary columns', async () => {
  let game = startClientGame('isaac', 42);
  for (let i = 0; i < 15; i++) {
    game = clientGameReducer(game, {
      type: 'submit_player_turn',
      turn: { playerId: 'human', actions: [{ type: 'withdraw' }] },
    }) as ActiveClientGameState;
    game = clientGameReducer(game, {
      type: 'advance_room',
    }) as ActiveClientGameState;
  }
  const before = structuredClone(game);
  await render(
    createElement(GameResult, {
      game,
      embedded: true,
      onRestart: () => {},
      scoreDecimals: 4,
    }),
  );
  expect(rows('.final-table thead th')).toHaveLength(6);
  expect(rows('.final-table tbody tr').map((r) => r.dataset.playerId)).toEqual(
    game.finalRanking.map((r) => r.playerId),
  );
  expect(rows('.final-table .ranking-profile-cell details')).toHaveLength(19);
  for (const [i, row] of rows('.final-table tbody tr').entries())
    expect(row.querySelector('.ranking-metric-primary')!.textContent).toBe(
      game.finalRanking[i]!.finalScore.toFixed(4),
    );
  expect(
    node.querySelector(
      '.final-table [data-ranking-self="true"] .ranking-player-cell',
    )!.textContent,
  ).toContain('以撒');
  expect(game).toEqual(before);
});

it('keeps scrolling/sticky identity styles scoped to rankings instead of shrinking the settlement or changing global tables', () => {
  const css = readFileSync('app/globals.css', 'utf8');
  expect(css).toContain(
    '.ranking-data-scroll .result-table thead th { position:sticky; top:0;',
  );
  expect(css).toContain(
    '.ranking-data-scroll .result-table tr>:nth-child(2) { position:sticky; left:54px;',
  );
  expect(css).toContain('grid-template-columns:minmax(0,1fr) minmax(0,1fr)');
  expect(css).toContain(
    '@media(max-width:1200px) { .contest-grid { grid-template-columns:minmax(0,1fr); } }',
  );
});

it('fits only an active public board to remaining viewport height without removing heading, notes or rows', async () => {
  const game = startClientGame('isaac', 42),
    before = structuredClone(game);
  await render(
    createElement(RoomRanking, { variant: 'public', game, onReturn: () => {} }),
  );
  expect(node.querySelector('[data-public-ranking="active"]')).not.toBeNull();
  expect(node.querySelector('#room-utilities-title')!.textContent).toBe(
    '当前公开排行',
  );
  expect(
    node.querySelector('.utility-page-description')!.textContent,
  ).toContain('行动前公开数据');
  expect(node.querySelector('.ranking-context')).toBeNull();
  expect(node.querySelector('.ranking-basis')!.textContent).toContain(
    '相同数值并列',
  );
  expect(node.querySelector('footer')!.textContent).toContain('Esc 可返回');
  expect(rows('.ranking-table tbody tr')).toHaveLength(20);
  expect(game).toEqual(before);
  await render(
    createElement(RoomRanking, { variant: 'public', onReturn: () => {} }),
  );
  expect(node.querySelector('[data-public-ranking]')).toBeNull();
  expect(node.textContent).toContain('暂无排行');
  await render(
    createElement(RoomRanking, {
      game: room(),
      embedded: true,
      onSwitch: () => {},
      onAdvance: () => {},
    }),
  );
  expect(node.querySelector('[data-public-ranking]')).toBeNull();
});

it('gives numeric headers enough selector specificity and paints focused sticky cells in their own layer', () => {
  const css = readFileSync('app/globals.css', 'utf8');
  expect(css).toContain(
    '.ranking-data-scroll .result-table .ranking-number, .ranking-data-scroll .result-table .ranking-metric-primary { text-align:right;',
  );
  expect(css).toContain(
    '.ranking-data-scroll tr[data-ranking-self="true"]:focus>*',
  );
  expect(css).toContain(
    '.ranking-data-scroll tr[data-ranking-self="true"]:focus>:first-child',
  );
  expect(css).toContain(
    '.ranking-data-scroll tr[data-ranking-self="true"]:focus>:last-child',
  );
  expect(css).toContain(
    '.survival-board-table tr[data-ranking-self="true"]:focus>:first-child',
  );
  expect(css).toContain(
    'box-shadow:inset 2px 0 var(--primary), inset 0 2px var(--primary), inset 0 -2px var(--primary)',
  );
  expect(css).toContain('@media (min-width:900px) and (min-height:700px)');
  expect(css).toContain(
    '[data-public-ranking="active"] .ranking-data-scroll { flex:1; min-height:140px; max-height:none; }',
  );
  expect(css).toContain(
    'main:has(>[data-public-ranking="active"]) { display:flex; flex-direction:column; height:100dvh; min-height:100dvh; }',
  );
});
it('combines public mode/count/phase into the heading without repeating floor context or dropping scoring caveats', async () => {
  const game = room(),
    before = structuredClone(game);
  await render(
    createElement(RoomRanking, { variant: 'public', game, onReturn: () => {} }),
  );
  const heading = node.querySelector('.utility-page-title-line')!;
  expect(heading.textContent).toContain('经典 · 20 人 · 本房已结算');
  expect(node.querySelector('.ranking-context')).toBeNull();
  expect(node.querySelector('.ranking-basis')!.textContent).toContain(
    '未含终局倍率',
  );
  expect(node.querySelector('.ranking-basis')!.textContent).toContain(
    '本房行动结算后公开',
  );
  expect(node.querySelector('.ranking-basis')!.textContent).toContain(
    '相同数值并列',
  );
  await click(button('资金排行'));
  expect(node.querySelector('.ranking-basis')!.textContent).toContain(
    '非竞价能力',
  );
  expect(heading.textContent).not.toContain('房间');
  expect(game).toEqual(before);
  await render(
    createElement(RoomRanking, {
      variant: 'public',
      game: { ...game, phase: 'game_result' },
      onReturn: () => {},
    }),
  );
  expect(
    node.querySelector('.utility-page-description')!.textContent,
  ).toContain('整局已结束');
});
it('uses public-only fixed columns and a single frame with readable two-line player rows', async () => {
  await render(
    createElement(RoomRanking, {
      variant: 'public',
      game: startClientGame('isaac', 42),
      onReturn: () => {},
    }),
  );
  expect(rows('.ranking-table colgroup col')).toHaveLength(4);
  expect(rows('.ranking-table tbody tr')).toHaveLength(20);
  expect(rows('.ranking-player-cell small')).toHaveLength(20);
  await render(
    createElement(RoomRanking, {
      game: room(),
      embedded: true,
      onSwitch: () => {},
      onAdvance: () => {},
    }),
  );
  expect(node.querySelector('.ranking-table colgroup')).toBeNull();
  const css = readFileSync('app/globals.css', 'utf8');
  expect(css).toContain(
    '[data-public-ranking="active"] .round-ranking-panel { border:0; border-radius:0; padding:0; background:none; margin-top:14px; }',
  );
  expect(css).toContain(
    '[data-public-ranking="active"] .ranking-table { table-layout:fixed; }',
  );
  expect(css).toContain(
    '[data-public-ranking="active"] .ranking-table tbody tr>* { height:54px; padding-block:7px; }',
  );
  expect(css).toContain('white-space:normal; overflow-wrap:anywhere;');
});
