import { aiPersonalityOrder } from './ai-personality';
import { mergeResearchMetrics } from './balance-research';
import {
  budgetCohortNames,
  type BudgetFloorSummary,
  type BudgetGameObservation,
} from './character-budget-diagnostics';
import { characterOrder } from './characters';
import { defaultRules } from './config';
import type { CharacterId } from './item-types';
import { simulateAiGames } from './simulation';

export const characterBudgetCases = [
  { name: 'public_budget', basis: 'public', doubles: true },
  { name: 'character_budget', basis: 'character', doubles: true },
  { name: 'no_double', basis: 'public', doubles: false },
] as const;
const divide = (n: number, d: number) => (d === 0 ? 0 : n / d);

export function mergeBudgetFloors(
  rows: readonly BudgetFloorSummary[],
): BudgetFloorSummary {
  const fields = [
    'playerFloors',
    'decisions',
    'withdrawals',
    'premiumDecisions',
    'premiumNoMoney',
    'lateDecisions',
    'lateNoMoney',
    'considered',
    'feasible',
    'selected',
    'doubleBid',
    'doubleDisrupt',
    'doubleScore',
    'doubleCost',
    'doubleAwards',
  ] as const;
  const counters = Object.fromEntries(
    fields.map((key) => [key, rows.reduce((sum, r) => sum + r[key], 0)]),
  ) as Pick<BudgetFloorSummary, (typeof fields)[number]>;
  const floorScore = mergeResearchMetrics(rows.map((r) => r.floorScore));
  const actualCost = mergeResearchMetrics(rows.map((r) => r.actualCost));
  return {
    ...counters,
    startingMoney: mergeResearchMetrics(rows.map((r) => r.startingMoney)),
    endMoney: mergeResearchMetrics(rows.map((r) => r.endMoney)),
    floorScore,
    actualCost,
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
      floorScore.mean * floorScore.count,
      actualCost.mean * actualCost.count,
    ),
  };
}

/** Paired ratio difference; one entire game is a cluster, not nineteen independent samples. */
export function pairedCharacterDifference(
  control: readonly BudgetGameObservation[],
  candidate: readonly BudgetGameObservation[],
  character: CharacterId,
  field: 'scoreSum' | 'winners',
) {
  if (control.length !== candidate.length)
    throw new Error('Unpaired game count.');
  const clusters = control.map((game, index) => {
    const next = candidate[index]!;
    const base = game.characters[character],
      changed = next.characters[character];
    if (game.game !== next.game || base.players !== changed.players)
      throw new Error('Unpaired character population.');
    return { count: base.players, delta: changed[field] - base[field] };
  });
  const players = clusters.reduce((sum, r) => sum + r.count, 0);
  const difference = divide(
    clusters.reduce((sum, r) => sum + r.delta, 0),
    players,
  );
  const variance = clusters.reduce(
    (sum, r) => sum + (r.delta - difference * r.count) ** 2,
    0,
  );
  const standardError =
    clusters.length > 1 && players > 0
      ? Math.sqrt((clusters.length / (clusters.length - 1)) * variance) /
        players
      : null;
  return {
    games: clusters.length,
    players,
    difference: players ? difference : null,
    standardError,
    interval95:
      standardError === null
        ? null
        : [
            difference - 1.96 * standardError,
            difference + 1.96 * standardError,
          ],
  };
}

export function runCharacterBudgetStudy(options: {
  gamesPerSeed: number;
  seeds: readonly number[];
  onProgress?: (name: string, seed: number) => void;
}) {
  if (
    !Number.isInteger(options.gamesPerSeed) ||
    options.gamesPerSeed <= 0 ||
    !options.seeds.length ||
    options.seeds.some(
      (seed) => !Number.isInteger(seed) || seed < 0 || seed > 0xffffffff,
    ) ||
    new Set(options.seeds).size !== options.seeds.length
  )
    throw new RangeError(
      'Use positive games and distinct unsigned integer seeds.',
    );
  const gameSeeds = new Set<number>();
  for (const seed of options.seeds)
    for (let i = 0; i < options.gamesPerSeed; i += 1) {
      const gameSeed = (seed + i * 0x9e3779b1) >>> 0;
      if (gameSeeds.has(gameSeed))
        throw new RangeError('Study seeds produce overlapping game clusters.');
      gameSeeds.add(gameSeed);
    }
  const raw = Object.fromEntries(
    characterBudgetCases.map((variant) => {
      const seeds = options.seeds.map((seed) => {
        const report = simulateAiGames(
          options.gamesPerSeed,
          seed,
          { ...defaultRules, playerCount: 19 },
          {
            doctrinePopulation: { balanced: 9, cooperative: 5, chaotic: 5 },
            enablePersonalities: true,
            personalityCountMinimum: 2,
            personalityCountMaximum: 4,
            personalityPool: aiPersonalityOrder,
            enableSituationAnalysis: true,
            enableItemAnalysis: true,
            enableDoubleActions: variant.doubles,
            research: {
              randomization: 'per-player-room',
              doubleActionBudgetBasis: variant.basis,
              collectCharacterBudget: true,
            },
          },
        );
        const research = report.research!;
        options.onProgress?.(variant.name, seed);
        return {
          seed,
          games: report.games,
          worldFingerprint: research.worldFingerprint,
          personalityFingerprint: research.personalityFingerprint,
          score: report.finalScore,
          winnerScore: report.winnerScore,
          characters: report.characterPerformance,
          doubles: report.doubleActionAnalysis,
          floors: research.characterBudget!.floors,
          gameClusters: research.characterBudget!.games,
        };
      });
      return [variant.name, seeds];
    }),
  );
  const reference = raw.public_budget!;
  for (const [name, results] of Object.entries(raw))
    results.forEach((result, index) => {
      if (
        result.worldFingerprint !== reference[index]!.worldFingerprint ||
        result.personalityFingerprint !==
          reference[index]!.personalityFingerprint
      )
        throw new Error(`Fixed input drift in ${name}.`);
      for (const floor of ['1', '2', '3'])
        for (const cohort of budgetCohortNames) {
          if (
            JSON.stringify(result.floors[floor]![cohort].startingMoney) !==
            JSON.stringify(
              reference[index]!.floors[floor]![cohort].startingMoney,
            )
          )
            throw new Error(`Funding cohort drift in ${name}.`);
        }
    });
  const pair = (base: string, candidate: string) => {
    const summarize = (
      left: BudgetGameObservation[],
      right: BudgetGameObservation[],
    ) =>
      Object.fromEntries(
        characterOrder.map((id) => [
          id,
          {
            score: pairedCharacterDifference(left, right, id, 'scoreSum'),
            winnerRate: pairedCharacterDifference(left, right, id, 'winners'),
          },
        ]),
      );
    const left = raw[base]!,
      right = raw[candidate]!;
    return {
      seeds: options.seeds.map((seed, i) => ({
        seed,
        characters: summarize(left[i]!.gameClusters, right[i]!.gameClusters),
      })),
      pooled: summarize(
        left.flatMap((r) => r.gameClusters),
        right.flatMap((r) => r.gameClusters),
      ),
    };
  };
  return {
    gamesPerSeed: options.gamesPerSeed,
    seeds: [...options.seeds],
    randomization: 'per-player-room',
    excluded: ['all_in'],
    playersPerGame: 19,
    parameters: {
      doctrinePopulation: { balanced: 9, cooperative: 5, chaotic: 5 },
      personalityCount: [2, 4],
      secondaryActualCostRatio: 0.17,
      secondaryNominalRatio: 0.4,
      publicReserveRatio: 0.1,
      stopWeight: 3,
    },
    pairs: {
      character_vs_public: pair('public_budget', 'character_budget'),
      public_vs_no_double: pair('no_double', 'public_budget'),
    },
    cases: Object.fromEntries(
      Object.entries(raw).map(([name, seeds]) => [
        name,
        {
          seeds: seeds.map(({ gameClusters: _, ...result }) => result),
          pooled: {
            games: seeds.reduce((sum, r) => sum + r.games, 0),
            score: mergeResearchMetrics(seeds.map((r) => r.score)),
            winnerScore: mergeResearchMetrics(seeds.map((r) => r.winnerScore)),
            characters: Object.fromEntries(
              characterOrder.map((id) => {
                const rows = seeds.map((r) => r.characters[id]);
                const players = rows.reduce((sum, r) => sum + r.playerGames, 0);
                return [
                  id,
                  {
                    players,
                    score: mergeResearchMetrics(rows.map((r) => r.finalScore)),
                    money: mergeResearchMetrics(rows.map((r) => r.finalMoney)),
                    items: mergeResearchMetrics(
                      rows.map((r) => r.finalItemCount),
                    ),
                    winnerRate: divide(
                      rows.reduce(
                        (sum, r) => sum + r.winnerRate * r.playerGames,
                        0,
                      ),
                      players,
                    ),
                  },
                ];
              }),
            ),
            floors: Object.fromEntries(
              ['1', '2', '3'].map((floor) => [
                floor,
                Object.fromEntries(
                  budgetCohortNames.map((cohort) => [
                    cohort,
                    mergeBudgetFloors(
                      seeds.map((r) => r.floors[floor]![cohort]),
                    ),
                  ]),
                ),
              ]),
            ),
          },
        },
      ]),
    ),
  };
}
