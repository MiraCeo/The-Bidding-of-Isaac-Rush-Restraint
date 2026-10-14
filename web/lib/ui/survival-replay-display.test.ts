import { describe, expect, it, vi } from 'vitest';
import {
  survivalReplayDisplayLog,
  survivalReplayOverview,
  survivalReplayTimeline,
} from './survival-replay-display';
import {
  startSurvivalGame,
  survivalGameReducer,
  type SurvivalGameState,
} from '../game/survival-session';
import { createSurvivalReplay } from './survival-record';
import {
  serializeSurvivalReplay,
  parseSurvivalReplay,
} from './survival-persistence';
import * as ai from '../game/survival-ai';
import { replaySelectedResult, replayMoneyTimeline } from './replay-view-model';
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
function complete() {
  let game = startSurvivalGame({
    seed: 42,
    characterId: 'isaac',
    cutLines: Array(7).fill(0),
  });
  while (game.phase !== 'competition_complete') game = next(game);
  return game;
}
describe('survival-only read-only replay adapters', () => {
  it('keeps active-only room facts, provenance and saved cooperation radius for shared panels', () => {
    const game = complete(),
      log = createSurvivalReplay(game),
      before = JSON.stringify(log),
      display = survivalReplayDisplayLog(log);
    expect(display.final).toBeNull();
    expect(display.rulesVersion).toBe(log.compatibility);
    expect(display.ruleFacts?.cooperationRadii).toEqual(Array(7).fill(100));
    for (let i = 0; i < log.rooms.length; i++) {
      const r = display.rooms[i]!;
      expect(r.settlement).toBe(log.rooms[i]);
      expect(r.settlement.players.map((p) => p.id)).toEqual(
        log.rooms[i]!.activePlayerIds,
      );
      expect(r.build).toBe(log.rooms[i]!.build);
      expect(r.previousPlayers).toBe(i ? log.rooms[i - 1]!.players : null);
      for (const player of r.settlement.players)
        expect(replaySelectedResult(r, player.id).score).toEqual(
          log.rooms[i]!.roomScoreSummaries[player.id],
        );
    }
    expect(JSON.stringify(log)).toBe(before);
  });
  it('matches all final totals, exchanges once at BOSS and freezes eliminated graph series', () => {
    const log = createSurvivalReplay(complete()),
      timeline = survivalReplayTimeline(log);
    expect(timeline.series).toHaveLength(20);
    for (const series of timeline.series) {
      expect(series.points.at(-1)!.value).toBe(
        log.final!.cumulativeScores[series.playerId],
      );
      let prior = 0;
      log.rooms.forEach((room, i) => {
        const floor = log.floors.find(
            (f) => f.floorIndex === room.room.floorIndex,
          ),
          cash =
            room.room.roomIndex === 4
              ? (floor?.scores[series.playerId]?.exchangedScore ?? 0)
              : 0;
        const expected = Number(
          (
            prior +
            (room.roomScoreSummaries[series.playerId]?.finalScore ?? 0) +
            cash
          ).toFixed(4),
        );
        expect(series.points[i + 1]!.value).toBe(expected);
        prior = expected;
      });
    }
    const human = timeline.series.find((s) => s.playerId === 'human')!,
      last = survivalReplayOverview(log, 'human').lastRoomIndex;
    expect(
      human.points
        .slice(last + 1)
        .every((p) => p.value === human.points[last + 1]!.value),
    ).toBe(true);
  });
  it('does not pre-exchange cash when BOSS is recorded but the floor is not settled', () => {
    let game = startSurvivalGame({
      seed: 42,
      characterId: 'isaac',
      cutLines: Array(7).fill(0),
    });
    while (!(game.phase === 'room_result' && game.roomIndex === 4))
      game = next(game);
    const log = createSurvivalReplay(game),
      timeline = survivalReplayTimeline(log);
    expect(log.floors).toHaveLength(0);
    for (const s of timeline.series)
      expect(s.points.at(-1)!.value).toBe(
        Number(
          log.rooms
            .reduce(
              (sum, r) =>
                sum + (r.roomScoreSummaries[s.playerId]?.finalScore ?? 0),
              0,
            )
            .toFixed(4),
        ),
      );
  });
  it('builds money segments only for actual participating rooms, with no reset after elimination', () => {
    const log = createSurvivalReplay(complete()),
      display = survivalReplayDisplayLog(log),
      overview = survivalReplayOverview(log, 'human');
    const moneyLog = {
      ...display,
      rooms: display.rooms.filter((r) =>
        r.settlement.players.some((p) => p.id === 'human'),
      ),
    };
    const model = replayMoneyTimeline(moneyLog, 'human');
    expect(model.segments.flatMap((s) => s.points)).toHaveLength(
      overview.participatingRooms,
    );
    expect(moneyLog.rooms).toHaveLength(overview.lastRoomIndex + 1);
    expect(overview.final?.rank).toBe(
      log.final!.ranking.find((r) => r.playerId === 'human')!.rank,
    );
  });
  it('reads historical client2 facts and renders without rerunning AI or altering export', () => {
    const source = serializeSurvivalReplay(createSurvivalReplay(complete()));
    const spy = vi.spyOn(ai, 'decideSurvivalAiTurn');
    try {
      const log = parseSurvivalReplay(source).replay,
        before = serializeSurvivalReplay(log, undefined, new Date(0));
      survivalReplayDisplayLog(log);
      survivalReplayTimeline(log);
      survivalReplayOverview(log, 'human');
      expect(spy).not.toHaveBeenCalled();
      expect(serializeSurvivalReplay(log, undefined, new Date(0))).toBe(before);
      expect(log.ruleFacts.engineVersion).toBe('survival-client-2');
    } finally {
      spy.mockRestore();
    }
  });
});
