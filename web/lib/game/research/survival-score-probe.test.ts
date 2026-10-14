import { describe, expect, it } from 'vitest';
import {
  runSurvivalScoreProbe,
  scoreQuantile,
  summarizeScores,
} from './survival-score-probe';
import { startSurvivalGame, createSurvivalResearchReducer } from '../survival-session';
import { decideAiTurn } from '../ai-decision';
const survivalGameReducer=createSurvivalResearchReducer(decideAiTurn);
import { characterOrder } from '../characters';

describe('isolated survival no-elimination score probe', () => {
  it.each(
    characterOrder.flatMap((characterId) =>
      [42, 99].map((seed) => ({ characterId, seed })),
    ),
  )(
    'matches first-floor authoritative facts for $characterId / $seed before live eliminations',
    ({ characterId, seed }) => {
      const facts: unknown[] = [];
      const probe = runSurvivalScoreProbe(
        { seed, characterId, policy: 'pace_bid', floors: 1 },
        { onRoom: (fact) => facts.push(fact) },
      );
      let game = startSurvivalGame({
        seed,
        characterId,
        cutLines: Array(7).fill(250),
      });
      for (let i = 0; i < 5; i++) {
        const human = game.players[0]!,
          amount = Math.floor(human.money / (5 - i));
        game = survivalGameReducer(game, {
          type: 'submit_player_turn',
          turn: {
            playerId: 'human',
            actions:
              amount < 1
                ? [{ type: 'withdraw' }]
                : [{ type: 'bid', group: i % 2 ? 'B' : 'A', amount }],
          },
        });
        const fact = facts[i] as {
          result: unknown;
          before: unknown;
          turns: unknown;
        };
        const {
          build: _build,
          room: _room,
          turns,
          playersBefore,
          entryEvents: _events,
          activePlayerIds: _ids,
          aiChoices: _choices,
          ...result
        } = game.roomRecords.at(-1)!;
        expect(fact.result).toEqual(result);
        expect(fact.before).toEqual(playersBefore);
        expect(fact.turns).toEqual(turns);
        game = survivalGameReducer(game, { type: 'advance_room' });
      }
      expect(probe.floors[0]!.scores).toEqual(game.floorRecords[0]!.scores);
      expect(probe.players).toHaveLength(20);
      expect(game.activePlayerIds.length).toBeLessThan(20);
    },
  );
  it('keeps all 20 participants alive in all 35 rooms, preserving the recursive decomposition', () => {
    let rooms = 0;
    const result = runSurvivalScoreProbe(
      { seed: 99, characterId: 'eden', policy: 'withdraw' },
      {
        onRoom: (fact) => {
          rooms++;
          expect(fact.result.players).toHaveLength(20);
          expect(fact.turns).toHaveLength(20);
          expect(
            fact.room.rewards.every(
              (reward) => reward.itemId !== 'dark_princes_crown',
            ),
          ).toBe(true);
        },
      },
    );
    expect(rooms).toBe(35);
    expect(result.floors).toHaveLength(7);
    expect(result.players).toHaveLength(20);
    result.floors.forEach((fact, i) => {
      expect(fact.players).toHaveLength(20);
      for (const score of Object.values(fact.scores)) {
        expect(score.survivalScore).toBeCloseTo(
          score.newScore + score.inheritedScore,
          4,
        );
        expect(score.newScore).toBeCloseTo(
          score.roomScore + score.exchangedScore,
          4,
        );
      }
      if (i > 0)
        expect(fact.scores.human!.previousSurvivalScore).toBe(
          result.floors[i - 1]!.scores.human!.survivalScore,
        );
    });
    expect(
      result.players.every((player) =>
        player.items.every((item) => item.itemId !== 'dark_princes_crown'),
      ),
    ).toBe(true);
  });
  it('runs a separate all-AI condition, including the test slot and tracking every AI history', () => {
    const result = runSurvivalScoreProbe({
      seed: 77,
      characterId: 'isaac',
      policy: 'all_ai',
      floors: 2,
    });
    expect(result.players.every((player) => !player.isHuman)).toBe(true);
    expect(Object.keys(result.aiProfiles)).toHaveLength(20);
    expect(
      Object.values(result.aiProfiles).every(
        (profile) => profile.history.rounds === 10,
      ),
    ).toBe(true);
  });
  it('is deterministic and does not change production zero-line minimum eliminations', () => {
    const options = {
      seed: 91,
      characterId: 'isaac' as const,
      policy: 'pace_bid' as const,
      floors: 2,
    };
    expect(runSurvivalScoreProbe(options)).toEqual(
      runSurvivalScoreProbe(options),
    );
    let game = startSurvivalGame({
      seed: 91,
      characterId: 'isaac',
      cutLines: Array(7).fill(0),
    });
    for (let i = 0; i < 5; i++) {
      game = survivalGameReducer(game, {
        type: 'submit_player_turn',
        turn: { playerId: 'human', actions: [{ type: 'withdraw' }] },
      });
      game = survivalGameReducer(game, { type: 'advance_room' });
    }
    expect(game.activePlayerIds).toHaveLength(18);
  });
  it('summarizes true zero values and documented linear percentiles', () => {
    expect(scoreQuantile([0, 10, 20, 30], 0.5)).toBe(15);
    expect(scoreQuantile([0, 10, 20, 30], 0.1)).toBeCloseTo(3);
    expect(summarizeScores([0, 0, 10, 30])).toMatchObject({
      n: 4,
      mean: 10,
      zeroRate: 0.5,
      p50: 5,
      max: 30,
    });
    expect(summarizeScores([]).mean).toBeNull();
    expect(() => summarizeScores([NaN])).toThrow();
  });
});
