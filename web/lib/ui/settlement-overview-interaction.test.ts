// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import { RoomResult } from '@/components/game/room-result';
import { GameApp } from '@/components/game/game-app';
import { SettlementStatus } from '@/components/game/settlement-navigation';
import {
  startClientGame,
  type ActiveClientGameState,
} from '../game/client-session';
import { settleRuntimeRoom } from '../game/room-engine';
import { createSeededRandom } from '../game/random';
import { defaultRules } from '../game/config';
import type { ItemId, PlayerTurn, GeneratedRoom } from '../game/item-types';
import { createGameSession, reduceGameSession } from './game-session';
import { serializeGameCheckpoint, gameSaveKey } from './game-save';
import {
  startSurvivalClient,
  reduceSurvivalClient,
  activeModeKey,
} from './survival-client';
import {
  serializeSurvivalCheckpoint,
  survivalSaveKey,
} from './survival-persistence';
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
const show = async (view: Parameters<Root['render']>[0]) =>
  act(async () => root.render(view));
const click = async (el: HTMLElement) => act(async () => el.click());
const button = (text: string) => {
  const b = [...node.querySelectorAll<HTMLButtonElement>('button')].find(
    (e) => e.textContent?.trim() === text,
  );
  if (!b) throw Error('missing ' + text);
  return b;
};
function fixture({
  item = 'grab_bag',
  owned = ['sacred_heart'],
  double = false,
  withdraw = false,
  boss = false,
  amount = 250,
}: {
  item?: ItemId;
  owned?: ItemId[];
  double?: boolean;
  withdraw?: boolean;
  boss?: boolean;
  amount?: number;
} = {}) {
  const g = startClientGame(double ? 'jacob_esau' : 'isaac', 42);
  g.players.forEach((p) => (p.money = 1000));
  const h = g.players.find((p) => p.isHuman)!;
  h.items = (double ? [...owned, 'more_options' as const] : owned).map(
    (itemId, i) => ({
      itemId,
      instanceId: 'fixture-' + i,
      acquiredOrder: i + 1,
    }),
  );
  const room: GeneratedRoom = {
    ...g.rooms[0]![0]!,
    kind: boss ? ('boss' as const) : ('normal' as const),
    rewards: [
      { group: 'A' as const, itemId: item, hidden: false },
      { group: 'B' as const, itemId: 'interest' as const, hidden: false },
    ],
  };
  const turns: PlayerTurn[] = g.players.map((p) => ({
    playerId: p.id,
    actions:
      !p.isHuman || withdraw
        ? [{ type: 'withdraw' }]
        : double
          ? [
              { type: 'bid', group: 'A', amount: 250 },
              { type: 'bid', group: 'B', amount: 200 },
            ]
          : [{ type: 'bid', group: 'A', amount }],
  }));
  const settlement = {
    ...settleRuntimeRoom(
      room,
      g.players,
      turns,
      defaultRules,
      createSeededRandom(3),
    ),
    room,
    turns,
    playersBefore: g.players,
  };
  return {
    ...g,
    phase: 'room_result',
    roomSettlement: settlement,
    players: settlement.players,
  } as ActiveClientGameState;
}
const result = (
  g: ActiveClientGameState,
  advance = vi.fn(),
  ranking = vi.fn(),
) =>
  createElement(RoomResult, {
    embedded: true,
    game: g,
    onAdvance: advance,
    onShowRanking: ranking,
  });
it('shows authoritative net cost and score calculation once before disclosure, without changing facts', async () => {
  const g = fixture(),
    before = structuredClone(g);
  await show(result(g));
  expect(node.querySelector('.settlement-money-equation')!.textContent).toBe(
    '扣款 250 − 返还 188 = 净支出 62',
  );
  const b = g.roomSettlement!.scoreBreakdowns.human!,
    sub = b.actions.reduce((s, a) => s + a.subtotal, 0);
  expect(node.querySelector('.settlement-overview')!.textContent).toContain(
    `计分小计 ${sub.toFixed(2)} × 1.500 → ${g.roomSettlement!.roomScoreSummaries.human!.initialScore.toFixed(2)}`,
  );
  expect(node.querySelector('.summary-negative')!.textContent).toBe('-62');
  expect(node.querySelectorAll('.reward-acquired-banner')).toHaveLength(0);
  expect(node.querySelectorAll('.settlement-earned-items>div')).toHaveLength(1);
  expect(
    [
      ...node.querySelectorAll<HTMLDetailsElement>(
        '.settlement-disclosures>details',
      ),
    ].every((d) => !d.open),
  ).toBe(true);
  expect(node.querySelector('.settlement-overview')!.textContent).not.toContain(
    '追溯追加',
  );
  expect(g).toEqual(before);
});
it('does not apply awarded-heart retroactivity twice or hide score clearing', async () => {
  const g = fixture({ item: 'moms_heart', boss: true }),
    before = structuredClone(g);
  await show(result(g));
  const score = g.roomSettlement!.roomScoreSummaries.human!;
  expect(score.retroactiveMultiplier).toBe(2);
  expect(node.querySelector('.settlement-overview')!.textContent).toContain(
    `追溯追加 +${score.retroactiveScore.toFixed(2)}`,
  );
  expect(node.querySelector('.summary-score')!.textContent).toBe(
    '+' + score.finalScore.toFixed(2),
  );
  expect(node.querySelector('.player-settlement')!.textContent).toContain(
    '追溯追加',
  );
  expect(g).toEqual(before);
  const cleared = fixture({
    owned: ['whore_of_babylon'],
    item: 'interest',
    amount: 1,
  });
  expect(cleared.roomSettlement!.scoreBreakdowns.human!.cleared).toBe(true);
  expect(cleared.roomSettlement!.roomScoreSummaries.human!.finalScore).toBe(0);
  await show(result(cleared));
  expect(node.querySelector('.settlement-overview')!.textContent).toContain(
    '积分清零',
  );
});
it('handles zero-cost withdrawal and positive other income without a misleading net-spend equation', async () => {
  const g = fixture({ withdraw: true });
  await show(result(g));
  expect(node.querySelector('.settlement-money-equation')!.textContent).toBe(
    '扣款 0 = 净支出 0',
  );
  expect(node.querySelector('.settlement-earned')!.textContent).toContain(
    '本房未获道具',
  );
  expect(node.querySelector('.settlement-overview')!.textContent).toContain(
    '静观其变',
  );
  const gain = fixture();
  gain.roomSettlement!.players.find((p) => p.isHuman)!.money += 300;
  gain.roomSettlement!.events.push({
    type: 'money',
    playerId: 'human',
    amount: 300,
    message: '测试资金收入300',
  });
  await show(result(gain));
  expect(node.querySelector('.settlement-money-equation')!.textContent).toBe(
    '返还 188 + 收入 300 − 扣款 250 = 净收入 238',
  );
});
it('retains both actions and raw events while relocating special causes, and only advances on explicit click', async () => {
  const g = fixture({ double: true }),
    before = structuredClone(g),
    advance = vi.fn(),
    ranking = vi.fn();
  await show(result(g, advance, ranking));
  expect(node.querySelector('.settlement-overview')!.textContent).toContain(
    '竞拍 A · 250 / 竞拍 B · 200',
  );
  expect(node.querySelectorAll('.resolved-action-list>article')).toHaveLength(
    2,
  );
  for (const d of node.querySelectorAll<HTMLDetailsElement>(
    '.settlement-disclosures>details:not(.result-market-details)',
  )) {
    await click(d.querySelector('summary')!);
    expect(d.open).toBe(true);
  }
  expect(node.querySelector('.event-panel')).toBeNull();
  expect(node.querySelector('.event-list')).toBeNull();
  expect(node.querySelector('.settlement-fund-notes')!.textContent).toContain(
    '福袋返还',
  );
  const destroy = g.roomSettlement!.events.find(
    (e) => e.playerId === 'human' && e.type === 'destroy',
  );
  if (destroy)
    expect(node.querySelector('.reward-settlement')!.textContent).toContain(
      destroy.message,
    );
  expect(advance).not.toHaveBeenCalled();
  expect(ranking).not.toHaveBeenCalled();
  expect(g).toEqual(before);
  await click(button('积分排行'));
  expect(ranking).toHaveBeenCalledExactlyOnceWith('score');
  await click(button('争夺榜'));
  expect(ranking).toHaveBeenLastCalledWith('contest');
  await click(button('进入下一房间'));
  expect(advance).toHaveBeenCalledOnce();
});
it('keeps the compact status read-only and closes it with Escape from its native summary', async () => {
  await show(
    createElement(
      SettlementStatus,
      { brief: '生存 · 1层 2/5房 · 资金569' },
      createElement('p', null, '斩杀线200'),
    ),
  );
  const d = node.querySelector('details')!;
  await click(d.querySelector('summary')!);
  expect(d.open).toBe(true);
  await act(async () =>
    d
      .querySelector('summary')!
      .dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
      ),
  );
  expect(d.open).toBe(false);
  expect(localStorage.length).toBe(0);
});
it.each(['classic', 'survival'] as const)(
  'places %s tools and lifecycle separately, preserves save on reading/cancelling and restarts only after confirmation',
  async (mode) => {
    if (mode === 'classic') {
      let s = reduceGameSession(createGameSession(42), {
        type: 'start_game',
        characterId: 'isaac',
      });
      s = reduceGameSession(s, {
        type: 'submit_player_turn',
        turn: {
          playerId: 'human',
          actions: [{ type: 'bid', group: 'A', amount: 25 }],
        },
      });
      localStorage.setItem(gameSaveKey, serializeGameCheckpoint(s));
    } else {
      let s = startSurvivalClient('isaac', 1, 'standard');
      s = reduceSurvivalClient(s, {
        type: 'submit_player_turn',
        turn: {
          playerId: 'human',
          actions: [{ type: 'bid', group: 'B', amount: 250 }],
        },
      });
      localStorage.setItem(
        survivalSaveKey,
        serializeSurvivalCheckpoint(s.game, s.draft),
      );
    }
    localStorage.setItem(activeModeKey, mode);
    await show(createElement(GameApp));
    const key = mode === 'classic' ? gameSaveKey : survivalSaveKey,
      before = localStorage.getItem(key);
    expect(node.querySelector('.topbar .settlement-status')).not.toBeNull();
    expect(node.querySelector('.settlement-mode')!.textContent).toBe(
      mode === 'classic' ? '经典' : '生存',
    );
    expect(node.querySelector('.settlement-position')!.textContent).toContain(
      '第1层',
    );
    expect(node.querySelectorAll('.topbar .app-version')).toHaveLength(1);
    expect(node.querySelector('.brand-kicker .app-version')).not.toBeNull();
    expect(node.querySelector('.topbar-session .app-version')).toBeNull();
    if (mode === 'survival') {
      expect(
        node.querySelector('.settlement-status-body .survival-status'),
      ).toBeNull();
      expect(
        node.querySelector('.settlement-status-body dl')!.textContent,
      ).toContain('斩杀线');
    }
    expect(
      node.querySelector('.settlement-heading nav')!.textContent,
    ).toContain('本局回放');
    expect(node.querySelector('.settlement-lifecycle')!.textContent).toContain(
      '返回主菜单',
    );
    expect(node.querySelector('.settlement-lifecycle')!.textContent).toContain(
      '重新开始',
    );
    expect(
      node.querySelector('.settlement-primary-actions')!.textContent,
    ).not.toContain('重新开始');
    await click(button('重新开始'));
    expect(node.textContent).toContain('结束当前对局');
    await click(button(mode === 'classic' ? '保留当前对局' : '取消'));
    expect(localStorage.getItem(key)).toBe(before);
    await click(button('查看构筑'));
    expect(node.querySelector('.settlement-heading')).not.toBeNull();
    await click(
      [...node.querySelectorAll<HTMLButtonElement>('button')].find(
        (e) => e.textContent?.trim() === '返回游戏',
      )!,
    );
    expect(localStorage.getItem(key)).toBe(before);
    await click(button('重新开始'));
    await click(button('确认重新开始'));
    expect(node.textContent).toContain('选择角色');
  },
);

it('keeps the computation concise without zero retroactivity and retains all raw events unchanged', async () => {
  const g = fixture(),
    before = structuredClone(g);
  await show(result(g));
  expect(
    node.querySelector('.settlement-disclosures')!.textContent,
  ).not.toContain('结算事件');
  expect(node.querySelector('.score-total-row')).toBeNull();
  const line = node.querySelector('.settlement-calculation-line')!;
  expect(line.textContent).not.toContain('追溯追加');
  expect(line.textContent).not.toContain('倍率后');
  expect(line.textContent!.match(/本房积分/g)).toHaveLength(1);
  expect(node.querySelector('.player-settlement')!.textContent).toContain(
    '计入本房倍率',
  );
  expect(node.querySelector('.settlement-fund-notes')!.textContent).toContain(
    '福袋返还 188',
  );
  expect(g).toEqual(before);
});
it('explains a changed scoring value only with recorded action-specific adjustment evidence', async () => {
  const g = fixture({ owned: ['brimstone'], amount: 100 });
  const breakdown = g.roomSettlement!.scoreBreakdowns.human!,
    action = g.roomSettlement!.resolvedActions.find(
      (a) => a.playerId === 'human',
    )!;
  expect(breakdown.triggers.some((t) => t.kind === 'scoring_adjustment')).toBe(
    true,
  );
  const before = structuredClone(g);
  await show(result(g));
  expect(node.querySelector('.settlement-scoring-note')!.textContent).toContain(
    `硫磺火计分修正：合作判定 ${action.scoringEquivalent} → 计分取值 ${breakdown.actions[0]!.scoringValue}`,
  );
  expect(node.querySelector('.settlement-scoring-note')!.textContent).toContain(
    `市场等价 ${action.marketEquivalent} 不变`,
  );
  expect(g).toEqual(before);
  const noProof = structuredClone(g);
  noProof.roomSettlement!.scoreBreakdowns.human!.triggers = [];
  await show(result(noProof));
  expect(
    node.querySelector('.settlement-scoring-note')?.textContent ?? '',
  ).toBe('');
});
it('keeps refund and destruction explanations with their outcomes, without presenting ordinary award messages again', async () => {
  const g = fixture();
  g.roomSettlement!.events.push({
    type: 'destroy',
    playerId: 'human',
    group: 'B',
    effectItemId: 'more_options',
    message: '测试：B组道具被摧毁',
  });
  const before = structuredClone(g);
  await show(result(g));
  expect(node.querySelector('.reward-settlement')!.textContent).toContain(
    '测试：B组道具被摧毁',
  );
  expect(node.querySelector('.player-settlement')!.textContent).not.toContain(
    '测试：B组道具被摧毁',
  );
  expect(node.querySelector('.player-settlement')!.textContent).toContain(
    '福袋返还',
  );
  expect(
    node.querySelector('.settlement-disclosures')!.textContent,
  ).not.toContain('获得道具 grab_bag');
  expect(node.querySelectorAll('.settlement-person')).not.toHaveLength(0);
  expect(g).toEqual(before);
});
