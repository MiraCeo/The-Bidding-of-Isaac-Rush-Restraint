import type {
  ActiveClientGameState,
  ClientFinalRankingEntry,
  ClientRoomSettlementRecord,
} from '../game/client-session';
import type { AiStrategy } from '../game/ai-decision';
import type {
  CharacterId,
  RuntimePlayerState,
  SettlementEvent,
} from '../game/item-types';
import { countItem } from '../game/runtime';
import { readBuildVersion, saveCompatibility, shortHash } from './game-version';

export interface ReplayRoomRecord {
  seed: number;
  location: string;
  build: string;
  source: 'live' | 'save-reconstruction';
  previousPlayers: RuntimePlayerState[] | null;
  entryEvents: SettlementEvent[];
  aiChoices: Array<{ playerId: string; strategy: AiStrategy }>;
  settlement: ClientRoomSettlementRecord;
}
export interface ReplayFinalRecord {
  build: string;
  players: RuntimePlayerState[];
  ranking: ClientFinalRankingEntry[];
  crownMultipliers: Record<string, number>;
}
export interface ReplayLog {
  id: string;
  seed: number;
  characterId: CharacterId;
  rulesVersion: string;
  startedBuild: string;
  playerNames: Record<string, string>;
  rooms: ReplayRoomRecord[];
  final: ReplayFinalRecord | null;
}
export function copySnapshot<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
export function canonicalJson(value: unknown): string {
  if (typeof value === 'number' && !Number.isFinite(value))
    throw new Error('记录包含非法数值。');
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}
export function createReplayLog(game: ActiveClientGameState): ReplayLog {
  return {
    id: `ISAAC-${game.seed.toString(16).padStart(8, '0')}-${game.selectedCharacter}-${saveCompatibility.split('-').at(-1)}`,
    seed: game.seed,
    characterId: game.selectedCharacter,
    rulesVersion: saveCompatibility,
    startedBuild: readBuildVersion(),
    playerNames: Object.fromEntries(
      game.players.map((p) => [
        p.id,
        p.isHuman ? '你' : game.aiProfiles[p.id]!.name,
      ]),
    ),
    rooms: [],
    final: null,
  };
}
export function appendReplayRoom(
  log: ReplayLog,
  game: ActiveClientGameState,
): ReplayLog {
  if (!game.roomSettlement) throw new Error('回放记录缺少已完成的结算。');
  const location = `F${game.floorIndex + 1}-R${game.roomIndex + 1}`;
  if (log.rooms.some((record) => record.location === location))
    throw new Error('同一房间不能重复追加回放。');
  const record: ReplayRoomRecord = copySnapshot({
    seed: game.seed,
    location,
    build: readBuildVersion(),
    source: 'live',
    previousPlayers: log.rooms.at(-1)?.settlement.players ?? null,
    entryEvents: game.roomEntryEvents,
    aiChoices: game.revealedAiDecisions.map((decision) => ({
      playerId: decision.turn.playerId,
      strategy: decision.strategy,
    })),
    settlement: game.roomSettlement,
  });
  return { ...log, rooms: [...log.rooms, record] };
}
export function finalizeReplay(
  log: ReplayLog,
  game: ActiveClientGameState,
): ReplayLog {
  const crownMultipliers = Object.fromEntries(
    game.players.map((p) => {
      const crowns = countItem(p, 'dark_princes_crown');
      return [
        p.id,
        Math.max(0.9, 1.4 - (p.items.length - crowns) * 0.05) ** crowns,
      ];
    }),
  );
  return {
    ...log,
    final: copySnapshot({
      build: readBuildVersion(),
      players: game.players,
      ranking: game.finalRanking,
      crownMultipliers,
    }),
  };
}
export function reconstructLegacyReplay(log: ReplayLog): ReplayLog {
  return {
    ...log,
    startedBuild: '旧存档：原构建未记录',
    rooms: log.rooms.map((r) => ({
      ...r,
      build: '旧存档：兼容规则核验重建',
      source: 'save-reconstruction',
    })),
    final: log.final
      ? { ...log.final, build: '旧存档：兼容规则核验重建' }
      : null,
  };
}
export function replayRoomLocator(
  log: ReplayLog,
  record: ReplayRoomRecord,
): string {
  const fingerprint = shortHash(
    canonicalJson({
      entryEvents: record.entryEvents,
      aiChoices: record.aiChoices,
      settlement: record.settlement,
    }),
  );
  return `${log.id}/${record.location}#${fingerprint}`;
}
