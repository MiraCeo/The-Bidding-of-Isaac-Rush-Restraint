import type { AiPublicMarketSnapshot } from './ai-analysis';
import { decideAiTurn, type AiDecision } from './ai-decision';
import { defaultRules } from './config';
import type {
  CharacterId,
  GeneratedRoom,
  PlayerTurn,
  RuntimePlayerState,
  SettlementEvent,
} from './item-types';
import { createSeededRandom } from './random';
import { preparePlayersForRoom } from './room-economy';
import { settleRuntimeRoom, type RoomSettlementResult } from './room-engine';
import { generateFloor } from './rooms';
import { calculateFinalScore } from './item-scoring';
import { validateTurn } from './turns';
import {
  createClientRoster,
  decideClientAiRoom,
  createClientMarketSnapshot,
  updateClientAiHistory,
  mixClientSeed,
  type AiClientProfile,
} from './client-runtime';
export type { AiClientProfile } from './client-runtime';

export type ClientGamePhase =
  | 'character_selection'
  | 'room_action'
  | 'room_result'
  | 'room_ranking'
  | 'game_result';

export type ClientRankingView = 'score' | 'contest';

export interface CharacterSelectionState {
  phase: 'character_selection';
  seed: number;
}

export interface ClientRoomSettlementRecord extends RoomSettlementResult {
  room: GeneratedRoom;
  turns: PlayerTurn[];
  playersBefore: RuntimePlayerState[];
}

export interface ClientFinalRankingEntry {
  playerId: string;
  finalScore: number;
}

export interface ActiveClientGameState {
  phase: Exclude<ClientGamePhase, 'character_selection'>;
  seed: number;
  humanPlayerId: 'human';
  selectedCharacter: CharacterId;
  floorIndex: number;
  roomIndex: number;
  rooms: GeneratedRoom[][];
  players: RuntimePlayerState[];
  aiProfiles: Record<string, AiClientProfile>;
  roomEntryEvents: SettlementEvent[];
  submittedPlayerTurn: PlayerTurn | null;
  revealedAiDecisions: AiDecision[];
  pendingRoomTurns: PlayerTurn[] | null;
  recentMarkets: AiPublicMarketSnapshot[];
  roomSettlement: ClientRoomSettlementRecord | null;
  roomRankingView: ClientRankingView;
  finalRanking: ClientFinalRankingEntry[];
}

export type ClientGameState = CharacterSelectionState | ActiveClientGameState;

export type ClientGameAction =
  | {
      type: 'start_game';
      characterId: CharacterId;
    }
  | {
      type: 'submit_player_turn';
      turn: PlayerTurn;
    }
  | {
      type: 'show_room_ranking';
      view: ClientRankingView;
    }
  | {
      type: 'switch_room_ranking';
      view: ClientRankingView;
    }
  | {
      type: 'advance_room';
    }
  | {
      type: 'restart_game';
      seed: number;
    };

export function createSessionSeed(): number {
  const values = new Uint32Array(1);
  globalThis.crypto.getRandomValues(values);
  return values[0]!;
}

export function createCharacterSelectionState(
  seed = createSessionSeed(),
): CharacterSelectionState {
  return { phase: 'character_selection', seed: seed >>> 0 };
}

export function startClientGame(
  characterId: CharacterId,
  seed = createSessionSeed(),
): ActiveClientGameState {
  const normalizedSeed = seed >>> 0;
  const roomRandom = createSeededRandom(
    mixClientSeed(normalizedSeed, 0x243f6a88),
  );
  const gameplayRandom = createSeededRandom(
    mixClientSeed(normalizedSeed, 0x13198a2e),
  );
  const rooms = defaultRules.roomsPerFloor.map((_, floorIndex) =>
    generateFloor(floorIndex, roomRandom),
  );
  const roster = createClientRoster(characterId, normalizedSeed);
  const aiProfiles = roster.aiProfiles;

  const preparation = preparePlayersForRoom(
    roster.players,
    0,
    0,
    defaultRules,
    gameplayRandom,
  );

  return {
    phase: 'room_action',
    seed: normalizedSeed,
    humanPlayerId: 'human',
    selectedCharacter: characterId,
    floorIndex: 0,
    roomIndex: 0,
    rooms,
    players: preparation.players,
    aiProfiles,
    roomEntryEvents: preparation.events,
    submittedPlayerTurn: null,
    revealedAiDecisions: [],
    pendingRoomTurns: null,
    recentMarkets: [],
    roomSettlement: null,
    roomRankingView: 'score',
    finalRanking: [],
  };
}

function revealAiDecisions(
  state: ActiveClientGameState,
  decideTurn: typeof decideAiTurn,
): Pick<
  ActiveClientGameState,
  'aiProfiles' | 'revealedAiDecisions' | 'pendingRoomTurns'
> {
  const room = getCurrentRoom(state);
  const globalRoomIndex =
    state.rooms
      .slice(0, state.floorIndex)
      .reduce((total, floor) => total + floor.length, 0) + state.roomIndex;
  const remainingGameRooms =
    state.rooms.reduce((total, floor) => total + floor.length, 0) -
    globalRoomIndex;
  const remainingRooms =
    state.rooms[state.floorIndex]!.length - state.roomIndex;
  const ai = decideClientAiRoom(
    {
      seed: state.seed,
      players: state.players,
      aiProfiles: state.aiProfiles,
      room,
      globalRoomIndex,
      remainingRooms,
      remainingGameRooms,
      recentMarkets: state.recentMarkets,
      rules: defaultRules,
    },
    decideTurn,
  );
  return {
    aiProfiles: ai.aiProfiles,
    revealedAiDecisions: ai.decisions,
    pendingRoomTurns: [
      state.submittedPlayerTurn!,
      ...ai.decisions.map((decision) => decision.turn),
    ],
  };
}

function settleClientRoom(state: ActiveClientGameState): ActiveClientGameState {
  if (!state.pendingRoomTurns) return state;
  const globalRoomIndex =
    state.rooms
      .slice(0, state.floorIndex)
      .reduce((total, floor) => total + floor.length, 0) + state.roomIndex;
  const settlementRandom = createSeededRandom(
    mixClientSeed(state.seed, (0x510e527f ^ globalRoomIndex) >>> 0),
  );
  const room = getCurrentRoom(state);
  const settlement = settleRuntimeRoom(
    room,
    state.players,
    state.pendingRoomTurns,
    defaultRules,
    settlementRandom,
  );
  const nextProfiles = updateClientAiHistory(
    state.aiProfiles,
    state.revealedAiDecisions,
    settlement,
  );
  const marketSnapshot = createClientMarketSnapshot(
    settlement,
    defaultRules.floorStartingMoney[state.floorIndex]!,
    defaultRules.playerCount,
  );
  return {
    ...state,
    phase: 'room_result',
    players: settlement.players,
    aiProfiles: nextProfiles,
    recentMarkets: marketSnapshot
      ? [...state.recentMarkets, marketSnapshot]
      : state.recentMarkets,
    roomSettlement: {
      room,
      turns: state.pendingRoomTurns,
      playersBefore: state.players,
      ...settlement,
    },
  };
}

function createFinalRanking(
  state: ActiveClientGameState,
): ClientFinalRankingEntry[] {
  const globalRoomIndex = state.rooms.reduce(
    (total, floor) => total + floor.length,
    0,
  );
  const tieRandom = createSeededRandom(
    mixClientSeed(state.seed, (0x5be0cd19 ^ globalRoomIndex) >>> 0),
  );
  return state.players
    .map((player) => ({
      playerId: player.id,
      finalScore: calculateFinalScore(player),
      tieBreaker: tieRandom.next(),
    }))
    .sort(
      (left, right) =>
        right.finalScore - left.finalScore ||
        left.tieBreaker - right.tieBreaker,
    )
    .map(({ playerId, finalScore }) => ({ playerId, finalScore }));
}

function advanceClientRoom(
  state: ActiveClientGameState,
): ActiveClientGameState {
  const currentFloor = state.rooms[state.floorIndex]!;
  const isLastRoomInFloor = state.roomIndex >= currentFloor.length - 1;
  const isLastFloor = state.floorIndex >= state.rooms.length - 1;
  if (isLastRoomInFloor && isLastFloor) {
    return {
      ...state,
      phase: 'game_result',
      finalRanking: createFinalRanking(state),
    };
  }

  const nextFloorIndex = isLastRoomInFloor
    ? state.floorIndex + 1
    : state.floorIndex;
  const nextRoomIndex = isLastRoomInFloor ? 0 : state.roomIndex + 1;
  const nextGlobalRoomIndex =
    state.rooms
      .slice(0, nextFloorIndex)
      .reduce((total, floor) => total + floor.length, 0) + nextRoomIndex;
  const roomEntryRandom = createSeededRandom(
    mixClientSeed(state.seed, (0x1f83d9ab ^ nextGlobalRoomIndex) >>> 0),
  );
  const preparation = preparePlayersForRoom(
    state.players,
    nextFloorIndex,
    nextRoomIndex,
    defaultRules,
    roomEntryRandom,
  );
  return {
    ...state,
    phase: 'room_action',
    floorIndex: nextFloorIndex,
    roomIndex: nextRoomIndex,
    players: preparation.players,
    roomEntryEvents: preparation.events,
    submittedPlayerTurn: null,
    revealedAiDecisions: [],
    pendingRoomTurns: null,
    roomSettlement: null,
    roomRankingView: 'score',
  };
}

function reduceClientGame(
  state: ClientGameState,
  action: ClientGameAction,
  decideTurn: typeof decideAiTurn,
): ClientGameState {
  if (action.type === 'start_game' && state.phase === 'character_selection') {
    return startClientGame(action.characterId, state.seed);
  }
  if (action.type === 'submit_player_turn' && state.phase === 'room_action') {
    const human = state.players.find(
      (player) => player.id === state.humanPlayerId,
    );
    if (!human || validateTurn(human, action.turn, defaultRules).length > 0)
      return state;
    const submittedState: ActiveClientGameState = {
      ...state,
      submittedPlayerTurn: action.turn,
    };
    const revealedState: ActiveClientGameState = {
      ...submittedState,
      ...revealAiDecisions(submittedState, decideTurn),
    };
    return settleClientRoom(revealedState);
  }
  if (action.type === 'show_room_ranking' && state.phase === 'room_result') {
    return { ...state, phase: 'room_ranking', roomRankingView: action.view };
  }
  if (action.type === 'switch_room_ranking' && state.phase === 'room_ranking') {
    return { ...state, roomRankingView: action.view };
  }
  if (
    action.type === 'advance_room' &&
    (state.phase === 'room_result' || state.phase === 'room_ranking')
  ) {
    return advanceClientRoom(state);
  }
  if (action.type === 'restart_game' && state.phase === 'game_result') {
    return createCharacterSelectionState(action.seed);
  }
  return state;
}

/** Production always uses the unchanged decision source and two-argument protocol. */
export function clientGameReducer(
  state: ClientGameState,
  action: ClientGameAction,
): ClientGameState {
  return reduceClientGame(state, action, decideAiTurn);
}

/** Explicit research-only seam. No setting or experiment is persisted in game/save state. */
export function createClientResearchReducer(decideTurn: typeof decideAiTurn) {
  return (state: ClientGameState, action: ClientGameAction): ClientGameState =>
    reduceClientGame(state, action, decideTurn);
}

export function isActiveClientGame(
  state: ClientGameState,
): state is ActiveClientGameState {
  return state.phase !== 'character_selection';
}

export function getCurrentRoom(state: ActiveClientGameState): GeneratedRoom {
  const room = state.rooms[state.floorIndex]?.[state.roomIndex];
  if (!room)
    throw new RangeError(
      `Unknown room ${state.floorIndex}:${state.roomIndex}.`,
    );
  return room;
}
