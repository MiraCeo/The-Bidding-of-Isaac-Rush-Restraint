import { defaultRules } from './config';
import { decideAiTurn, type AiDecision } from './ai-decision';
import { decideSurvivalAiTurn } from './survival-ai';
import {
  isSurvivalDifficulty,
  currentSurvivalAiPolicy,
  type SurvivalAiPolicy,
  type SurvivalDifficulty,
} from './survival-difficulty';
import type { AiPublicMarketSnapshot } from './ai-analysis';
import type { ClientRoomSettlementRecord } from './client-session';
import type { AiStrategy } from './ai-decision';
import {
  createClientRoster,
  decideClientAiRoom,
  createClientMarketSnapshot,
  updateClientAiHistory,
  mixClientSeed,
  type AiClientProfile,
} from './client-runtime';
import type {
  CharacterId,
  GeneratedRoom,
  PlayerTurn,
  RuntimePlayerState,
  SettlementEvent,
} from './item-types';
import { survivalItemCatalog, survivalExcludedItems } from './survival-content';
import { copySnapshot } from '../shared/json-facts';
import { createSeededRandom } from './random';
import { preparePlayersForRoom } from './room-economy';
import { settleRuntimeRoom } from './room-engine';
import { generateFloor, type BossRewardPolicy } from './rooms';
import { validateTurn } from './turns';
import type { RulesConfig } from './types';
import {
  calculateSurvivalFloorScore,
  validateSurvivalStoredScore,
  type SurvivalFloorScore,
  type SurvivalElimination,
} from './survival-floor';
import {
  settleSurvivalEliminations,
  rankSurvivalFacts,
  type ResolvedSurvivalPlan,
  type SurvivalEliminationResolution,
  type SurvivalRankingEntry,
} from './survival-results';
import {
  maximumSurvivalFloors,
  survivalPrototypeRules,
  validateSurvivalRules,
  type SurvivalRules,
} from './survival-rules';

export interface SurvivalStartOptions {
  aiPolicy?: SurvivalAiPolicy;
  aiDifficulty?: SurvivalDifficulty;
  characterId: CharacterId;
  seed: number;
  /** Explicit experimental schedule; no implicit cut line or rule chosen for a live match. */
  cutLines: readonly number[];
  /** Survival uses the confirmed ordinary BOSS pool, never the classic terminal exception. */
  bossRewards?: 'standard';
  buildId?: string;
  rules?: Readonly<SurvivalRules>;
}
export type SurvivalPrototypeOptions = SurvivalStartOptions;

export interface SurvivalCommandRecord {
  build: string;
  action: SurvivalGameAction;
}

export interface SurvivalFloorRecord {
  build: string;
  floorIndex: number;
  cutLine: number;
  activePlayerIds: string[];
  scores: Record<string, SurvivalFloorScore>;
  plan: ResolvedSurvivalPlan;
  resolution: Omit<SurvivalEliminationResolution, 'plan'>;
}

export interface SurvivalEliminatedPlayer {
  floorIndex: number;
  reason: SurvivalElimination['reason'];
  score: SurvivalFloorScore;
  cumulativeScore: number;
}

export interface SurvivalRoomRecord extends ClientRoomSettlementRecord {
  build: string;
  /** Preserve actual entry economy and strategy facts; do not infer them later from balance deltas. */
  entryEvents: SettlementEvent[];
  activePlayerIds: string[];
  aiChoices: Array<{ playerId: string; strategy: AiStrategy }>;
}

/** Survival state, deliberately not assignable to a v3 classic GameSession. */
export interface SurvivalGameState {
  aiPolicy?: SurvivalAiPolicy;
  /** Omitted only for historical AI2 highest-policy continuation. */
  aiDifficulty?: SurvivalDifficulty;
  mode: 'survival';
  phase:
    | 'room_action'
    | 'room_result'
    | 'floor_result'
    | 'competition_complete';
  seed: number;
  startedBuild: string;
  currentBuild: string;
  completedBuild: string | null;
  commandLog: SurvivalCommandRecord[];
  selectedCharacter: CharacterId;
  humanPlayerId: 'human';
  rules: Readonly<SurvivalRules>;
  cutLines: readonly number[];
  bossRewards: 'standard';
  floorIndex: number;
  roomIndex: number;
  /** Generated floors only. The unvisited future reward sequence is never precomputed. */
  rooms: GeneratedRoom[][];
  /** Complete roster in its original order; eliminated players are frozen. */
  players: RuntimePlayerState[];
  activePlayerIds: string[];
  aiProfiles: Record<string, AiClientProfile>;
  previousSurvivalScores: Record<string, number>;
  cumulativeScores: Record<string, number>;
  currentFloorRoomScores: Record<string, number[]>;
  eliminated: Record<string, SurvivalEliminatedPlayer>;
  humanEliminatedAt: number | null;
  roomEntryEvents: SettlementEvent[];
  revealedAiDecisions: AiDecision[];
  recentMarkets: AiPublicMarketSnapshot[];
  roomSettlement: ClientRoomSettlementRecord | null;
  /** Active-only room facts consumed by the independent v4 factual replay. */
  roomRecords: SurvivalRoomRecord[];
  floorRecords: SurvivalFloorRecord[];
  completionReason: 'survivor_threshold' | 'all_eliminated' | null;
  finalRanking: SurvivalRankingEntry[];
  championId: string | null;
}

export type SurvivalGameAction =
  | { type: 'submit_player_turn'; turn: PlayerTurn }
  | { type: 'submit_ai_room' }
  | { type: 'advance_room' }
  | { type: 'advance_floor' };

function activePlayers(state: SurvivalGameState): RuntimePlayerState[] {
  const ids = new Set(state.activePlayerIds);
  return state.players.filter((player) => ids.has(player.id));
}

function mergePlayers(
  roster: RuntimePlayerState[],
  updated: RuntimePlayerState[],
): RuntimePlayerState[] {
  const byId = new Map(updated.map((player) => [player.id, player]));
  return roster.map((player) => byId.get(player.id) ?? player);
}

function roomRules(
  rules: Readonly<SurvivalRules>,
  floorIndex: number,
  count: number,
): RulesConfig {
  return {
    ...defaultRules,
    playerCount: count,
    roomsPerFloor: Array<number>(floorIndex + 1).fill(rules.roomsPerFloor),
    floorStartingMoney: Array<number>(floorIndex + 1).fill(
      rules.floorStartingMoney,
    ),
    scoreStorageDecimals: rules.scoreStorageDecimals,
  };
}

function validateRuntimeNumbers(
  players: readonly RuntimePlayerState[],
  decimals: number,
): void {
  for (const player of players) {
    if (!Number.isSafeInteger(player.money) || player.money < 0)
      throw new RangeError('Survival money exceeds the safe integer range.');
    validateSurvivalStoredScore(player.score, decimals);
    if (
      player.items.some((item) => survivalExcludedItems.includes(item.itemId))
    )
      throw new Error('Excluded item present in survival inventory.');
  }
}

function floorRooms(
  seed: number,
  floorIndex: number,
  bossRewards: BossRewardPolicy,
): GeneratedRoom[] {
  const random = createSeededRandom(
    mixClientSeed(
      seed,
      (0x243f6a88 ^ Math.imul(floorIndex + 1, 0x9e3779b1)) >>> 0,
    ),
  );
  return generateFloor(floorIndex, random, survivalItemCatalog, bossRewards);
}

export function startSurvivalGame(
  options: SurvivalStartOptions,
): SurvivalGameState {
  if (
    options.aiPolicy !== undefined &&
    (options.aiPolicy !== currentSurvivalAiPolicy ||
      options.aiDifficulty === undefined)
  )
    throw new Error('Unknown survival AI policy or missing difficulty.');
  if (
    options.aiDifficulty !== undefined &&
    !isSurvivalDifficulty(options.aiDifficulty)
  )
    throw new RangeError('Unknown survival AI difficulty.');
  const rules = Object.freeze({ ...(options.rules ?? survivalPrototypeRules) });
  validateSurvivalRules(rules);
  // This release is two presets, not a general custom-roster/room editor.
  if (
    rules.initialPlayerCount !== 20 ||
    rules.roomsPerFloor !== 5 ||
    rules.floorStartingMoney !== 1000 ||
    rules.minimumEliminations !== 2 ||
    rules.finalSurvivorCount !== 6 ||
    rules.scoreStorageDecimals !== 4
  ) {
    throw new RangeError(
      'Survival requires the confirmed 20-player, five-room, 1000-money, two-elimination/six-survivor preset.',
    );
  }
  if (
    !Number.isInteger(options.seed) ||
    options.seed < 0 ||
    options.seed > 0xffffffff
  ) {
    throw new RangeError('Survival seed must be an unsigned 32-bit integer.');
  }
  const maximumFloors = maximumSurvivalFloors(rules);
  if (maximumFloors < 1)
    throw new RangeError(
      'A survival match must start above the final survivor threshold.',
    );
  if (
    !Array.isArray(options.cutLines) ||
    options.cutLines.length !== maximumFloors
  ) {
    throw new RangeError(
      'Provide an explicit cut-line schedule for every potentially visited floor.',
    );
  }
  for (const cutLine of options.cutLines)
    validateSurvivalStoredScore(cutLine, rules.scoreStorageDecimals);
  if (options.bossRewards !== undefined && options.bossRewards !== 'standard') {
    throw new RangeError('Survival BOSS rewards must use the ordinary pool.');
  }
  const build = options.buildId ?? 'test-or-unbundled';
  validateBuild(build);
  const roster = createClientRoster(
    options.characterId,
    options.seed,
    survivalExcludedItems,
  );
  const preparation = preparePlayersForRoom(
    roster.players,
    0,
    0,
    roomRules(rules, 0, roster.players.length),
    createSeededRandom(mixClientSeed(options.seed, 0x13198a2e)),
  );
  validateRuntimeNumbers(preparation.players, rules.scoreStorageDecimals);
  return {
    ...(options.aiPolicy !== undefined ? { aiPolicy: options.aiPolicy } : {}),
    ...(options.aiDifficulty !== undefined
      ? { aiDifficulty: options.aiDifficulty }
      : {}),
    mode: 'survival',
    phase: 'room_action',
    seed: options.seed,
    startedBuild: build,
    currentBuild: build,
    completedBuild: null,
    commandLog: [],
    selectedCharacter: options.characterId,
    humanPlayerId: 'human',
    rules,
    cutLines: Object.freeze([...options.cutLines]),
    bossRewards: 'standard',
    floorIndex: 0,
    roomIndex: 0,
    rooms: [floorRooms(options.seed, 0, 'standard')],
    players: preparation.players,
    activePlayerIds: preparation.players.map((player) => player.id),
    aiProfiles: roster.aiProfiles,
    previousSurvivalScores: Object.fromEntries(
      preparation.players.map((player) => [player.id, 0]),
    ),
    cumulativeScores: Object.fromEntries(
      preparation.players.map((player) => [player.id, 0]),
    ),
    currentFloorRoomScores: Object.fromEntries(
      preparation.players.map((player) => [player.id, []]),
    ),
    eliminated: {},
    humanEliminatedAt: null,
    roomEntryEvents: preparation.events,
    revealedAiDecisions: [],
    recentMarkets: [],
    roomSettlement: null,
    roomRecords: [],
    floorRecords: [],
    completionReason: null,
    finalRanking: [],
    championId: null,
  };
}

/** Compatibility alias for internal step-two callers, not for old experimental file migration. */
export const startSurvivalPrototype = startSurvivalGame;

function validateBuild(build: string): void {
  if (typeof build !== 'string' || !build.trim() || build.length > 160)
    throw new RangeError('Invalid survival build identity.');
}
export function withSurvivalBuild(
  state: SurvivalGameState,
  build: string,
): SurvivalGameState {
  validateBuild(build);
  return state.currentBuild === build
    ? state
    : { ...state, currentBuild: build };
}

function settleRoom(
  state: SurvivalGameState,
  humanTurn: PlayerTurn | null,
  decideTurn: typeof decideAiTurn,
): SurvivalGameState {
  const players = activePlayers(state);
  const room = state.rooms[state.floorIndex]![state.roomIndex]!;
  const rules = roomRules(state.rules, state.floorIndex, players.length);
  const globalRoomIndex =
    state.floorIndex * state.rules.roomsPerFloor + state.roomIndex;
  const ai = decideClientAiRoom(
    {
      seed: state.seed,
      players,
      aiProfiles: state.aiProfiles,
      room,
      globalRoomIndex,
      remainingRooms: state.rules.roomsPerFloor - state.roomIndex,
      // This is a bound used by the old heuristic, not hidden knowledge of the real finish time.
      remainingGameRooms:
        Math.ceil(
          (players.length - state.rules.finalSurvivorCount) /
            state.rules.minimumEliminations,
        ) *
          state.rules.roomsPerFloor -
        state.roomIndex,
      recentMarkets: state.recentMarkets,
      rules,
      survivalDifficulty: state.aiDifficulty,
      survivalAiPolicy: state.aiPolicy,
      survivalContext: {
        cutLine: state.cutLines[state.floorIndex]!,
        moneyExchangeRatio: state.rules.moneyExchangeRatio,
        scoreInheritanceRatio: state.rules.scoreInheritanceRatio,
        minimumEliminations: state.rules.minimumEliminations,
        participants: players.map((player) => ({
          playerId: player.id,
          money: player.money,
          roomScore: (state.currentFloorRoomScores[player.id] ?? []).reduce(
            (sum, value) => sum + value,
            0,
          ),
          previousSurvivalScore: state.previousSurvivalScores[player.id] ?? 0,
        })),
      },
    },
    decideTurn,
  );
  const turns = [
    ...(humanTurn ? [humanTurn] : []),
    ...ai.decisions.map((decision) => decision.turn),
  ];
  const minimumAcquisitionOrder =
    state.players.reduce(
      (highest, player) =>
        player.items.reduce(
          (order, item) => Math.max(order, item.acquiredOrder),
          highest,
        ),
      0,
    ) + 1;
  const result = settleRuntimeRoom(
    room,
    players,
    turns,
    rules,
    createSeededRandom(
      mixClientSeed(state.seed, (0x510e527f ^ globalRoomIndex) >>> 0),
    ),
    { minimumAcquisitionOrder },
  );
  validateRuntimeNumbers(result.players, state.rules.scoreStorageDecimals);
  const record: SurvivalRoomRecord = {
    build: state.currentBuild,
    room,
    turns,
    playersBefore: players,
    ...result,
    entryEvents: state.roomEntryEvents.map((event) => ({ ...event })),
    activePlayerIds: players.map((player) => player.id),
    aiChoices: ai.decisions.map((decision) => ({
      playerId: decision.turn.playerId,
      strategy: decision.strategy,
    })),
  };
  const market = createClientMarketSnapshot(
    result,
    state.rules.floorStartingMoney,
    players.length,
  );
  return {
    ...state,
    phase: 'room_result',
    players: mergePlayers(state.players, result.players),
    aiProfiles: updateClientAiHistory(ai.aiProfiles, ai.decisions, result),
    revealedAiDecisions: ai.decisions,
    recentMarkets: market
      ? [...state.recentMarkets, market].slice(-3)
      : state.recentMarkets,
    roomSettlement: record,
    roomRecords: [...state.roomRecords, record],
    currentFloorRoomScores: {
      ...state.currentFloorRoomScores,
      ...Object.fromEntries(
        result.players.map((player) => [
          player.id,
          [
            ...state.currentFloorRoomScores[player.id]!,
            result.roomScoreSummaries[player.id]!.finalScore,
          ],
        ]),
      ),
    },
  };
}

function settleFloor(state: SurvivalGameState): SurvivalGameState {
  const players = activePlayers(state);
  const scores = Object.fromEntries(
    players.map((player) => [
      player.id,
      calculateSurvivalFloorScore(
        {
          finalRoomScores: state.currentFloorRoomScores[player.id]!,
          remainingMoney: player.money,
          previousSurvivalScore: state.previousSurvivalScores[player.id]!,
        },
        state.rules,
      ),
    ]),
  );
  const cutLine = state.cutLines[state.floorIndex]!;
  const resolved = settleSurvivalEliminations(
    players.map((player) => ({
      playerId: player.id,
      survivalScore: scores[player.id]!.survivalScore,
    })),
    cutLine,
    state.rules,
    createSeededRandom(
      mixClientSeed(state.seed, (0x94d049bb ^ state.floorIndex) >>> 0),
    ),
  );
  const { plan, ...resolution } = resolved;
  const record: SurvivalFloorRecord = {
    build: state.currentBuild,
    floorIndex: state.floorIndex,
    cutLine,
    activePlayerIds: [...state.activePlayerIds],
    scores,
    plan,
    resolution,
  };
  const base: SurvivalGameState = {
    ...state,
    phase: 'floor_result',
    floorRecords: [...state.floorRecords, record],
  };
  const eliminated = { ...state.eliminated };
  const cumulativeScores = { ...state.cumulativeScores };
  const factor = 10 ** state.rules.scoreStorageDecimals;
  for (const player of players) {
    const total =
      Math.round(
        (cumulativeScores[player.id]! +
          scores[player.id]!.newScore +
          Number.EPSILON) *
          factor,
      ) / factor;
    validateSurvivalStoredScore(total, state.rules.scoreStorageDecimals);
    cumulativeScores[player.id] = total;
  }
  for (const elimination of plan.eliminations) {
    eliminated[elimination.playerId] = {
      floorIndex: state.floorIndex,
      reason: elimination.reason,
      score: scores[elimination.playerId]!,
      cumulativeScore: cumulativeScores[elimination.playerId]!,
    };
  }
  return {
    ...base,
    activePlayerIds: [...plan.survivorIds],
    eliminated,
    cumulativeScores,
    previousSurvivalScores: {
      ...state.previousSurvivalScores,
      ...Object.fromEntries(
        players.map((player) => [player.id, scores[player.id]!.survivalScore]),
      ),
    },
    humanEliminatedAt:
      state.humanEliminatedAt ?? eliminated.human?.floorIndex ?? null,
  };
}

function enterRoom(
  state: SurvivalGameState,
  nextFloor: boolean,
): SurvivalGameState {
  const floorIndex = nextFloor ? state.floorIndex + 1 : state.floorIndex;
  const roomIndex = nextFloor ? 0 : state.roomIndex + 1;
  const players = activePlayers(state);
  const globalRoomIndex = floorIndex * state.rules.roomsPerFloor + roomIndex;
  const preparation = preparePlayersForRoom(
    players,
    floorIndex,
    roomIndex,
    roomRules(state.rules, floorIndex, players.length),
    createSeededRandom(
      mixClientSeed(state.seed, (0x1f83d9ab ^ globalRoomIndex) >>> 0),
    ),
  );
  validateRuntimeNumbers(preparation.players, state.rules.scoreStorageDecimals);
  return {
    ...state,
    phase: 'room_action',
    floorIndex,
    roomIndex,
    rooms: nextFloor
      ? [...state.rooms, floorRooms(state.seed, floorIndex, state.bossRewards)]
      : state.rooms,
    players: mergePlayers(state.players, preparation.players),
    roomEntryEvents: preparation.events,
    roomSettlement: null,
    revealedAiDecisions: [],
    currentFloorRoomScores: nextFloor
      ? Object.fromEntries(state.activePlayerIds.map((id) => [id, []]))
      : state.currentFloorRoomScores,
  };
}

function reduceSurvival(
  state: SurvivalGameState,
  action: SurvivalGameAction,
  decideTurn: typeof decideAiTurn,
): SurvivalGameState {
  if (state.phase === 'room_action') {
    const humanActive = state.activePlayerIds.includes(state.humanPlayerId);
    if (action.type === 'submit_player_turn' && humanActive) {
      const human = state.players.find(
        (player) => player.id === state.humanPlayerId,
      )!;
      if (
        validateTurn(
          human,
          action.turn,
          roomRules(
            state.rules,
            state.floorIndex,
            state.activePlayerIds.length,
          ),
        ).length
      )
        return state;
      return settleRoom(state, action.turn, decideTurn);
    }
    if (action.type === 'submit_ai_room' && !humanActive)
      return settleRoom(state, null, decideTurn);
  }
  if (state.phase === 'room_result' && action.type === 'advance_room') {
    return state.roomIndex === state.rules.roomsPerFloor - 1
      ? settleFloor(state)
      : enterRoom(state, false);
  }
  if (state.phase === 'floor_result' && action.type === 'advance_floor') {
    const plan = state.floorRecords.at(-1)!.plan;
    if (plan.shouldFinish) {
      const random = createSeededRandom(
        mixClientSeed(
          state.seed,
          (0x2545f491 ^ state.roomRecords.length) >>> 0,
        ),
      );
      const finalRanking = rankSurvivalFacts(
        state.players.map((player) => ({
          playerId: player.id,
          eliminationFloorIndex:
            state.eliminated[player.id]?.floorIndex ?? null,
          finalScore: state.cumulativeScores[player.id]!,
          tieBreaker: random.next(),
        })),
        state.rules.scoreStorageDecimals,
      );
      return {
        ...state,
        phase: 'competition_complete',
        completedBuild: state.currentBuild,
        completionReason: state.activePlayerIds.length
          ? 'survivor_threshold'
          : 'all_eliminated',
        finalRanking,
        championId:
          finalRanking.find((entry) => entry.isChampion)?.playerId ?? null,
      };
    }
    return enterRoom(state, true);
  }
  return state;
}

/** Internal prototype uses unchanged AI heuristics until the dedicated survival-AI step. */
export function survivalGameReducer(
  state: SurvivalGameState,
  action: SurvivalGameAction,
): SurvivalGameState {
  return recordCommand(state, action, decideSurvivalAiTurn);
}

function recordCommand(
  state: SurvivalGameState,
  action: SurvivalGameAction,
  decideTurn: typeof decideAiTurn,
): SurvivalGameState {
  const detachedAction = copySnapshot(action);
  const next = reduceSurvival(state, detachedAction, decideTurn);
  return next === state
    ? state
    : {
        ...next,
        commandLog: [
          ...state.commandLog,
          { build: state.currentBuild, action: detachedAction },
        ],
      };
}

export function createSurvivalResearchReducer(decideTurn: typeof decideAiTurn) {
  return (state: SurvivalGameState, action: SurvivalGameAction) =>
    recordCommand(state, action, decideTurn);
}

/** Complete the remaining competition only after personal elimination. */
export function continueSurvivalAfterHumanElimination(
  state: SurvivalGameState,
  reducer = survivalGameReducer,
): SurvivalGameState {
  if (state.activePlayerIds.includes(state.humanPlayerId)) return state;
  let current = state;
  // Detect a broken/injected reducer, never silently force a match to finish on this budget.
  const remainingFloors = Math.ceil(
    (state.activePlayerIds.length - state.rules.finalSurvivorCount) /
      state.rules.minimumEliminations,
  );
  const maximumCommands =
    (Math.max(0, remainingFloors) + 1) * (2 * state.rules.roomsPerFloor + 2);
  let commands = 0;
  while (current.phase !== 'competition_complete') {
    if (commands++ >= maximumCommands)
      throw new Error(
        'Automatic survival progression exceeded the derived rule bound.',
      );
    const action: SurvivalGameAction =
      current.phase === 'room_action'
        ? { type: 'submit_ai_room' }
        : current.phase === 'room_result'
          ? { type: 'advance_room' }
          : { type: 'advance_floor' };
    const next = reducer(current, action);
    if (next === current) return current;
    current = next;
  }
  return current;
}

/** Public projection never exposes future rewards, AI private predictions or unpublished turns. */
export function survivalPublicStatus(state: SurvivalGameState) {
  const round = (value: number) =>
    Math.round(
      (value + Number.EPSILON) * 10 ** state.rules.scoreStorageDecimals,
    ) /
    10 ** state.rules.scoreStorageDecimals;
  const eliminatedHuman = state.eliminated[state.humanPlayerId];
  const human = state.players.find(
    (player) => player.id === state.humanPlayerId,
  )!;
  return {
    mode: state.mode,
    floor: state.floorIndex + 1,
    room: state.roomIndex + 1,
    activePlayerCount: state.activePlayerIds.length,
    cutLine: state.cutLines[state.floorIndex]!,
    phase: state.phase,
    completionReason: state.completionReason,
    human: eliminatedHuman
      ? {
          status: 'eliminated' as const,
          floor: eliminatedHuman.floorIndex + 1,
          score: { ...eliminatedHuman.score },
        }
      : {
          status: 'active' as const,
          money: human.money,
          floorRoomScore: round(
            (state.currentFloorRoomScores[human.id] ?? []).reduce(
              (sum, value) => sum + value,
              0,
            ),
          ),
          projectedExchangeScore: round(
            human.money * state.rules.moneyExchangeRatio,
          ),
          inheritedScore:
            state.phase === 'floor_result' ||
            state.phase === 'competition_complete'
              ? state.floorRecords.at(-1)!.scores[human.id]!.inheritedScore
              : round(
                  state.previousSurvivalScores[human.id]! *
                    state.rules.scoreInheritanceRatio,
                ),
        },
  };
}
