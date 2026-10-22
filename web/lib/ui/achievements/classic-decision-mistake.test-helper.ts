/** Isolated decision-content mistakes. No production or save/replay integration. */
import { createSeededRandom } from '../../game/random';
import { mixClientSeed } from '../../game/client-runtime';
import { getRuntimeActionAmounts, validateTurn } from '../../game/turns';
import type { AiDecision, AiDecisionOptions } from '../../game/ai-decision';
import type {
  PlayerTurn,
  RuntimePlayerState,
  CharacterId,
} from '../../game/item-types';
import type { RulesConfig } from '../../game/types';
import { decisionMistakePlan as plan } from '../../../scripts/classic-decision-mistake-plan.mjs';
import {
  applyQuoteMistake,
  mistakeQuoteUtility,
  runMistakeMatch,
  type MistakeEvent,
  type MistakeArm,
} from './classic-mistake.test-helper';
import type { StudyPolicy } from './difficulty-study.test-helper';

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

export function applyDecisionMistake(
  decision: AiDecision,
  player: RuntimePlayerState,
  floor: number,
  rules: RulesConfig,
  options: AiDecisionOptions,
  seed: number,
  config: { rate: number; mediumShare: number },
): { decision: AiDecision; event: DecisionMistakeEvent } {
  if (
    ![config.rate, config.mediumShare].every(
      (n) => Number.isFinite(n) && n >= 0 && n <= 1,
    )
  )
    throw Error('Invalid decision mistake probability');
  const room = options.context?.room.roomIndex ?? 0;
  const empty: DecisionMistakeEvent = {
    playerId: player.id,
    floor,
    room,
    triggered: false,
    applied: false,
    severity: null,
    requestedSeverity: null,
    requestedKind: null,
    kind: null,
    fallback: false,
    reason: 'not-triggered',
  };
  if (config.rate === 0) return { decision, event: empty };
  if (player.money <= 0)
    return { decision, event: { ...empty, reason: 'zero-cash' } };
  const ordinal = Number(player.id.replace('ai-', ''));
  if (!Number.isSafeInteger(ordinal))
    throw Error('Decision mistake adapter is AI-only');
  const roomSalt = (floor * 5 + room) ^ Math.imul(ordinal, 0x85ebca6b);
  const gate = createSeededRandom(
    mixClientSeed(seed, (0x7f4a7c15 ^ roomSalt) >>> 0),
  );
  if (gate.next() >= config.rate) return { decision, event: empty };
  const severity = gate.next() < config.mediumShare ? 'medium' : 'mild';
  const choice = createSeededRandom(
    mixClientSeed(seed, (0x243f17a9 ^ roomSalt) >>> 0),
  );
  const pick = choice.next();
  const requestedKind: MistakeKind =
    pick < plan.content.rewardShare
      ? 'reward'
      : pick < plan.content.rewardShare + plan.content.budgetShare
        ? 'budget'
        : 'quote';
  if (requestedKind !== 'quote') {
    const candidates = decisionMistakeCandidates(
      requestedKind,
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
          requestedKind,
          'mild',
          decision,
          player,
          floor,
          rules,
          options,
        ),
      );
    if (candidates.length) {
      const selected =
        candidates[Math.floor(choice.next() * candidates.length)]!;
      return {
        decision: { ...decision, turn: selected.turn },
        event: {
          ...empty,
          triggered: true,
          applied: true,
          requestedKind,
          kind: requestedKind,
          requestedSeverity: severity,
          severity: selected.severity,
          reason: 'applied',
          before: decision.turn,
          after: selected.turn,
          beforeCost: costOf(player, decision.turn, rules),
          afterCost: selected.cost,
          modelLoss: selected.loss,
          visibleValueGap: selected.visibleValueGap,
          reserveAfter: player.money - selected.cost,
        },
      };
    }
  }
  // The ONE stochastic trigger was already resolved above. rate=1 reuses the
  // old quote candidate selector without introducing a second chance to fail.
  const quote = applyQuoteMistake(
    decision,
    player,
    floor,
    rules,
    options,
    seed,
    { rate: 1, mediumShare: config.mediumShare },
  );
  return {
    decision: quote.decision,
    event: {
      ...quote.event,
      requestedKind,
      kind: quote.event.applied ? 'quote' : null,
      fallback: requestedKind !== 'quote',
    },
  };
}

export function decisionMistakeSeed(block: number) {
  if (!Number.isSafeInteger(block) || block < 0 || block >= plan.blocks)
    throw Error('Invalid decision mistake seed block');
  return (0x08010000 + Math.imul(plan.seedStart + block + 1, 104729)) >>> 0;
}
export function runDecisionMistakeMatch(
  block: number,
  role: CharacterId,
  policy: StudyPolicy,
  arm: MistakeArm,
  witness?: (event: DecisionMistakeEvent) => void,
) {
  const structured = arm.id.startsWith('new');
  const observe = (event: MistakeEvent) =>
    witness?.(
      structured
        ? (event as DecisionMistakeEvent)
        : {
            ...event,
            requestedKind: event.triggered ? 'quote' : null,
            kind: event.applied ? 'quote' : null,
            fallback: false,
          },
    );
  const row = runMistakeMatch(
    block,
    role,
    policy,
    arm,
    observe,
    decisionMistakeSeed(block),
    structured ? applyDecisionMistake : applyQuoteMistake,
  );
  return { ...row, kind: plan.rowKind };
}
