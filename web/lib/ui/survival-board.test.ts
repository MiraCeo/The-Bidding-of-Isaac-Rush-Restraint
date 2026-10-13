import { describe, expect, it } from 'vitest';
import { currentSurvivalBoard, finalSurvivalBoard } from './survival-board';
import {
  startSurvivalGame,
  survivalGameReducer,
  type SurvivalGameState,
} from '../game/survival-session';
import { createSurvivalReplay } from './survival-record';

const start = () =>
  startSurvivalGame({
    seed: 42,
    characterId: 'isaac',
    cutLines: Array(7).fill(0),
  });
function next(game: SurvivalGameState) {
  return survivalGameReducer(
    game,
    game.phase === 'room_action'
      ? game.activePlayerIds.includes('human')
        ? {
            type: 'submit_player_turn',
            turn: { playerId: 'human', actions: [{ type: 'withdraw' }] },
          }
        : { type: 'submit_ai_room' }
      : {
          type: game.phase === 'room_result' ? 'advance_room' : 'advance_floor',
        },
  );
}
function floor() {
  let game = start();
  while (game.phase !== 'floor_result') game = next(game);
  return game;
}
describe('read-only live and final survival leaderboard', () => {
  it('shows twenty live zero entries without exchanging opening cash or exposing future floors', () => {
    const game = start(),
      before = structuredClone(game),
      board = currentSurvivalBoard(game);
    expect(board.floorCount).toBe(1);
    expect(board.liveFloorIndex).toBe(0);
    expect(board.rows).toHaveLength(20);
    expect(
      board.rows.every(
        (row) =>
          row.total === 0 &&
          row.floors[0]?.score === 0 &&
          row.statusLabel === '存活',
      ),
    ).toBe(true);
    expect(game).toEqual(before);
  });
  it('updates every room from settled R and never includes provisional cash or inherited S', () => {
    let game = start();
    for (let i = 0; i < 5; i++) {
      game = next(game);
      const board = currentSurvivalBoard(game);
      for (const row of board.rows) {
        const expected = Number(
          game.currentFloorRoomScores[row.playerId]!.reduce(
            (sum, n) => sum + n,
            0,
          ).toFixed(4),
        );
        expect(row.floors[0]).toEqual({
          score: expected,
          kind: 'live',
          rooms: i + 1,
        });
        expect(row.total).toBe(expected);
      }
      if (i < 4) game = next(game);
    }
    expect(currentSurvivalBoard(game).rows.some((row) => row.total > 0)).toBe(
      true,
    );
  });
  it('replaces live R with settled newScore exactly once at the floor boundary', () => {
    const game = floor(),
      board = currentSurvivalBoard(game);
    expect(board.liveFloorIndex).toBeNull();
    for (const row of board.rows) {
      const score = game.floorRecords[0]!.scores[row.playerId]!;
      expect(row.floors[0]).toEqual({
        score: score.newScore,
        survivalScore: score.survivalScore,
        kind: 'settled',
        rooms: 5,
      });
      expect(row.total).toBe(game.cumulativeScores[row.playerId]);
    }
  });
  it('keeps completed floors after advancement, freezes eliminated rows and updates survivors only', () => {
    const first = floor(),
      nextFloor = next(first),
      before = currentSurvivalBoard(nextFloor),
      game = next(nextFloor),
      board = currentSurvivalBoard(game);
    expect(board.floorCount).toBe(2);
    expect(board.liveFloorIndex).toBe(1);
    for (const row of board.rows) {
      expect(row.floors[0]).toEqual(
        before.rows.find((r) => r.playerId === row.playerId)!.floors[0],
      );
      if (first.eliminated[row.playerId]) {
        expect(row.floors[1]).toBeNull();
        expect(row.total).toBe(first.cumulativeScores[row.playerId]);
      } else expect(row.floors[1]?.rooms).toBe(1);
    }
    expect(
      board.rows
        .slice(0, first.activePlayerIds.length)
        .every((row) => row.active),
    ).toBe(true);
  });
  it('uses authoritative final order and identical layer totals in live results and factual replay', () => {
    let game = start();
    while (game.phase !== 'competition_complete') game = next(game);
    const board = currentSurvivalBoard(game),
      replay = finalSurvivalBoard(createSurvivalReplay(game));
    expect(board).toEqual(replay);
    expect(board.rows.map((row) => row.playerId)).toEqual(
      game.finalRanking.map((row) => row.playerId),
    );
    for (const row of board.rows)
      expect(
        Number(
          row.floors
            .reduce((sum, cell) => sum + (cell?.score ?? 0), 0)
            .toFixed(4),
        ),
      ).toBe(row.total);
  });
  it('never marks a wipeout leader as a survivor and retains twenty frozen entries', () => {
    let game = startSurvivalGame({
      seed: 42,
      characterId: 'isaac',
      cutLines: Array(7).fill(1000000),
    });
    while (game.phase !== 'competition_complete') game = next(game);
    const board = currentSurvivalBoard(game);
    expect(board.rows).toHaveLength(20);
    expect(board.rows.every((row) => !row.active)).toBe(true);
    expect(board.rows.every((row) => row.floors[0]?.kind === 'settled')).toBe(
      true,
    );
  });
});
