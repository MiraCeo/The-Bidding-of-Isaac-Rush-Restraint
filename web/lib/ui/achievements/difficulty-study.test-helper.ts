/** Offline research only. Scripted human-slot policies are not human telemetry.
 * No browser/storage, balance overrides, item injection or capacity experiments. */
import { defaultRules } from '../../game/config';
import {
  decideAiTurn,
  type AiStrategy,
  type AiDecisionOptions,
} from '../../game/ai-decision';
import { decideSurvivalAiTurn } from '../../game/survival-ai';
import { createAiQuoteProfile } from '../../game/ai-quote';
import {
  createEmptyAiHistory,
  type AiPlayerHistory,
  type AiPublicMarketSnapshot,
} from '../../game/ai-analysis';
import { createSeededRandom } from '../../game/random';
import { validateTurn } from '../../game/turns';
import type {
  CharacterId,
  GeneratedRoom,
  PlayerTurn,
  RuntimePlayerState,
  RoomReward,
} from '../../game/item-types';
import type { RulesConfig } from '../../game/types';
import type { ClassicAiSettings } from '../../game/classic-difficulty';
import type { SurvivalDifficulty } from '../../game/survival-difficulty';
import type { SurvivalGameState } from '../../game/survival-session';
import type {
  ActiveClientGameState,
  ClientRoomSettlementRecord,
} from '../../game/client-session';
import { createGameSession, reduceGameSession } from '../game-session';
import {
  startSurvivalClient,
  reduceSurvivalClient,
  survivalRoomRules,
} from '../survival-client';
import {
  beginClassicGrowth,
  beginSurvivalGrowth,
  applyGrowthContext,
  type GrowthContext,
} from './lifecycle';
import { createPlayerProfile } from '../player-profile';
import { projectAchievementRegistry } from './registry';
import { decodeAchievementEvent } from './event-codec';
import {
  achievementCatalog,
  achievementCharacters,
  type AchievementId,
} from './catalog';
import { canonicalJson } from '../../shared/json-facts';
import { sha256Hex } from '../../shared/sha256';

export const studyPolicies = ['pace', 'public-ai', 'explore'] as const;
export type StudyPolicy = (typeof studyPolicies)[number];
export const studyTime = new Date('2026-10-15T00:00:00.000Z');
const owns = (p: RuntimePlayerState, id: string) =>
  p.items.some((i) => i.itemId === id);
export interface StudyMetrics {
  highest: number;
  interest: number;
  savings: number;
  stolen: number;
}
export interface StudyMatch {
  mode: 'classic' | 'survival';
  difficulty: 'classic' | SurvivalDifficulty;
  classicAi?: ClassicAiSettings;
  role: CharacterId;
  policy: StudyPolicy;
  seed: number;
  humanRooms: number;
  totalRooms: number;
  terminal: boolean;
  champion: boolean;
  survived: boolean;
  achieved: AchievementId[];
  metrics: StudyMetrics;
  actions: Record<'bid' | 'disrupt' | 'withdraw' | 'dual', number>;
  opportunities: {
    interestRooms: number;
    bagRooms: number;
    saleRooms: number;
    dualBidRooms: number;
    dualDisruptRooms: number;
    transcendenceRooms: number;
    fullBidActions: number;
  };
  events: { kind: 'entry' | 'room'; index: number; metrics: StudyMetrics }[];
  root: string;
  traceFingerprint: string;
}
function rank(
  players: readonly RuntimePlayerState[],
  human: RuntimePlayerState,
  key: 'money' | 'score',
) {
  return players.length <= 1
    ? 1
    : 1 -
        players.filter((p) => p[key] > human[key]).length /
          (players.length - 1);
}
export function createStudyController(seed: number, policy: StudyPolicy) {
  const random = createSeededRandom((seed ^ 0x6a09e667) >>> 0),
    quoteRandom = createSeededRandom((seed ^ 0xbb67ae85) >>> 0);
  const quoteProfile = createAiQuoteProfile(
    createSeededRandom((seed ^ 0x3c6ef372) >>> 0),
  );
  let history: AiPlayerHistory = createEmptyAiHistory(),
    strategy: AiStrategy = 'withdraw';
  const decide = (
    game: ActiveClientGameState | SurvivalGameState,
    rules: RulesConfig,
  ): PlayerTurn => {
    const human = game.players.find((p) => p.id === 'human')!,
      active =
        'activePlayerIds' in game
          ? game.players.filter((p) => game.activePlayerIds.includes(p.id))
          : game.players;
    const current = game.rooms[game.floorIndex]![game.roomIndex]!;
    // Mask hidden item identities even before the existing AI's own hidden checks.
    const visibleReward = (reward: RoomReward): RoomReward =>
      reward.hidden ? { ...reward, itemId: 'score_charm' } : reward;
    const room: GeneratedRoom = {
      ...current,
      rewards: [
        visibleReward(current.rewards[0]),
        visibleReward(current.rewards[1]),
      ],
    };
    const remaining = 5 - game.roomIndex,
      amount = Math.floor(human.money / remaining),
      group = random.next() < 0.5 ? 'A' : 'B';
    if (policy === 'public-ai') {
      const options: AiDecisionOptions = {
        remainingRooms: remaining,
        enableDoubleActions: true,
        enableSituationAnalysis: true,
        enableItemAnalysis: true,
        doctrine: 'balanced',
        personalities: [],
        quoteProfile,
        quoteRandom,
        context: {
          moneyRankPercentile: rank(active, human, 'money'),
          scoreRankPercentile: rank(active, human, 'score'),
          history,
          recentMarkets: game.recentMarkets.slice(
            -3,
          ) as AiPublicMarketSnapshot[],
          room,
          remainingGameRooms:
            'activePlayerIds' in game
              ? Math.ceil(
                  (active.length - game.rules.finalSurvivorCount) /
                    game.rules.minimumEliminations,
                ) *
                  5 -
                game.roomIndex
              : 15 - game.floorIndex * 5 - game.roomIndex,
        },
      };
      if ('activePlayerIds' in game) {
        options.survivalDifficulty = 'highest';
        options.survivalAiPolicy = game.aiPolicy;
        options.survivalContext = {
          cutLine: game.cutLines[game.floorIndex]!,
          moneyExchangeRatio: game.rules.moneyExchangeRatio,
          scoreInheritanceRatio: game.rules.scoreInheritanceRatio,
          minimumEliminations: game.rules.minimumEliminations,
          participants: active.map((p) => ({
            playerId: p.id,
            money: p.money,
            roomScore: (game.currentFloorRoomScores[p.id] ?? []).reduce(
              (a, b) => a + b,
              0,
            ),
            previousSurvivalScore: game.previousSurvivalScores[p.id] ?? 0,
          })),
        };
      }
      const result = (
        'activePlayerIds' in game ? decideSurvivalAiTurn : decideAiTurn
      )(human, game.floorIndex, rules, random, options);
      strategy = result.strategy;
      return result.turn;
    }
    if (amount < 1) {
      strategy = 'withdraw';
      return { playerId: 'human', actions: [{ type: 'withdraw' }] };
    }
    if (policy === 'explore') {
      const roll = random.next(),
        cap = Math.floor(human.money * 0.5);
      if (roll < 0.08) {
        strategy = 'withdraw';
        return { playerId: 'human', actions: [{ type: 'withdraw' }] };
      }
      if (roll < 0.25 && cap >= 2) {
        strategy = 'disrupt_high';
        const first = Math.min(
          cap,
          Math.max(1, Math.round(amount * (0.7 + random.next() * 0.5))),
        );
        if (owns(human, 'more_options_question'))
          return {
            playerId: 'human',
            actions: [
              { type: 'disrupt', group: 'A', amount: first },
              {
                type: 'disrupt',
                group: 'B',
                amount: Math.min(cap, Math.max(1, Math.round(amount * 0.6))),
              },
            ],
          };
        return {
          playerId: 'human',
          actions: [{ type: 'disrupt', group, amount: first }],
        };
      }
      if (roll < 0.3) {
        strategy = 'high_bid';
        return {
          playerId: 'human',
          actions: [{ type: 'bid', group, amount: human.money }],
        };
      }
      if (owns(human, 'more_options') && cap >= 3 && roll < 0.8) {
        strategy = 'cooperate';
        const first = Math.max(
            1,
            Math.min(cap - 1, Math.round(Math.min(cap, amount * 1.3) * 0.65)),
          ),
          second = Math.max(
            1,
            Math.min(cap - first, Math.round(amount * 0.45)),
          );
        return {
          playerId: 'human',
          actions: [
            { type: 'bid', group: 'A', amount: first },
            { type: 'bid', group: 'B', amount: second },
          ],
        };
      }
    }
    strategy = 'cooperate';
    return { playerId: 'human', actions: [{ type: 'bid', group, amount }] };
  };
  const update = (r: ClientRoomSettlementRecord) => {
    const acts = r.resolvedActions.filter((a) => a.playerId === 'human');
    if (!acts.length) return;
    const competitive = strategy !== 'withdraw',
      awards = r.awards
        .filter((a) => a.playerId === 'human')
        .reduce((n, a) => n + a.copies, 0),
      earnedEntitlement = r.entitlements.some((a) => a.playerId === 'human');
    history = {
      ...history,
      rounds: history.rounds + 1,
      competitiveRounds: history.competitiveRounds + Number(competitive),
      awards: history.awards + awards,
      failedCompetitiveRounds:
        history.failedCompetitiveRounds +
        Number(competitive && !earnedEntitlement),
      lastStrategy: strategy,
      strategyCounts: {
        ...history.strategyCounts,
        [strategy]: history.strategyCounts[strategy] + 1,
      },
    };
  };
  return { decide, update };
}
function blankMetrics(): StudyMetrics {
  return { highest: 0, interest: 0, savings: 0, stolen: 0 };
}
function summarize(
  context: GrowthContext,
  meta: Omit<
    StudyMatch,
    'achieved' | 'metrics' | 'events' | 'root' | 'traceFingerprint'
  >,
): StudyMatch {
  const result = applyGrowthContext(
      createPlayerProfile(studyTime),
      context,
      studyTime,
    ),
    view = projectAchievementRegistry(result.profile)!;
  const metrics = {
    highest: view.progress.B08,
    interest: view.progress.D08,
    savings: view.progress.D10,
    stolen: view.progress.D11,
  };
  const events: StudyMatch['events'] = [];
  for (const unit of context.units) {
    const e = decodeAchievementEvent(unit),
      m = blankMetrics();
    if (e.stage === 'entry') {
      m.interest = e.facts.interestMoney;
      m.stolen = e.facts.stolenMoney;
    } else if (e.stage === 'room') {
      m.highest = e.facts.highestAwardOpportunities;
      m.savings = e.facts.saleSavings ?? 0;
    } else continue;
    events.push({ kind: e.stage, index: unit.position, metrics: m });
  }
  return {
    ...meta,
    achieved: Object.keys(view.achievedAt).sort() as AchievementId[],
    metrics,
    events,
    root: context.root,
    traceFingerprint: sha256Hex(canonicalJson(context)),
  };
}
export function playAchievementStudy(
  seed: number,
  role: CharacterId,
  policy: StudyPolicy,
  difficulty: 'classic' | SurvivalDifficulty = 'classic',
  observer?: {
    room?: (record: ClientRoomSettlementRecord, rules: RulesConfig) => void;
    aiOnlyRoom?: (
      record: ClientRoomSettlementRecord,
      rules: RulesConfig,
    ) => void;
    complete?: (context: GrowthContext) => void;
    terminal?: (game: ActiveClientGameState | SurvivalGameState) => void;
  },
  classicAi?: ClassicAiSettings,
): StudyMatch {
  if (classicAi && difficulty !== 'classic')
    throw Error('Classic research settings cannot label a survival match');
  const ctrl = createStudyController(seed, policy),
    actions: StudyMatch['actions'] = {
      bid: 0,
      disrupt: 0,
      withdraw: 0,
      dual: 0,
    };
  const opportunities: StudyMatch['opportunities'] = {
    interestRooms: 0,
    bagRooms: 0,
    saleRooms: 0,
    dualBidRooms: 0,
    dualDisruptRooms: 0,
    transcendenceRooms: 0,
    fullBidActions: 0,
  };
  const observe = (r: ClientRoomSettlementRecord, rules = defaultRules) => {
    const p = r.playersBefore.find((p) => p.id === 'human');
    if (!p) return;
    observer?.room?.(r, rules);
    for (const [key, item] of [
      ['interestRooms', 'interest'],
      ['bagRooms', 'money_bag'],
      ['saleRooms', 'steam_sale'],
      ['dualBidRooms', 'more_options'],
      ['dualDisruptRooms', 'more_options_question'],
      ['transcendenceRooms', 'transcendence'],
    ] as const)
      opportunities[key] += Number(owns(p, item));
    const own = r.resolvedActions.filter((a) => a.playerId === 'human');
    if (own.length === 2) actions.dual++;
    for (const a of own) {
      actions[a.action.type]++;
      opportunities.fullBidActions += Number(
        a.action.type === 'bid' && a.action.amount === p.money && p.money > 0,
      );
    }
    ctrl.update(r);
  };
  if (difficulty === 'classic') {
    let s = beginClassicGrowth(
        reduceGameSession(createGameSession(seed), {
          type: 'start_game',
          characterId: role,
          ...(classicAi ? { classicAi } : {}),
        }),
      ),
      commands = 0;
    while (s.game.phase !== 'game_result') {
      if (++commands > 32) throw Error('Classic study command bound exceeded');
      if (s.game.phase === 'character_selection')
        throw Error('Unexpected selection');
      if (s.game.phase === 'room_action') {
        const turn = ctrl.decide(s.game, defaultRules),
          p = s.game.players.find((p) => p.id === 'human')!;
        if (validateTurn(p, turn, defaultRules).length)
          throw Error('Study submitted invalid classic action');
        s = reduceGameSession(s, { type: 'submit_player_turn', turn });
        if (s.game.phase === 'character_selection' || !s.game.roomSettlement)
          throw Error('Missing settlement');
        observe(s.game.roomSettlement);
      } else s = reduceGameSession(s, { type: 'advance_room' });
      if (s.growthIssue) throw Error(s.growthIssue);
    }
    const human = s.game.finalRanking.find((p) => p.playerId === 'human')!;
    observer?.terminal?.(s.game);
    observer?.complete?.(s.growth!);
    return summarize(s.growth!, {
      mode: 'classic',
      difficulty,
      ...(classicAi ? { classicAi: s.game.classicAi! } : {}),
      role,
      policy,
      seed,
      humanRooms: s.replay!.rooms.length,
      totalRooms: s.replay!.rooms.length,
      terminal: true,
      champion: !s.game.finalRanking.some(
        (p) => p.finalScore > human.finalScore,
      ),
      survived: true,
      actions,
      opportunities,
    });
  }
  let s = beginSurvivalGrowth(startSurvivalClient(role, seed, difficulty)),
    commands = 0;
  while (s.game.phase !== 'competition_complete') {
    const g = s.game;
    if (++commands > 80) throw Error('Survival study command bound exceeded');
    if (g.phase === 'room_action') {
      if (g.activePlayerIds.includes('human')) {
        const rules = survivalRoomRules(g),
          turn = ctrl.decide(g, rules),
          p = g.players.find((p) => p.id === 'human')!;
        if (validateTurn(p, turn, rules).length)
          throw Error('Study submitted invalid survival action');
        s = reduceSurvivalClient(s, { type: 'submit_player_turn', turn });
        if (!s.game.roomSettlement) throw Error('Missing survival settlement');
        observe(s.game.roomSettlement, rules);
      } else {
        s = reduceSurvivalClient(s, { type: 'submit_ai_room' });
        if (!s.game.roomSettlement) throw Error('Missing AI-only settlement');
        observer?.aiOnlyRoom?.(s.game.roomSettlement, survivalRoomRules(g));
      }
    } else
      s = reduceSurvivalClient(s, {
        type: g.phase === 'room_result' ? 'advance_room' : 'advance_floor',
      });
    if (s.growthIssue) throw Error(s.growthIssue);
  }
  observer?.terminal?.(s.game);
  observer?.complete?.(s.growth!);
  return summarize(s.growth!, {
    mode: 'survival',
    difficulty,
    role,
    policy,
    seed,
    humanRooms: s.game.roomRecords.filter((r) =>
      r.activePlayerIds.includes('human'),
    ).length,
    totalRooms: s.game.roomRecords.length,
    terminal: true,
    champion: s.game.championId === 'human',
    survived: s.game.humanEliminatedAt === null,
    actions,
    opportunities,
  });
}
export function summarizeStudyRows(rows: readonly StudyMatch[]) {
  const metrics = Object.keys(blankMetrics()) as (keyof StudyMetrics)[];
  const distribution = (values: number[]) => {
    const sorted = [...values].sort((a, b) => a - b);
    const quantile = (p: number) =>
      sorted.length
        ? sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1)]!
        : 0;
    return {
      n: sorted.length,
      mean: sorted.reduce((a, b) => a + b, 0) / (sorted.length || 1),
      p50: quantile(0.5),
      p90: quantile(0.9),
      p95: quantile(0.95),
      max: sorted.at(-1) ?? 0,
      zero: sorted.filter((x) => x === 0).length,
    };
  };
  const rate = (hits: number, n: number) => {
    if (!n) return { hits, n, rate: null, lo95: null, hi95: null };
    const z = 1.96,
      p = hits / n,
      d = 1 + (z * z) / n,
      c = (p + (z * z) / (2 * n)) / d,
      e = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d;
    return {
      hits,
      n,
      rate: p,
      lo95: Math.max(0, c - e),
      hi95: Math.min(1, c + e),
    };
  };
  const groups = new Map<string, StudyMatch[]>();
  for (const r of rows) {
    const key = r.policy + '/' + r.difficulty;
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  return [...groups].map(([key, group]) => ({
    key,
    n: group.length,
    champions: rate(group.filter((r) => r.champion).length, group.length),
    survivors: rate(group.filter((r) => r.survived).length, group.length),
    humanRooms: distribution(group.map((r) => r.humanRooms)),
    metrics: Object.fromEntries(
      metrics.map((k) => [k, distribution(group.map((r) => r.metrics[k]))]),
    ),
    achievements: Object.fromEntries(
      achievementCatalog.map((a) => [
        a.id,
        rate(
          group.filter((r) => r.achieved.includes(a.id)).length,
          (a.scope === 'classic' && group[0]!.mode !== 'classic') ||
            (a.scope === 'survival' && group[0]!.mode !== 'survival')
            ? 0
            : group.length,
        ),
      ]),
    ),
    byRole: Object.fromEntries(
      achievementCharacters.map((role) => {
        const roleRows = group.filter((r) => r.role === role);
        return [
          role,
          {
            n: roleRows.length,
            metrics: Object.fromEntries(
              metrics.map((k) => [
                k,
                distribution(roleRows.map((r) => r.metrics[k])),
              ]),
            ),
            achievements: Object.fromEntries(
              achievementCatalog.map((a) => [
                a.id,
                rate(
                  roleRows.filter((r) => r.achieved.includes(a.id)).length,
                  (a.scope === 'classic' && group[0]!.mode !== 'classic') ||
                    (a.scope === 'survival' && group[0]!.mode !== 'survival')
                    ? 0
                    : roleRows.length,
                ),
              ]),
            ),
          },
        ];
      }),
    ),
  }));
}
