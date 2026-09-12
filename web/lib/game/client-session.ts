import {
  createEmptyAiHistory,
  type AiPlayerHistory,
  type AiPublicMarketSnapshot,
} from './ai-analysis';
import { decideAiTurn, type AiDecision, type AiDoctrine } from './ai-decision';
import { generateAiPersonalities, type AiPersonality } from './ai-personality';
import { createAiQuoteProfile, type AiQuoteProfile } from './ai-quote';
import {
  assignCharacter,
  chooseRandomCharacter,
} from './characters';
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
import { createRuntimePlayer } from './runtime';
import { generateFloor } from './rooms';
import { calculateFinalScore } from './item-scoring';
import { validateTurn } from './turns';

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

export interface AiClientProfile {
  playerId: string;
  name: string;
  doctrine: AiDoctrine;
  personalities: AiPersonality[];
  history: AiPlayerHistory;
  quoteProfile: AiQuoteProfile;
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

const aiNames = [
  '守夜人',
  '纸冠',
  '红桃六',
  '长尾猫',
  '阿贝尔',
  '旧钥匙',
  '灯芯',
  '灰骰子',
  '盐柱',
  '羊皮卷',
  '小石子',
  '木勺',
  '空口袋',
  '黑烛',
  '铜纽扣',
  '蓝火柴',
  '玻璃眼',
  '断羽',
  '无名者',
] as const;

const doctrinePopulation: readonly AiDoctrine[] = [
  ...Array<AiDoctrine>(9).fill('balanced'),
  ...Array<AiDoctrine>(5).fill('cooperative'),
  ...Array<AiDoctrine>(5).fill('chaotic'),
];

function mixSeed(seed: number, salt: number): number {
  return (seed ^ salt) >>> 0;
}

function shuffle<T>(values: readonly T[], seed: number): T[] {
  const result = [...values];
  const random = createSeededRandom(seed);
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random.next() * (index + 1));
    [result[index], result[swapIndex]] = [result[swapIndex]!, result[index]!];
  }
  return result;
}

export function createSessionSeed(): number {
  const values = new Uint32Array(1);
  globalThis.crypto.getRandomValues(values);
  return values[0]!;
}

export function createCharacterSelectionState(seed = createSessionSeed()): CharacterSelectionState {
  return { phase: 'character_selection', seed: seed >>> 0 };
}

export function startClientGame(
  characterId: CharacterId,
  seed = createSessionSeed(),
): ActiveClientGameState {
  const normalizedSeed = seed >>> 0;
  const roomRandom = createSeededRandom(mixSeed(normalizedSeed, 0x243f6a88));
  const characterRandom = createSeededRandom(mixSeed(normalizedSeed, 0xbb67ae85));
  const personalityRandom = createSeededRandom(mixSeed(normalizedSeed, 0x6a09e667));
  const quoteProfileRandom = createSeededRandom(mixSeed(normalizedSeed, 0xa4093822));
  const gameplayRandom = createSeededRandom(mixSeed(normalizedSeed, 0x13198a2e));
  const shuffledDoctrines = shuffle(doctrinePopulation, mixSeed(normalizedSeed, 0x7f4a7c15));
  const rooms = defaultRules.roomsPerFloor.map((_, floorIndex) =>
    generateFloor(floorIndex, roomRandom),
  );

  let human = createRuntimePlayer({ id: 'human', money: 0, score: 0, isHuman: true });
  human = assignCharacter(human, characterId, characterRandom);

  const aiProfiles: Record<string, AiClientProfile> = {};
  const aiPlayers = aiNames.map((name, index) => {
    const playerId = `ai-${index + 1}`;
    const character = chooseRandomCharacter(characterRandom);
    const player = assignCharacter(
      createRuntimePlayer({ id: playerId, money: 0, score: 0, isHuman: false }),
      character,
      characterRandom,
    );
    aiProfiles[playerId] = {
      playerId,
      name,
      doctrine: shuffledDoctrines[index]!,
      personalities: generateAiPersonalities(personalityRandom, 2, 4),
      history: createEmptyAiHistory(),
      quoteProfile: createAiQuoteProfile(quoteProfileRandom),
    };
    return player;
  });

  const preparation = preparePlayersForRoom(
    [human, ...aiPlayers],
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

function rankPercentiles(
  players: readonly RuntimePlayerState[],
  value: (player: RuntimePlayerState) => number,
): Map<string, number> {
  const ranked = [...players].sort(
    (left, right) => value(right) - value(left) || left.id.localeCompare(right.id),
  );
  return new Map(
    ranked.map((player, index) => [
      player.id,
      ranked.length <= 1 ? 1 : 1 - index / (ranked.length - 1),
    ]),
  );
}

function revealAiDecisions(
  state: ActiveClientGameState,
): Pick<ActiveClientGameState, 'aiProfiles' | 'revealedAiDecisions' | 'pendingRoomTurns'> {
  const room = getCurrentRoom(state);
  const globalRoomIndex = state.rooms
    .slice(0, state.floorIndex)
    .reduce((total, floor) => total + floor.length, 0) + state.roomIndex;
  const remainingGameRooms = state.rooms.reduce((total, floor) => total + floor.length, 0) - globalRoomIndex;
  const remainingRooms = state.rooms[state.floorIndex]!.length - state.roomIndex;
  const decisionRandom = createSeededRandom(
    mixSeed(state.seed, (0x9e3779b9 ^ globalRoomIndex) >>> 0),
  );
  const quoteRandom = createSeededRandom(
    mixSeed(state.seed, (0x3c6ef372 ^ globalRoomIndex) >>> 0),
  );
  const moneyRanks = rankPercentiles(state.players, (player) => player.money);
  const scoreRanks = rankPercentiles(state.players, (player) => player.score);
  const nextProfiles = { ...state.aiProfiles };

  const decisions = state.players
    .filter((player) => !player.isHuman)
    .map((player) => {
      const profile = state.aiProfiles[player.id];
      if (!profile) throw new Error(`玩家 ${player.id} 缺少 AI 档案。`);
      const decision = decideAiTurn(player, state.floorIndex, defaultRules, decisionRandom, {
        remainingRooms,
        context: {
          moneyRankPercentile: moneyRanks.get(player.id) ?? 0.5,
          scoreRankPercentile: scoreRanks.get(player.id) ?? 0.5,
          recentMarkets: state.recentMarkets.slice(-3),
          history: profile.history,
          room,
          remainingGameRooms,
        },
        enableSituationAnalysis: true,
        enableItemAnalysis: true,
        quoteProfile: profile.quoteProfile,
        quoteRandom,
        doctrine: profile.doctrine,
        personalities: profile.personalities,
        enableDoubleActions: true,
      });
      const errors = validateTurn(player, decision.turn, defaultRules);
      if (errors.length > 0) {
        throw new Error(`AI ${player.id} 生成了非法行动：${errors.join('；')}`);
      }
      const strategy = decision.strategy;
      nextProfiles[player.id] = {
        ...profile,
        history: {
          ...profile.history,
          rounds: profile.history.rounds + 1,
          competitiveRounds: profile.history.competitiveRounds + (strategy === 'withdraw' ? 0 : 1),
          strategyCounts: {
            ...profile.history.strategyCounts,
            [strategy]: profile.history.strategyCounts[strategy] + 1,
          },
          lastStrategy: strategy,
        },
      };
      return decision;
    });

  return {
    aiProfiles: nextProfiles,
    revealedAiDecisions: decisions,
    pendingRoomTurns: [state.submittedPlayerTurn!, ...decisions.map((decision) => decision.turn)],
  };
}

function createPublicMarketSnapshot(
  settlement: RoomSettlementResult,
  floorIndex: number,
): AiPublicMarketSnapshot | null {
  if (!settlement.baseline) return null;
  const marketActions = settlement.resolvedActions.filter(
    (resolved) => resolved.action.type !== 'withdraw',
  );
  const floorMoney = defaultRules.floorStartingMoney[floorIndex]!;
  const qualificationCutoffs = (['A', 'B'] as const).flatMap((group) => {
    const equivalents = settlement.highPricePlacements
      .filter((placement) => placement.group === group)
      .flatMap((placement) => {
        const resolved = settlement.resolvedActions.find(
          (action) => action.playerId === placement.playerId &&
            action.action.type !== 'withdraw' &&
            action.action.group === group,
        );
        return resolved?.marketEquivalent === null || resolved?.marketEquivalent === undefined
          ? []
          : [resolved.marketEquivalent];
      });
    return equivalents.length === 0 ? [] : [Math.min(...equivalents)];
  });
  return {
    targetRatio: settlement.baseline.target / floorMoney,
    participationRate: settlement.baseline.participantCount / defaultRules.playerCount,
    disruptionRate: marketActions.length === 0
      ? 0
      : marketActions.filter((action) => action.action.type === 'disrupt').length / marketActions.length,
    highestMarketEquivalentRatio: Math.max(
      0,
      ...marketActions.map((action) => action.marketEquivalent ?? 0),
    ) / floorMoney,
    highPriceQualificationRatio: qualificationCutoffs.length === 0
      ? undefined
      : qualificationCutoffs.reduce((sum, value) => sum + value, 0) /
        qualificationCutoffs.length /
        floorMoney,
  };
}

function settleClientRoom(state: ActiveClientGameState): ActiveClientGameState {
  if (!state.pendingRoomTurns) return state;
  const globalRoomIndex = state.rooms
    .slice(0, state.floorIndex)
    .reduce((total, floor) => total + floor.length, 0) + state.roomIndex;
  const settlementRandom = createSeededRandom(
    mixSeed(state.seed, (0x510e527f ^ globalRoomIndex) >>> 0),
  );
  const room = getCurrentRoom(state);
  const settlement = settleRuntimeRoom(
    room,
    state.players,
    state.pendingRoomTurns,
    defaultRules,
    settlementRandom,
  );
  const nextProfiles = { ...state.aiProfiles };
  for (const decision of state.revealedAiDecisions) {
    const playerId = decision.turn.playerId;
    const profile = nextProfiles[playerId];
    if (!profile) continue;
    const awardedCopies = settlement.awards
      .filter((award) => award.playerId === playerId)
      .reduce((total, award) => total + award.copies, 0);
    const earnedEntitlement = settlement.entitlements.some(
      (entitlement) => entitlement.playerId === playerId,
    );
    nextProfiles[playerId] = {
      ...profile,
      history: {
        ...profile.history,
        awards: profile.history.awards + awardedCopies,
        failedCompetitiveRounds: profile.history.failedCompetitiveRounds +
          (decision.strategy !== 'withdraw' && !earnedEntitlement ? 1 : 0),
      },
    };
  }
  const marketSnapshot = createPublicMarketSnapshot(settlement, state.floorIndex);
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

function createFinalRanking(state: ActiveClientGameState): ClientFinalRankingEntry[] {
  const globalRoomIndex = state.rooms.reduce((total, floor) => total + floor.length, 0);
  const tieRandom = createSeededRandom(
    mixSeed(state.seed, (0x5be0cd19 ^ globalRoomIndex) >>> 0),
  );
  return state.players
    .map((player) => ({
      playerId: player.id,
      finalScore: calculateFinalScore(player),
      tieBreaker: tieRandom.next(),
    }))
    .sort((left, right) => right.finalScore - left.finalScore || left.tieBreaker - right.tieBreaker)
    .map(({ playerId, finalScore }) => ({ playerId, finalScore }));
}

function advanceClientRoom(state: ActiveClientGameState): ActiveClientGameState {
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

  const nextFloorIndex = isLastRoomInFloor ? state.floorIndex + 1 : state.floorIndex;
  const nextRoomIndex = isLastRoomInFloor ? 0 : state.roomIndex + 1;
  const nextGlobalRoomIndex = state.rooms
    .slice(0, nextFloorIndex)
    .reduce((total, floor) => total + floor.length, 0) + nextRoomIndex;
  const roomEntryRandom = createSeededRandom(
    mixSeed(state.seed, (0x1f83d9ab ^ nextGlobalRoomIndex) >>> 0),
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

export function clientGameReducer(
  state: ClientGameState,
  action: ClientGameAction,
): ClientGameState {
  if (action.type === 'start_game' && state.phase === 'character_selection') {
    return startClientGame(action.characterId, state.seed);
  }
  if (action.type === 'submit_player_turn' && state.phase === 'room_action') {
    const human = state.players.find((player) => player.id === state.humanPlayerId);
    if (!human || validateTurn(human, action.turn, defaultRules).length > 0) return state;
    const submittedState: ActiveClientGameState = {
      ...state,
      submittedPlayerTurn: action.turn,
    };
    const revealedState: ActiveClientGameState = {
      ...submittedState,
      ...revealAiDecisions(submittedState),
    };
    return settleClientRoom(revealedState);
  }
  if (action.type === 'show_room_ranking' && state.phase === 'room_result') {
    return { ...state, phase: 'room_ranking', roomRankingView: action.view };
  }
  if (action.type === 'switch_room_ranking' && state.phase === 'room_ranking') {
    return { ...state, roomRankingView: action.view };
  }
  if (action.type === 'advance_room' && (state.phase === 'room_result' || state.phase === 'room_ranking')) {
    return advanceClientRoom(state);
  }
  if (action.type === 'restart_game' && state.phase === 'game_result') {
    return createCharacterSelectionState(action.seed);
  }
  return state;
}

export function isActiveClientGame(
  state: ClientGameState,
): state is ActiveClientGameState {
  return state.phase !== 'character_selection';
}

export function getCurrentRoom(state: ActiveClientGameState): GeneratedRoom {
  const room = state.rooms[state.floorIndex]?.[state.roomIndex];
  if (!room) throw new RangeError(`Unknown room ${state.floorIndex}:${state.roomIndex}.`);
  return room;
}
