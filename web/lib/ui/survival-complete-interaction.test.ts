// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import { SurvivalComplete } from '@/components/game/survival-complete';
import { GameApp } from '@/components/game/game-app';
import {
  startSurvivalClient,
  reduceSurvivalClient,
  activeModeKey,
} from './survival-client';
import { createSurvivalReplay } from './survival-record';
import { finalSurvivalBoard } from './survival-board';
import { survivalFinalGapLabel } from '@/components/game/survival-final-board';
import {
  startSurvivalGame,
  survivalGameReducer,
} from '../game/survival-session';
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
const render = async (view: Parameters<Root['render']>[0]) =>
  act(async () => root.render(view));
const click = async (el: HTMLElement) => act(async () => el.click());
const button = (text: string) => {
  const b = [...node.querySelectorAll<HTMLButtonElement>('button')].find(
    (b) => b.textContent?.trim() === text,
  );
  if (!b) throw Error('missing ' + text);
  return b;
};
const props = () => ({
  onNew: vi.fn(),
  onBuild: vi.fn(),
  onReplay: vi.fn(),
  onReturnMenu: vi.fn(),
});
function complete(seed: number, mode: 'budget' | 'withdraw') {
  let s = startSurvivalClient('isaac', seed, 'standard');
  for (
    let step = 0;
    step < 250 && s.game.phase !== 'competition_complete';
    step++
  ) {
    const g = s.game,
      h = g.players.find((p) => p.id === 'human')!;
    s = reduceSurvivalClient(
      s,
      g.phase === 'room_action'
        ? g.activePlayerIds.includes('human')
          ? {
              type: 'submit_player_turn',
              turn: {
                playerId: 'human',
                actions:
                  mode === 'withdraw' || h.money < 1
                    ? [{ type: 'withdraw' }]
                    : [
                        {
                          type: 'bid',
                          group: g.roomIndex % 2 ? 'B' : 'A',
                          amount: Math.max(
                            1,
                            Math.floor(h.money / (5 - g.roomIndex)),
                          ),
                        },
                      ],
              },
            }
          : { type: 'submit_ai_room' }
        : {
            type: g.phase === 'room_result' ? 'advance_room' : 'advance_floor',
          },
    );
  }
  if (s.game.phase !== 'competition_complete') throw Error('not complete');
  return s;
}

it.each([
  ['withdraw', 'below_cut_line', '线下淘汰'],
  ['budget', 'lowest_score', '末位补淘汰'],
] as const)(
  'explains %s from frozen recorded facts and retains every final rank and floor value',
  async (mode, reason, label) => {
    const s = complete(1, mode),
      log = createSurvivalReplay(s.game),
      before = structuredClone(log),
      model = finalSurvivalBoard(log),
      p = props();
    expect(log.final!.eliminated.human!.reason).toBe(reason);
    await render(
      createElement(SurvivalComplete, {
        ...p,
        log,
        decimals: 4,
        aiProfiles: s.game.aiProfiles,
      }),
    );
    expect(node.querySelectorAll('h2')).toHaveLength(1);
    expect(
      node.querySelector('.survival-complete-reason')!.textContent,
    ).not.toContain('原判定');
    expect(node.querySelectorAll('.final-table tbody tr')).toHaveLength(20);
    for (const [index, row] of [
      ...node.querySelectorAll<HTMLElement>('.final-table tbody tr'),
    ].entries()) {
      const expected = model.rows[index]!,
        player = log.final!.players.find((p) => p.id === expected.playerId)!;
      expect(row.dataset.playerId).toBe(expected.playerId);
      expect(row.querySelector('[data-final-score]')!.textContent).toBe(
        expected.total.toFixed(4),
      );
      expect(row.querySelector('[data-final-status]')!.textContent).toBe(
        expected.statusLabel,
      );
      expect(
        [...row.querySelectorAll<HTMLElement>('[data-item-instance]')].map(
          (e) => e.dataset.itemInstance,
        ),
      ).toEqual(player.items.map((i) => i.instanceId));
      expect(row.textContent).not.toContain('资金');
    }
    expect(
      [...node.querySelectorAll<HTMLElement>('.podium-card')].map(
        (e) => e.dataset.podiumPlayer,
      ),
    ).toEqual(model.rows.slice(0, 3).map((r) => r.playerId));
    await click(button('分层成绩'));
    expect(
      [...node.querySelectorAll('thead th small')].map((e) => e.textContent),
    ).toEqual(model.rows[0]!.floors.map(() => '新增积分'));
    expect(
      node.querySelector('.survival-complete-outcomes')!.textContent,
    ).toContain(label);
    const own = model.rows.find((r) => r.playerId === 'human')!;
    expect(node.querySelector('[data-final-human-score]')!.textContent).toBe(
      own.total.toFixed(4),
    );
    const elimination = log.final!.eliminated.human!;
    expect(
      node.querySelector('.survival-complete-reason')!.textContent,
    ).toContain(elimination.score.survivalScore.toFixed(4));
    if (reason === 'lowest_score')
      expect(
        node.querySelector('.survival-complete-reason')!.textContent,
      ).toContain('达线仍可能末位补淘汰');
    const rows = [...node.querySelectorAll<HTMLElement>('tbody tr')];
    expect(rows).toHaveLength(20);
    expect(rows.map((r) => r.dataset.playerId)).toEqual(
      model.rows.map((r) => r.playerId),
    );
    for (const [index, row] of rows.entries()) {
      const expected = model.rows[index]!;
      expect(row.querySelector('[data-total] strong')!.textContent).toBe(
        expected.total.toFixed(4),
      );
      expect(row.querySelector('.survival-board-status')!.textContent).toBe(
        expected.statusLabel,
      );
      expected.floors.forEach((cell, i) => {
        expect(
          row.querySelector(`[data-floor="${i}"] strong`)!.textContent,
        ).toBe(cell ? cell.score.toFixed(4) : '—');
      });
    }
    const self = node.querySelector<HTMLElement>('[data-ranking-self="true"]')!,
      scroll = vi.fn();
    Object.defineProperty(self, 'scrollIntoView', { value: scroll });
    await click(button('定位本人'));
    expect(document.activeElement).toBe(self);
    expect(scroll).toHaveBeenCalledOnce();
    expect(p.onNew).not.toHaveBeenCalled();
    expect(log).toEqual(before);
    expect(localStorage.length).toBe(0);
    await click(button('再来一局生存'));
    expect(p.onNew).toHaveBeenCalledOnce();
  },
);
it('shows a surviving human and no-champion outcome without manufacturing a champion or elimination', async () => {
  const s = complete(2, 'budget'),
    log = createSurvivalReplay(s.game),
    before = structuredClone(log);
  expect(log.final!.eliminated.human).toBeUndefined();
  await render(createElement(SurvivalComplete, { ...props(), log }));
  expect(
    node.querySelector('.survival-complete-outcomes')!.textContent,
  ).toContain('存活至终局');
  expect(
    node.querySelector('.survival-complete-outcomes .complete-alive'),
  ).not.toBeNull();
  expect(log).toEqual(before);
  // An explicit internal high-cut-line fixture, not standard-mode natural play.
  let allOut = startSurvivalGame({
    seed: 1,
    characterId: 'isaac',
    cutLines: Array(7).fill(1000000),
  });
  while (allOut.phase !== 'competition_complete') {
    allOut = survivalGameReducer(
      allOut,
      allOut.phase === 'room_action'
        ? {
            type: 'submit_player_turn',
            turn: { playerId: 'human', actions: [{ type: 'withdraw' }] },
          }
        : {
            type:
              allOut.phase === 'room_result' ? 'advance_room' : 'advance_floor',
          },
    );
  }
  const noChampion = createSurvivalReplay(allOut);
  expect(noChampion.final!.reason).toBe('all_eliminated');
  await render(
    createElement(SurvivalComplete, { ...props(), log: noChampion }),
  );
  expect(node.querySelector('.complete-champion')!.textContent).toBe('无冠军');
  expect(node.querySelector('.podium-1 .podium-rank svg')).toBeNull();
});
it('keeps early-eliminated personal header facts frozen while the final AI floor and read-only tools differ', async () => {
  const s = complete(1, 'withdraw'),
    frozen = s.game.eliminated.human!;
  expect(frozen.floorIndex).toBeLessThan(s.game.floorIndex);
  localStorage.setItem(
    survivalSaveKey,
    serializeSurvivalCheckpoint(s.game, s.draft),
  );
  localStorage.setItem(activeModeKey, 'survival');
  await render(createElement(GameApp));
  await act(async () => new Promise((r) => setTimeout(r, 30)));
  expect(node.querySelector('.survival-complete')).not.toBeNull();
  expect(node.querySelector('.survival-settled-status')).toBeNull();
  expect(node.querySelector('.topbar .settlement-status')).not.toBeNull();
  const facts = node.querySelector('.settlement-status-facts')!.textContent!;
  expect(facts).toContain('个人结果层／斩杀线第 1 层');
  expect(facts).toContain('个人结算房间分' + frozen.score.roomScore.toFixed(2));
  expect(facts).toContain(frozen.score.inheritedScore.toFixed(2));
  expect(facts).toContain(frozen.score.exchangedScore.toFixed(2));
  const before = localStorage.getItem(survivalSaveKey);
  for (const label of ['查看构筑', '本局回放']) {
    await click(button(label));
    await click(button('返回游戏'));
    expect(localStorage.getItem(survivalSaveKey)).toBe(before);
  }
  await click(button('再来一局生存'));
  expect(node.textContent).toContain('选择角色');
});

it('does not explain a survival-priority boundary using an incomparable point gap or invent AI traits from a factual replay', async () => {
  const s = complete(1, 'budget'),
    log = createSurvivalReplay(s.game),
    model = finalSurvivalBoard(log),
    before = structuredClone(log);
  const boundary = model.rows.findIndex(
    (row, i) => i > 0 && row.active !== model.rows[i - 1]!.active,
  );
  expect(boundary).toBeGreaterThan(0);
  expect(
    survivalFinalGapLabel(model.rows[boundary]!, model.rows[boundary - 1], 2),
  ).toBe('存活状态优先排序');
  const row = model.rows.find((r) => !r.active)!;
  expect(
    survivalFinalGapLabel(
      row,
      { ...row, eliminationFloorIndex: (row.eliminationFloorIndex ?? 0) + 1 },
      2,
    ),
  ).toBe('淘汰层数优先排序');
  expect(survivalFinalGapLabel(row, { ...row }, 4)).toBe('与上一名同分');
  await render(createElement(SurvivalComplete, { ...props(), log }));
  expect(node.querySelectorAll('[data-ai-personality]')).toHaveLength(0);
  expect(node.textContent).toContain('流派未记录');
  expect(log).toEqual(before);
});

it('routes survival AI capsules to the exact read-only glossary entry and back', async () => {
  const s = complete(2, 'budget');
  localStorage.setItem(
    survivalSaveKey,
    serializeSurvivalCheckpoint(s.game, s.draft),
  );
  localStorage.setItem(activeModeKey, 'survival');
  await render(createElement(GameApp));
  await act(async () => new Promise((r) => setTimeout(r, 30)));
  const before = localStorage.getItem(survivalSaveKey),
    table = node.querySelector('.survival-final .final-table')!;
  const trait = node.querySelector<HTMLButtonElement>(
      'button[data-ai-personality]',
    )!,
    key = trait.dataset.aiPersonality!;
  await click(trait);
  expect(
    node.querySelector(`.ai-guide-reader [data-guide-personality="${key}"]`),
  ).not.toBeNull();
  await click(button('游戏'));
  expect(node.querySelector('.survival-final .final-table')).toBe(table);
  expect(localStorage.getItem(survivalSaveKey)).toBe(before);
});
