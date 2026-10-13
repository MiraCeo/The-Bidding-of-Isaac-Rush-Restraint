import { writeFileSync } from 'node:fs';
import { it } from 'vitest';
import { characterOrder } from './characters';
import { startSurvivalGame, survivalGameReducer } from './survival-session';

it.skipIf(process.env.SURVIVAL_ENTRY_STUDY !== '1')(
  'compares first public cut-line presets with fixed worlds and two human scripts',
  () => {
    const results = [];
    for (const cut of [150, 200, 250])
      for (const policy of ['withdraw', 'pace_bid'] as const) {
        const layers: number[] = [],
          deaths: number[] = [],
          survivors: number[] = [];
        let totalEliminations = 0,
          humanSurvived = 0;
        for (let i = 0; i < 60; i += 1) {
          let game = startSurvivalGame({
            characterId: characterOrder[i % 5]!,
            seed: (20261013 + i * 0x9e3779b1) >>> 0,
            cutLines: Array(7).fill(cut),
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
                          policy === 'withdraw' || amount < 1
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
              game = survivalGameReducer(
                game,
                game.phase === 'room_result'
                  ? { type: 'advance_room' }
                  : { type: 'advance_floor' },
              );
          }
          layers.push(game.floorRecords.length);
          survivors.push(game.activePlayerIds.length);
          deaths.push(
            game.humanEliminatedAt === null
              ? game.floorRecords.length + 1
              : game.humanEliminatedAt + 1,
          );
          totalEliminations += Number(
            game.completionReason === 'all_eliminated',
          );
          humanSurvived += Number(game.activePlayerIds.includes('human'));
        }
        layers.sort((a, b) => a - b);
        results.push({
          cut,
          policy,
          games: 60,
          meanFloors: layers.reduce((a, b) => a + b, 0) / 60,
          medianFloors: layers[30],
          p90Floors: layers[54],
          totalEliminations,
          humanSurvived,
          meanFinalSurvivors: survivors.reduce((a, b) => a + b, 0) / 60,
          meanHumanLastFloor: deaths.reduce((a, b) => a + b, 0) / 60,
        });
      }
    writeFileSync(
      'work/survival-entry-calibration.json',
      JSON.stringify(
        {
          seed: 20261013,
          gamesPerCondition: 60,
          note: 'Small entry-preset comparison, not a formal ecological balance study.',
          results,
        },
        null,
        2,
      ),
    );
  },
  120_000,
);
