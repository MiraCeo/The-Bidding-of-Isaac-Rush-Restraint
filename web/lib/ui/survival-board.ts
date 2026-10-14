import type { SurvivalGameState } from '../game/survival-session';
import type { SurvivalReplayLog } from './survival-record';
import { characterNames } from '../game/characters';

export interface SurvivalBoardCell {
  score: number;
  survivalScore?: number;
  kind: 'settled' | 'live';
  rooms: number;
}
export interface SurvivalBoardRow {
  playerId: string;
  name: string;
  characterName: string;
  statusLabel: string;
  active: boolean;
  eliminationFloorIndex: number | null;
  rank: number;
  floors: (SurvivalBoardCell | null)[];
  total: number;
}
export interface SurvivalBoardModel {
  final: boolean;
  floorCount: number;
  liveFloorIndex: number | null;
  rows: SurvivalBoardRow[];
}
const round = (score: number) =>
  Math.round((score + Number.EPSILON) * 10000) / 10000;

/** Display-only live R plus finalized newScore. Never pre-exchange cash or repeat inheritance. */
export function currentSurvivalBoard(
  game: SurvivalGameState,
): SurvivalBoardModel {
  const settledCurrent = game.floorRecords.some(
    (f) => f.floorIndex === game.floorIndex,
  );
  const final = game.phase === 'competition_complete',
    floorCount = game.floorIndex + 1;
  const rows = game.players.map((player, index) => {
    const eliminated = game.eliminated[player.id],
      active = game.activePlayerIds.includes(player.id);
    const floors = Array.from(
      { length: floorCount },
      (_, floorIndex): SurvivalBoardCell | null => {
        const record = game.floorRecords.find(
            (f) => f.floorIndex === floorIndex,
          ),
          score = record?.scores[player.id];
        if (score)
          return {
            score: score.newScore,
            survivalScore: score.survivalScore,
            kind: 'settled',
            rooms: game.rules.roomsPerFloor,
          };
        if (floorIndex === game.floorIndex && !settledCurrent && active) {
          const scores = game.currentFloorRoomScores[player.id] ?? [];
          return {
            score: round(scores.reduce((sum, n) => sum + n, 0)),
            kind: 'live',
            rooms: scores.length,
          };
        }
        return null;
      },
    );
    return {
      playerId: player.id,
      name:
        player.id === 'human'
          ? '你'
          : (game.aiProfiles[player.id]?.name ?? player.id),
      characterName: player.characterId
        ? characterNames[player.characterId]
        : '—',
      statusLabel: eliminated
        ? `第 ${eliminated.floorIndex + 1} 层淘汰`
        : '存活',
      active,
      eliminationFloorIndex: eliminated?.floorIndex ?? null,
      rank: index + 1,
      floors,
      total: round(floors.reduce((sum, cell) => sum + (cell?.score ?? 0), 0)),
    };
  });
  if (final) {
    const rank = new Map(
      game.finalRanking.map((entry) => [entry.playerId, entry.rank]),
    );
    rows.sort((a, b) => rank.get(a.playerId)! - rank.get(b.playerId)!);
  } else
    rows.sort(
      (a, b) =>
        Number(b.active) - Number(a.active) ||
        (b.eliminationFloorIndex ?? floorCount) -
          (a.eliminationFloorIndex ?? floorCount) ||
        b.total - a.total,
    );
  rows.forEach((row, i) => {
    row.rank = i + 1;
  });
  return {
    final,
    floorCount,
    liveFloorIndex: settledCurrent ? null : game.floorIndex,
    rows,
  };
}

/** Final factual replays keep their recorded order, including seeded tie decisions. */
export function finalSurvivalBoard(log: SurvivalReplayLog): SurvivalBoardModel {
  return {
    final: true,
    floorCount: log.floors.length,
    liveFloorIndex: null,
    rows: (log.final?.ranking ?? []).map((entry) => {
      const player = log.final!.players.find((p) => p.id === entry.playerId);
      return {
        playerId: entry.playerId,
        name: log.playerNames[entry.playerId]!,
        characterName: player?.characterId
          ? characterNames[player.characterId]
          : '—',
        statusLabel:
          entry.eliminationFloorIndex === null
            ? '存活'
            : `第 ${entry.eliminationFloorIndex + 1} 层淘汰`,
        active: entry.eliminationFloorIndex === null,
        eliminationFloorIndex: entry.eliminationFloorIndex,
        rank: entry.rank,
        total: entry.finalScore,
        floors: log.floors.map((f) => {
          const score = f.scores[entry.playerId];
          return score
            ? {
                score: score.newScore,
                survivalScore: score.survivalScore,
                kind: 'settled',
                rooms: 5,
              }
            : null;
        }),
      };
    }),
  };
}
