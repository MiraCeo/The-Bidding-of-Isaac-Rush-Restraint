import { defaultRules } from '../game/config';
import type { ActiveClientGameState } from '../game/client-session';
import type {
  SurvivalGameState,
  SurvivalGameAction,
} from '../game/survival-session';
import {
  startSurvivalGame,
  survivalGameReducer,
} from '../game/survival-session';
import type { CharacterId } from '../game/item-types';
import { createSessionSeed } from '../game/client-session';
import type { RulesConfig } from '../game/types';
import { createRoomDraft, type RoomDraft } from './game-session';
import { readBuildVersion } from './game-version';
import { survivalOfficialCutLines } from '../game/survival-rules';
import {
  defaultSurvivalDifficulty,
  currentSurvivalAiPolicy,
  type SurvivalDifficulty,
} from '../game/survival-difficulty';
import { observeSurvivalGrowth, type GrowthContext } from './achievements/lifecycle';

/** Official preset; never mutate a restored match's own recorded schedule. */
export const survivalEntryCutLines = survivalOfficialCutLines;
export const activeModeKey = 'bidding-active-mode-v1';
export interface SurvivalClientSession {
  growth?: GrowthContext;
  growthIssue?: string;
  game: SurvivalGameState;
  draft: RoomDraft | null;
}
export function survivalRoomRules(game: SurvivalGameState): RulesConfig {
  return {
    ...defaultRules,
    playerCount: game.activePlayerIds.length,
    roomsPerFloor: game.rooms.map(() => 5),
    floorStartingMoney: game.rooms.map(() => 1000),
  };
}
/** Display model only. Never feed this projection into classic persistence or progression. */
export function survivalRoomView(
  game: SurvivalGameState,
  includeEliminated = false,
): ActiveClientGameState {
  const phase = game.phase === 'room_action' ? 'room_action' : 'room_result';
  const record = game.roomSettlement;
  return {
    phase,
    seed: game.seed,
    humanPlayerId: 'human',
    selectedCharacter: game.selectedCharacter,
    floorIndex: game.floorIndex,
    roomIndex: game.roomIndex,
    rooms: game.rooms,
    players: includeEliminated
      ? game.players
      : game.players.filter((player) =>
          game.activePlayerIds.includes(player.id),
        ),
    aiProfiles: game.aiProfiles,
    roomEntryEvents: game.roomEntryEvents,
    submittedPlayerTurn:
      record?.turns.find((turn) => turn.playerId === 'human') ?? null,
    revealedAiDecisions: game.revealedAiDecisions,
    pendingRoomTurns: phase === 'room_action' ? null : (record?.turns ?? null),
    recentMarkets: game.recentMarkets,
    roomSettlement: record,
    roomRankingView: 'score',
    finalRanking: [],
  };
}
export function survivalDraft(game: SurvivalGameState): RoomDraft | null {
  if (game.phase !== 'room_action' || !game.activePlayerIds.includes('human'))
    return null;
  return createRoomDraft(survivalRoomView(game), survivalRoomRules(game));
}
export function startSurvivalClient(
  characterId: CharacterId,
  seed = createSessionSeed(),
  aiDifficulty: SurvivalDifficulty = defaultSurvivalDifficulty,
): SurvivalClientSession {
  const game = startSurvivalGame({
    aiPolicy: currentSurvivalAiPolicy,
    aiDifficulty,
    characterId,
    seed,
    cutLines: [...survivalEntryCutLines],
    buildId: readBuildVersion(),
  });
  return { game, draft: survivalDraft(game) };
}
export function reduceSurvivalClient(
  session: SurvivalClientSession,
  action: SurvivalGameAction,
): SurvivalClientSession {
  const game = survivalGameReducer(session.game, action);
  if (game === session.game) return session;
  const next: SurvivalClientSession = { game, draft: survivalDraft(game) };
  if (session.growth) {
    next.growth = session.growth;
    next.growthIssue = session.growthIssue;
    if (!session.growthIssue) {
      try { next.growth = observeSurvivalGrowth(session.game, game, session.growth); }
      catch (error) { next.growthIssue = error instanceof Error ? error.message : '成长捕获失败。'; }
    }
  }
  return next;
}
