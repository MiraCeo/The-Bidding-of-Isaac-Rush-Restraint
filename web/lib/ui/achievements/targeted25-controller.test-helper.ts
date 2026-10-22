/** Research human slot only. No opponent decision, future room or RNG input. */
import type { AiPublicMarketSnapshot } from '../../game/ai-analysis';
import type {
  ActiveClientGameState,
  ClientRoomSettlementRecord,
} from '../../game/client-session';
import type {
  SurvivalGameState,
  SurvivalFloorRecord,
} from '../../game/survival-session';
import type {
  GeneratedRoom,
  ItemId,
  PlayerTurn,
  RuntimePlayerState,
} from '../../game/item-types';
import type { RulesConfig } from '../../game/types';
import { estimateSurvivalTurnScore } from '../../game/survival-ai-plan';
import { getRuntimeActionAmounts, validateTurn } from '../../game/turns';
import {
  chooseEdgeTurn,
  type EdgePublicInput,
} from './audit117-edge.test-helper';
import {
  extractAchievementRoomFacts,
  extractAchievementFloorFacts,
} from './facts';
import { extractMilestoneRoomFacts } from './milestone-room-facts';
import { extractAllInCapital } from './revision066-facts';

export type TargetGoal =
  | 'capital'
  | 'double-bid'
  | 'double-disrupt'
  | 'redemption'
  | 'combo-clear'
  | 'watch'
  | 'visible-item'
  | 'edge'
  | 'score';
export interface TargetPublicInput {
  human: RuntimePlayerState;
  room: GeneratedRoom;
  recentMarkets: AiPublicMarketSnapshot[];
  survival?: EdgePublicInput;
}
/** Explicit allowlist; never spread game state or enumerate its properties. */
export function targetPublicInput(
  g: ActiveClientGameState | SurvivalGameState,
): TargetPublicInput {
  const room = g.rooms[g.floorIndex]![g.roomIndex]!,
    mask = (r: GeneratedRoom['rewards'][number]) => ({
      group: r.group,
      hidden: r.hidden,
      itemId: r.hidden ? ('score_charm' as const) : r.itemId,
    }),
    visible: GeneratedRoom = {
      floorIndex: room.floorIndex,
      roomIndex: room.roomIndex,
      kind: room.kind,
      rewards: [mask(room.rewards[0]), mask(room.rewards[1])],
    },
    human = g.players.find((p) => p.id === 'human')!;
  const input: TargetPublicInput = {
    human,
    room: visible,
    recentMarkets: g.recentMarkets.slice(-3),
  };
  if ('mode' in g && g.mode === 'survival')
    input.survival = {
      human,
      room: visible,
      cutLine: g.cutLines[g.floorIndex]!,
      minimumEliminations: g.rules.minimumEliminations,
      moneyExchangeRatio: g.rules.moneyExchangeRatio,
      scoreInheritanceRatio: g.rules.scoreInheritanceRatio,
      participants: g.players
        .filter((p) => g.activePlayerIds.includes(p.id))
        .map((p) => ({
          playerId: p.id,
          money: p.money,
          roomScore: (g.currentFloorRoomScores[p.id] ?? []).reduce(
            (a, b) => a + b,
            0,
          ),
          previousSurvivalScore: g.previousSurvivalScores[p.id] ?? 0,
        })),
    };
  return input;
}
export interface TargetState {
  done: string[];
  redeemedRooms: string[];
  eternal: boolean;
  babylon: boolean;
  lowestConfirmed: boolean;
}
export function freshTargetState(): TargetState {
  return {
    done: [],
    redeemedRooms: [],
    eternal: false,
    babylon: false,
    lowestConfirmed: false,
  };
}
export function confirmTargetFloor(
  state: TargetState,
  record: SurvivalFloorRecord,
) {
  return {
    ...state,
    lowestConfirmed:
      state.lowestConfirmed ||
      extractAchievementFloorFacts(record).lowestSurvivor,
  };
}
export function targetPrediction(input: TargetPublicInput, rules: RulesConfig) {
  const base = rules.floorStartingMoney[input.room.floorIndex]!,
    m = input.recentMarkets;
  const mean = (
    key:
      | 'targetRatio'
      | 'highestMarketEquivalentRatio'
      | 'highPriceQualificationRatio',
    fallback: number,
  ) => {
    const v = m
      .map((s) => s[key])
      .filter((n): n is number => n !== undefined && Number.isFinite(n));
    return Math.max(
      1,
      base * (v.length ? v.reduce((a, b) => a + b, 0) / v.length : fallback),
    );
  };
  return {
    base,
    target: mean('targetRatio', 0.3),
    highest: mean('highestMarketEquivalentRatio', 0.6),
    qualification: mean('highPriceQualificationRatio', 0.47),
  };
}
export interface TargetDecision {
  turn: PlayerTurn;
  baseTurn: PlayerTurn;
  goal: TargetGoal;
  visibleTarget: ItemId | null;
  predictedScore: number;
  basePredictedScore: number;
  actualCost: number;
  baseCost: number;
  predictedTarget: number;
  lowestConfirmedBefore: boolean;
  eligible: {
    capital: boolean;
    doubleBid: boolean;
    doubleDisrupt: boolean;
    redemption: boolean;
    combo: boolean;
    lostMantle: boolean;
  };
}
export function chooseTargetTurn(
  input: TargetPublicInput,
  rules: RulesConfig,
  missing: readonly string[],
  state: TargetState,
  seekLowest: boolean,
): TargetDecision {
  const { human: h, room } = input,
    owns = (id: ItemId) => h.items.some((i) => i.itemId === id),
    need = (n: string) => missing.includes(n) && !state.done.includes(n),
    { base, target, highest, qualification } = targetPrediction(input, rules),
    cost = (t: PlayerTurn) =>
      t.actions.reduce(
        (n, a) => n + getRuntimeActionAmounts(h, a, rules).actualCost,
        0,
      ),
    score = (t: PlayerTurn) =>
      estimateSurvivalTurnScore(
        h,
        t.actions,
        target,
        highest,
        base,
        room.kind,
        rules,
      ),
    turn = (
      type: 'bid' | 'disrupt',
      amount: number,
      group: 'A' | 'B' = 'A',
    ): PlayerTurn => ({
      playerId: h.id,
      actions: [{ type, amount: Math.max(1, Math.round(amount)), group }],
    }),
    legal = (t: PlayerTurn) => validateTurn(h, t, rules).length === 0,
    withdraw: PlayerTurn = { playerId: h.id, actions: [{ type: 'withdraw' }] },
    candidates: PlayerTurn[] = [withdraw],
    cap = h.money * [0.4, 0.5, 0.6, 0.75, 1][room.roomIndex]!,
    prices = [
      ...new Set(
        [
          1,
          target * 0.8,
          target * 0.9,
          target,
          target * 1.1,
          target * 1.2,
          qualification * 1.05,
          cap,
        ].map(Math.round),
      ),
    ];
  // Future liquidity has a value; the final room has no remaining spending need.
  const utility = (t: PlayerTurn) =>
    score(t) - (cost(t) / base) * (4 - room.roomIndex) * 32;
  for (const group of ['A', 'B'] as const)
    for (const amount of prices) {
      if (amount <= cap) candidates.push(turn('bid', amount, group));
      if (owns('transcendence') || owns('short_brimstone'))
        candidates.push(turn('disrupt', amount / 1.25, group));
    }
  if (owns('more_options'))
    for (const amount of [target * 0.75, target, h.money / 4])
      candidates.push({
        playerId: h.id,
        actions: [
          {
            type: 'bid',
            group: 'A',
            amount: Math.max(1, Math.round(amount * 0.95)),
          },
          {
            type: 'bid',
            group: 'B',
            amount: Math.max(1, Math.round(amount * 1.05)),
          },
        ],
      });
  const best = (ts: PlayerTurn[]) =>
    ts.filter(legal).sort((a, b) => utility(b) - utility(a))[0];
  const baseTurn = best(candidates)!,
    champion =
      (need('E13') && h.characterId === 'isaac' && !input.survival) ||
      Boolean(input.survival && seekLowest && state.lowestConfirmed);
  let chosen = baseTurn,
    goal: TargetGoal = 'score',
    visibleTarget: ItemId | null = null;
  const choose = (ts: PlayerTurn[], g: TargetGoal) => {
    const selected = best(ts);
    if (!selected) return false;
    chosen = selected;
    goal = g;
    return true;
  };
  const full = turn('bid', h.money),
    eligible = {
      capital:
        h.money > 0 &&
        legal(full) &&
        cost(full) >=
          Math.ceil((h.characterFloorStartingMoney ?? Infinity) / 2),
      doubleBid: owns('more_options'),
      doubleDisrupt: owns('more_options_question') && !owns('transcendence'),
      redemption: owns('transcendence'),
      combo: owns('eternal_d6') && owns('whore_of_babylon'),
      lostMantle:
        h.characterId === 'lost' &&
        room.rewards.some((r) => !r.hidden && r.itemId === 'holy_mantle'),
    };
  const double = (kind: 'bid' | 'disrupt') => {
    const eq = kind === 'bid' ? 1 : rules.disruptionMarketMultiplier;
    return [
      qualification * 1.1,
      target * (kind === 'bid' ? 1 : 2),
      (h.money * eq) / 4,
    ].map((n) => ({
      playerId: h.id,
      actions: [
        {
          type: kind,
          group: 'A' as const,
          amount: Math.max(1, Math.floor((n / eq) * 0.95)),
        },
        {
          type: kind,
          group: 'B' as const,
          amount: Math.max(1, Math.floor((n / eq) * 1.05)),
        },
      ],
    }));
  };
  eligible.doubleBid = eligible.doubleBid && double('bid').some(legal);
  eligible.doubleDisrupt =
    eligible.doubleDisrupt && double('disrupt').some(legal);
  eligible.redemption =
    eligible.redemption &&
    [
      turn('disrupt', target / rules.disruptionScoringMultiplier),
      turn('disrupt', (qualification * 1.1) / rules.disruptionMarketMultiplier),
    ].some(legal);
  // A champion attempt does not spend its whole opening on a side quest.
  if (!champion) {
    if (need('D12') && eligible.capital && room.roomIndex === 0)
      choose([full], 'capital');
    else if (
      need('C15') &&
      eligible.doubleDisrupt &&
      (!need('B07') || !eligible.doubleBid || room.roomIndex % 2 === 0)
    )
      choose(double('disrupt'), 'double-disrupt');
    else if (need('B07') && eligible.doubleBid)
      choose(double('bid'), 'double-bid');
    else if (need('C14') && eligible.redemption)
      choose(
        [
          turn('disrupt', target / rules.disruptionScoringMultiplier),
          turn(
            'disrupt',
            (qualification * 1.1) / rules.disruptionMarketMultiplier,
          ),
        ],
        'redemption',
      );
    else if (
      need('C13') &&
      eligible.combo &&
      (!state.eternal || !state.babylon)
    )
      choose([turn('bid', 1)], 'combo-clear');
    else if (
      need('B10') &&
      (h.money < base * 0.08 ||
        (input.recentMarkets.at(-1)?.disruptionRate ?? 0) >= 0.3)
    )
      choose([withdraw], 'watch');
  }
  // Only visible identities may influence acquisition. Never inspect hidden item IDs.
  const itemPriority = (id: ItemId) => {
    if (id === 'holy_mantle' && need('E18') && h.characterId === 'lost')
      return 10;
    if (
      need('C13') &&
      ((id === 'whore_of_babylon' && owns('eternal_d6')) ||
        (id === 'eternal_d6' && owns('whore_of_babylon')))
    )
      return 9;
    if (id === 'eternal_d6' && need('E20') && !owns(id)) return 8;
    if (id === 'more_options' && (need('B07') || need('E22')) && !owns(id))
      return 7;
    if (id === 'more_options_question' && need('C15') && !owns(id)) return 6;
    if (id === 'transcendence' && need('C14') && !owns(id)) return 5;
    if (id === 'guppys_tail' && (need('C17') || need('C19')) && !owns(id))
      return 4;
    return 0;
  };
  const prize = room.rewards
    .filter((r) => !r.hidden && itemPriority(r.itemId) > 0)
    .sort((a, b) => itemPriority(b.itemId) - itemPriority(a.itemId))[0];
  if (
    prize &&
    !(input.survival && seekLowest && state.lowestConfirmed) &&
    (goal === 'score' || goal === 'watch' || goal === 'combo-clear')
  ) {
    const bids = [
      target,
      qualification * 1.1,
      Math.min(h.money, highest * 1.05),
    ].map((n) => turn('bid', n, prize.group));
    // Acquisition aims at qualification, with a bounded price premium, not a promise.
    const selected = bids
      .filter(legal)
      .filter((t) => cost(t) <= h.money * (champion ? 0.45 : 0.8))
      .sort(
        (a, b) =>
          score(b) +
          Math.min(
            1,
            (b.actions[0]!.type === 'withdraw' ? 0 : b.actions[0]!.amount) /
              qualification,
          ) *
            50 -
          (cost(b) / base) * 20 -
          (score(a) +
            Math.min(
              1,
              (a.actions[0]!.type === 'withdraw' ? 0 : a.actions[0]!.amount) /
                qualification,
            ) *
              50 -
            (cost(a) / base) * 20),
      )[0];
    if (selected) {
      chosen = selected;
      goal = 'visible-item';
      visibleTarget = prize.itemId;
    }
  }
  if (input.survival && seekLowest && !state.lowestConfirmed) {
    chosen = chooseEdgeTurn(
      input.survival,
      chosen,
      rules,
      target,
      highest,
    ).turn;
    goal = 'edge';
    visibleTarget = null;
  }
  if (!legal(chosen)) throw Error('Illegal targeted action');
  return {
    turn: chosen,
    baseTurn,
    goal,
    visibleTarget,
    predictedScore: score(chosen),
    basePredictedScore: score(baseTurn),
    actualCost: cost(chosen),
    baseCost: cost(baseTurn),
    predictedTarget: target,
    lowestConfirmedBefore: state.lowestConfirmed,
    eligible,
  };
}
/** All successes below are post-settlement observations, not simulated intentions. */
export function observeTargetRoom(
  state: TargetState,
  record: ClientRoomSettlementRecord,
) {
  const facts = extractAchievementRoomFacts(record);
  if (!facts) throw Error('No human authority');
  const flags = extractMilestoneRoomFacts(record).milestoneFlags,
    capital = extractAllInCapital(record),
    key = `${record.room.floorIndex}/${record.room.roomIndex}`,
    redeemedRooms = [
      ...new Set([...state.redeemedRooms, ...(flags & 4 ? [key] : [])]),
    ],
    eternal = state.eternal || facts.eternalCleared,
    babylon = state.babylon || facts.babylonCleared,
    success: string[] = [],
    h = record.playersBefore.find((p) => p.id === 'human')!;
  if (facts.allInBid && capital && capital[0] >= Math.ceil(capital[1] / 2))
    success.push('D12');
  if (facts.optionsDestroyed) success.push('B07');
  if (flags & 8) success.push('C15');
  if (redeemedRooms.length >= 2) success.push('C14');
  if (eternal && babylon) success.push('C13');
  if (
    h.characterId === 'lost' &&
    record.awards.some(
      (a) =>
        a.playerId === 'human' && a.itemId === 'holy_mantle' && a.copies > 0,
    )
  )
    success.push('E18');
  return {
    state: {
      ...state,
      redeemedRooms,
      eternal,
      babylon,
      done: [...new Set([...state.done, ...success])],
    },
    actual: {
      success,
      redeemed: Boolean(flags & 4),
      watchedVacancy: facts.watchedVacancy,
      eternal: facts.eternalCleared,
      babylon: facts.babylonCleared,
      capital: capital ?? null,
      awards: record.awards.filter((a) => a.playerId === 'human'),
      // Returned entitlements are AFTER More Options removes a group. The
      // production fact extractor recovers bid qualification from ordered
      // placements, Lucky Foot sources and the actual More Options destroy event.
      doubleQualified:
        facts.bidSuccesses.length === 2 && facts.bidSuccesses.every(Boolean),
      actualScore: record.roomScoreSummaries.human?.finalScore ?? null,
    },
  };
}
