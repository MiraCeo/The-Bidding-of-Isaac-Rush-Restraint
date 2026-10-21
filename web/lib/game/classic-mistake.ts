/** classic-population-1 execution limits. Immutable policy, independent of research scripts.
 * Base quote/secondary analyses describe the intended turn; classicMistake records
 * any post-planning execution change explicitly. No secret human turn is accepted. */
import { candidateUtility, type AiQuoteAnalysis } from './ai-quote';
import { createSeededRandom } from './random';
import { getRuntimeActionAmounts, validateTurn } from './turns';
import type { AiDecision, AiDecisionOptions } from './ai-decision';
import type { PlayerTurn, RuntimePlayerState } from './item-types';
import type { PlayerAction, RulesConfig } from './types';
import type { ClassicAiGrade } from './classic-population';
import { classicGradeProfiles } from './classic-population';

const mixClientSeed = (seed: number, salt: number) => (seed ^ salt) >>> 0;
const mistakePlan = {
  mildFactors: [0.85, 0.9, 1.1, 1.15],
  mediumFactors: [0.7, 0.75, 1.25, 1.3],
  mildMaximumModelLoss: 0.15,
  mediumMaximumModelLoss: 0.35,
} as const;
const plan = {
  content: {
    rewardShare: 0.45,
    budgetShare: 0.35,
    quoteShare: 0.2,
    minimumVisibleValueGap: 0.15,
    rewardLossCaps: { mild: 0.35, medium: 0.65 },
    budgetLossCaps: { mild: 0.4, medium: 0.8 },
    budgetFactors: { mild: [1.3, 1.45], medium: [1.6, 1.8] },
    budgetMinimumExtraFloorRatio: { mild: 0.025, medium: 0.05 },
    budgetMaximumExtraFloorRatio: { mild: 0.1, medium: 0.18 },
    budgetMaximumCashRatio: { mild: 0.65, medium: 0.75 },
  },
} as const;

function mistakeQuoteUtility(
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
  return candidateUtility(
    player,
    action,
    strategy,
    Math.max(
      0,
      Math.min(1.25, decision.analysis?.groupValues[action.group] ?? 0.5),
    ),
    decision.liquidityRatio,
    quote.prediction,
    quote.opportunityBudget,
    rules.floorStartingMoney[floor]!,
    options.context?.room.kind,
    rules,
  ).utility;
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
    // The adapter below records the intended turn and marks pre-execution analysis.
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

export type MistakeKind = 'reward' | 'budget' | 'quote';
export interface DecisionMistakeEvent extends MistakeEvent {
  requestedKind: MistakeKind | null;
  kind: MistakeKind | null;
  fallback: boolean;
  visibleValueGap?: number;
  reserveAfter?: number;
}
type Candidate = {
  turn: PlayerTurn;
  loss: number;
  cost: number;
  severity: 'mild' | 'medium';
  visibleValueGap?: number;
};
const costOf = (
  player: RuntimePlayerState,
  turn: PlayerTurn,
  rules: RulesConfig,
) =>
  turn.actions.reduce(
    (n, a) => n + getRuntimeActionAmounts(player, a, rules).actualCost,
    0,
  );

export function decisionMistakeCandidates(
  kind: 'reward' | 'budget',
  severity: 'mild' | 'medium',
  decision: AiDecision,
  player: RuntimePlayerState,
  floor: number,
  rules: RulesConfig,
  options: AiDecisionOptions,
): Candidate[] {
  const candidates: Candidate[] = [];
  const baseCost = costOf(player, decision.turn, rules);
  if (kind === 'reward') {
    // Do not use hidden item identities, even for the counterfactual model.
    if (
      !options.context ||
      options.context.room.rewards.some((r) => r.hidden) ||
      !decision.analysis
    )
      return [];
    const gap = Math.abs(
      decision.analysis.groupValues.A - decision.analysis.groupValues.B,
    );
    if (gap < plan.content.minimumVisibleValueGap) return [];
    const turn: PlayerTurn = {
      ...decision.turn,
      actions: decision.turn.actions.map((a) =>
        a.type === 'withdraw'
          ? a
          : { ...a, group: a.group === 'A' ? 'B' : 'A' },
      ),
    };
    if (validateTurn(player, turn, rules).length) return [];
    let loss = 0;
    for (const [i, before] of decision.turn.actions.entries()) {
      const after = turn.actions[i]!;
      const quote =
        i === 0
          ? decision.quoteAnalysis
          : decision.secondaryActionAnalysis?.selectedQuote;
      const strategy =
        i === 0
          ? decision.strategy
          : decision.secondaryActionAnalysis?.selectedStrategy;
      if (
        before.type === 'withdraw' ||
        after.type === 'withdraw' ||
        !quote ||
        !strategy ||
        strategy === 'withdraw'
      )
        return [];
      loss +=
        mistakeQuoteUtility(
          player,
          before,
          strategy,
          quote,
          decision,
          floor,
          rules,
          options,
        ) -
        mistakeQuoteUtility(
          player,
          after,
          strategy,
          quote,
          decision,
          floor,
          rules,
          options,
        );
    }
    if (loss > 0.015 && loss <= plan.content.rewardLossCaps[severity])
      candidates.push({
        turn,
        loss,
        cost: costOf(player, turn, rules),
        severity,
        visibleValueGap: gap,
      });
    return candidates;
  }
  // This is a current-room overcommitment, not a fictitious future rule change.
  if (
    (options.remainingRooms ?? 1) <= 1 ||
    options.context?.room.kind === 'boss'
  )
    return [];
  const floorMoney = rules.floorStartingMoney[floor]!;
  for (const [i, before] of decision.turn.actions.entries()) {
    const quote =
      i === 0
        ? decision.quoteAnalysis
        : decision.secondaryActionAnalysis?.selectedQuote;
    const strategy =
      i === 0
        ? decision.strategy
        : decision.secondaryActionAnalysis?.selectedStrategy;
    if (
      before.type === 'withdraw' ||
      !quote ||
      !strategy ||
      strategy === 'withdraw'
    )
      continue;
    const originalUtility = mistakeQuoteUtility(
      player,
      before,
      strategy,
      quote,
      decision,
      floor,
      rules,
      options,
    );
    for (const factor of plan.content.budgetFactors[severity]) {
      const amount = Math.round(before.amount * factor);
      if (amount <= before.amount || amount >= player.money) continue;
      const replacement = { ...before, amount };
      const turn = {
        ...decision.turn,
        actions: decision.turn.actions.map((a, j) =>
          j === i ? replacement : a,
        ),
      };
      if (validateTurn(player, turn, rules).length) continue;
      const cost = costOf(player, turn, rules),
        extra = cost - baseCost;
      if (
        extra <
          Math.max(
            1,
            floorMoney * plan.content.budgetMinimumExtraFloorRatio[severity],
          ) ||
        extra >
          floorMoney * plan.content.budgetMaximumExtraFloorRatio[severity] ||
        cost > player.money * plan.content.budgetMaximumCashRatio[severity]
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
      if (loss > 0.015 && loss <= plan.content.budgetLossCaps[severity])
        candidates.push({ turn, loss, cost, severity });
    }
  }
  return candidates;
}

export interface FeasibleMistakeEvent extends DecisionMistakeEvent {
  selection: 'feasible-first';
  availableKinds: MistakeKind[];
  candidateCounts: Record<MistakeKind, number>;
}
const kindOrder: MistakeKind[] = ['reward', 'budget', 'quote'];
const weights = {
  reward: plan.content.rewardShare,
  budget: plan.content.budgetShare,
  quote: plan.content.quoteShare,
};
export function selectFeasibleKind(
  available: readonly MistakeKind[],
  sample: number,
): MistakeKind | null {
  if (!Number.isFinite(sample) || sample < 0 || sample >= 1)
    throw Error('Invalid type sample');
  if (
    new Set(available).size !== available.length ||
    available.some((k) => !kindOrder.includes(k))
  )
    throw Error('Invalid available kinds');
  const allowed = kindOrder.filter((k) => available.includes(k));
  if (!allowed.length) return null;
  const total = allowed.reduce((n, k) => n + weights[k], 0);
  let point = sample * total;
  for (const k of allowed) {
    point -= weights[k];
    if (point < 0) return k;
  }
  return allowed[allowed.length - 1]!;
}

export function applyFeasibleMistake(
  decision: AiDecision,
  player: RuntimePlayerState,
  floor: number,
  rules: RulesConfig,
  options: AiDecisionOptions,
  seed: number,
  config: { rate: number; mediumShare: number },
): { decision: AiDecision; event: FeasibleMistakeEvent } {
  if (
    ![config.rate, config.mediumShare].every(
      (n) => Number.isFinite(n) && n >= 0 && n <= 1,
    )
  )
    throw Error('Invalid feasibility mistake probability');
  const room = options.context?.room.roomIndex ?? 0;
  const event: FeasibleMistakeEvent = {
    playerId: player.id,
    floor,
    room,
    triggered: false,
    applied: false,
    severity: null,
    requestedSeverity: null,
    reason: 'not-triggered',
    requestedKind: null,
    kind: null,
    fallback: false,
    selection: 'feasible-first',
    availableKinds: [],
    candidateCounts: { reward: 0, budget: 0, quote: 0 },
  };
  // Highest must not enumerate candidates, allocate extra streams or draw RNG.
  if (config.rate === 0) return { decision, event };
  if (player.money <= 0)
    return { decision, event: { ...event, reason: 'zero-cash' } };
  const ordinal = Number(player.id.replace('ai-', ''));
  if (!Number.isSafeInteger(ordinal))
    throw Error('Feasibility adapter is AI-only');
  const salt = (floor * 5 + room) ^ Math.imul(ordinal, 0x85ebca6b);
  const gate = createSeededRandom(
    mixClientSeed(seed, (0x7f4a7c15 ^ salt) >>> 0),
  );
  if (gate.next() >= config.rate) return { decision, event };
  event.triggered = true;
  const severity = gate.next() < config.mediumShare ? 'medium' : 'mild';
  event.requestedSeverity = severity;

  // Use exactly the existing per-type generators and their medium->mild fallback.
  const pools = (['reward', 'budget'] as const).map((kind) => {
    const candidates = decisionMistakeCandidates(
      kind,
      severity,
      decision,
      player,
      floor,
      rules,
      options,
    );
    if (!candidates.length && severity === 'medium')
      candidates.push(
        ...decisionMistakeCandidates(
          kind,
          'mild',
          decision,
          player,
          floor,
          rules,
          options,
        ),
      );
    return { kind, candidates };
  });
  // The quote helper's rate=1 is a forced candidate lookup, NOT a second
  // probabilistic trigger. Its own independent selector remains unchanged.
  const quote = applyQuoteMistake(
    decision,
    player,
    floor,
    rules,
    options,
    seed,
    { rate: 1, mediumShare: config.mediumShare },
  );
  event.candidateCounts = {
    reward: pools[0]!.candidates.length,
    budget: pools[1]!.candidates.length,
    quote: Number(quote.event.applied),
  };
  event.availableKinds = kindOrder.filter((k) => event.candidateCounts[k] > 0);
  if (!event.availableKinds.length)
    return { decision, event: { ...event, reason: 'no-bounded-candidate' } };
  const choice = createSeededRandom(
    mixClientSeed(seed, (0x243f17a9 ^ salt) >>> 0),
  );
  const kind = selectFeasibleKind(event.availableKinds, choice.next())!;
  if (kind === 'quote')
    return {
      decision: quote.decision,
      event: {
        ...quote.event,
        requestedKind: kind,
        kind,
        fallback: false,
        selection: 'feasible-first',
        availableKinds: event.availableKinds,
        candidateCounts: event.candidateCounts,
      },
    };
  const pool = pools.find((p) => p.kind === kind)!;
  const selected =
    pool.candidates[Math.floor(choice.next() * pool.candidates.length)]!;
  const beforeCost = decision.turn.actions.reduce(
    (n, a) => n + getRuntimeActionAmounts(player, a, rules).actualCost,
    0,
  );
  return {
    decision: { ...decision, turn: selected.turn },
    event: {
      ...event,
      applied: true,
      requestedKind: kind,
      kind,
      severity: selected.severity,
      reason: 'applied',
      before: decision.turn,
      after: selected.turn,
      beforeCost,
      afterCost: selected.cost,
      modelLoss: selected.loss,
      visibleValueGap: selected.visibleValueGap,
      reserveAfter: player.money - selected.cost,
    },
  };
}

/** Only actual mutations add metadata; the high-grade return is identity-preserving. */
export function applyClassicPopulationMistake(
  decision: AiDecision,
  player: RuntimePlayerState,
  floor: number,
  rules: RulesConfig,
  options: AiDecisionOptions,
  seed: number,
  grade: ClassicAiGrade,
): AiDecision {
  const result = applyFeasibleMistake(
    decision,
    player,
    floor,
    rules,
    options,
    seed,
    classicGradeProfiles[grade],
  );
  if (!result.event.applied) return decision;
  const e = result.event;
  return {
    ...result.decision,
    classicMistake: {
      kind: e.kind!,
      severity: e.severity!,
      analysisBasis: 'before-mistake',
      intendedTurn: decision.turn,
      beforeCost: e.beforeCost!,
      afterCost: e.afterCost!,
      modelLoss: e.modelLoss!,
    },
  };
}
