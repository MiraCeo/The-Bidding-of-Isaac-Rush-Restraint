import { describe, expect, it } from 'vitest';
import {
  characterBudgetCases,
  mergeBudgetFloors,
  pairedCharacterDifference,
  runCharacterBudgetStudy,
} from './character-budget-research';
import {
  CharacterBudgetCollector,
  edenFundingBand,
  summarizeBudgetNumbers,
  type BudgetGameObservation,
} from './character-budget-diagnostics';
import { assignCharacter, characterOrder } from './characters';
import { aiPersonalityOrder } from './ai-personality';
import { defaultRules } from './config';
import { createRuntimePlayer } from './runtime';
import { createSeededRandom } from './random';
import { simulateAiGames, type SimulationOptions } from './simulation';

const settings: SimulationOptions = {
  doctrinePopulation: { balanced: 9, cooperative: 5, chaotic: 5 },
  enablePersonalities: true,
  personalityCountMinimum: 2,
  personalityCountMaximum: 4,
  personalityPool: aiPersonalityOrder,
  enableDoubleActions: true,
};
function game(
  index: number,
  players: number,
  scoreSum: number,
  winners = 0,
): BudgetGameObservation {
  return {
    game: index,
    characters: Object.fromEntries(
      characterOrder.map((id) => [
        id,
        {
          players: id === 'jacob_esau' ? players : 0,
          scoreSum: id === 'jacob_esau' ? scoreSum : 0,
          winners: id === 'jacob_esau' ? winners : 0,
        },
      ]),
    ) as BudgetGameObservation['characters'],
  };
}
describe('T08 isolated funds diagnostics and paired analysis', () => {
  it.each([
    [99, 'low'],
    [100, 'equal'],
    [101, 'high'],
  ] as const)(
    'stratifies actual rounded Eden start %s against the public baseline',
    (money, band) => {
      expect(edenFundingBand(money, 100)).toBe(band);
    },
  );
  it('does not replace recorded Eden starting funds with interest or remaining money', () => {
    const player = assignCharacter(
      createRuntimePlayer({ id: 'p', money: 999, score: 17, isHuman: false }),
      'eden',
      createSeededRandom(42),
    );
    player.characterFloorStartingMoney = 90;
    const before = structuredClone(player);
    const collector = new CharacterBudgetCollector();
    collector.beginFloor(1, 100, [player]);
    collector.endFloor([{ ...player, money: 600, score: 117 }]);
    const floor = collector.summarize().floors['1']!;
    expect(floor.eden_low.startingMoney.mean).toBe(90);
    expect(floor.eden_low.endMoney.mean).toBe(600);
    expect(floor.eden_low.floorScore.mean).toBe(100);
    expect(floor.eden_high.playerFloors).toBe(0);
    expect(player).toEqual(before);
  });
  it('requires prepared funds and complete floors before summarizing', () => {
    const player = assignCharacter(
      createRuntimePlayer({ id: 'p', money: 0, score: 0, isHuman: false }),
      'isaac',
      createSeededRandom(1),
    );
    const collector = new CharacterBudgetCollector();
    expect(() => collector.beginFloor(1, 100, [player])).toThrow(/prepared/);
    player.characterFloorStartingMoney = 110;
    collector.beginFloor(1, 100, [player]);
    expect(() => collector.summarize()).toThrow(/unfinished/);
    expect(() => collector.beginFloor(2, 500, [player])).toThrow(/unfinished/);
  });
  it.each(['legacy', 'per-player-room'] as const)(
    'adds observations without changing any existing %s simulation output',
    (randomization) => {
      const baseline = simulateAiGames(
        4,
        42,
        { ...defaultRules, playerCount: 19 },
        { ...settings, research: { randomization } },
      );
      const observed = simulateAiGames(
        4,
        42,
        { ...defaultRules, playerCount: 19 },
        {
          ...settings,
          research: { randomization, collectCharacterBudget: true },
        },
      );
      const { characterBudget, ...research } = observed.research!;
      expect({ ...observed, research }).toEqual(baseline);
      expect(characterBudget!.games).toHaveLength(4);
      for (const floor of Object.values(characterBudget!.floors)) {
        expect(floor.all.playerFloors).toBe(76);
        expect(floor.all.decisions).toBe(380);
        expect(floor.all.lateDecisions).toBe(152);
        expect(
          floor.eden_low.playerFloors +
            floor.eden_equal.playerFloors +
            floor.eden_high.playerFloors,
        ).toBe(floor.eden.playerFloors);
      }
      const totalScore = Object.values(characterBudget!.floors).reduce(
        (sum, f) => sum + f.all.floorScore.mean * f.all.playerFloors,
        0,
      );
      const totalCosts = Object.values(characterBudget!.floors).reduce(
        (sum, f) => sum + f.all.actualCost.mean * f.all.playerFloors,
        0,
      );
      expect(totalScore).toBeCloseTo(observed.scoringTotals.finalRoomScore, 6);
      expect(totalCosts).toBeCloseTo(observed.scoringTotals.actualCosts, 6);
      const doubleCount = Object.values(characterBudget!.floors).reduce(
        (sum, f) => sum + f.all.selected,
        0,
      );
      expect(doubleCount).toBe(observed.doubleActionAnalysis.selected);
    },
  );
  it('makes the budget-basis switch an exact negative control when doubles are disabled', () => {
    const run = (doubleActionBudgetBasis: 'public' | 'character') =>
      simulateAiGames(
        4,
        42,
        { ...defaultRules, playerCount: 19 },
        {
          ...settings,
          enableDoubleActions: false,
          research: {
            randomization: 'per-player-room',
            doubleActionBudgetBasis,
            collectCharacterBudget: true,
          },
        },
      );
    expect(run('character')).toEqual(run('public'));
  });
  it('runs reproducible three-case studies with fixed role and Eden floor cohorts, not formal configuration changes', () => {
    const rules = structuredClone(defaultRules),
      pool = [...aiPersonalityOrder];
    const first = runCharacterBudgetStudy({ gamesPerSeed: 3, seeds: [41, 42] });
    expect(first).toEqual(
      runCharacterBudgetStudy({ gamesPerSeed: 3, seeds: [41, 42] }),
    );
    expect(Object.keys(first.cases)).toEqual(
      characterBudgetCases.map((c) => c.name),
    );
    expect(first.excluded).toEqual(['all_in']);
    expect(first.cases.public_budget!.pooled.score.count).toBe(114);
    for (const candidate of Object.values(first.cases))
      for (const [index, row] of candidate.seeds.entries()) {
        const baseline = first.cases.public_budget!.seeds[index]!;
        expect(row.worldFingerprint).toBe(baseline.worldFingerprint);
        expect(row.personalityFingerprint).toBe(
          baseline.personalityFingerprint,
        );
        for (const floor of ['1', '2', '3'])
          expect(row.floors[floor]!.eden_low.startingMoney).toEqual(
            baseline.floors[floor]!.eden_low.startingMoney,
          );
      }
    expect(defaultRules).toEqual(rules);
    expect(aiPersonalityOrder).toEqual(pool);
  });
  it('merges observed denominators rather than averaging per-seed rates', () => {
    const first = runCharacterBudgetStudy({ gamesPerSeed: 1, seeds: [42] })
      .cases.public_budget!.pooled.floors['1']!.all;
    const second = {
      ...first,
      premiumDecisions: 9,
      premiumNoMoney: 9,
      considered: 100,
      selected: 10,
      doubleScore: 200,
      doubleCost: 20,
      doubleAwards: 5,
    };
    const changed = {
      ...first,
      premiumDecisions: 1,
      premiumNoMoney: 0,
      considered: 1,
      selected: 1,
      doubleScore: 50,
      doubleCost: 5,
      doubleAwards: 1,
    };
    const merged = mergeBudgetFloors([changed, second]);
    expect(merged.premiumNoMoneyRate).toBe(0.9);
    expect(merged.doubleSelectionRate).toBeCloseTo(11 / 101);
    expect(merged.doubleScoreMean).toBeCloseTo(250 / 11);
    expect(merged.doubleAwardsMean).toBeCloseTo(6 / 11);
    expect(mergeBudgetFloors([]).playerFloors).toBe(0);
  });
  it('uses a paired game-cluster standard error, not independent player error bars', () => {
    const base = [game(1, 2, 10, 0), game(2, 1, 10, 1), game(3, 0, 0)];
    const next = [game(1, 2, 12, 1), game(2, 1, 14, 0), game(3, 0, 0)];
    const score = pairedCharacterDifference(
      base,
      next,
      'jacob_esau',
      'scoreSum',
    );
    expect(score.difference).toBe(2);
    expect(score.standardError).toBeCloseTo(Math.sqrt(12) / 3);
    expect(score.interval95![0]).toBeCloseTo(2 - (1.96 * Math.sqrt(12)) / 3);
    expect(
      pairedCharacterDifference(base, next, 'jacob_esau', 'winners').difference,
    ).toBe(0);
    expect(
      pairedCharacterDifference(base, next, 'eden', 'scoreSum').interval95,
    ).toBeNull();
  });
  it('rejects unmatched game counts, identifiers or character population', () => {
    expect(() =>
      pairedCharacterDifference([game(1, 1, 1)], [], 'jacob_esau', 'scoreSum'),
    ).toThrow(/count/);
    expect(() =>
      pairedCharacterDifference(
        [game(1, 1, 1)],
        [game(2, 1, 1)],
        'jacob_esau',
        'scoreSum',
      ),
    ).toThrow(/population/);
    expect(() =>
      pairedCharacterDifference(
        [game(1, 1, 1)],
        [game(1, 2, 1)],
        'jacob_esau',
        'scoreSum',
      ),
    ).toThrow(/population/);
  });
  it('keeps large metrics finite without spreading arrays onto the call stack', () => {
    const metric = summarizeBudgetNumbers(
      Array.from({ length: 200_000 }, () => 7),
    );
    expect(metric).toEqual({
      count: 200_000,
      mean: 7,
      standardDeviation: 0,
      minimum: 7,
      maximum: 7,
    });
  });
  it('rejects invalid seeds and overlapping generated game clusters', () => {
    for (const options of [
      { gamesPerSeed: 0, seeds: [1] },
      { gamesPerSeed: 1, seeds: [] },
      { gamesPerSeed: 1, seeds: [1, 1] },
      { gamesPerSeed: 1, seeds: [-1] },
      { gamesPerSeed: 2, seeds: [1, (1 + 0x9e3779b1) >>> 0] },
    ])
      expect(() => runCharacterBudgetStudy(options)).toThrow();
  });
});
