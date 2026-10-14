import { describe, expect, it } from 'vitest';
import { createSeededRandom } from './random';
import { survivalPrototypeRules as rules } from './survival-rules';
import {
  rankSurvivalFacts,
  settleSurvivalEliminations,
  resolveSurvivalPlanFacts,
  survivalRankingStatus,
} from './survival-results';
import { startSurvivalGame } from './survival-session';
import { generateFloor } from './rooms';
import { survivalItemCatalog } from './survival-content';
import { getCharacterStartingItems } from './characters';

describe('confirmed survival decisions', () => {
  it('randomly fills exactly two tied cutoff positions and records reproducible facts', () => {
    const players = Array.from({ length: 20 }, (_, i) => ({
      playerId: `p-${i}`,
      survivalScore: 100,
    }));
    const a = settleSurvivalEliminations(
      players,
      100,
      rules,
      createSeededRandom(42),
    );
    const b = settleSurvivalEliminations(
      players,
      100,
      rules,
      createSeededRandom(42),
    );
    expect(a).toEqual(b);
    expect(a.plan.eliminations).toHaveLength(2);
    expect(a.plan.survivorIds).toHaveLength(18);
    expect(a.reason).toBe('random_tie');
    expect(a.tieBreaks).toHaveLength(20);
    expect(resolveSurvivalPlanFacts(players, 100, rules, a.tieBreaks)).toEqual(
      a,
    );
    expect(
      settleSurvivalEliminations(players, 100, rules, createSeededRandom(87))
        .tieBreaks,
    ).not.toEqual(a.tieBreaks);
  });
  it('does not consume elimination randomness without a boundary tie', () => {
    const players = Array.from({ length: 20 }, (_, i) => ({
      playerId: `p-${i}`,
      survivalScore: 100 + i,
    }));
    const random = {
      next: () => {
        throw new Error('Unexpected draw');
      },
    };
    expect(
      settleSurvivalEliminations(players, 100, rules, random).plan.eliminations,
    ).toHaveLength(2);
    expect(
      settleSurvivalEliminations(players, 1000, rules, random),
    ).toMatchObject({
      reason: 'all_below',
      plan: { survivorIds: [], shouldFinish: true },
    });
  });
  it.each(
    [
      [],
      [{ playerId: 'wrong', value: 0.5 }],
      [{ playerId: 'p-0', value: 1 }],
    ].map((ties) => ({ ties })),
  )('rejects incomplete or invalid tie evidence $ties', ({ ties }) => {
    const players = Array.from({ length: 20 }, (_, i) => ({
      playerId: `p-${i}`,
      survivalScore: 100,
    }));
    expect(() => resolveSurvivalPlanFacts(players, 100, rules, ties)).toThrow();
  });
  it('ranks survivors first, then later eliminations, then cumulative score regardless of earlier huge scores', () => {
    const result = rankSurvivalFacts(
      [
        {
          playerId: 'early-rich',
          eliminationFloorIndex: 0,
          finalScore: 1_000_000,
          tieBreaker: 0.1,
        },
        {
          playerId: 'late-low',
          eliminationFloorIndex: 3,
          finalScore: 1,
          tieBreaker: 0.2,
        },
        {
          playerId: 'survivor-low',
          eliminationFloorIndex: null,
          finalScore: 0,
          tieBreaker: 0.9,
        },
        {
          playerId: 'late-high',
          eliminationFloorIndex: 3,
          finalScore: 100,
          tieBreaker: 0.4,
        },
        {
          playerId: 'survivor-high',
          eliminationFloorIndex: null,
          finalScore: 100,
          tieBreaker: 0.8,
        },
      ],
      4,
    );
    expect(result.map((entry) => entry.playerId)).toEqual([
      'survivor-high',
      'survivor-low',
      'late-high',
      'late-low',
      'early-rich',
    ]);
    expect(result.map((entry) => entry.rank)).toEqual([1, 2, 3, 4, 5]);
    expect(result[0]!.isChampion).toBe(true);
    expect(survivalRankingStatus(result[0]!)).toBe('存活');
    expect(survivalRankingStatus(result[2]!)).toBe('第 4 层淘汰');
  });
  it('uses saved tie breakers only after status, layer and score, and does not give a total-elimination winner a crown', () => {
    const result = rankSurvivalFacts(
      [
        {
          playerId: 'a',
          eliminationFloorIndex: 1,
          finalScore: 100,
          tieBreaker: 0.9,
        },
        {
          playerId: 'b',
          eliminationFloorIndex: 1,
          finalScore: 100,
          tieBreaker: 0.1,
        },
      ],
      4,
    );
    expect(result[0]!.playerId).toBe('b');
    expect(result.every((entry) => !entry.isChampion)).toBe(true);
  });
  it.each([-1, Infinity, NaN, 100.00001])(
    'rejects invalid final scores %s',
    (finalScore) => {
      expect(() =>
        rankSurvivalFacts(
          [
            {
              playerId: 'p',
              eliminationFloorIndex: null,
              finalScore,
              tieBreaker: 0.5,
            },
          ],
          4,
        ),
      ).toThrow();
    },
  );
  it('defaults survival to standard BOSS rewards and keeps classic terminal hearts intact', () => {
    const game = startSurvivalGame({
      characterId: 'eden',
      seed: 42,
      cutLines: Array(7).fill(0),
    });
    expect(game.bossRewards).toBe('standard');
    expect(
      generateFloor(2, createSeededRandom(42))[4]!.rewards.map(
        (reward) => reward.itemId,
      ),
    ).toEqual(['moms_heart', 'moms_heart']);
  });
  it('excludes the crown from every survival reward and human/AI Eden start without mutating classic content', () => {
    for (let seed = 0; seed < 100; seed += 1) {
      const game = startSurvivalGame({
        characterId: 'eden',
        seed,
        cutLines: Array(7).fill(0),
      });
      expect(
        game.players.every((player) =>
          player.items.every((item) => item.itemId !== 'dark_princes_crown'),
        ),
      ).toBe(true);
      for (let floor = 0; floor < 7; floor += 1) {
        const rooms = generateFloor(
          floor,
          createSeededRandom(seed),
          survivalItemCatalog,
          'standard',
        );
        expect(
          rooms.every((room) =>
            room.rewards.every(
              (reward) => reward.itemId !== 'dark_princes_crown',
            ),
          ),
        ).toBe(true);
      }
    }
    const classicStarts = Array.from({ length: 300 }, (_, seed) =>
      getCharacterStartingItems('eden', createSeededRandom(seed)),
    );
    expect(
      classicStarts.some((items) => items.includes('dark_princes_crown')),
    ).toBe(true);
  });
});
