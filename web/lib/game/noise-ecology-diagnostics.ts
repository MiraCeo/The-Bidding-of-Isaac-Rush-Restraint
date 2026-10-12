import type { AiDecision, AiDoctrine } from './ai-decision';
import type { AiPersonality } from './ai-personality';
import type {
  CharacterId,
  GeneratedRoom,
  RuntimePlayerState,
} from './item-types';
import type { RoomSettlementResult } from './room-engine';
import { countItem } from './runtime';
import { calculateFinalScore } from './item-scoring';
import { summarizeBudgetNumbers } from './character-budget-diagnostics';
import { updateResearchFingerprint } from './simulation-research';
import { defaultRules } from './config';
import type { RulesConfig } from './types';
import { characterOrder } from './characters';

export interface EcologyProfile {
  doctrine: AiDoctrine;
  personalities: readonly AiPersonality[];
}
export interface EcologyRecord {
  game: number;
  playerId: string;
  character: CharacterId;
  doctrine: AiDoctrine;
  gambler: boolean;
  score: number;
  beforeCrown: number;
  money: number;
  hearts: number;
  winner: boolean;
  cost: number;
  quotes: number;
  clamps: number;
  secondaryQuotes: number;
  secondaryClamps: number;
  coopAttempts: number;
  coopHits: number;
  coopPlacements: number;
}
export interface EcologyCluster {
  game: number;
  players: number;
  scoreSum: number;
  winners: number;
}
interface RoomObservation {
  decisions: number;
  participated: number;
  noMoney: number;
  initialSum: number;
  retroSum: number;
  finalSum: number;
}
interface LateObservation {
  decisions: number;
  noMoney: number;
}
export type EcologyGroup =
  | 'all'
  | 'gambler'
  | 'non_gambler'
  | 'heart0'
  | 'heart1'
  | 'heart2plus'
  | CharacterId;
export const ecologyGroups: readonly EcologyGroup[] = [
  'all',
  'gambler',
  'non_gambler',
  'heart0',
  'heart1',
  'heart2plus',
  ...characterOrder,
];

function inEcologyGroup(record: EcologyRecord, name: EcologyGroup): boolean {
  if (name === 'all') return true;
  if (name === 'gambler') return record.gambler;
  if (name === 'non_gambler') return !record.gambler;
  if (name === 'heart0') return record.hearts === 0;
  if (name === 'heart1') return record.hearts === 1;
  if (name === 'heart2plus') return record.hearts >= 2;
  return record.character === name;
}

export function scoreQuantiles(values: readonly number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const q = (fraction: number) => {
    if (!sorted.length) return 0;
    const position = (sorted.length - 1) * fraction;
    const i = Math.floor(position);
    return (
      sorted[i]! + (sorted[Math.ceil(position)]! - sorted[i]!) * (position - i)
    );
  };
  return { p05: q(0.05), p50: q(0.5), p95: q(0.95), p99: q(0.99) };
}
const ratio = (a: number, b: number) => (b === 0 ? 0 : a / b);
export function summarizeEcologyRecords(records: readonly EcologyRecord[]) {
  const sum = (
    key:
      | 'cost'
      | 'quotes'
      | 'clamps'
      | 'secondaryQuotes'
      | 'secondaryClamps'
      | 'coopAttempts'
      | 'coopHits'
      | 'coopPlacements',
  ) => records.reduce((total, r) => total + r[key], 0);
  const winners = records.filter((r) => r.winner).length;
  return {
    players: records.length,
    winners,
    winnerRate: ratio(winners, records.length),
    score: summarizeBudgetNumbers(records.map((r) => r.score)),
    beforeCrown: summarizeBudgetNumbers(records.map((r) => r.beforeCrown)),
    money: summarizeBudgetNumbers(records.map((r) => r.money)),
    quantiles: scoreQuantiles(records.map((r) => r.score)),
    actualCost: sum('cost'),
    quotes: sum('quotes'),
    clamps: sum('clamps'),
    secondaryQuotes: sum('secondaryQuotes'),
    secondaryClamps: sum('secondaryClamps'),
    coopAttempts: sum('coopAttempts'),
    coopHits: sum('coopHits'),
    coopPlacements: sum('coopPlacements'),
    clampRate: ratio(sum('clamps'), sum('quotes')),
    secondaryClampRate: ratio(sum('secondaryClamps'), sum('secondaryQuotes')),
    coopHitRate: ratio(sum('coopHits'), sum('coopAttempts')),
    coopPlacementRate: ratio(sum('coopPlacements'), sum('coopAttempts')),
  };
}

/** Shared observations for AI-only research and the real client reducer; never feeds back into AI. */
export class NoiseEcologyCollector {
  private active = new Map<string, EcologyRecord>();
  private records: EcologyRecord[] = [];
  private fingerprint = 0x811c9dc5;
  private rooms: Record<string, RoomObservation> = {};
  private late: Record<string, LateObservation> = {};
  private lateCharacters: Record<string, LateObservation> = {};
  private gameCount = 0;
  private humanWins = 0;
  private allWinnerSlots = 0;
  private clusters: EcologyCluster[] = [];
  constructor(private rules: RulesConfig = defaultRules) {}

  beginGame(
    game: number,
    rooms: readonly GeneratedRoom[][],
    players: readonly RuntimePlayerState[],
    profiles: ReadonlyMap<string, EcologyProfile>,
    quoteProfiles: unknown,
  ) {
    if (this.active.size) throw new Error('Unfinished ecology game.');
    this.gameCount += 1;
    this.fingerprint = updateResearchFingerprint(this.fingerprint, {
      rooms,
      players: players.map((p) => ({
        id: p.id,
        character: p.characterId,
        items: p.items.map((i) => i.itemId),
      })),
      profiles: [...profiles],
      quoteProfiles,
    });
    for (const player of players.filter((p) => !p.isHuman)) {
      const profile = profiles.get(player.id);
      if (!profile || !player.characterId)
        throw new Error('Missing ecology profile.');
      this.active.set(player.id, {
        game,
        playerId: player.id,
        character: player.characterId,
        doctrine: profile.doctrine,
        gambler: profile.personalities.includes('gambler'),
        score: 0,
        beforeCrown: 0,
        money: 0,
        hearts: 0,
        winner: false,
        cost: 0,
        quotes: 0,
        clamps: 0,
        secondaryQuotes: 0,
        secondaryClamps: 0,
        coopAttempts: 0,
        coopHits: 0,
        coopPlacements: 0,
      });
    }
  }
  entry(room: GeneratedRoom, players: readonly RuntimePlayerState[]) {
    if (room.roomIndex === 0)
      this.fingerprint = updateResearchFingerprint(
        this.fingerprint,
        players.map((p) => [p.id, p.characterFloorStartingMoney]),
      );
  }
  room(
    room: GeneratedRoom,
    before: readonly RuntimePlayerState[],
    decisions: readonly AiDecision[],
    settlement: RoomSettlementResult,
  ) {
    const key = `${room.floorIndex + 1}:${room.kind}`;
    const observation = (this.rooms[key] ??= {
      decisions: 0,
      participated: 0,
      noMoney: 0,
      initialSum: 0,
      retroSum: 0,
      finalSum: 0,
    });
    const late = (this.late[String(room.floorIndex + 1)] ??= {
      decisions: 0,
      noMoney: 0,
    });
    for (const player of before.filter((p) => !p.isHuman)) {
      const record = this.active.get(player.id)!;
      const decision = decisions.find((d) => d.turn.playerId === player.id)!;
      if (!decision) throw new Error('Missing ecology decision.');
      observation.decisions += 1;
      if (decision.strategy !== 'withdraw') observation.participated += 1;
      if (player.money <= 0) observation.noMoney += 1;
      if (room.roomIndex >= 3) {
        const roleLate = (this.lateCharacters[
          `${room.floorIndex + 1}:${player.characterId}`
        ] ??= { decisions: 0, noMoney: 0 });
        roleLate.decisions += 1;
        if (player.money <= 0) roleLate.noMoney += 1;
        late.decisions += 1;
        if (player.money <= 0) late.noMoney += 1;
      }
      const score = settlement.roomScoreSummaries[player.id]!;
      observation.initialSum += score.initialScore;
      observation.retroSum += score.retroactiveScore;
      observation.finalSum += score.finalScore;
      const quotes = [
        {
          index: 0,
          strategy: decision.strategy,
          quote: decision.quoteAnalysis,
        },
        {
          index: 1,
          strategy: decision.secondaryActionAnalysis?.selectedStrategy,
          quote: decision.secondaryActionAnalysis?.selectedQuote,
        },
      ];
      for (const entry of quotes) {
        const action = settlement.resolvedActions.find(
          (a) =>
            a.playerId === player.id &&
            a.actionIndex === entry.index &&
            a.action.type !== 'withdraw',
        );
        if (!entry.quote || !action || action.action.type === 'withdraw')
          continue;
        const group = action.action.group;
        if (entry.index === 0) {
          record.quotes += 1;
          if (entry.quote.wasClamped) record.clamps += 1;
        } else {
          record.secondaryQuotes += 1;
          if (entry.quote.wasClamped) record.secondaryClamps += 1;
        }
        if (
          entry.index === 0 &&
          (entry.strategy === 'cooperate' ||
            entry.strategy === 'disrupt_cooperate') &&
          settlement.baseline &&
          action.marketEquivalent !== null
        ) {
          record.coopAttempts += 1;
          if (
            Math.abs(action.marketEquivalent - settlement.baseline.target) <=
            this.rules.floorStartingMoney[room.floorIndex]! *
              this.rules.cooperationZoneRatio
          )
            record.coopHits += 1;
          if (
            settlement.cooperationPlacements.some(
              (p) => p.playerId === player.id && p.group === group,
            )
          )
            record.coopPlacements += 1;
        }
      }
      record.cost += settlement.resolvedActions
        .filter((a) => a.playerId === player.id)
        .reduce((sum, a) => sum + a.actualCost, 0);
    }
  }
  endGame(players: readonly RuntimePlayerState[]) {
    const highest = Math.max(...players.map(calculateFinalScore));
    this.allWinnerSlots += players.filter(
      (p) => calculateFinalScore(p) === highest,
    ).length;
    if (players.some((p) => p.isHuman && calculateFinalScore(p) === highest))
      this.humanWins += 1;
    const gamblers: EcologyRecord[] = [];
    for (const player of players.filter((p) => !p.isHuman)) {
      const record = this.active.get(player.id)!;
      Object.assign(record, {
        score: calculateFinalScore(player),
        beforeCrown: player.score,
        money: player.money,
        hearts: countItem(player, 'moms_heart'),
        winner: calculateFinalScore(player) === highest,
      });
      this.records.push(record);
      if (record.gambler) gamblers.push(record);
    }
    const game = this.records[this.records.length - 1]!.game;
    this.clusters.push({
      game,
      players: gamblers.length,
      scoreSum: gamblers.reduce((sum, p) => sum + p.score, 0),
      winners: gamblers.filter((p) => p.winner).length,
    });
    this.active.clear();
  }
  summarize() {
    if (this.active.size) throw new Error('Unfinished ecology game.');
    const groups = Object.fromEntries(
      ecologyGroups.map((name) => {
        const records = this.records.filter((r) => inEcologyGroup(r, name));
        return [name, summarizeEcologyRecords(records)];
      }),
    ) as Record<EcologyGroup, ReturnType<typeof summarizeEcologyRecords>>;
    const aiWinnerSlots = groups.all.winners;
    const doctrines = Object.fromEntries(
      (['balanced', 'cooperative', 'chaotic'] as const).map((doctrine) => {
        const records = this.records.filter((r) => r.doctrine === doctrine);
        const winners = records.filter((r) => r.winner).length;
        return [
          doctrine,
          {
            players: records.length,
            winners,
            winnerRate: ratio(winners, records.length),
            championShareAmongAI: ratio(winners, aiWinnerSlots),
            populationShare: ratio(records.length, this.records.length),
          },
        ];
      }),
    );
    return {
      games: this.gameCount,
      fingerprint: this.fingerprint.toString(16).padStart(8, '0'),
      groups,
      doctrines,
      rooms: this.rooms,
      late: this.late,
      lateCharacters: this.lateCharacters,
      humanWins: this.humanWins,
      allWinnerSlots: this.allWinnerSlots,
      // Raw scores and paired clusters are internal pooling inputs; the report runner strips them after pooling.
      samples: Object.fromEntries(
        ecologyGroups.map((name) => [
          name,
          this.records
            .filter((r) => inEcologyGroup(r, name))
            .map((r) => r.score),
        ]),
      ) as Record<EcologyGroup, number[]>,
      clusters: this.clusters,
    };
  }
}
export type NoiseEcologySummary = ReturnType<
  NoiseEcologyCollector['summarize']
>;
