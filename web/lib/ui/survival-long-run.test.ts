import { describe, it, expect } from 'vitest';
import { playLongRun, longRunAction } from './survival-long-run';
import { survivalGameReducer } from '../game/survival-session';
import {
  serializeSurvivalCheckpoint,
  parseSurvivalCheckpoint,
  serializeSurvivalReplay,
  parseSurvivalReplay,
} from './survival-persistence';
import { createSurvivalReplay } from './survival-record';
import {
  serializeSurvivalBackup,
  parseSurvivalBackup,
} from './survival-backup';
import { createPlayerProfile } from './player-profile';
import { currentSurvivalBoard, finalSurvivalBoard } from './survival-board';
import { survivalReplayTimeline } from './survival-replay-display';
import { assertFiniteJsonNumbers } from '../shared/json-facts';
const runs = [
  playLongRun(3, 'isaac'),
  playLongRun(3, 'jacob_esau'),
  playLongRun(42, 'jacob_esau', 'hard', 'pace', true),
];
describe('seven-floor stability without modifying formal AI or rules', () => {
  it.each(runs)(
    'restores every accepted command boundary: $characterId / structural=$structural',
    (run) => {
      expect(run.game.roomRecords).toHaveLength(35);
      expect(run.game.floorRecords).toHaveLength(7);
      expect(run.steps).toHaveLength(77);
      for (let i = 0; i < run.states.length; i++) {
        const game = run.states[i]!,
          source = serializeSurvivalCheckpoint(game),
          restored = parseSurvivalCheckpoint(source).game;
        expect(restored).toEqual(game);
        if (i < run.steps.length)
          expect(survivalGameReducer(restored, run.steps[i]!.action)).toEqual(
            run.states[i + 1],
          );
      }
    },
    30000,
  );
  it.each(runs)(
    'keeps cumulative scores, final order and all read-only facts consistent: $characterId / structural=$structural',
    (run) => {
      const game = run.game,
        log = createSurvivalReplay(game),
        round = (n: number) => Number(n.toFixed(4));
      expect(parseSurvivalReplay(serializeSurvivalReplay(log)).replay).toEqual(
        log,
      );
      expect(
        parseSurvivalBackup(
          serializeSurvivalBackup(game, null, createPlayerProfile()),
        ).checkpoint.game,
      ).toEqual(game);
      expect(currentSurvivalBoard(game)).toEqual(finalSurvivalBoard(log));
      for (const p of game.players) {
        const summed = round(
          game.floorRecords.reduce(
            (n, f) => n + (f.scores[p.id]?.newScore ?? 0),
            0,
          ),
        );
        expect(summed).toBe(game.cumulativeScores[p.id]);
        expect(
          survivalReplayTimeline(log)
            .series.find((s) => s.playerId === p.id)!
            .points.at(-1)!.value,
        ).toBe(summed);
      }
      for (const room of game.roomRecords) {
        expect(room.turns.map((t) => t.playerId).sort()).toEqual(
          room.activePlayerIds.slice().sort(),
        );
        expect(room.players.every((p) => p.money >= 0)).toBe(true);
        for (const score of Object.values(room.roomScoreSummaries))
          expect(round(score.initialScore + score.retroactiveScore)).toBe(
            score.finalScore,
          );
      }
    },
    30000,
  );
  it('keeps eliminated humans frozen throughout real AI-only continuation and matches interrupted final results', () => {
    const run = runs[0]!,
      elimination = run.states.find((s) => s.humanEliminatedAt !== null)!,
      frozen = structuredClone(elimination.players[0]);
    for (const state of run.states.filter((s) => s.humanEliminatedAt !== null))
      expect(state.players[0]).toEqual(frozen);
    const boundary = run.states.find(
      (s) => s.humanEliminatedAt !== null && s.phase === 'room_action',
    )!;
    let restored = parseSurvivalCheckpoint(
      serializeSurvivalCheckpoint(boundary),
    ).game;
    while (restored.phase !== 'competition_complete')
      restored = survivalGameReducer(restored, longRunAction(restored));
    expect(restored).toEqual(run.game);
    expect(
      run.game.roomRecords
        .slice(5)
        .every((r) => r.turns.every((t) => t.playerId !== 'human')),
    ).toBe(true);
  });
  it('includes genuine double actions, refunds and heart retroactivity in the structural maximum fixture', () => {
    const game = runs[2]!.game;
    expect(
      game.roomRecords.some((r) => r.turns.some((t) => t.actions.length === 2)),
    ).toBe(true);
    expect(
      game.roomRecords.some((r) => r.events.some((e) => e.type === 'refund')),
    ).toBe(true);
    expect(
      game.roomRecords.some((r) =>
        Object.values(r.roomScoreSummaries).some((s) => s.retroactiveScore > 0),
      ),
    ).toBe(true);
  });
  it('validates shared graph aliases but rejects non-finite values and actual cycles, including excluded checkpoint facts', () => {
    const shared = { score: 1 };
    expect(() =>
      assertFiniteJsonNumbers({ a: shared, b: shared }),
    ).not.toThrow();
    for (const value of [NaN, Infinity, -Infinity])
      expect(() =>
        assertFiniteJsonNumbers({ nested: [{ score: value }] }),
      ).toThrow('非法数值');
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(() => assertFiniteJsonNumbers(cyclic)).toThrow('循环引用');
    const game = structuredClone(runs[0]!.game);
    game.roomRecords[0]!.players[0]!.money = Infinity;
    expect(() => serializeSurvivalCheckpoint(game)).toThrow('非法数值');
  });
});
