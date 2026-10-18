// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import { SurvivalFloorResult } from '@/components/game/survival-floor-result';
import { SurvivalFloorFacts } from '@/components/game/survival-replay-viewer';
import { GameApp } from '@/components/game/game-app';
import {
  startSurvivalClient,
  reduceSurvivalClient,
  activeModeKey,
} from './survival-client';
import {
  serializeSurvivalCheckpoint,
  survivalSaveKey,
  parseSurvivalCheckpoint,
} from './survival-persistence';
import {
  createSurvivalReplay,
  type SurvivalReplayLog,
} from './survival-record';
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
const button = (name: string) => {
  const b = [...node.querySelectorAll<HTMLButtonElement>('button')].find(
    (b) => b.textContent?.trim() === name,
  );
  if (!b) throw Error('missing ' + name);
  return b;
};
function fixture(index = 0) {
  for (let seed = 1; seed <= 20; seed++) {
    let s = startSurvivalClient('isaac', seed, 'standard');
    for (
      let step = 0;
      step < 100 && s.game.phase !== 'competition_complete';
      step++
    ) {
      const g = s.game;
      if (
        g.phase === 'floor_result' &&
        g.floorIndex === index &&
        g.activePlayerIds.includes('human')
      )
        return s;
      if (!g.activePlayerIds.includes('human')) break;
      s = reduceSurvivalClient(
        s,
        g.phase === 'room_action'
          ? {
              type: 'submit_player_turn',
              turn: {
                playerId: 'human',
                actions: [
                  {
                    type: 'bid',
                    group: 'A',
                    amount:
                      Math.min(
                        250,
                        g.players.find((p) => p.id === 'human')!.money,
                      ) || 1,
                  },
                ],
              },
            }
          : {
              type:
                g.phase === 'room_result' ? 'advance_room' : 'advance_floor',
            },
      );
    }
  }
  throw Error('no current-rule floor fixture');
}
const props = (log: SurvivalReplayLog, index = 0) => ({
  log,
  index,
  onAdvance: vi.fn(),
  onBuild: vi.fn(),
  onReplay: vi.fn(),
  onReturnMenu: vi.fn(),
  onRestart: vi.fn(),
});
it('prioritizes the recorded human result and preserves every ledger row, score and outcome', async () => {
  const s = fixture(),
    log = createSurvivalReplay(s.game),
    before = structuredClone(log),
    p = props(log),
    f = log.floors[0]!,
    h = f.scores.human!;
  await render(createElement(SurvivalFloorResult, p));
  expect(node.querySelectorAll('h2')).toHaveLength(1);
  expect(node.querySelector('.floor-outcomes')!.textContent).toContain(
    '本层存活',
  );
  expect(node.querySelector('.floor-outcomes')!.textContent).toContain(
    h.survivalScore.toFixed(2),
  );
  expect(node.querySelector('.floor-outcomes')!.textContent).toContain(
    h.newScore.toFixed(2),
  );
  expect(node.querySelector('.floor-ledger .survival-floor-stats')).toBeNull();
  const rows = [...node.querySelectorAll('tbody tr')];
  expect(rows).toHaveLength(f.activePlayerIds.length);
  const sorted = f.activePlayerIds
    .slice()
    .sort((a, b) => f.scores[b]!.survivalScore - f.scores[a]!.survivalScore);
  for (const [i, id] of sorted.entries()) {
    const score = f.scores[id]!,
      removed = f.plan.eliminations.find((e) => e.playerId === id);
    expect([...rows[i]!.children].map((e) => e.textContent)).toEqual([
      log.playerNames[id],
      score.roomScore.toFixed(2),
      score.exchangedScore.toFixed(2),
      score.inheritedScore.toFixed(2),
      score.newScore.toFixed(2),
      score.survivalScore.toFixed(2),
      (score.survivalScore - f.cutLine).toFixed(2),
      removed
        ? removed.reason === 'below_cut_line'
          ? '线下淘汰'
          : '末位补淘汰'
        : '存活',
    ]);
  }
  const self = node.querySelector<HTMLElement>('[data-ranking-self="true"]')!,
    scroll = vi.fn();
  Object.defineProperty(self, 'scrollIntoView', { value: scroll });
  await click(button('定位本人'));
  expect(document.activeElement).toBe(self);
  expect(scroll).toHaveBeenCalledOnce();
  expect(p.onAdvance).not.toHaveBeenCalled();
  expect(log).toEqual(before);
  expect(localStorage.length).toBe(0);
  await click(button('进入下一层'));
  expect(p.onAdvance).toHaveBeenCalledOnce();
});
it('does not infer survival from a positive margin and keeps the recorded finish button branch', async () => {
  const s = fixture(),
    log = structuredClone(createSurvivalReplay(s.game)),
    f = log.floors[0]!;
  // Explicit presentation fixture; not a naturally recorded elimination.
  f.plan.survivorIds = f.plan.survivorIds.filter((id) => id !== 'human');
  f.plan.eliminations.push({
    playerId: 'human',
    reason: 'lowest_score',
  } as (typeof f.plan.eliminations)[number]);
  f.plan.shouldFinish = true;
  const before = structuredClone(log);
  await render(
    createElement(SurvivalFloorResult, { ...props(log), decimals: 4 }),
  );
  expect(node.querySelector('.floor-verdict')!.textContent).toBe('末位补淘汰');
  expect(button('查看生存总榜')).toBeTruthy();
  expect(node.querySelector('.floor-outcomes')!.textContent).toContain(
    f.scores.human!.survivalScore.toFixed(4),
  );
  expect(log).toEqual(before);
});
it('leaves the existing read-only replay floor presentation unchanged by default', async () => {
  const log = createSurvivalReplay(fixture().game),
    before = structuredClone(log);
  await render(createElement(SurvivalFloorFacts, { log, index: 0 }));
  expect(node.querySelector('h3')!.textContent).toContain('斩杀线');
  expect(node.querySelectorAll('.survival-floor-stats article')).toHaveLength(
    4,
  );
  expect(node.querySelector('.floor-ledger-scroll')).toBeNull();
  expect(node.querySelector('.floor-outcomes')).toBeNull();
  expect(log).toEqual(before);
});
it('shows recorded inherited/exchanged floor values in the compact header and preserves the match while reading and cancelling', async () => {
  const s = fixture(1),
    f = s.game.floorRecords.at(-1)!,
    h = f.scores.human!;
  expect(h.inheritedScore).toBeGreaterThan(0);
  localStorage.setItem(
    survivalSaveKey,
    serializeSurvivalCheckpoint(s.game, s.draft),
  );
  localStorage.setItem(activeModeKey, 'survival');
  await render(createElement(GameApp));
  const before = localStorage.getItem(survivalSaveKey);
  expect(node.querySelector('.topbar .settlement-status')).not.toBeNull();
  expect(node.querySelector('.survival-settled-status')).toBeNull();
  expect(node.querySelector('.survival-tools')?.hasAttribute('hidden')).toBe(
    true,
  );
  expect(node.querySelector('.settlement-status-facts')!.textContent).toContain(
    '结算继承' + h.inheritedScore.toFixed(2),
  );
  expect(node.querySelector('.settlement-status-facts')!.textContent).toContain(
    '余额兑换' + h.exchangedScore.toFixed(2),
  );
  for (const label of ['查看构筑', '本局回放']) {
    await click(button(label));
    await click(button('返回游戏'));
    expect(localStorage.getItem(survivalSaveKey)).toBe(before);
  }
  await click(button('重新开始'));
  await click(button('取消'));
  expect(localStorage.getItem(survivalSaveKey)).toBe(before);
  await click(button('进入下一层'));
  expect(
    parseSurvivalCheckpoint(localStorage.getItem(survivalSaveKey)!).game
      .floorIndex,
  ).toBe(s.game.floorIndex + 1);
  expect(node.querySelector('#bid-A')).not.toBeNull();
});
