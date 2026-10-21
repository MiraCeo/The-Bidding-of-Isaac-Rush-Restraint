/** Isolated quote-lapse experiment. Never imported by production, never emits saves. */
import { createHash } from 'node:crypto';
import {
  decideAiTurn,
  type AiDecision,
  type AiDecisionOptions,
} from '../../game/ai-decision';
import type { AiQuoteAnalysis } from '../../game/ai-quote';
import { defaultRules } from '../../game/config';
import { classicAiPolicy } from '../../game/classic-difficulty';
import {
  startClientGame,
  createClientResearchReducer,
  clientGameReducer,
  type ClientRoomSettlementRecord,
  type ActiveClientGameState,
} from '../../game/client-session';
import {
  mixClientSeed,
  createClientMarketSnapshot,
} from '../../game/client-runtime';
import { createSeededRandom } from '../../game/random';
import { getRoomScoreMultiplier } from '../../game/room-modifiers';
import { hasItem } from '../../game/runtime';
import { getRuntimeActionAmounts, validateTurn } from '../../game/turns';
import type { PlayerAction, RulesConfig } from '../../game/types';
import type {
  CharacterId,
  PlayerTurn,
  RuntimePlayerState,
} from '../../game/item-types';
import { canonicalJson } from '../../shared/json-facts';
import {
  createStudyController,
  type StudyPolicy,
} from './difficulty-study.test-helper';
import {
  classicTierTrace,
  classicTierTerminalHash,
} from './classic-tier-study.test-helper';
import { mistakePlan } from '../../../scripts/classic-mistake-plan.mjs';

export type MistakeArm = (typeof mistakePlan.arms)[number];
const clamp = (n: number, lo: number, hi: number) =>
  Math.max(lo, Math.min(hi, n));
const hash = (v: unknown) =>
  createHash('sha256').update(canonicalJson(v)).digest('hex');

/** Exact classic candidateUtility mirror from ai-quote.ts, checked against its
 * emitted candidates in tests. Only public, pre-submit predictions are used. */
export function mistakeQuoteUtility(
  player: RuntimePlayerState,
  action: PlayerAction,
  strategy: AiDecision['strategy'],
  quote: AiQuoteAnalysis,
  decision: AiDecision,
  floor: number,
  rules: RulesConfig,
  options: AiDecisionOptions,
) {
  if (action.type === 'withdraw' || strategy === 'withdraw')
    throw Error('No active quote utility');
  const amounts = getRuntimeActionAmounts(player, action, rules);
  const floorMoney = rules.floorStartingMoney[floor]!;
  const prediction = quote.prediction,
    sigma = floorMoney * rules.scoreSigmaRatio;
  const score = Math.exp(
    -Math.abs((amounts.scoringEquivalent ?? 0) - prediction.predictedTarget) /
      sigma,
  );
  const adjustedScore =
    score *
    getRoomScoreMultiplier(
      options.context?.room.kind,
      rules.roomScoreMultipliers,
    );
  const acquisition =
    strategy === 'high_bid'
      ? 1 /
        (1 +
          Math.exp(
            -(
              (amounts.marketEquivalent ?? 0) -
              prediction.predictedHighPriceQualificationEquivalent
            ) / sigma,
          ))
      : strategy === 'cooperate'
        ? score
        : hasItem(player, 'transcendence')
          ? score * 0.5
          : 0;
  const sabotage =
    strategy === 'disrupt_high'
      ? clamp(
          (amounts.marketEquivalent ?? 0) /
            Math.max(prediction.predictedHighestMarketEquivalent, 1),
          0,
          1.5,
        )
      : 0;
  const scarcity = 1 / clamp(decision.liquidityRatio, 0.25, 1.5);
  const penalty =
    amounts.actualCost / Math.max(quote.opportunityBudget, floorMoney * 0.02);
  return (
    adjustedScore * (strategy === 'disrupt_high' ? 0.15 : 0.55) +
    acquisition *
      clamp(decision.analysis?.groupValues[action.group] ?? 0.5, 0, 1.25) *
      0.55 -
    penalty * (0.1 + scarcity * 0.04) +
    sabotage * 0.5
  );
}

export interface MistakeEvent {
  playerId: string;
  floor: number;
  room: number;
  triggered: boolean;
  applied: boolean;
  severity: 'mild' | 'medium' | null;
  requestedSeverity: 'mild' | 'medium' | null;
  reason: 'zero-cash' | 'not-triggered' | 'no-bounded-candidate' | 'applied';
  before?: PlayerTurn;
  after?: PlayerTurn;
  beforeCost?: number;
  afterCost?: number;
  modelLoss?: number;
}
export function applyQuoteMistake(
  decision: AiDecision,
  player: RuntimePlayerState,
  floor: number,
  rules: RulesConfig,
  options: AiDecisionOptions,
  seed: number,
  config: { rate: number; mediumShare: number },
) {
  if (
    !Number.isFinite(config.rate) ||
    !Number.isFinite(config.mediumShare) ||
    config.rate < 0 ||
    config.rate > 1 ||
    config.mediumShare < 0 ||
    config.mediumShare > 1
  )
    throw Error('Invalid mistake probability');
  const room = options.context?.room.roomIndex ?? 0;
  const event: MistakeEvent = {
    playerId: player.id,
    floor,
    room,
    triggered: false,
    applied: false,
    severity: null,
    requestedSeverity: null,
    reason: 'not-triggered',
  };
  // Zero-rate returns before creating or drawing any additional random stream.
  if (config.rate === 0) return { decision, event };
  if (player.money <= 0)
    return { decision, event: { ...event, reason: 'zero-cash' as const } };
  const ordinal = Number(player.id.replace('ai-', ''));
  if (!Number.isSafeInteger(ordinal)) throw Error('Mistake adapter is AI-only');
  const random = createSeededRandom(
    mixClientSeed(
      seed,
      (0x7f4a7c15 ^ (floor * 5 + room) ^ Math.imul(ordinal, 0x85ebca6b)) >>> 0,
    ),
  );
  if (random.next() >= config.rate) return { decision, event };
  event.triggered = true;
  const requested = random.next() < config.mediumShare ? 'medium' : 'mild';
  event.requestedSeverity = requested;
  const baseCost = decision.turn.actions.reduce(
    (n, a) => n + getRuntimeActionAmounts(player, a, rules).actualCost,
    0,
  );
  const candidates: {
    turn: PlayerTurn;
    loss: number;
    cost: number;
    severity: 'mild' | 'medium';
  }[] = [];
  for (const severity of (requested === 'medium'
    ? ['medium', 'mild']
    : ['mild']) as ('medium' | 'mild')[]) {
    for (const [index, action] of decision.turn.actions.entries()) {
      const quote =
        index === 0
          ? decision.quoteAnalysis
          : decision.secondaryActionAnalysis?.selectedQuote;
      const strategy =
        index === 0
          ? decision.strategy
          : decision.secondaryActionAnalysis?.selectedStrategy;
      if (
        action.type === 'withdraw' ||
        !quote ||
        !strategy ||
        strategy === 'withdraw'
      )
        continue;
      const originalUtility = mistakeQuoteUtility(
        player,
        action,
        strategy,
        quote,
        decision,
        floor,
        rules,
        options,
      );
      const factors =
        severity === 'mild'
          ? mistakePlan.mildFactors
          : mistakePlan.mediumFactors;
      for (const factor of factors) {
        const amount = Math.round(action.amount * factor);
        if (
          amount <= 0 ||
          amount === action.amount ||
          (amount >= player.money && action.amount < player.money)
        )
          continue;
        const replacement = { ...action, amount };
        const turn = {
          ...decision.turn,
          actions: decision.turn.actions.map((a, i) =>
            i === index ? replacement : a,
          ),
        };
        if (validateTurn(player, turn, rules).length) continue;
        const cost = turn.actions.reduce(
          (n, a) => n + getRuntimeActionAmounts(player, a, rules).actualCost,
          0,
        );
        const replacementCost = getRuntimeActionAmounts(
          player,
          replacement,
          rules,
        ).actualCost;
        if (
          cost > player.money ||
          replacementCost > quote.paceMaximumActualCost
        )
          continue;
        if (
          turn.actions.length === 2 &&
          cost > decision.secondaryActionAnalysis!.totalActualCostCap
        )
          continue;
        const loss =
          originalUtility -
          mistakeQuoteUtility(
            player,
            replacement,
            strategy,
            quote,
            decision,
            floor,
            rules,
            options,
          );
        const cap =
          severity === 'mild'
            ? mistakePlan.mildMaximumModelLoss
            : mistakePlan.mediumMaximumModelLoss;
        if (loss > 1e-8 && loss <= cap)
          candidates.push({ turn, loss, cost, severity });
      }
    }
    if (candidates.length) break;
  }
  if (!candidates.length)
    return {
      decision,
      event: { ...event, reason: 'no-bounded-candidate' as const },
    };
  const selected = candidates[Math.floor(random.next() * candidates.length)]!;
  return {
    // quoteAnalysis intentionally remains the PRE-lapse model. This experimental
    // state is never a playable save/replay or persisted classic-tiered-1 claim.
    decision: { ...decision, turn: selected.turn },
    event: {
      ...event,
      applied: true,
      severity: selected.severity,
      reason: 'applied' as const,
      before: decision.turn,
      after: selected.turn,
      beforeCost: baseCost,
      afterCost: selected.cost,
      modelLoss: selected.loss,
    },
  };
}

export function mistakeSeed(block: number) {
  if (!Number.isSafeInteger(block) || block < 0 || block >= mistakePlan.blocks)
    throw Error('Invalid mistake seed block');
  return (
    (0x08010000 + Math.imul(mistakePlan.seedStart + block + 1, 104729)) >>> 0
  );
}
function counters() {
  return {
    turns: 0,
    positiveCash: 0,
    triggers: 0,
    applied: 0,
    mild: 0,
    medium: 0,
    blocked: 0,
    modelLoss: 0,
    costChange: 0,
    withdraw: 0,
    zeroCash: 0,
    humanAwards: 0,
    humanEntitled: 0,
    aiAwards: 0,
    beforeBossCash: 0,
    beforeBossTurns: 0,
    targets: 0,
    targetRatio: 0,
    targetRatioSquared: 0,
  };
}
export function runMistakeMatch(
  block: number,
  role: CharacterId,
  policy: StudyPolicy,
  arm: MistakeArm,
  witness?: (event: MistakeEvent) => void,
  explicitStudySeed?: number,
  transform: typeof applyQuoteMistake = applyQuoteMistake,
  roomObserver?: (record: ClientRoomSettlementRecord) => void,
  terminalObserver?: (game: ActiveClientGameState) => void,
) {
  const seed = explicitStudySeed ?? mistakeSeed(block);
  if (!Number.isSafeInteger(seed) || seed < 0 || seed > 0xffffffff)
    throw Error('Invalid explicit research seed');
  let game = startClientGame(
    role,
    seed,
    arm.base === 'original'
      ? undefined
      : { policy: classicAiPolicy, difficulty: arm.base },
  );
  const world = hash({
    players: game.players,
    rooms: game.rooms,
    aiProfiles: game.aiProfiles,
  });
  const floors = [counters(), counters(), counters()];
  const decider: typeof decideAiTurn = (
    player,
    floor,
    rules,
    random,
    options,
  ) => {
    if (!options) throw Error('Research reducer must supply public context');
    const base = decideAiTurn(player, floor, rules, random, options);
    const result = transform(base, player, floor, rules, options, seed, arm);
    const stats = floors[floor]!;
    stats.positiveCash += Number(player.money > 0);
    stats.triggers += Number(result.event.triggered);
    stats.applied += Number(result.event.applied);
    stats.mild += Number(result.event.severity === 'mild');
    stats.medium += Number(result.event.severity === 'medium');
    stats.blocked += Number(result.event.triggered && !result.event.applied);
    stats.modelLoss += result.event.modelLoss ?? 0;
    stats.costChange +=
      (result.event.afterCost ?? 0) - (result.event.beforeCost ?? 0);
    if (result.event.triggered) witness?.(result.event);
    return result.decision;
  };
  const reduce =
    arm.rate === 0 ? clientGameReducer : createClientResearchReducer(decider);
  const ctrl = createStudyController(seed, policy),
    trace = classicTierTrace();
  let rooms = 0;
  for (let command = 0; game.phase !== 'game_result'; command++) {
    if (command >= 32) throw Error('Incomplete mistake game');
    if (game.phase === 'room_action') {
      const next = reduce(game, {
        type: 'submit_player_turn',
        turn: ctrl.decide(game, defaultRules),
      });
      if (next.phase !== 'room_result' || !next.roomSettlement)
        throw Error('Missing mistake settlement');
      game = next;
      const r = game.roomSettlement!,
        stats = floors[game.floorIndex]!,
        floorMoney = defaultRules.floorStartingMoney[game.floorIndex]!;
      if (arm.rate === 0)
        stats.positiveCash += r.playersBefore.filter(
          (p) => !p.isHuman && p.money > 0,
        ).length;
      for (const turn of r.turns) {
        const p = r.playersBefore.find((p) => p.id === turn.playerId)!;
        const cost = r.resolvedActions
          .filter((a) => a.playerId === p.id)
          .reduce((s, a) => s + a.actualCost, 0);
        if (
          validateTurn(p, turn, defaultRules).length ||
          cost < 0 ||
          cost > p.money
        )
          throw Error('Illegal mistake-study action or actual cost');
        const awards = r.awards
          .filter((a) => a.playerId === p.id)
          .reduce((s, a) => s + a.copies, 0);
        if (p.isHuman) {
          stats.humanAwards += awards;
          stats.humanEntitled += Number(
            r.entitlements.some((e) => e.playerId === p.id),
          );
          continue;
        }
        stats.turns++;
        stats.aiAwards += awards;
        stats.withdraw += Number(turn.actions[0]!.type === 'withdraw');
        stats.zeroCash += Number(p.money === 0);
        if (r.room.kind === 'boss') {
          stats.beforeBossTurns++;
          stats.beforeBossCash += p.money / floorMoney;
        }
      }
      const market = createClientMarketSnapshot(
        r,
        floorMoney,
        r.playersBefore.length,
      );
      if (market) {
        stats.targets++;
        stats.targetRatio += market.targetRatio;
        stats.targetRatioSquared += market.targetRatio ** 2;
      }
      roomObserver?.(r);
      ctrl.update(r);
      trace.update(r);
      rooms++;
    } else {
      const next = reduce(game, { type: 'advance_room' });
      if (next.phase === 'character_selection')
        throw Error('Unexpected mistake selection');
      game = next;
    }
  }
  if (rooms !== 15) throw Error('Incomplete mistake match');
  terminalObserver?.(game);
  const rank = game.finalRanking.findIndex((p) => p.playerId === 'human') + 1;
  return {
    kind: 'research-only-quote-lapse',
    block,
    seed,
    role,
    policy,
    arm: arm.id,
    world,
    traceHash: trace.digest(),
    terminalHash: classicTierTerminalHash(game),
    rooms,
    rank,
    score: game.finalRanking[rank - 1]!.finalScore,
    floors,
  };
}
