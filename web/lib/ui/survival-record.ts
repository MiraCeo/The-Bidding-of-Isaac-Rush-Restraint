import { survivalFactsV1Mechanics as survivalMechanics } from './survival-facts-v1';
import { characterCatalog, type CharacterDefinition } from '../game/characters';
import { defaultRules } from '../game/config';
import { survivalItemCatalog } from '../game/survival-content';
import type {
  CharacterId,
  ItemDefinition,
  RuntimePlayerState,
  SettlementEvent,
} from '../game/item-types';
import type { RulesConfig } from '../game/types';
import type { SurvivalRules } from '../game/survival-rules';
import { maximumSurvivalFloors } from '../game/survival-rules';
import type {
  SurvivalGameState,
  SurvivalRoomRecord,
  SurvivalFloorRecord,
  SurvivalEliminatedPlayer,
} from '../game/survival-session';
import type { SurvivalRankingEntry } from '../game/survival-results';
import { canonicalJson, copySnapshot, shortHash } from '../shared/json-facts';
import type { SurvivalDifficulty } from '../game/survival-difficulty';

/** Bump when survival runtime, AI, RNG or continuation semantics change. */
export const survivalEngineVersion = 'survival-client-4';
export { survivalFactsV1Mechanics as survivalMechanics } from './survival-facts-v1';
export interface SurvivalParameters {
  aiPolicy?: import('../game/survival-difficulty').SurvivalAiPolicy;
  /** Absent in AI2 historical files, which retain the frozen highest policy. */
  aiDifficulty?: SurvivalDifficulty;
  rules: SurvivalRules;
  cutLines: number[];
  bossRewards: 'standard';
}
export interface SurvivalRuleFacts {
  engineVersion: string;
  parameters: SurvivalParameters;
  mechanics: typeof survivalMechanics;
  roomRules: RulesConfig;
  items: ItemDefinition[];
  characters: CharacterDefinition[];
}
export interface SurvivalFinalRecord {
  build: string;
  players: RuntimePlayerState[];
  activePlayerIds: string[];
  eliminated: Record<string, SurvivalEliminatedPlayer>;
  cumulativeScores: Record<string, number>;
  ranking: SurvivalRankingEntry[];
  championId: string | null;
  reason: 'survivor_threshold' | 'all_eliminated';
}
export interface SurvivalReplayLog {
  mode: 'survival';
  encoding: 'survival-facts-1';
  id: string;
  compatibility: string;
  seed: number;
  characterId: CharacterId;
  startedBuild: string;
  ruleFacts: SurvivalRuleFacts;
  playerNames: Record<string, string>;
  initialPlayers: RuntimePlayerState[];
  initialEntryEvents: SettlementEvent[];
  rooms: SurvivalRoomRecord[];
  floors: SurvivalFloorRecord[];
  final: SurvivalFinalRecord | null;
}
export function createSurvivalRuleFacts(
  parameters: SurvivalParameters,
): SurvivalRuleFacts {
  const count = maximumSurvivalFloors(parameters.rules);
  return copySnapshot({
    engineVersion:
      parameters.aiPolicy !== undefined
        ? survivalEngineVersion
        : parameters.aiDifficulty === undefined
          ? 'survival-client-2'
          : 'survival-client-3',
    parameters,
    mechanics: survivalMechanics,
    roomRules: {
      ...defaultRules,
      playerCount: parameters.rules.initialPlayerCount,
      roomsPerFloor: Array<number>(count).fill(parameters.rules.roomsPerFloor),
      floorStartingMoney: Array<number>(count).fill(
        parameters.rules.floorStartingMoney,
      ),
      scoreStorageDecimals: parameters.rules.scoreStorageDecimals,
    },
    items: survivalItemCatalog.map((item) => ({ ...item })),
    characters: characterCatalog.map((character) => ({
      ...character,
      fixedStartingItems: [...character.fixedStartingItems],
    })),
  });
}
export function survivalCompatibility(facts: SurvivalRuleFacts): string {
  return `${facts.engineVersion}-${shortHash(canonicalJson(facts))}`;
}
export function survivalMatchId(
  seed: number,
  characterId: string,
  compatibility: string,
): string {
  return `ISAAC-SURVIVAL-${seed.toString(16).padStart(8, '0')}-${characterId}-${compatibility}`;
}
export function survivalParameters(
  game: SurvivalGameState,
): SurvivalParameters {
  return copySnapshot({
    ...(game.aiPolicy !== undefined ? { aiPolicy: game.aiPolicy } : {}),
    ...(game.aiDifficulty !== undefined
      ? { aiDifficulty: game.aiDifficulty }
      : {}),
    rules: { ...game.rules },
    cutLines: [...game.cutLines],
    bossRewards: game.bossRewards,
  });
}
/** Capture only completed room/layer facts; no future rewards, private AI diagnostics or commands. */
export function createSurvivalReplay(
  game: SurvivalGameState,
): SurvivalReplayLog {
  const ruleFacts = createSurvivalRuleFacts(survivalParameters(game));
  const compatibility = survivalCompatibility(ruleFacts);
  return copySnapshot({
    mode: 'survival',
    encoding: 'survival-facts-1',
    seed: game.seed,
    characterId: game.selectedCharacter,
    id: survivalMatchId(game.seed, game.selectedCharacter, compatibility),
    compatibility,
    startedBuild: game.startedBuild,
    ruleFacts,
    playerNames: Object.fromEntries(
      game.players.map((player) => [
        player.id,
        player.isHuman ? '你' : game.aiProfiles[player.id]!.name,
      ]),
    ),
    initialPlayers: game.roomRecords[0]?.playersBefore ?? game.players,
    initialEntryEvents:
      game.roomRecords[0]?.entryEvents ?? game.roomEntryEvents,
    rooms: game.roomRecords,
    floors: game.floorRecords,
    final:
      game.phase === 'competition_complete'
        ? {
            build: game.completedBuild!,
            players: game.players,
            activePlayerIds: game.activePlayerIds,
            eliminated: game.eliminated,
            cumulativeScores: game.cumulativeScores,
            ranking: game.finalRanking,
            championId: game.championId,
            reason: game.completionReason!,
          }
        : null,
  });
}
