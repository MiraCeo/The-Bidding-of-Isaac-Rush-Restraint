/** Research-only full-roster runner. Not a live game, checkpoint or factual replay. */
import { startSurvivalGame } from '../survival-session';
import {
  survivalPrototypeRules,
  maximumSurvivalFloors,
} from '../survival-rules';
import { survivalItemCatalog } from '../survival-content';
import { defaultRules } from '../config';
import {
  calculateSurvivalFloorScore,
  validateSurvivalStoredScore,
  type SurvivalFloorScore,
} from '../survival-floor';
import {
  decideClientAiRoom,
  createClientMarketSnapshot,
  updateClientAiHistory,
  mixClientSeed,
  type AiClientProfile,
} from '../client-runtime';
import { preparePlayersForRoom } from '../room-economy';
import { settleRuntimeRoom, type RoomSettlementResult } from '../room-engine';
import { generateFloor } from '../rooms';
import { createSeededRandom } from '../random';
import {
  createEmptyAiHistory,
  type AiPublicMarketSnapshot,
} from '../ai-analysis';
import { createAiQuoteProfile } from '../ai-quote';
import { generateAiPersonalities } from '../ai-personality';
import type {
  CharacterId,
  GeneratedRoom,
  PlayerTurn,
  RuntimePlayerState,
} from '../item-types';

export const probePolicies = ['pace_bid', 'withdraw', 'all_ai'] as const;
export type ProbePolicy = (typeof probePolicies)[number];
export interface ScoreProbeOptions {
  seed: number;
  characterId: CharacterId;
  policy: ProbePolicy;
  floors?: number;
}
export interface ProbeRoomFact {
  room: GeneratedRoom;
  turns: PlayerTurn[];
  before: RuntimePlayerState[];
  result: RoomSettlementResult;
}
export interface ProbeFloorFact {
  floorIndex: number;
  players: RuntimePlayerState[];
  scores: Record<string, SurvivalFloorScore>;
}
export interface ProbeObserver {
  onRoom?: (fact: ProbeRoomFact) => void;
  onFloor?: (fact: ProbeFloorFact) => void;
}

/** Does not relax production rules or use cutLine=0 (which still removes two players). */
export function runSurvivalScoreProbe(
  options: ScoreProbeOptions,
  observer: ProbeObserver = {},
) {
  const floors =
    options.floors ?? maximumSurvivalFloors(survivalPrototypeRules);
  if (!Number.isSafeInteger(floors) || floors < 1 || floors > 7)
    throw new RangeError('Score probe supports one to seven complete floors.');
  if (!probePolicies.includes(options.policy))
    throw new RangeError('Unknown score-probe policy.');
  const initial = startSurvivalGame({
    characterId: options.characterId,
    seed: options.seed,
    cutLines: Array(7).fill(0),
    buildId: 'research-no-elimination-1',
  });
  let players = initial.players,
    profiles = initial.aiProfiles,
    recentMarkets: AiPublicMarketSnapshot[] = [];
  // An extra balanced AI replaces the test-controlled slot only in this explicit condition.
  // Its profile has a separate stream, without consuming the original 19-AI initialization streams.
  if (options.policy === 'all_ai') {
    players = players.map((player) => ({ ...player, isHuman: false }));
    const random = createSeededRandom(mixClientSeed(options.seed, 0xc0ac29b7));
    profiles = {
      ...profiles,
      human: {
        playerId: 'human',
        name: '探针AI',
        doctrine: 'balanced',
        personalities: generateAiPersonalities(random, 2, 4),
        quoteProfile: createAiQuoteProfile(random),
        history: createEmptyAiHistory(),
      } satisfies AiClientProfile,
    };
  }
  let previousScores: Record<string, number> = Object.fromEntries(
    players.map((player) => [player.id, 0]),
  );
  const floorFacts: ProbeFloorFact[] = [];
  for (let floorIndex = 0; floorIndex < floors; floorIndex++) {
    const rules = {
      ...defaultRules,
      playerCount: 20,
      roomsPerFloor: Array(floorIndex + 1).fill(5),
      floorStartingMoney: Array(floorIndex + 1).fill(1000),
    };
    const rooms =
      floorIndex === 0
        ? initial.rooms[0]!
        : generateFloor(
            floorIndex,
            createSeededRandom(
              mixClientSeed(
                options.seed,
                (0x243f6a88 ^ Math.imul(floorIndex + 1, 0x9e3779b1)) >>> 0,
              ),
            ),
            survivalItemCatalog,
            'standard',
          );
    const scores: Record<string, number[]> = Object.fromEntries(
      players.map((player) => [player.id, []]),
    );
    for (let roomIndex = 0; roomIndex < 5; roomIndex++) {
      const globalRoomIndex = floorIndex * 5 + roomIndex;
      if (globalRoomIndex > 0)
        players = preparePlayersForRoom(
          players,
          floorIndex,
          roomIndex,
          rules,
          createSeededRandom(
            mixClientSeed(options.seed, (0x1f83d9ab ^ globalRoomIndex) >>> 0),
          ),
        ).players;
      const room = rooms[roomIndex]!;
      const ai = decideClientAiRoom({
        seed: options.seed,
        players,
        aiProfiles: profiles,
        room,
        globalRoomIndex,
        remainingRooms: 5 - roomIndex,
        // Same public upper bound as live survival with 20 active players; no fixed-finish knowledge.
        remainingGameRooms: 35 - roomIndex,
        recentMarkets,
        rules,
      });
      const human = players[0]!,
        amount = Math.floor(human.money / (5 - roomIndex));
      const turns: PlayerTurn[] =
        options.policy === 'all_ai'
          ? ai.decisions.map((decision) => decision.turn)
          : [
              {
                playerId: 'human',
                actions:
                  options.policy === 'withdraw' || amount < 1
                    ? [{ type: 'withdraw' }]
                    : [
                        {
                          type: 'bid',
                          group: roomIndex % 2 ? 'B' : 'A',
                          amount,
                        },
                      ],
              },
              ...ai.decisions.map((decision) => decision.turn),
            ];
      const minimumAcquisitionOrder =
        players.reduce(
          (highest, player) =>
            player.items.reduce(
              (order, item) => Math.max(order, item.acquiredOrder),
              highest,
            ),
          0,
        ) + 1;
      const before = players;
      const result = settleRuntimeRoom(
        room,
        players,
        turns,
        rules,
        createSeededRandom(
          mixClientSeed(options.seed, (0x510e527f ^ globalRoomIndex) >>> 0),
        ),
        { minimumAcquisitionOrder },
      );
      for (const player of result.players) {
        if (!Number.isSafeInteger(player.money) || player.money < 0)
          throw new Error('Invalid score-probe funds.');
        validateSurvivalStoredScore(player.score, 4);
        scores[player.id]!.push(
          result.roomScoreSummaries[player.id]!.finalScore,
        );
      }
      observer.onRoom?.({ room, turns, before, result });
      players = result.players;
      profiles = updateClientAiHistory(ai.aiProfiles, ai.decisions, result);
      const market = createClientMarketSnapshot(result, 1000, 20);
      if (market) recentMarkets = [...recentMarkets, market].slice(-3);
    }
    const fact: ProbeFloorFact = {
      floorIndex,
      players,
      scores: Object.fromEntries(
        players.map((player) => [
          player.id,
          calculateSurvivalFloorScore(
            {
              finalRoomScores: scores[player.id]!,
              remainingMoney: player.money,
              previousSurvivalScore: previousScores[player.id]!,
            },
            survivalPrototypeRules,
          ),
        ]),
      ),
    };
    floorFacts.push(fact);
    observer.onFloor?.(fact);
    previousScores = Object.fromEntries(
      players.map((player) => [
        player.id,
        fact.scores[player.id]!.survivalScore,
      ]),
    );
    // Deliberately no elimination, survival plan, champion, final ranking, profile or storage write.
  }
  return {
    kind: 'research-no-elimination' as const,
    seed: options.seed,
    policy: options.policy,
    players,
    aiProfiles: profiles,
    floors: floorFacts,
  };
}

/** Type-7 linear sample quantile. Keep finite values; no rounded inputs in threshold comparisons. */
export function scoreQuantile(sorted: readonly number[], probability: number) {
  if (!sorted.length) return null;
  if (probability < 0 || probability > 1)
    throw new RangeError('Invalid quantile probability.');
  const index = (sorted.length - 1) * probability,
    lo = Math.floor(index),
    hi = Math.ceil(index);
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (index - lo);
}
export function summarizeScores(values: readonly number[]) {
  if (values.some((value) => !Number.isFinite(value) || value < 0))
    throw new Error('Invalid research sample.');
  const sorted = [...values].sort((a, b) => a - b),
    sum = values.reduce((a, b) => a + b, 0);
  return {
    n: values.length,
    mean: values.length ? sum / values.length : null,
    zeroRate: values.length
      ? values.filter((value) => value === 0).length / values.length
      : null,
    min: sorted[0] ?? null,
    p05: scoreQuantile(sorted, 0.05),
    p10: scoreQuantile(sorted, 0.1),
    p15: scoreQuantile(sorted, 0.15),
    p20: scoreQuantile(sorted, 0.2),
    p25: scoreQuantile(sorted, 0.25),
    p50: scoreQuantile(sorted, 0.5),
    p75: scoreQuantile(sorted, 0.75),
    p90: scoreQuantile(sorted, 0.9),
    p95: scoreQuantile(sorted, 0.95),
    p99: scoreQuantile(sorted, 0.99),
    max: sorted.at(-1) ?? null,
  };
}
