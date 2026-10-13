import { describe, expect, it } from 'vitest';
import {
  calculateSurvivalFloorScore,
  planSurvivalEliminations,
  type SurvivalParticipantScore,
} from './survival-floor';
import {
  maximumSurvivalFloors,
  survivalPrototypeRules as rules,
  validateSurvivalRules,
} from './survival-rules';

const roster = (...scores: number[]): SurvivalParticipantScore[] =>
  scores.map((survivalScore, index) => ({ playerId: `p-${index + 1}`, survivalScore }));
const settled = (remainingMoney: number, previousSurvivalScore = 0) =>
  calculateSurvivalFloorScore({
    finalRoomScores: [0, 0, 0, 0, 0],
    remainingMoney,
    previousSurvivalScore,
  }, rules);

describe('internal survival rule foundation', () => {
  it('keeps the confirmed two-elimination/six-survivor layout separate from classic rules', () => {
    expect(rules).toMatchObject({
      initialPlayerCount: 20,
      roomsPerFloor: 5,
      floorStartingMoney: 1000,
      minimumEliminations: 2,
      finalSurvivorCount: 6,
    });
    expect(Object.isFrozen(rules)).toBe(true);
    expect(maximumSurvivalFloors(rules)).toBe(7);
    expect(maximumSurvivalFloors(rules) * rules.roomsPerFloor).toBe(35);
  });

  it('rounds up the derived floor bound when an elimination overshoots the finish threshold', () => {
    expect(maximumSurvivalFloors({ ...rules, initialPlayerCount: 19 })).toBe(7);
    expect(maximumSurvivalFloors({ ...rules, initialPlayerCount: 6 })).toBe(0);
  });

  it.each([
    { minimumEliminations: 0 },
    { minimumEliminations: 1.5 },
    { minimumEliminations: 21 },
    { minimumEliminations: 7 },
    { finalSurvivorCount: 0 },
    { finalSurvivorCount: 21 },
    { initialPlayerCount: Number.MAX_SAFE_INTEGER + 1 },
    { roomsPerFloor: 0 },
    { floorStartingMoney: -1000 },
    { moneyExchangeRatio: -0.1 },
    { moneyExchangeRatio: Infinity },
    { scoreInheritanceRatio: 1 },
    { scoreInheritanceRatio: NaN },
    { scoreStorageDecimals: 9 },
    { scoreStorageDecimals: 2.5 },
  ])('rejects invalid internal configuration %j', (changes) => {
    expect(() => validateSurvivalRules({ ...rules, ...changes })).toThrow(RangeError);
  });
});

describe('survival floor score components', () => {
  it.each([[0, 0], [200, 20], [500, 50], [800, 80], [1000, 100], [1405, 140.5]])(
    'exchanges the actual remaining %s money for %s points without a 100-point cap',
    (money, expected) => {
      expect(settled(money)).toMatchObject({
        remainingMoney: money,
        exchangedScore: expected,
        inheritedScore: 0,
        newScore: expected,
        survivalScore: expected,
      });
    },
  );

  it('combines authoritative final room scores, exchange and recursive inheritance once', () => {
    const finalRoomScores = Object.freeze([100, 150, 100, 100, 800]);
    const input = Object.freeze({ finalRoomScores, remainingMoney: 375, previousSurvivalScore: 500 });
    expect(calculateSurvivalFloorScore(input, rules)).toEqual({
      roomScore: 1250,
      remainingMoney: 375,
      exchangedScore: 37.5,
      previousSurvivalScore: 500,
      inheritedScore: 100,
      newScore: 1287.5,
      survivalScore: 1387.5,
    });
    expect(input.remainingMoney).toBe(375);
    expect(input.finalRoomScores[4]).toBe(800);
  });

  it('decays earlier performance without counting inheritance as this floor\'s new points', () => {
    const first = settled(1000);
    const second = settled(1000, first.survivalScore);
    const third = settled(1000, second.survivalScore);
    expect([first.survivalScore, second.survivalScore, third.survivalScore]).toEqual([100, 120, 124]);
    expect(first.newScore + second.newScore + third.newScore).toBe(300);
  });

  it('stores separately rounded four-decimal components whose sum matches the survival score', () => {
    const result = calculateSurvivalFloorScore({
      finalRoomScores: [1.1111, 2.2222, 3.3333, 4.4444, 5.5555],
      remainingMoney: 1,
      previousSurvivalScore: 1.2345,
    }, rules);
    expect(result.roomScore).toBe(16.6665);
    expect(result.inheritedScore).toBe(0.2469);
    expect(result.newScore).toBe(16.7665);
    expect(result.survivalScore).toBe(17.0134);
  });

  it('accepts explicit experimental ratio changes without editing the classic configuration', () => {
    expect(calculateSurvivalFloorScore({
      finalRoomScores: [0, 0, 0, 0, 0],
      remainingMoney: 1000,
      previousSurvivalScore: 100,
    }, { ...rules, moneyExchangeRatio: 0.05, scoreInheritanceRatio: 0.1 }).survivalScore).toBe(60);
  });

  it.each([-1, 0.5, Infinity, NaN, Number.MAX_SAFE_INTEGER + 1])(
    'rejects invalid remaining money %s rather than clamping it',
    (money) => expect(() => settled(money)).toThrow(RangeError),
  );

  it.each([-1, Infinity, NaN, 1e15, 1.00001])('rejects invalid or precision-unsafe previous scores %s', (previous) => {
    expect(() => settled(0, previous)).toThrow(RangeError);
  });

  it.each([
    [],
    [0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0],
    [0, 0, -1, 0, 0],
    [0, 0, Infinity, 0, 0],
    [0, 0, NaN, 0, 0],
    [0, 0, 1e15, 0, 0],
    [0, 0, 1.00001, 0, 0],
  ].map((finalRoomScores) => ({ finalRoomScores })))('requires five valid completed room scores: $finalRoomScores', ({ finalRoomScores }) => {
    expect(() => calculateSurvivalFloorScore({
      finalRoomScores,
      remainingMoney: 0,
      previousSurvivalScore: 0,
    }, rules)).toThrow(RangeError);
  });

  it('rejects an unsafe combined score even if each room is individually representable', () => {
    expect(() => calculateSurvivalFloorScore({
      finalRoomScores: Array<number>(5).fill(200_000_000_000),
      remainingMoney: 0,
      previousSurvivalScore: 0,
    }, rules)).toThrow(RangeError);
  });
});

describe('survival elimination planning without inventing unresolved policies', () => {
  it('eliminates all below-line players, even when more than two leave', () => {
    const result = planSurvivalEliminations(roster(10, 20, 30, 100, 110, 120, 130, 140, 150, 160), 100, rules);
    expect(result).toEqual({
      status: 'resolved',
      eliminations: [
        { playerId: 'p-1', reason: 'below_cut_line' },
        { playerId: 'p-2', reason: 'below_cut_line' },
        { playerId: 'p-3', reason: 'below_cut_line' },
      ],
      survivorIds: ['p-4', 'p-5', 'p-6', 'p-7', 'p-8', 'p-9', 'p-10'],
      shouldFinish: false,
    });
  });

  it('supplements a single below-line elimination with the lowest passing player', () => {
    const result = planSurvivalEliminations(roster(99, 100, 110, 120, 130, 140, 150, 160), 100, rules);
    expect(result).toMatchObject({
      status: 'resolved',
      eliminations: [
        { playerId: 'p-1', reason: 'below_cut_line' },
        { playerId: 'p-2', reason: 'lowest_score' },
      ],
      shouldFinish: true,
    });
  });

  it('eliminates the lowest two when everybody passes, and equality with the line is passing', () => {
    expect(planSurvivalEliminations(roster(100, 110, 120, 130, 140, 150, 160, 170), 100, rules)).toEqual({
      status: 'resolved',
      eliminations: [
        { playerId: 'p-1', reason: 'lowest_score' },
        { playerId: 'p-2', reason: 'lowest_score' },
      ],
      survivorIds: ['p-3', 'p-4', 'p-5', 'p-6', 'p-7', 'p-8'],
      shouldFinish: true,
    });
  });

  it('uses actual survivors when the count drops below six; it does not backfill', () => {
    const result = planSurvivalEliminations(roster(0, 10, 20, 30, 100, 110, 120, 130), 100, rules);
    expect(result).toMatchObject({
      status: 'resolved',
      survivorIds: ['p-5', 'p-6', 'p-7', 'p-8'],
      shouldFinish: true,
    });
  });

  it('permits one survivor after a mass elimination', () => {
    expect(planSurvivalEliminations(roster(0, 0, 0, 0, 0, 0, 100), 100, rules)).toMatchObject({
      status: 'resolved',
      survivorIds: ['p-7'],
      shouldFinish: true,
    });
  });

  it('leaves a tie spanning the last elimination slot unresolved', () => {
    expect(planSurvivalEliminations(roster(100, 110, 110, 120, 130, 140, 150, 160), 100, rules)).toEqual({
      status: 'requires_tie_break',
      certainEliminations: [{ playerId: 'p-1', reason: 'lowest_score' }],
      tiedPlayerIds: ['p-2', 'p-3'],
      tieEliminationCount: 1,
    });
  });

  it('does not break a fully tied passing roster by player ID or input order', () => {
    expect(planSurvivalEliminations(roster(...Array<number>(8).fill(100)), 100, rules)).toMatchObject({
      status: 'requires_tie_break',
      certainEliminations: [],
      tieEliminationCount: 2,
    });
  });

  it('detects a supplement tie after a single below-line player', () => {
    expect(planSurvivalEliminations(roster(90, 100, 100, 110, 120, 130, 140, 150), 100, rules)).toEqual({
      status: 'requires_tie_break',
      certainEliminations: [{ playerId: 'p-1', reason: 'below_cut_line' }],
      tiedPlayerIds: ['p-2', 'p-3'],
      tieEliminationCount: 1,
    });
  });

  it('does not require a tie break when the entire tied group must be eliminated', () => {
    expect(planSurvivalEliminations(roster(100, 100, 110, 120, 130, 140, 150, 160), 100, rules)).toMatchObject({
      status: 'resolved',
      eliminations: [
        { playerId: 'p-1', reason: 'lowest_score' },
        { playerId: 'p-2', reason: 'lowest_score' },
      ],
    });
  });

  it('does not invent survivors or a champion when everybody misses the line', () => {
    expect(planSurvivalEliminations(roster(0, 10, 20, 30, 40, 50, 60, 70), 100, rules)).toEqual({
      status: 'requires_all_below_policy',
      belowCutLineIds: ['p-1', 'p-2', 'p-3', 'p-4', 'p-5', 'p-6', 'p-7', 'p-8'],
    });
  });

  it.each([1, 5, 6])('does not eliminate again when already at the finish threshold: %s', (count) => {
    const participants = roster(...Array<number>(count).fill(0));
    expect(planSurvivalEliminations(participants, 100, rules)).toEqual({
      status: 'resolved',
      eliminations: [],
      survivorIds: participants.map((participant) => participant.playerId),
      shouldFinish: true,
    });
  });

  it('preserves the input roster and uses scores rather than human identity', () => {
    const participants = Object.freeze(roster(150, 140, 130, 120, 110, 100, 90, 80)
      .map((participant, index) => Object.freeze({
        ...participant,
        playerId: index === 7 ? 'human' : participant.playerId,
      })));
    expect(planSurvivalEliminations(participants, 100, rules)).toMatchObject({
      status: 'resolved',
      eliminations: [
        { playerId: 'p-7', reason: 'below_cut_line' },
        { playerId: 'human', reason: 'below_cut_line' },
      ],
    });
    expect(participants[0]!.survivalScore).toBe(150);
  });

  it('finishes in seven floors on the minimum-two route without enforcing a separate floor cap', () => {
    let participants = roster(...Array.from({ length: 20 }, (_, index) => 100 + index));
    let floors = 0;
    while (participants.length > rules.finalSurvivorCount) {
      const plan = planSurvivalEliminations(participants, 100, rules);
      if (plan.status !== 'resolved') throw new Error('Unexpected unresolved unique-score plan.');
      expect(plan.eliminations).toHaveLength(2);
      const survivors = new Set(plan.survivorIds);
      participants = participants.filter((participant) => survivors.has(participant.playerId));
      floors += 1;
      expect(plan.shouldFinish).toBe(participants.length <= 6);
    }
    expect(floors).toBe(7);
    expect(participants).toHaveLength(6);
  });

  it('preserves elimination count and membership across ongoing sizes, below-line counts and roster order', () => {
    for (let count = 7; count <= 20; count += 1) {
      for (let belowCount = 0; belowCount < count; belowCount += 1) {
        const participants = roster(...Array.from({ length: count }, (_, index) =>
          index < belowCount ? index : 100 + index,
        ));
        const expectedEliminatedCount = Math.max(2, belowCount);
        const expectedIds = participants.slice(0, expectedEliminatedCount).map((participant) => participant.playerId).sort();
        for (const ordered of [participants, [...participants].reverse()]) {
          const plan = planSurvivalEliminations(ordered, 100, rules);
          if (plan.status !== 'resolved') throw new Error('Unexpected pending plan.');
          expect(plan.eliminations.map((elimination) => elimination.playerId).sort()).toEqual(expectedIds);
          expect(plan.survivorIds).toHaveLength(count - expectedEliminatedCount);
          expect(plan.shouldFinish).toBe(count - expectedEliminatedCount <= 6);
        }
      }
    }
  });

  it.each([-1, Infinity, NaN, 1e15, 100.00001])('rejects invalid cut lines %s', (cutLine) => {
    expect(() => planSurvivalEliminations(roster(100), cutLine, rules)).toThrow(RangeError);
  });

  it.each([
    [],
    roster(...Array<number>(21).fill(100)),
    [{ playerId: ' ', survivalScore: 100 }],
    [{ playerId: 'same', survivalScore: 100 }, { playerId: 'same', survivalScore: 200 }],
    [{ playerId: 'p', survivalScore: -1 }],
    [{ playerId: 'p', survivalScore: Infinity }],
    [{ playerId: 'p', survivalScore: NaN }],
    [{ playerId: 'p', survivalScore: 100.00001 }],
  ].map((participants) => ({ participants })))('rejects malformed survivor inputs: $participants', ({ participants }) => {
    expect(() => planSurvivalEliminations(participants, 100, rules)).toThrow(RangeError);
  });
});
