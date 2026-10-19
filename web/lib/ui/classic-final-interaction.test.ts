// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { it, expect, beforeEach, afterEach, vi } from 'vitest';
import { GameResult } from '@/components/game/game-result';
import { classicFinalGapLabel } from '@/components/game/classic-final-ranking';
import { getItemDefinition, aiPersonalityNames } from '@/lib/game';
import { itemPresentations } from '@/lib/game/item-presentation';
import { ItemArtAvailability } from '@/components/game/item-icon';
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
it('keeps recorded final order, full table and character podium at selected precision, without invoking restart while reading', async () => {
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
    expect(row.querySelector('[data-final-score]')!.textContent).toBe(
      entry.finalScore.toFixed(4),
    );
    expect(row.querySelector('[data-final-money]')).toBeNull();
    expect(row.textContent).not.toContain('资金');
    expect(
      row.querySelector<HTMLElement>('[data-item-count]')!.dataset.itemCount,
    ).toBe(String(p.items.length));
    expect(
      [...row.querySelectorAll<HTMLElement>('[data-item-instance]')].map(
        (e) => e.dataset.itemInstance,
      ),
    ).toEqual(p.items.map((i) => i.instanceId));
    expect(
      [
        ...row.querySelectorAll<HTMLElement>(
          '.final-inventory-icons [data-item-id]',
        ),
      ].map((e) => e.dataset.itemId),
    ).toEqual(p.items.map((i) => i.itemId));
    expect(row.querySelector('[data-final-gap]')!.textContent).toBe(
      classicFinalGapLabel(
        entry.finalScore,
        game.finalRanking[i - 1]?.finalScore,
        4,
      ),
    );
    expect(row.querySelector('[data-player-kind]')!.textContent).toBe(
      p.id === game.humanPlayerId ? '真人' : 'AI',
    );
    const profile = game.aiProfiles[p.id];
    const identity = row.querySelector('[data-player-kind]')!;
    const doctrine = row.querySelector<HTMLElement>('[data-ai-doctrine]');
    if (profile) {
      expect(doctrine?.dataset.aiDoctrine).toBe(profile.doctrine);
      expect(doctrine?.classList.contains('final-doctrine-pill')).toBe(true);
      expect(identity.nextElementSibling).toBe(doctrine);
      expect(doctrine?.nextElementSibling).toBe(
        row.querySelector('[data-ai-personality]'),
      );
    } else expect(doctrine).toBeNull();
    expect(
      [...row.querySelectorAll('[data-ai-personality]')].map(
        (e) => e.textContent,
      ),
    ).toEqual(profile?.personalities.map((p) => aiPersonalityNames[p]) ?? []);
  }
  expect(
    [...node.querySelectorAll('.podium-card>strong')].map((e) => e.textContent),
  ).toEqual(game.finalRanking.slice(0, 3).map((e) => e.finalScore.toFixed(4)));
  const awards = [...node.querySelectorAll<HTMLElement>('.podium-card')];
  expect(
    node.querySelector('.classic-final-awards')!.textContent,
  ).not.toContain('资金');
  expect(node.querySelector('.classic-final-outcomes')!.textContent).toContain(
    `${game.players.find((p) => p.id === game.humanPlayerId)!.money} 资金`,
  );
  expect(awards.map((e) => e.dataset.podiumPlayer)).toEqual(
    game.finalRanking.slice(0, 3).map((e) => e.playerId),
  );
  for (const award of awards) {
    const p = game.players.find((p) => p.id === award.dataset.podiumPlayer)!;
    expect(
      award.querySelector<HTMLElement>('.character-art')!.dataset.characterId,
    ).toBe(p.characterId);
    expect(award.querySelectorAll('.character-art-figure')).toHaveLength(
      p.characterId === 'jacob_esau' ? 2 : 1,
    );
  }
  expect(
    node.querySelector('.classic-final-showcase .final-ranking-panel'),
  ).toBeNull();
  expect(
    node.querySelector('.classic-final-layout > .final-ranking-panel'),
  ).not.toBeNull();
  expect(
    node.querySelector('.classic-final-showcase .classic-final-outcomes'),
  ).not.toBeNull();
  expect(
    node.querySelector('.classic-final-lifecycle .final-actions button'),
  ).not.toBeNull();
  expect(node.textContent).not.toContain('按本局已记录的最终顺序');
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
it('retains terminal phase through build/replay/settings navigation and moves real restart to the bottom action bar', async () => {
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

it('formats adjacent gaps without changing ties or rounding a positive difference into a tie', () => {
  expect(classicFinalGapLabel(1563.02, 1569.07, 2)).toBe('距上一名差6.05分');
  expect(classicFinalGapLabel(2048.44, undefined, 2)).toBe('榜首');
  expect(classicFinalGapLabel(100, 100, 4)).toBe('与上一名同分');
  expect(classicFinalGapLabel(1, 1.000001, 2)).toBe('距上一名不足0.01分');
  expect(classicFinalGapLabel(1, 1.000001, 4)).toBe('距上一名不足0.0001分');
  expect(classicFinalGapLabel(2, 1, 2)).toBe('较上一名高1.00分');
});
it('retains every repeated instance and empty inventory, and opens a read-only item description', async () => {
  const game = structuredClone(completed().game);
  if (game.phase !== 'game_result') throw Error('final');
  const first = game.players.find(
    (p) => p.id === game.finalRanking[0]!.playerId,
  )!;
  first.items = Array.from({ length: 18 }, (_, i) => ({
    instanceId: `display-copy-${i}`,
    itemId: 'd6' as const,
    acquiredOrder: i,
  }));
  const second = game.players.find(
    (p) => p.id === game.finalRanking[1]!.playerId,
  )!;
  second.items = [];
  const before = structuredClone(game),
    restart = vi.fn();
  await show(
    createElement(GameResult, { game, onRestart: restart, embedded: true }),
  );
  const rows = node.querySelectorAll('tbody tr');
  expect(rows[0]!.querySelectorAll('[data-item-instance]')).toHaveLength(18);
  expect(rows[1]!.textContent).toContain('0件道具暂无道具');
  const trigger =
    rows[0]!.querySelector<HTMLButtonElement>('.final-item-button')!;
  expect(trigger.title).toContain(itemPresentations.d6.description);
  await click(trigger);
  const dialog = document.querySelector('[role="dialog"]')!;
  expect(dialog).not.toBeNull();
  expect(dialog.textContent).toContain(getItemDefinition('d6').name);
  expect(dialog.textContent).toContain(itemPresentations.d6.description);
  await click(
    dialog.querySelector<HTMLButtonElement>('[aria-label="关闭道具详情"]')!,
  );
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(game).toEqual(before);
  expect(restart).not.toHaveBeenCalled();
});

it('keeps item names and inspection accessible when an atlas is unavailable', async () => {
  const game = completed().game;
  if (game.phase !== 'game_result') throw Error('final');
  await show(
    createElement(
      ItemArtAvailability.Provider,
      { value: { collectibles: false, trinkets: false, pickups: false } },
      createElement(GameResult, { game, onRestart: vi.fn(), embedded: true }),
    ),
  );
  const icons = node.querySelectorAll('.final-inventory-icons .item-icon');
  expect(icons.length).toBeGreaterThan(0);
  expect(
    [...icons].every((e) => e.getAttribute('data-icon-kind') === 'fallback'),
  ).toBe(true);
  expect(
    [...node.querySelectorAll<HTMLButtonElement>('.final-item-button')].every(
      (e) =>
        e.title.includes('：') &&
        e.getAttribute('aria-label')?.startsWith('查看'),
    ),
  ).toBe(true);
});
