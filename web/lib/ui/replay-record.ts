import { canonicalJson, copySnapshot } from '../shared/json-facts';
export { canonicalJson, copySnapshot } from '../shared/json-facts';
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
import { defaultRules } from '../game/config';
import { classicReplayId, type ClassicAiSettings } from '../game/classic-difficulty';
import { readBuildVersion, saveCompatibility, shortHash } from './game-version';

export interface ReplayRoomRecord {
  seed: number;
  location: string;
  build: string;
  source: 'live' | 'save-reconstruction' | 'checkpoint-reconstruction';
  /** Original feedback identity survives storage-format migrations. */
  locator?: string;
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
  classicAi?: ClassicAiSettings;
  id: string;
  seed: number;
  characterId: CharacterId;
  rulesVersion: string;
  startedBuild: string;
  ruleFacts?: ReplayRuleFacts;
  playerNames: Record<string, string>;
  rooms: ReplayRoomRecord[];
  final: ReplayFinalRecord | null;
}
export interface ReplayRuleFacts {
  floorStartingMoney: number[];
  cooperationRadii: number[];
  scoreStorageDecimals: number;
}
export function createReplayLog(game: ActiveClientGameState): ReplayLog {
  return {
    ...(game.classicAi ? { classicAi: { ...game.classicAi } } : {}),
    id: classicReplayId(game.seed, game.selectedCharacter, saveCompatibility, game.classicAi),
    seed: game.seed,
    characterId: game.selectedCharacter,
    rulesVersion: saveCompatibility,
    startedBuild: readBuildVersion(),
    ruleFacts: {
      floorStartingMoney: [...defaultRules.floorStartingMoney],
      cooperationRadii: defaultRules.floorStartingMoney.map(
        (money) => money * defaultRules.cooperationZoneRatio,
      ),
      scoreStorageDecimals: defaultRules.scoreStorageDecimals,
    },
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
  record.locator = replayRoomLocator(log, record);
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
export function replayRoomLocator(
  log: ReplayLog,
  record: ReplayRoomRecord,
): string {
  if (record.locator) return record.locator;
  const fingerprint = shortHash(
    canonicalJson({
      entryEvents: record.entryEvents,
      aiChoices: record.aiChoices,
      settlement: record.settlement,
    }),
  );
  return `${log.id}/${record.location}#${fingerprint}`;
}
