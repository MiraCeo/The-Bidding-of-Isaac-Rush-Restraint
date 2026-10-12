import type { AiDecision } from './ai-decision';
import { characterOrder } from './characters';
import type {
  CharacterId,
  GeneratedRoom,
  RuntimePlayerState,
} from './item-types';
import type { RoomSettlementResult } from './room-engine';
import type { MetricSummary } from './simulation';

export const budgetCohortNames = [
  'all',
  ...characterOrder,
  'eden_low',
  'eden_equal',
  'eden_high',
] as const;
export type BudgetCohort = (typeof budgetCohortNames)[number];

export function edenFundingBand(
  startingMoney: number,
  publicMoney: number,
): 'low' | 'equal' | 'high' {
  return startingMoney < publicMoney
    ? 'low'
    : startingMoney > publicMoney
      ? 'high'
      : 'equal';
}
export function summarizeBudgetNumbers(
  values: readonly number[],
): MetricSummary {
  if (!values.length)
    return { count: 0, mean: 0, standardDeviation: 0, minimum: 0, maximum: 0 };
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  return {
    count: values.length,
    mean,
    standardDeviation: Math.sqrt(
      values.reduce((sum, value) => sum + (value - mean) ** 2, 0) /
        values.length,
    ),
    minimum: values.reduce((a, b) => Math.min(a, b), Infinity),
    maximum: values.reduce((a, b) => Math.max(a, b), -Infinity),
  };
}

interface FloorObservation {
  floor: number;
  character: CharacterId;
  fundingBand: 'low' | 'equal' | 'high';
  startingMoney: number;
  entryScore: number;
  endMoney: number;
  floorScore: number;
  decisions: number;
  withdrawals: number;
  premiumDecisions: number;
  premiumNoMoney: number;
  lateDecisions: number;
  lateNoMoney: number;
  considered: number;
  feasible: number;
  selected: number;
  doubleBid: number;
  doubleDisrupt: number;
  doubleScore: number;
  doubleCost: number;
  doubleAwards: number;
  actualCost: number;
}
export interface BudgetFloorSummary {
  playerFloors: number;
  startingMoney: MetricSummary;
  endMoney: MetricSummary;
  floorScore: MetricSummary;
  actualCost: MetricSummary;
  decisions: number;
  withdrawals: number;
  premiumDecisions: number;
  premiumNoMoney: number;
  lateDecisions: number;
  lateNoMoney: number;
  considered: number;
  feasible: number;
  selected: number;
  doubleBid: number;
  doubleDisrupt: number;
  doubleScore: number;
  doubleCost: number;
  doubleAwards: number;
  withdrawalRate: number;
  premiumNoMoneyRate: number;
  lateNoMoneyRate: number;
  doubleSelectionRate: number;
  doubleFeasibleRate: number;
  doubleScoreMean: number;
  doubleCostMean: number;
  doubleAwardsMean: number;
  finalScorePerActualMoney: number;
}
export interface BudgetGameCharacter {
  players: number;
  scoreSum: number;
  winners: number;
}
export interface BudgetGameObservation {
  game: number;
  characters: Record<CharacterId, BudgetGameCharacter>;
}
export interface CharacterBudgetDiagnostics {
  floors: Record<string, Record<BudgetCohort, BudgetFloorSummary>>;
  games: BudgetGameObservation[];
}

function summary(records: readonly FloorObservation[]): BudgetFloorSummary {
  const counters = {
    decisions: 0,
    withdrawals: 0,
    premiumDecisions: 0,
    premiumNoMoney: 0,
    lateDecisions: 0,
    lateNoMoney: 0,
    considered: 0,
    feasible: 0,
    selected: 0,
    doubleBid: 0,
    doubleDisrupt: 0,
    doubleScore: 0,
    doubleCost: 0,
    doubleAwards: 0,
  };
  for (const record of records)
    for (const key of Object.keys(counters) as (keyof typeof counters)[])
      counters[key] += record[key];
  const divide = (n: number, d: number) => (d === 0 ? 0 : n / d);
  return {
    playerFloors: records.length,
    startingMoney: summarizeBudgetNumbers(records.map((r) => r.startingMoney)),
    endMoney: summarizeBudgetNumbers(records.map((r) => r.endMoney)),
    floorScore: summarizeBudgetNumbers(records.map((r) => r.floorScore)),
    actualCost: summarizeBudgetNumbers(records.map((r) => r.actualCost)),
    ...counters,
    withdrawalRate: divide(counters.withdrawals, counters.decisions),
    premiumNoMoneyRate: divide(
      counters.premiumNoMoney,
      counters.premiumDecisions,
    ),
    lateNoMoneyRate: divide(counters.lateNoMoney, counters.lateDecisions),
    doubleSelectionRate: divide(counters.selected, counters.considered),
    doubleFeasibleRate: divide(counters.feasible, counters.considered),
    doubleScoreMean: divide(counters.doubleScore, counters.selected),
    doubleCostMean: divide(counters.doubleCost, counters.selected),
    doubleAwardsMean: divide(counters.doubleAwards, counters.selected),
    finalScorePerActualMoney: divide(
      records.reduce((sum, r) => sum + r.floorScore, 0),
      records.reduce((sum, r) => sum + r.actualCost, 0),
    ),
  };
}

/** Read-only, opt-in observations. No random source and no writes to players or decisions. */
export class CharacterBudgetCollector {
  private active = new Map<string, FloorObservation>();
  private completed: FloorObservation[] = [];
  private games: BudgetGameObservation[] = [];

  beginFloor(
    floor: number,
    publicMoney: number,
    players: readonly RuntimePlayerState[],
  ) {
    if (this.active.size)
      throw new Error('Previous diagnostic floor is unfinished.');
    for (const player of players) {
      if (!player.characterId || player.characterFloorStartingMoney === null)
        throw new Error('Character funds must be prepared before observation.');
      this.active.set(player.id, {
        floor,
        character: player.characterId,
        fundingBand: edenFundingBand(
          player.characterFloorStartingMoney,
          publicMoney,
        ),
        startingMoney: player.characterFloorStartingMoney,
        entryScore: player.score,
        endMoney: 0,
        floorScore: 0,
        decisions: 0,
        withdrawals: 0,
        premiumDecisions: 0,
        premiumNoMoney: 0,
        lateDecisions: 0,
        lateNoMoney: 0,
        considered: 0,
        feasible: 0,
        selected: 0,
        doubleBid: 0,
        doubleDisrupt: 0,
        doubleScore: 0,
        doubleCost: 0,
        doubleAwards: 0,
        actualCost: 0,
      });
    }
  }
  decision(
    player: RuntimePlayerState,
    room: GeneratedRoom,
    decision: AiDecision,
  ) {
    const record = this.active.get(player.id)!;
    record.decisions += 1;
    if (decision.strategy === 'withdraw') record.withdrawals += 1;
    if (room.kind === 'shop' || room.kind === 'boss') {
      record.premiumDecisions += 1;
      if (player.money <= 0) record.premiumNoMoney += 1;
    }
    if (room.roomIndex >= 3) {
      record.lateDecisions += 1;
      if (player.money <= 0) record.lateNoMoney += 1;
    }
    const secondary = decision.secondaryActionAnalysis;
    if (secondary?.considered) {
      record.considered += 1;
      if (
        secondary.legalSecondaryMaximum > 0 &&
        secondary.candidates.length > 0
      )
        record.feasible += 1;
      if (secondary.selectedStrategy && decision.turn.actions.length === 2) {
        record.selected += 1;
        if (secondary.mode === 'bid') record.doubleBid += 1;
        else record.doubleDisrupt += 1;
      }
    }
  }
  settlement(settlement: RoomSettlementResult, doubles: ReadonlySet<string>) {
    for (const action of settlement.resolvedActions) {
      const record = this.active.get(action.playerId)!;
      record.actualCost += action.actualCost;
      if (doubles.has(action.playerId)) record.doubleCost += action.actualCost;
    }
    for (const id of doubles) {
      const record = this.active.get(id)!;
      record.doubleScore += settlement.roomScoreSummaries[id]!.finalScore;
      record.doubleAwards += settlement.awards
        .filter((a) => a.playerId === id)
        .reduce((sum, a) => sum + a.copies, 0);
    }
  }
  endFloor(players: readonly RuntimePlayerState[]) {
    for (const player of players) {
      const record = this.active.get(player.id)!;
      record.endMoney = player.money;
      record.floorScore = player.score - record.entryScore;
      this.completed.push(record);
    }
    this.active.clear();
  }
  endGame(
    game: number,
    players: readonly RuntimePlayerState[],
    scores: readonly number[],
    winnerIndexes: readonly number[],
  ) {
    const characters = Object.fromEntries(
      characterOrder.map((id) => [id, { players: 0, scoreSum: 0, winners: 0 }]),
    ) as Record<CharacterId, BudgetGameCharacter>;
    players.forEach((player, index) => {
      const row = characters[player.characterId!]!;
      row.players += 1;
      row.scoreSum += scores[index]!;
      if (winnerIndexes.includes(index)) row.winners += 1;
    });
    this.games.push({ game, characters });
  }
  summarize(): CharacterBudgetDiagnostics {
    if (this.active.size) throw new Error('Diagnostic floor is unfinished.');
    return {
      floors: Object.fromEntries(
        [1, 2, 3].map((floor) => [
          String(floor),
          Object.fromEntries(
            budgetCohortNames.map((name) => {
              const records = this.completed.filter(
                (r) =>
                  r.floor === floor &&
                  (name === 'all' ||
                    name === r.character ||
                    (r.character === 'eden' &&
                      name === `eden_${r.fundingBand}`)),
              );
              return [name, summary(records)];
            }),
          ),
        ]),
      ) as CharacterBudgetDiagnostics['floors'],
      games: this.games,
    };
  }
}
