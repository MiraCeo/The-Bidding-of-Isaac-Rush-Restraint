import { describe, expect, it } from 'vitest';
import {
  runSurvivalEliminationProbe,
  proposedSurvivalCutLines,
} from './survival-elimination-probe';
import { runSurvivalScoreProbe } from './survival-score-probe';
import {
  startSurvivalGame,
  createSurvivalResearchReducer,
} from '../survival-session';
import { decideAiTurn } from '../ai-decision';
const survivalGameReducer = createSurvivalResearchReducer(decideAiTurn);
import { survivalEntryCutLines } from '../../ui/survival-client';
import { characterOrder } from '../characters';

describe('research-only proposed survival curve', () => {
  it.each(characterOrder)(
    'matches formal mechanics with retained legacy policy for $0',
    (characterId) => {
      const options = {
        seed: 42,
        characterId,
        cutLines: proposedSurvivalCutLines,
      };
      const probe = runSurvivalEliminationProbe({
        ...options,
        policy: 'pace_bid',
      });
      let game = startSurvivalGame({
        ...options,
        buildId: 'research-real-elimination-1',
      });
      while (game.phase !== 'competition_complete') {
        if (game.phase === 'room_action') {
          const human = game.players[0]!,
            amount = Math.floor(human.money / (5 - game.roomIndex));
          game = survivalGameReducer(
            game,
            game.activePlayerIds.includes('human')
              ? {
                  type: 'submit_player_turn',
                  turn: {
                    playerId: 'human',
                    actions:
                      amount < 1
                        ? [{ type: 'withdraw' }]
                        : [
                            {
                              type: 'bid',
                              group: game.roomIndex % 2 ? 'B' : 'A',
                              amount,
                            },
                          ],
                  },
                }
              : { type: 'submit_ai_room' },
          );
        } else
          game = survivalGameReducer(game, {
            type:
              game.phase === 'room_result' ? 'advance_room' : 'advance_floor',
          });
      }
      expect(probe).toEqual(game);
      expect(survivalEntryCutLines).toEqual([
        200, 325, 500, 750, 1050, 1500, 2500,
      ]);
    },
  );
  it('matches all-AI v29 first-floor decisions, economy and scores before applying actual eliminations', () => {
    const rooms: unknown[] = [];
    const floors: unknown[] = [];
    runSurvivalScoreProbe(
      { seed: 99, characterId: 'eden', policy: 'all_ai', floors: 1 },
      {
        onRoom: (fact) => rooms.push(fact),
        onFloor: (fact) => floors.push(fact),
      },
    );
    const game = runSurvivalEliminationProbe({
      seed: 99,
      characterId: 'eden',
      policy: 'all_ai',
      cutLines: proposedSurvivalCutLines,
    });
    for (let i = 0; i < 5; i++) {
      const recorded = game.roomRecords[i]!;
      const fact = rooms[i] as {
        turns: unknown;
        result: {
          players: unknown;
          baseline: unknown;
          roomScoreSummaries: unknown;
        };
      };
      expect(recorded.turns).toEqual(fact.turns);
      expect(
        recorded.players.map((player) => ({ ...player, isHuman: false })),
      ).toEqual(fact.result.players);
      expect(recorded.baseline).toEqual(fact.result.baseline);
      expect(recorded.roomScoreSummaries).toEqual(
        fact.result.roomScoreSummaries,
      );
    }
    expect(game.floorRecords[0]!.scores).toEqual(
      (floors[0] as { scores: unknown }).scores,
    );
  });
  it('freezes eliminated AI and never fabricates human actions after elimination', () => {
    const frozen = new Map<string, string>();
    const game = runSurvivalEliminationProbe(
      {
        seed: 42,
        characterId: 'isaac',
        policy: 'withdraw',
        cutLines: proposedSurvivalCutLines,
      },
      {
        onFloor: (_before, after) => {
          for (const player of after.players) {
            const previous = frozen.get(player.id);
            if (previous)
              expect(
                JSON.stringify({
                  player,
                  history: after.aiProfiles[player.id]?.history,
                }),
              ).toBe(previous);
            if (after.eliminated[player.id] && !previous)
              frozen.set(
                player.id,
                JSON.stringify({
                  player,
                  history: after.aiProfiles[player.id]?.history,
                }),
              );
          }
        },
      },
    );
    expect(game.humanEliminatedAt).toBe(0);
    expect(
      game.roomRecords
        .slice(5)
        .every((record) =>
          record.turns.every((turn) => turn.playerId !== 'human'),
        ),
    ).toBe(true);
    expect(game.finalRanking).toHaveLength(20);
  });
  it('uses the actual finish rule rather than forcing completion on floor six', () => {
    const game = runSurvivalEliminationProbe({
      seed: 12,
      characterId: 'lost',
      policy: 'all_ai',
      cutLines: Array(7).fill(0),
    });
    expect(game.floorRecords).toHaveLength(7);
    expect(game.activePlayerIds).toHaveLength(6);
    expect(
      game.floorRecords.every(
        (record) => record.plan.eliminations.length === 2,
      ),
    ).toBe(true);
  });
  it('is repeatable with no client preset mutation', () => {
    const opts = {
      seed: 77,
      characterId: 'azazel' as const,
      policy: 'all_ai' as const,
      cutLines: proposedSurvivalCutLines,
    };
    expect(runSurvivalEliminationProbe(opts)).toEqual(
      runSurvivalEliminationProbe(opts),
    );
    expect(proposedSurvivalCutLines).toEqual([
      200, 250, 325, 425, 550, 700, 850,
    ]);
    expect(survivalEntryCutLines).toEqual([
      200, 325, 500, 750, 1050, 1500, 2500,
    ]);
  });
});
