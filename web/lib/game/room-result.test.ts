import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { RoomResult } from '@/components/game/room-result';
import { startClientGame } from './client-session';
import { defaultRules } from './config';
import type { ItemId, PlayerTurn } from './item-types';
import { settleRuntimeRoom } from './room-engine';
import { createRuntimePlayer } from './runtime';

function renderResult(itemId: ItemId, clearScore = false, withdraw = false) {
  const human = createRuntimePlayer({ id: 'human', money: 100, score: 200, isHuman: true });
  human.characterId = 'isaac';
  if (clearScore) human.items.push({ instanceId: 'eternal', itemId: 'eternal_d6', acquiredOrder: 1 });
  const room = {
    floorIndex: 0, roomIndex: 4, kind: 'boss' as const,
    rewards: [
      { group: 'A' as const, itemId, hidden: false },
      { group: 'B' as const, itemId: 'interest' as const, hidden: false },
    ] as const,
  };
  const turns: PlayerTurn[] = [{
    playerId: 'human',
    actions: withdraw ? [{ type: 'withdraw' }] : [{ type: 'bid', group: 'A', amount: 40 }],
  }];
  const settlement = settleRuntimeRoom(room, [human], turns, defaultRules, { next: () => 0 });
  const game = {
    ...startClientGame('isaac', 42),
    phase: 'room_result' as const,
    floorIndex: 0,
    roomIndex: 4,
    players: settlement.players,
    roomSettlement: { ...settlement, room, turns, playersBefore: [human] },
  };
  const html = renderToStaticMarkup(createElement(RoomResult, {
    game, onShowRanking: () => {}, onAdvance: () => {},
  }));
  const calculation = html.match(/<div class="settlement-calculation-line"[^>]*>(.*?)<\/div>/s)?.[1];
  expect(calculation).toBeDefined();
  return { html, text: html.replace(/<[^>]+>/g, ''), calculation: calculation!.replace(/<[^>]+>/g, '').replace(/\s+/g, ''), settlement, human };
}

describe('room result score presentation', () => {
  it('uses the same final room score in the summary and heart-adjusted breakdown', () => {
    const { text, calculation, settlement, human } = renderResult('moms_heart');
    const initial = settlement.scoreBreakdowns.human!.score;
    const final = (settlement.players[0]!.score - human.score).toFixed(2);
    expect(text).toContain(`本房积分+${final}`);
    const summary = settlement.roomScoreSummaries.human!;
    expect(summary.initialScore).toBe(initial);
    expect(summary.retroactiveScore).toBe(initial);
    expect(summary.finalScore).toBe(initial * 2);
    expect(summary.initialScore + summary.retroactiveScore).toBe(summary.finalScore);
    expect(calculation).toContain(`倍率后${initial.toFixed(2)}＋追溯追加${initial.toFixed(2)}→本房积分${final}`);
    expect(calculation).toContain('×本房倍率2.000');
    expect(summary.retroactiveMultiplier).toBe(2);
    expect(settlement.scoreBreakdowns.human!.multiplier * summary.retroactiveMultiplier).toBe(4);
  });

  it('shows no retroactive bonus for a newly awarded Sacred Heart', () => {
    const { text, calculation, settlement } = renderResult('sacred_heart');
    const score = settlement.scoreBreakdowns.human!.score.toFixed(2);
    expect(text).toContain(`本房积分+${score}`);
    expect(calculation).toContain(`→本房积分${score}`);
    expect(settlement.roomScoreSummaries.human!.retroactiveScore).toBe(0);
    expect(settlement.roomScoreSummaries.human!.finalScore).toBe(settlement.scoreBreakdowns.human!.score);
    expect(calculation).not.toContain('追溯追加');
  });

  it('keeps cleared rooms at zero after a heart is awarded', () => {
    const { text, calculation, settlement } = renderResult('moms_heart', true);
    expect(text).toContain('本房积分+0.00');
    expect(calculation).toContain('→本房积分0.00');
    expect(settlement.roomScoreSummaries.human!.retroactiveScore).toBe(0);
    expect(settlement.roomScoreSummaries.human!.finalScore).toBe(0);
    expect(calculation).not.toContain('追溯追加');
    expect(text).toContain('本房间积分因道具效果被清零');
  });

  it('renders an all-withdraw room with a zero final score and no market baseline', () => {
    const { text, calculation, settlement } = renderResult('moms_heart', false, true);
    expect(text).toContain('无市场样本');
    expect(text).toContain('本房积分+0.00');
    expect(calculation).toBe('计分小计0.00×本房倍率1.000→本房积分0.00');
    expect(settlement.roomScoreSummaries.human!.finalScore).toBe(0);
  });
});
