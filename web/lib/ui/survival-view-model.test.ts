import { describe, expect, it } from 'vitest';
import {
  startSurvivalGame,
  survivalGameReducer,
  type SurvivalGameState,
} from '../game/survival-session';
import { createSurvivalReplay } from './survival-record';
import {
  survivalFinalRankingRows,
  sameSurvivalReplayResults,
} from './survival-view-model';
import { copySnapshot } from '../shared/json-facts';

function complete(cut = 0) {
  let game = startSurvivalGame({
    characterId: 'isaac',
    seed: 42,
    cutLines: Array(7).fill(cut),
  });
  while (game.phase !== 'competition_complete') {
    game = survivalGameReducer(
      game,
      game.phase === 'room_action'
        ? game.activePlayerIds.includes('human')
          ? {
              type: 'submit_player_turn',
              turn: { playerId: 'human', actions: [{ type: 'withdraw' }] },
            }
          : { type: 'submit_ai_room' }
        : game.phase === 'room_result'
          ? { type: 'advance_room' }
          : { type: 'advance_floor' },
    );
  }
  return createSurvivalReplay(game);
}
describe('survival factual result projections', () => {
  it('labels surviving and eliminated entries without inventing an elimination number for survivors', () => {
    const log = complete(),
      rows = survivalFinalRankingRows(log);
    expect(rows).toHaveLength(20);
    for (const row of rows) {
      expect(row.name).toBe(log.playerNames[row.playerId]);
      expect(row.statusLabel).toBe(
        row.eliminationFloorIndex === null
          ? '存活'
          : `第 ${row.eliminationFloorIndex + 1} 层淘汰`,
      );
    }
    expect(rows[0]!.statusLabel).toBe('存活');
  });
  it('keeps a total-elimination leaderboard without marking its first entry as champion', () => {
    const rows = survivalFinalRankingRows(complete(1_000_000));
    expect(rows[0]!.rank).toBe(1);
    expect(rows.every((row) => !row.isChampion)).toBe(true);
  });
  it('compares full facts rather than only seed, mode ID or a short checksum', () => {
    const log = complete(),
      altered = copySnapshot(log);
    altered.final!.ranking[0]!.finalScore += 1;
    expect(altered.id).toBe(log.id);
    expect(sameSurvivalReplayResults(log, altered)).toBe(false);
  });
  it('ignores compatible build provenance for same-match deduplication but preserves tie and outcome facts', () => {
    const log = complete(),
      newer = copySnapshot(log);
    newer.startedBuild = 'new';
    newer.rooms.forEach((record) => {
      record.build = 'new';
    });
    newer.floors.forEach((record) => {
      record.build = 'new';
    });
    newer.final!.build = 'new';
    expect(sameSurvivalReplayResults(log, newer)).toBe(true);
    newer.final!.ranking[0]!.tieBreaker = 0.123456;
    expect(sameSurvivalReplayResults(log, newer)).toBe(false);
  });
  it('does not publish a final leaderboard before competition completion', () => {
    const game: SurvivalGameState = startSurvivalGame({
      characterId: 'isaac',
      seed: 42,
      cutLines: Array(7).fill(0),
    });
    expect(survivalFinalRankingRows(createSurvivalReplay(game))).toEqual([]);
  });
});
