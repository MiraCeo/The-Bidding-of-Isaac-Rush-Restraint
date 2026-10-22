/** Isolated public-information human-slot controller, never an opponent AI change. */
import { createSeededRandom } from '../../game/random';
import { decideSurvivalAiTurn } from '../../game/survival-ai';
import { createAiQuoteProfile } from '../../game/ai-quote';
import { createEmptyAiHistory } from '../../game/ai-analysis';
import { estimateSurvivalTurnScore } from '../../game/survival-ai-plan';
import { getRuntimeActionAmounts, validateTurn } from '../../game/turns';
import type {
  CharacterId,
  PlayerTurn,
  RuntimePlayerState,
  GeneratedRoom,
} from '../../game/item-types';
import type { RulesConfig } from '../../game/types';
import type { SurvivalGameState } from '../../game/survival-session';
import type { ClientRoomSettlementRecord } from '../../game/client-session';
import {
  startSurvivalClient,
  reduceSurvivalClient,
  survivalRoomRules,
} from '../survival-client';
import { beginSurvivalGrowth, applyGrowthContext } from './lifecycle';
import { freshStudyProfile } from './current-study.test-helper';
import {
  projectAchievementRegistry,
  withAchievementVerificationScope,
} from './registry';
import { canonicalJson } from '../../shared/json-facts';
import { sha256Hex } from '../../shared/sha256';
import { decodeAchievementEvent } from './event-codec';

export interface EdgePublicInput {
  human: RuntimePlayerState;
  room: GeneratedRoom;
  cutLine: number;
  minimumEliminations: number;
  moneyExchangeRatio: number;
  scoreInheritanceRatio: number;
  participants: {
    playerId: string;
    money: number;
    roomScore: number;
    previousSurvivalScore: number;
  }[];
}
/** This pure selector receives no current rival turns, tie RNG or future rooms. */
export function chooseEdgeTurn(
  input: EdgePublicInput,
  base: PlayerTurn,
  rules: RulesConfig,
  target: number,
  highest: number,
) {
  const { human, room } = input,
    own = input.participants.find((p) => p.playerId === human.id)!;
  const remaining = 4 - room.roomIndex;
  const projected = (p: EdgePublicInput['participants'][number]) =>
    p.roomScore +
    (room.roomIndex ? p.roomScore / room.roomIndex : 80) *
      (5 - room.roomIndex) +
    p.money * input.moneyExchangeRatio +
    p.previousSurvivalScore * input.scoreInheritanceRatio;
  const rivalScores = input.participants
    .filter((p) => p.playerId !== human.id)
    .map(projected)
    .sort((a, b) => a - b);
  const goal = Math.max(
    input.cutLine,
    (rivalScores[
      Math.min(input.minimumEliminations - 1, rivalScores.length - 1)
    ] ?? input.cutLine) + 5,
  );
  const inherited = own.previousSurvivalScore * input.scoreInheritanceRatio;
  const future =
    (room.roomIndex ? own.roomScore / room.roomIndex : 80) * remaining * 0.65;
  const candidates: PlayerTurn[] = [
    base,
    { playerId: human.id, actions: [{ type: 'withdraw' }] },
  ];
  for (const factor of [0.5, 0.75, 1.25])
    candidates.push({
      ...base,
      actions: base.actions.map((a) =>
        a.type === 'withdraw'
          ? a
          : { ...a, amount: Math.max(1, Math.round(a.amount * factor)) },
      ),
    });
  let chosen = base,
    objective = Infinity;
  for (const turn of candidates) {
    if (validateTurn(human, turn, rules).length) continue;
    const cost = turn.actions.reduce(
      (n, a) => n + getRuntimeActionAmounts(human, a, rules).actualCost,
      0,
    );
    const score =
      own.roomScore +
      inherited +
      (human.money - cost) * input.moneyExchangeRatio +
      future +
      estimateSurvivalTurnScore(
        human,
        turn.actions,
        target,
        highest,
        rules.floorStartingMoney[room.floorIndex]!,
        room.kind,
        rules,
      );
    const error = Math.abs(score - goal) * (score < goal ? 4 : 1);
    if (error < objective) {
      objective = error;
      chosen = turn;
    }
  }
  return { turn: chosen, goal };
}
export function createEdgeController(seed: number) {
  const random = createSeededRandom((seed ^ 0x6a09e667) >>> 0),
    quoteRandom = createSeededRandom((seed ^ 0xbb67ae85) >>> 0);
  const quoteProfile = createAiQuoteProfile(
    createSeededRandom((seed ^ 0x3c6ef372) >>> 0),
  );
  let history = createEmptyAiHistory(),
    strategy: ReturnType<typeof decideSurvivalAiTurn>['strategy'] = 'withdraw';
  let changed = 0,
    attempts = 0;
  const decide = (g: SurvivalGameState, rules: RulesConfig) => {
    const human = g.players.find((p) => p.id === 'human')!,
      active = g.players.filter((p) => g.activePlayerIds.includes(p.id));
    const room = g.rooms[g.floorIndex]![g.roomIndex]!;
    const visible: GeneratedRoom = {
      ...room,
      rewards: [
        {
          ...room.rewards[0],
          itemId: room.rewards[0].hidden
            ? 'score_charm'
            : room.rewards[0].itemId,
        },
        {
          ...room.rewards[1],
          itemId: room.rewards[1].hidden
            ? 'score_charm'
            : room.rewards[1].itemId,
        },
      ],
    };
    const context = {
      cutLine: g.cutLines[g.floorIndex]!,
      moneyExchangeRatio: g.rules.moneyExchangeRatio,
      scoreInheritanceRatio: g.rules.scoreInheritanceRatio,
      minimumEliminations: g.rules.minimumEliminations,
      participants: active.map((p) => ({
        playerId: p.id,
        money: p.money,
        roomScore: (g.currentFloorRoomScores[p.id] ?? []).reduce(
          (a, b) => a + b,
          0,
        ),
        previousSurvivalScore: g.previousSurvivalScores[p.id] ?? 0,
      })),
    };
    const rank = (key: 'money' | 'score') =>
      active.length <= 1
        ? 1
        : 1 -
          active.filter((p) => p[key] > human[key]).length /
            (active.length - 1);
    // Match the original public-ai controller's first public group draw.
    random.next();
    const base = decideSurvivalAiTurn(human, g.floorIndex, rules, random, {
      remainingRooms: 5 - g.roomIndex,
      enableDoubleActions: true,
      enableSituationAnalysis: true,
      enableItemAnalysis: true,
      doctrine: 'balanced',
      personalities: [],
      quoteProfile,
      quoteRandom,
      survivalDifficulty: 'highest',
      survivalAiPolicy: g.aiPolicy,
      survivalContext: context,
      context: {
        moneyRankPercentile: rank('money'),
        scoreRankPercentile: rank('score'),
        history,
        recentMarkets: g.recentMarkets.slice(-3),
        room: visible,
        remainingGameRooms:
          Math.ceil(
            (active.length - g.rules.finalSurvivorCount) /
              g.rules.minimumEliminations,
          ) *
            5 -
          g.roomIndex,
      },
    });
    const chosen = chooseEdgeTurn(
      { human, room: visible, ...context },
      base.turn,
      rules,
      base.quoteAnalysis?.prediction.predictedTarget ?? 300,
      base.quoteAnalysis?.prediction.predictedHighestMarketEquivalent ?? 600,
    );
    attempts++;
    changed += Number(canonicalJson(chosen.turn) !== canonicalJson(base.turn));
    strategy = chosen.turn.actions.every((a) => a.type === 'withdraw')
      ? 'withdraw'
      : base.strategy;
    return chosen.turn;
  };
  const update = (r: ClientRoomSettlementRecord) => {
    const competitive = strategy !== 'withdraw';
    history = {
      ...history,
      rounds: history.rounds + 1,
      competitiveRounds: history.competitiveRounds + Number(competitive),
      awards:
        history.awards +
        r.awards
          .filter((a) => a.playerId === 'human')
          .reduce((n, a) => n + a.copies, 0),
      failedCompetitiveRounds:
        history.failedCompetitiveRounds +
        Number(
          competitive && !r.entitlements.some((e) => e.playerId === 'human'),
        ),
      lastStrategy: strategy,
      strategyCounts: {
        ...history.strategyCounts,
        [strategy]: history.strategyCounts[strategy] + 1,
      },
    };
  };
  return { decide, update, counts: () => ({ attempts, changed }) };
}
export function auditFloorCounts(
  context: Parameters<typeof decodeAchievementEvent>[0][],
) {
  let humanFloors = 0,
    passedFloors = 0,
    lowestFloors = 0;
  for (const unit of context) {
    const e = decodeAchievementEvent(unit);
    if (e.stage === 'floor') {
      humanFloors += Number(e.facts.humanParticipated);
      passedFloors += Number(
        e.facts.humanParticipated && e.facts.humanSurvived,
      );
      lowestFloors += Number(
        e.facts.humanParticipated &&
          e.facts.humanSurvived &&
          e.facts.lowestSurvivor,
      );
    }
  }
  return { humanFloors, passedFloors, lowestFloors };
}
export function runEdgeMatch(seed: number, role: CharacterId) {
  return withAchievementVerificationScope(() => {
    let s = beginSurvivalGrowth(startSurvivalClient(role, seed, 'standard')),
      commands = 0;
    const ctrl = createEdgeController(seed);
    let humanRooms = 0,
      aiOnlyRooms = 0;
    while (s.game.phase !== 'competition_complete') {
      if (++commands > 80) throw Error('Edge command bound');
      const g = s.game;
      if (g.phase === 'room_action') {
        if (g.activePlayerIds.includes('human')) {
          const rules = survivalRoomRules(g),
            turn = ctrl.decide(g, rules),
            player = g.players.find((p) => p.id === 'human')!;
          if (validateTurn(player, turn, rules).length)
            throw Error('Illegal edge turn');
          s = reduceSurvivalClient(s, { type: 'submit_player_turn', turn });
          if (!s.game.roomSettlement) throw Error('Missing edge settlement');
          ctrl.update(s.game.roomSettlement);
          humanRooms++;
        } else {
          s = reduceSurvivalClient(s, { type: 'submit_ai_room' });
          aiOnlyRooms++;
        }
      } else
        s = reduceSurvivalClient(s, {
          type: g.phase === 'room_result' ? 'advance_room' : 'advance_floor',
        });
      if (s.growthIssue) throw Error(s.growthIssue);
    }
    const context = s.growth!,
      view = projectAchievementRegistry(
        applyGrowthContext(freshStudyProfile(), context).profile,
      )!;
    const floors = auditFloorCounts(context.units);
    if (floors.lowestFloors !== (view.progress.F03 ?? 0))
      throw Error('Lowest event differs from production progress');
    return {
      context,
      progress: view.progress,
      achieved: Object.keys(view.achievedAt),
      floors,
      traceFingerprint: sha256Hex(canonicalJson(context)),
      humanRooms,
      aiOnlyRooms,
      controller: ctrl.counts(),
      survived: s.game.humanEliminatedAt === null,
    };
  });
}
