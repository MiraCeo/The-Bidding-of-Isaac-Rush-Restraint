import { aiPersonalityOrder, type AiPersonality } from './ai-personality';
import type { AiStrategy } from './ai-decision';
import type { MetricSummary, RankedPlayerRecord } from './simulation';

export interface ResearchPlayerRecord extends RankedPlayerRecord {
  money: number;
  awardedCopies: number;
  winner: boolean;
  strategyCounts: Record<AiStrategy, number>;
  quoteAttempts: number;
  quoteClamps: number;
  cooperationAttempts: number;
  cooperationHits: number;
  disruptedHighPriceSlots: number;
  disruptedHighPriceVacancies: number;
}

export interface ResearchCohortSummary {
  players: number;
  score: MetricSummary;
  money: MetricSummary;
  items: MetricSummary;
  scoreQuantiles: { p05: number; p50: number; p95: number; p99: number };
  winnerRate: number;
  awardsPerPlayerGame: number;
  strategyRates: Record<AiStrategy, number>;
  quoteAttempts: number;
  quoteClamps: number;
  cooperationAttempts: number;
  cooperationHits: number;
  disruptedHighPriceSlots: number;
  disruptedHighPriceVacancies: number;
}

export interface SimulationResearchSummary {
  worldFingerprint: string;
  personalityFingerprint: string;
  cohorts: Record<string, ResearchCohortSummary>;
}

const cohortDefinitions: Record<string, readonly AiPersonality[]> = {
  all: [],
  ...Object.fromEntries(aiPersonalityOrder.map((personality) => [personality, [personality]])),
  adaptive_rational: ['adaptive', 'rational'],
  rational_stubborn: ['rational', 'stubborn'],
  arrogant_stubborn: ['arrogant', 'stubborn'],
};

function metric(values: readonly number[]): MetricSummary {
  if (values.length === 0) return { count: 0, mean: 0, standardDeviation: 0, minimum: 0, maximum: 0 };
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  return {
    count: values.length,
    mean,
    standardDeviation: Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length),
    minimum: values.reduce((min, value) => Math.min(min, value), Infinity),
    maximum: values.reduce((max, value) => Math.max(max, value), -Infinity),
  };
}

function quantile(sorted: readonly number[], fraction: number): number {
  if (sorted.length === 0) return 0;
  const position = (sorted.length - 1) * fraction;
  const left = Math.floor(position);
  return sorted[left]! + (sorted[Math.ceil(position)]! - sorted[left]!) * (position - left);
}

/** Diagnostic fingerprints of fixed experimental inputs, not conditional gameplay outcomes. */
export function updateResearchFingerprint(hash: number, value: unknown): number {
  const text = JSON.stringify(value);
  for (let index = 0; index < text.length; index += 1) {
    hash = Math.imul(hash ^ text.charCodeAt(index), 0x01000193) >>> 0;
  }
  return hash;
}

export function summarizeResearchCohorts(records: readonly ResearchPlayerRecord[]): Record<string, ResearchCohortSummary> {
  return Object.fromEntries(Object.entries(cohortDefinitions).map(([name, required]) => {
    const members = required.length === 0 ? records : records.filter(
      (record) => required.every((personality) => record.personalities.includes(personality)),
    );
    const strategies: Record<AiStrategy, number> = {
      high_bid: 0, cooperate: 0, disrupt_high: 0, disrupt_cooperate: 0, withdraw: 0,
    };
    for (const member of members) {
      for (const strategy of Object.keys(strategies) as AiStrategy[]) {
        strategies[strategy] += member.strategyCounts[strategy];
      }
    }
    const decisions = Object.values(strategies).reduce((sum, count) => sum + count, 0);
    const scores = members.map((record) => record.finalScore).sort((a, b) => a - b);
    return [name, {
      players: members.length,
      score: metric(scores),
      money: metric(members.map((record) => record.money)),
      items: metric(members.map((record) => record.itemCount)),
      scoreQuantiles: { p05: quantile(scores, 0.05), p50: quantile(scores, 0.5), p95: quantile(scores, 0.95), p99: quantile(scores, 0.99) },
      winnerRate: members.length === 0 ? 0 : members.filter((record) => record.winner).length / members.length,
      awardsPerPlayerGame: members.length === 0 ? 0 : members.reduce((sum, record) => sum + record.awardedCopies, 0) / members.length,
      strategyRates: Object.fromEntries(Object.entries(strategies).map(([strategy, count]) => [strategy, decisions === 0 ? 0 : count / decisions])) as Record<AiStrategy, number>,
      quoteAttempts: members.reduce((sum, record) => sum + record.quoteAttempts, 0),
      quoteClamps: members.reduce((sum, record) => sum + record.quoteClamps, 0),
      cooperationAttempts: members.reduce((sum, record) => sum + record.cooperationAttempts, 0),
      cooperationHits: members.reduce((sum, record) => sum + record.cooperationHits, 0),
      disruptedHighPriceSlots: members.reduce((sum, record) => sum + record.disruptedHighPriceSlots, 0),
      disruptedHighPriceVacancies: members.reduce((sum, record) => sum + record.disruptedHighPriceVacancies, 0),
    } satisfies ResearchCohortSummary];
  }));
}
