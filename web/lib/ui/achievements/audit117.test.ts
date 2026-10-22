import { expect, it } from 'vitest';
import {
  audit117Plan as plan,
  audit117Seed,
  audit117Tasks,
} from '../../../scripts/audit117-plan.mjs';
import { runEdgeMatch, chooseEdgeTurn } from './audit117-edge.test-helper';
import { startSurvivalClient, survivalRoomRules } from '../survival-client';
import { validateTurn } from '../../game/turns';
import { canonicalJson } from '../../shared/json-facts';
import { sha256Hex } from '../../shared/sha256';
it('fixes bounded supplementary counts, paired 50-game seeds, and separate matrix/pilot seeds', () => {
  expect(plan.matrixBlocks * 8 * 5 * 3 + 6 * 3 * 20 + 6 * 50).toBe(1140);
  expect(audit117Tasks()).toHaveLength(18);
  const seeds = Array.from({ length: 6 }, (_, b) =>
    Array.from({ length: 50 }, (_, i) => audit117Seed(b, i, 'long')),
  ).flat();
  expect(new Set(seeds).size).toBe(300);
  for (let b = 0; b < 6; b++) {
    expect(audit117Seed(b, 0, 'long')).toBe(
      (0x08010000 + Math.imul(12001 + b * 20, 104729)) >>> 0,
    );
    expect(audit117Seed(b, 20, 'long')).toBe(
      (0x08010000 + Math.imul(20001 + b * 10, 104729)) >>> 0,
    );
    expect(audit117Seed(b, 30, 'long')).toBe(
      (0x08010000 + Math.imul(23001 + b * 20, 104729)) >>> 0,
    );
  }
  expect(seeds).not.toContain(audit117Seed(0, 0, 'matrix'));
  expect(() => audit117Seed(6, 0, 'long')).toThrow();
  expect(() => audit117Seed(0, 50, 'long')).toThrow();
});
it('uses a deterministic legal public selector, with immutable inputs and no hidden reward identities', () => {
  const g = startSurvivalClient('isaac', 42, 'standard').game,
    rules = survivalRoomRules(g),
    human = g.players.find((p) => p.id === 'human')!;
  const input = {
    human,
    room: g.rooms[0]![0]!,
    cutLine: 200,
    minimumEliminations: 2,
    moneyExchangeRatio: 0.1,
    scoreInheritanceRatio: 0.2,
    participants: g.players.map((p) => ({
      playerId: p.id,
      money: p.money,
      roomScore: 0,
      previousSurvivalScore: 0,
    })),
  };
  const base = {
    playerId: 'human',
    actions: [{ type: 'bid' as const, group: 'A' as const, amount: 200 }],
  };
  const before = JSON.stringify({ input, base });
  const result = chooseEdgeTurn(input, base, rules, 300, 600);
  expect(validateTurn(human, result.turn, rules)).toEqual([]);
  expect(JSON.stringify({ input, base })).toBe(before);
  expect(
    chooseEdgeTurn(
      {
        ...input,
        room: {
          ...input.room,
          rewards: [
            { ...input.room.rewards[0], hidden: true, itemId: 'guppys_tail' },
            { ...input.room.rewards[1], hidden: true, itemId: 'moms_heart' },
          ],
        },
      },
      base,
      rules,
      300,
      600,
    ),
  ).toEqual(result);
});
it('emits complete real authority, keeps AI-only floors out, and is deterministic without asserting edge success', () => {
  const a = runEdgeMatch(3, 'isaac'),
    b = runEdgeMatch(3, 'isaac');
  expect(a).toEqual(b);
  expect(a.context.units.at(-1)?.stage).toBe('complete');
  expect(a.traceFingerprint).toBe(sha256Hex(canonicalJson(a.context)));
  expect(a.floors.lowestFloors).toBe(a.progress.F03 ?? 0);
  expect(a.floors.passedFloors).toBeLessThanOrEqual(a.floors.humanFloors);
  expect(a.controller.attempts).toBe(a.humanRooms);
  expect(a.controller.changed).toBeGreaterThan(0);
  expect(a.humanRooms + a.aiOnlyRooms).toBeGreaterThanOrEqual(a.humanRooms);
}, 60000);
