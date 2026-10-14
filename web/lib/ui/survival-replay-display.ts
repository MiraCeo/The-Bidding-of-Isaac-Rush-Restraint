import type { SurvivalReplayLog } from './survival-record';
import type { ReplayLog, ReplayRoomRecord } from './replay-record';
import type { replayAllPlayerTimeline } from './replay-view-model';
const round = (n: number) => Math.round((n + Number.EPSILON) * 10000) / 10000;

/** UI adapter only. Keep active-only facts; never serialize this as a classic replay. */
export function survivalReplayDisplayLog(log: SurvivalReplayLog): ReplayLog {
  return {
    id: log.id,
    seed: log.seed,
    characterId: log.characterId,
    rulesVersion: log.compatibility,
    startedBuild: log.startedBuild,
    playerNames: log.playerNames,
    final: null,
    ruleFacts: {
      floorStartingMoney: [...log.ruleFacts.roomRules.floorStartingMoney],
      cooperationRadii: log.ruleFacts.roomRules.floorStartingMoney.map(
        (n) => n * log.ruleFacts.roomRules.cooperationZoneRatio,
      ),
      scoreStorageDecimals: log.ruleFacts.roomRules.scoreStorageDecimals,
    },
    rooms: log.rooms.map(
      (room, index): ReplayRoomRecord => ({
        seed: log.seed,
        location: `F${room.room.floorIndex + 1}-R${room.room.roomIndex + 1}`,
        build: room.build,
        source: 'live',
        previousPlayers: index > 0 ? log.rooms[index - 1]!.players : null,
        entryEvents: room.entryEvents,
        aiChoices: room.aiChoices,
        settlement: room,
      }),
    ),
  };
}

/** Running R plus finalized floor exchanges, frozen after elimination; no repeated inheritance. */
export function survivalReplayTimeline(
  log: SurvivalReplayLog,
): ReturnType<typeof replayAllPlayerTimeline> {
  const rooms = log.rooms.map((room, index) => ({
    index,
    location: `F${room.room.floorIndex + 1}-R${room.room.roomIndex + 1}`,
    floor: room.room.floorIndex,
  }));
  const series = log.initialPlayers.map((player) => {
    let total = 0;
    const points = [
      { roomIndex: -1, location: '入场', value: 0 },
      ...log.rooms.map((room, roomIndex) => {
        total = round(
          total + (room.roomScoreSummaries[player.id]?.finalScore ?? 0),
        );
        if (
          room.room.roomIndex ===
          log.ruleFacts.parameters.rules.roomsPerFloor - 1
        ) {
          const floor = log.floors.find(
            (f) => f.floorIndex === room.room.floorIndex,
          );
          total = round(
            total + (floor?.scores[player.id]?.exchangedScore ?? 0),
          );
        }
        return {
          roomIndex,
          location: rooms[roomIndex]!.location,
          value: total,
        };
      }),
    ];
    return { playerId: player.id, points };
  });
  return {
    rooms,
    series,
    maximum: Math.max(
      1,
      ...series.flatMap((s) => s.points.map((p) => p.value)),
    ),
  };
}
export function survivalReplayOverview(
  log: SurvivalReplayLog,
  playerId: string,
) {
  const participating = log.rooms.filter((room) =>
    room.activePlayerIds.includes(playerId),
  );
  const actions = participating.flatMap((room) =>
    room.resolvedActions.filter((a) => a.playerId === playerId),
  );
  const final = log.final?.ranking.find((row) => row.playerId === playerId);
  return {
    participatingRooms: participating.length,
    lastRoomIndex: log.rooms.reduce(
      (last, room, index) =>
        room.activePlayerIds.includes(playerId) ? index : last,
      -1,
    ),
    cost: actions.reduce((sum, a) => sum + a.actualCost, 0),
    refund: participating
      .flatMap((room) => room.events)
      .filter((e) => e.playerId === playerId && e.type === 'refund')
      .reduce((sum, e) => sum + (e.amount ?? 0), 0),
    awards: participating
      .flatMap((room) => room.awards)
      .filter((a) => a.playerId === playerId)
      .reduce((sum, a) => sum + a.copies, 0),
    cumulative:
      survivalReplayTimeline(log)
        .series.find((s) => s.playerId === playerId)
        ?.points.at(-1)?.value ?? 0,
    final,
  };
}
