import {
  createEmptyAiHistory,
  type AiPlayerHistory,
  type AiPublicMarketSnapshot,
} from './ai-analysis';
import { decideAiTurn, type AiDecision, type AiDoctrine } from './ai-decision';
import { generateAiPersonalities, type AiPersonality } from './ai-personality';
import { createAiQuoteProfile, type AiQuoteProfile } from './ai-quote';
import { assignCharacter, chooseRandomCharacter } from './characters';
import type {
  CharacterId,
  GeneratedRoom,
  RuntimePlayerState,
  ItemId,
} from './item-types';
import { createSeededRandom } from './random';
import { createRuntimePlayer } from './runtime';
import type { RoomSettlementResult } from './room-engine';
import { validateTurn } from './turns';
import type { RulesConfig } from './types';
import type { SurvivalDifficulty } from './survival-difficulty';
import type { SurvivalAiPublicContext } from './survival-ai-plan';

export interface AiClientProfile {
  playerId: string;
  name: string;
  doctrine: AiDoctrine;
  personalities: AiPersonality[];
  history: AiPlayerHistory;
  quoteProfile: AiQuoteProfile;
}

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

export function mixClientSeed(seed: number, salt: number): number {
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

/** Same fixed 1+19 roster and independent random streams in both modes. */
export function createClientRoster(
  characterId: CharacterId,
  seed: number,
  excludedStartingItems: readonly ItemId[] = [],
) {
  const normalizedSeed = seed >>> 0;
  const characterRandom = createSeededRandom(
    mixClientSeed(normalizedSeed, 0xbb67ae85),
  );
  const personalityRandom = createSeededRandom(
    mixClientSeed(normalizedSeed, 0x6a09e667),
  );
  const quoteProfileRandom = createSeededRandom(
    mixClientSeed(normalizedSeed, 0xa4093822),
  );
  const shuffledDoctrines = shuffle(
    doctrinePopulation,
    mixClientSeed(normalizedSeed, 0x7f4a7c15),
  );
  let human = createRuntimePlayer({
    id: 'human',
    money: 0,
    score: 0,
    isHuman: true,
  });
  human = assignCharacter(
    human,
    characterId,
    characterRandom,
    excludedStartingItems,
  );

  const aiProfiles: Record<string, AiClientProfile> = {};
  const aiPlayers = aiNames.map((name, index) => {
    const playerId = `ai-${index + 1}`;
    const character = chooseRandomCharacter(characterRandom);
    const player = assignCharacter(
      createRuntimePlayer({ id: playerId, money: 0, score: 0, isHuman: false }),
      character,
      characterRandom,
      excludedStartingItems,
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

  return { players: [human, ...aiPlayers], aiProfiles };
}

function rankPercentiles(
  players: readonly RuntimePlayerState[],
  value: (player: RuntimePlayerState) => number,
): Map<string, number> {
  const ranked = [...players].sort(
    (left, right) =>
      value(right) - value(left) || left.id.localeCompare(right.id),
  );
  return new Map(
    ranked.map((player, index) => [
      player.id,
      ranked.length <= 1 ? 1 : 1 - index / (ranked.length - 1),
    ]),
  );
}

export interface ClientAiRoomInput {
  survivalDifficulty?: SurvivalDifficulty;
  survivalAiPolicy?: import('./survival-difficulty').SurvivalAiPolicy;
  survivalContext?: SurvivalAiPublicContext;
  seed: number;
  players: readonly RuntimePlayerState[];
  aiProfiles: Record<string, AiClientProfile>;
  room: GeneratedRoom;
  globalRoomIndex: number;
  remainingRooms: number;
  /** Exact in classic; a declared upper-bound horizon in the survival prototype. */
  remainingGameRooms: number;
  recentMarkets: readonly AiPublicMarketSnapshot[];
  rules: RulesConfig;
}

/** Public pre-submit inputs only; no human turn or other current secret submissions. */
export function decideClientAiRoom(
  state: ClientAiRoomInput,
  decideTurn = decideAiTurn,
) {
  const { room, globalRoomIndex, remainingRooms, remainingGameRooms } = state;
  const decisionRandom = createSeededRandom(
    mixClientSeed(state.seed, (0x9e3779b9 ^ globalRoomIndex) >>> 0),
  );
  const quoteRandom = createSeededRandom(
    mixClientSeed(state.seed, (0x3c6ef372 ^ globalRoomIndex) >>> 0),
  );
  const moneyRanks = rankPercentiles(state.players, (player) => player.money);
  const scoreRanks = rankPercentiles(state.players, (player) => player.score);
  const nextProfiles = { ...state.aiProfiles };

  const decisions = state.players
    .filter((player) => !player.isHuman)
    .map((player) => {
      const profile = state.aiProfiles[player.id];
      if (!profile) throw new Error(`玩家 ${player.id} 缺少 AI 档案。`);
      const decision = decideTurn(
        player,
        room.floorIndex,
        state.rules,
        decisionRandom,
        {
          ...(state.survivalContext
            ? {
                survivalContext: state.survivalContext,
                survivalDifficulty: state.survivalDifficulty,
                survivalAiPolicy: state.survivalAiPolicy,
                survivalDifficultyRandom: createSeededRandom(
                  mixClientSeed(
                    state.seed,
                    (0xa54ff53a ^
                      globalRoomIndex ^
                      Math.imul(
                        player.id === 'human'
                          ? 0
                          : Number(player.id.replace('ai-', '')),
                        0x85ebca6b,
                      )) >>>
                      0,
                  ),
                ),
              }
            : {}),
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
        },
      );
      const errors = validateTurn(player, decision.turn, state.rules);
      if (errors.length > 0) {
        throw new Error(`AI ${player.id} 生成了非法行动：${errors.join('；')}`);
      }
      const strategy = decision.strategy;
      nextProfiles[player.id] = {
        ...profile,
        history: {
          ...profile.history,
          rounds: profile.history.rounds + 1,
          competitiveRounds:
            profile.history.competitiveRounds +
            (strategy === 'withdraw' ? 0 : 1),
          strategyCounts: {
            ...profile.history.strategyCounts,
            [strategy]: profile.history.strategyCounts[strategy] + 1,
          },
          lastStrategy: strategy,
        },
      };
      return decision;
    });

  return { aiProfiles: nextProfiles, decisions };
}

export function createClientMarketSnapshot(
  settlement: RoomSettlementResult,
  floorMoney: number,
  playerCount: number,
): AiPublicMarketSnapshot | null {
  if (!settlement.baseline) return null;
  const marketActions = settlement.resolvedActions.filter(
    (resolved) => resolved.action.type !== 'withdraw',
  );
  const qualificationCutoffs = (['A', 'B'] as const).flatMap((group) => {
    const equivalents = settlement.highPricePlacements
      .filter((placement) => placement.group === group)
      .flatMap((placement) => {
        const resolved = settlement.resolvedActions.find(
          (action) =>
            action.playerId === placement.playerId &&
            action.action.type !== 'withdraw' &&
            action.action.group === group,
        );
        return resolved?.marketEquivalent === null ||
          resolved?.marketEquivalent === undefined
          ? []
          : [resolved.marketEquivalent];
      });
    return equivalents.length === 0 ? [] : [Math.min(...equivalents)];
  });
  return {
    targetRatio: settlement.baseline.target / floorMoney,
    participationRate: settlement.baseline.participantCount / playerCount,
    disruptionRate:
      marketActions.length === 0
        ? 0
        : marketActions.filter((action) => action.action.type === 'disrupt')
            .length / marketActions.length,
    highestMarketEquivalentRatio:
      Math.max(
        0,
        ...marketActions.map((action) => action.marketEquivalent ?? 0),
      ) / floorMoney,
    highPriceQualificationRatio:
      qualificationCutoffs.length === 0
        ? undefined
        : qualificationCutoffs.reduce((sum, value) => sum + value, 0) /
          qualificationCutoffs.length /
          floorMoney,
  };
}

export function updateClientAiHistory(
  profiles: Record<string, AiClientProfile>,
  decisions: readonly AiDecision[],
  settlement: RoomSettlementResult,
): Record<string, AiClientProfile> {
  const nextProfiles = { ...profiles };
  for (const decision of decisions) {
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
        failedCompetitiveRounds:
          profile.history.failedCompetitiveRounds +
          (decision.strategy !== 'withdraw' && !earnedEntitlement ? 1 : 0),
      },
    };
  }
  return nextProfiles;
}
