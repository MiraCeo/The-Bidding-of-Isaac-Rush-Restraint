/** Feasibility-first selection experiment; no new candidates or strength changes. */
import { createSeededRandom } from '../../game/random';
import { mixClientSeed } from '../../game/client-runtime';
import { getRuntimeActionAmounts } from '../../game/turns';
import type { AiDecision, AiDecisionOptions } from '../../game/ai-decision';
import type { RuntimePlayerState, CharacterId } from '../../game/item-types';
import type { RulesConfig } from '../../game/types';
import { feasibleMistakePlan as plan } from '../../../scripts/classic-feasible-mistake-plan.mjs';
import {
  applyQuoteMistake,
  runMistakeMatch,
  type MistakeEvent,
  type MistakeArm,
} from './classic-mistake.test-helper';
import {
  applyDecisionMistake,
  decisionMistakeCandidates,
  type DecisionMistakeEvent,
  type MistakeKind,
} from './classic-decision-mistake.test-helper';
import type { StudyPolicy } from './difficulty-study.test-helper';

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

export function feasibleMistakeSeed(block: number) {
  if (!Number.isSafeInteger(block) || block < 0 || block >= plan.blocks)
    throw Error('Invalid feasibility study block');
  return (0x08010000 + Math.imul(plan.seedStart + block + 1, 104729)) >>> 0;
}
export function runFeasibleMistakeMatch(
  block: number,
  role: CharacterId,
  policy: StudyPolicy,
  arm: MistakeArm,
  witness?: (event: MistakeEvent) => void,
) {
  const eligible = arm.id.startsWith('eligible'),
    prior = arm.id.startsWith('prior');
  const observe = (event: MistakeEvent) =>
    witness?.(
      eligible
        ? event
        : prior
          ? ({ ...event, selection: 'type-first' } as MistakeEvent)
          : ({
              ...event,
              requestedKind: event.triggered ? 'quote' : null,
              kind: event.applied ? 'quote' : null,
              fallback: false,
              selection: 'quote-only',
            } as MistakeEvent),
    );
  const row = runMistakeMatch(
    block,
    role,
    policy,
    arm,
    observe,
    feasibleMistakeSeed(block),
    eligible
      ? applyFeasibleMistake
      : prior
        ? applyDecisionMistake
        : applyQuoteMistake,
  );
  return { ...row, kind: plan.rowKind };
}
