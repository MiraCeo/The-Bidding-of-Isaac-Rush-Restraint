import { describe, expect, it } from 'vitest';
import runtimeBaseline from './fixtures/classic-cross-runtime-baseline.json';
import { decideAiTurn } from './ai-decision';
import { aiPersonalityOrder } from './ai-personality';
import { characterOrder } from './characters';
import {
  clientGameReducer,
  createClientResearchReducer,
  getCurrentRoom,
  startClientGame,
} from './client-session';
import { defaultRules } from './config';
import { createSeededRandom } from './random';
import { createRuntimePlayer, grantItemInstance } from './runtime';
import { settleRuntimeRoom } from './room-engine';
import { updateResearchFingerprint } from './simulation-research';
import { simulateAiGames, type SimulationOptions } from './simulation';
import {
  NoiseEcologyCollector,
  scoreQuantiles,
  summarizeEcologyRecords,
  type EcologyRecord,
} from './noise-ecology-diagnostics';
import {
  ecologyHumanTurn,
  pairedGamblerDifference,
  poolEcologyReports,
  runNoiseEcologyStudy,
  simulateClientEcology,
} from './noise-ecology-research';

const goldenHashes = {
  isaac: 'a4e5f674',
  lost: 'd8a1e137',
  azazel: '15afde7e',
  eden: 'dde4acfc',
  jacob_esau: '07695d97',
};
// Independently captured from the original 1db86ba engine on Linux Node 24.15.
const runtimeGoldenHashes =
  process.platform === 'linux' ? runtimeBaseline.ecology.linux : goldenHashes;
const settings: SimulationOptions = {
  doctrinePopulation: { balanced: 9, cooperative: 5, chaotic: 5 },
  enablePersonalities: true,
  personalityCountMinimum: 2,
  personalityCountMaximum: 4,
  personalityPool: aiPersonalityOrder,
  enableDoubleActions: true,
};
function record(
  score: number,
  extras: Partial<EcologyRecord> = {},
): EcologyRecord {
  return {
    game: 1,
    playerId: 'p',
    character: 'isaac',
    doctrine: 'balanced',
    gambler: true,
    score,
    beforeCrown: score,
    money: 10,
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
    ...extras,
  };
}
function smallSummary(scores: number[]) {
  const players = scores.map((score, i) => ({
    ...createRuntimePlayer({ id: `p${i}`, money: 10, score, isHuman: false }),
    characterId: 'isaac' as const,
  }));
  const collector = new NoiseEcologyCollector();
  collector.beginGame(
    1,
    [],
    players,
    new Map(
      players.map((p) => [
        p.id,
        { doctrine: 'balanced' as const, personalities: ['gambler' as const] },
      ]),
    ),
    [],
  );
  collector.endGame(players);
  return collector.summarize();
}
describe('T07 noise experiments and T09 read-only monitor', () => {
  it.each(characterOrder)(
    'matches the pre-research 1db86ba full fifteen-room state fingerprint for %s',
    (characterId) => {
      let state = startClientGame(characterId, 42);
      let hash = updateResearchFingerprint(0x811c9dc5, state);
      while (state.phase !== 'game_result') {
        const next = clientGameReducer(state, {
          type: 'submit_player_turn',
          turn: ecologyHumanTurn(state, 'pace_bid'),
        });
        if (next.phase === 'character_selection')
          throw new Error('Unexpected selection');
        hash = updateResearchFingerprint(hash, next);
        const advanced = clientGameReducer(next, { type: 'advance_room' });
        if (advanced.phase === 'character_selection')
          throw new Error('Unexpected selection');
        hash = updateResearchFingerprint(hash, advanced);
        state = advanced;
      }
      expect(hash.toString(16).padStart(8, '0')).toBe(
        runtimeGoldenHashes[characterId],
      );
    },
  );
  it('makes the explicit 15% research source exactly identical to production through the complete game', () => {
    const reducer = createClientResearchReducer(
      (p, f, rules, random, options) =>
        decideAiTurn(p, f, rules, random, {
          ...options,
          experiments: { gamblerQuoteNoiseRatio: 0.15 },
        }),
    );
    let baseline = startClientGame('eden', 20261012),
      research = startClientGame('eden', 20261012);
    while (baseline.phase !== 'game_result') {
      const turn = ecologyHumanTurn(baseline, 'pace_bid');
      const a = clientGameReducer(baseline, {
        type: 'submit_player_turn',
        turn,
      });
      const b = reducer(research, { type: 'submit_player_turn', turn });
      expect(b).toEqual(a);
      const x = clientGameReducer(a, { type: 'advance_room' });
      const y = reducer(b, { type: 'advance_room' });
      if (
        x.phase === 'character_selection' ||
        y.phase === 'character_selection'
      )
        throw new Error('Restart');
      baseline = x;
      research = y;
    }
    expect(research).toEqual(baseline);
  });
  it('keeps secret human actions out of experimental AI decisions and preserves input state', () => {
    const state = startClientGame('lost', 42),
      before = structuredClone(state);
    const reducer = createClientResearchReducer(
      (p, f, rules, random, options) =>
        decideAiTurn(p, f, rules, random, {
          ...options,
          experiments: { gamblerQuoteNoiseRatio: 0.1 },
        }),
    );
    const bid = reducer(state, {
      type: 'submit_player_turn',
      turn: {
        playerId: 'human',
        actions: [{ type: 'bid', group: 'A', amount: 20 }],
      },
    });
    const disrupt = reducer(state, {
      type: 'submit_player_turn',
      turn: {
        playerId: 'human',
        actions: [{ type: 'disrupt', group: 'B', amount: 20 }],
      },
    });
    if (
      bid.phase === 'character_selection' ||
      disrupt.phase === 'character_selection'
    )
      throw new Error('Restart');
    expect(bid.revealedAiDecisions).toEqual(disrupt.revealedAiDecisions);
    expect(state).toEqual(before);
  });
  it('does not bypass AI legality validation with a research source', () => {
    const reducer = createClientResearchReducer(
      (p, f, rules, random, options) => ({
        ...decideAiTurn(p, f, rules, random, options),
        turn: {
          playerId: p.id,
          actions: [{ type: 'bid', group: 'A', amount: p.money + 1 }],
        },
      }),
    );
    const state = startClientGame('isaac', 42);
    expect(() =>
      reducer(state, {
        type: 'submit_player_turn',
        turn: ecologyHumanTurn(state, 'pace_bid'),
      }),
    ).toThrow(/非法行动/);
    expect(state.phase).toBe('room_action');
  });
  it('changes only gambler quote noise, retaining non-gambler decisions and gambler suppression weights', () => {
    const player = startClientGame('isaac', 42).players[0]!;
    const plain = decideAiTurn(
      player,
      0,
      defaultRules,
      createSeededRandom(37),
      { personalities: ['adaptive'] },
    );
    const other = decideAiTurn(
      player,
      0,
      defaultRules,
      createSeededRandom(37),
      {
        personalities: ['adaptive'],
        experiments: { gamblerQuoteNoiseRatio: 0.1 },
      },
    );
    expect(other).toEqual(plain);
    const control = decideAiTurn(
      player,
      0,
      defaultRules,
      createSeededRandom(37),
      {
        personalities: ['gambler'],
        experiments: { gamblerQuoteNoiseRatio: 0.15 },
      },
    );
    const candidate = decideAiTurn(
      player,
      0,
      defaultRules,
      createSeededRandom(37),
      {
        personalities: ['gambler'],
        experiments: { gamblerQuoteNoiseRatio: 0.1 },
      },
    );
    expect(candidate.finalWeights).toEqual(control.finalWeights);
    expect(candidate.personalityMultipliers).toEqual(
      control.personalityMultipliers,
    );
  });
  it.each(['legacy', 'per-player-room'] as const)(
    'collects monitoring without altering existing %s reports',
    (randomization) => {
      const rules = { ...defaultRules, playerCount: 19 };
      const baseline = simulateAiGames(3, 42, rules, {
        ...settings,
        research: { randomization },
      });
      const observed = simulateAiGames(3, 42, rules, {
        ...settings,
        research: { randomization, collectNoiseEcology: true },
      });
      const { noiseEcology, ...research } = observed.research!;
      expect({ ...observed, research }).toEqual(baseline);
      expect(noiseEcology!.groups.all.players).toBe(57);
      const bosses = Object.entries(noiseEcology!.rooms).filter(([key]) =>
        key.endsWith(':boss'),
      );
      expect(bosses.reduce((sum, [, r]) => sum + r.decisions, 0)).toBe(171);
    },
  );
  it('uses the real client population, rooms and human champion accounting', () => {
    const report = simulateClientEcology(3, 42, 0.15, 'pace_bid');
    expect(report.groups.all.players).toBe(57);
    expect(report.doctrines.balanced!.players).toBe(27);
    expect(report.doctrines.cooperative!.players).toBe(15);
    expect(report.doctrines.chaotic!.players).toBe(15);
    expect(
      Object.values(report.rooms).reduce((sum, r) => sum + r.decisions, 0),
    ).toBe(855);
    expect(report.groups.all.winners + report.humanWins).toBe(
      report.allWinnerSlots,
    );
    expect(report.allWinnerSlots).toBeGreaterThanOrEqual(3);
    expect(
      characterOrder.reduce((sum, id) => sum + report.groups[id].players, 0),
    ).toBe(57);
    for (const floor of ['1', '2', '3']) {
      for (const field of ['decisions', 'noMoney'] as const) {
        expect(
          characterOrder.reduce(
            (sum, id) =>
              sum + (report.lateCharacters[`${floor}:${id}`]?.[field] ?? 0),
            0,
          ),
        ).toBe(report.late[floor]![field]);
      }
    }
  });
  it('keeps the fixed human policy independent from hidden rewards and legal at zero funds', () => {
    const state = startClientGame('isaac', 42);
    const first = ecologyHumanTurn(state, 'pace_bid');
    const other = structuredClone(state);
    other.rooms.forEach((floor) =>
      floor.forEach((room) =>
        room.rewards.forEach((reward) => {
          reward.hidden = true;
          reward.itemId = 'moms_heart';
        }),
      ),
    );
    expect(ecologyHumanTurn(other, 'pace_bid')).toEqual(first);
    other.players[0]!.money = 0;
    expect(ecologyHumanTurn(other, 'pace_bid').actions).toEqual([
      { type: 'withdraw' },
    ]);
    expect(ecologyHumanTurn(state, 'withdraw').actions).toEqual([
      { type: 'withdraw' },
    ]);
  });
  it('measures cooperation with market equivalent rather than scoring equivalent', () => {
    const player = {
      ...createRuntimePlayer({ id: 'p', money: 100, score: 0, isHuman: false }),
      characterId: 'isaac' as const,
    };
    grantItemInstance(player, {
      instanceId: 'vision',
      itemId: 'twenty_twenty',
      acquiredOrder: 1,
    });
    const room = getCurrentRoom(startClientGame('isaac', 42));
    const base = decideAiTurn(player, 0, defaultRules, createSeededRandom(42), {
      strategyMultipliers: {
        high_bid: 0,
        cooperate: 1,
        disrupt_high: 0,
        disrupt_cooperate: 0,
        withdraw: 0,
      },
      enableDoubleActions: false,
    });
    if (!base.quoteAnalysis) throw new Error('No quote');
    const decision = {
      ...base,
      strategy: 'cooperate' as const,
      turn: {
        playerId: 'p',
        actions: [{ type: 'bid' as const, group: 'A' as const, amount: 20 }],
      },
    };
    const settled = settleRuntimeRoom(
      room,
      [player],
      [decision.turn],
      defaultRules,
      createSeededRandom(42),
    );
    settled.baseline!.target = 35;
    settled.cooperationPlacements = [
      { playerId: 'p', group: 'A', actionType: 'bid' },
    ];
    expect(settled.resolvedActions[0]!.marketEquivalent).toBe(25);
    expect(settled.resolvedActions[0]!.scoringEquivalent).toBe(20);
    const collector = new NoiseEcologyCollector();
    collector.beginGame(
      1,
      [],
      [player],
      new Map([['p', { doctrine: 'balanced', personalities: ['gambler'] }]]),
      [],
    );
    collector.room(room, [player], [decision], settled);
    collector.endGame(settled.players);
    expect(collector.summarize().groups.gambler.coopHits).toBe(1);
    expect(collector.summarize().groups.gambler.coopPlacements).toBe(1);
  });
  it('separates crown-free score, final hearts and AI champions', () => {
    const player = {
      ...createRuntimePlayer({
        id: 'p',
        money: 10,
        score: 100,
        isHuman: false,
      }),
      characterId: 'isaac' as const,
    };
    grantItemInstance(player, {
      instanceId: 'crown',
      itemId: 'dark_princes_crown',
      acquiredOrder: 1,
    });
    grantItemInstance(player, {
      instanceId: 'heart',
      itemId: 'moms_heart',
      acquiredOrder: 2,
    });
    const collector = new NoiseEcologyCollector();
    collector.beginGame(
      1,
      [],
      [player],
      new Map([['p', { doctrine: 'chaotic', personalities: [] }]]),
      [],
    );
    collector.endGame([player]);
    const report = collector.summarize();
    expect(report.groups.heart1.players).toBe(1);
    expect(report.groups.heart1.beforeCrown.mean).toBe(100);
    expect(report.groups.heart1.score.mean).toBe(135);
    expect(report.groups.heart1.winners).toBe(1);
    expect(report.groups.heart2plus.players).toBe(0);
    expect(report.doctrines.chaotic!.championShareAmongAI).toBe(1);
  });
  it('pools actual score samples and denominator counts, not seed quantiles or rates', () => {
    const a = smallSummary([0, 0]),
      b = smallSummary([100]);
    const pooled = poolEcologyReports([a, b]);
    expect(pooled.groups.gambler!.quantiles.p50).toBe(0);
    expect(pooled.groups.gambler!.quantiles.p95).toBeCloseTo(90);
    expect(pooled.groups.gambler!.score.mean).toBeCloseTo(100 / 3);
    const stats = summarizeEcologyRecords([
      record(1, { quotes: 1, clamps: 0, coopAttempts: 1, coopHits: 1 }),
      record(2, { quotes: 9, clamps: 9, coopAttempts: 9, coopHits: 0 }),
    ]);
    expect(stats.clampRate).toBe(0.9);
    expect(stats.coopHitRate).toBe(0.1);
    expect(scoreQuantiles([])).toEqual({ p05: 0, p50: 0, p95: 0, p99: 0 });
  });
  it('pairs fixed gambler carriers by game and handles missing cohorts without fictitious precision', () => {
    const base = [
      { game: 1, players: 2, scoreSum: 10, winners: 0 },
      { game: 2, players: 1, scoreSum: 10, winners: 1 },
    ];
    const next = [
      { game: 1, players: 2, scoreSum: 12, winners: 1 },
      { game: 2, players: 1, scoreSum: 14, winners: 0 },
    ];
    const result = pairedGamblerDifference(base, next, 'scoreSum');
    expect(result.difference).toBe(2);
    expect(result.standardError).toBeCloseTo(4 / 3);
    expect(pairedGamblerDifference([], [], 'scoreSum').difference).toBeNull();
    expect(() => pairedGamblerDifference(base, [], 'winners')).toThrow();
    expect(() =>
      pairedGamblerDifference(
        base,
        [{ ...next[0]!, players: 3 }, next[1]!],
        'winners',
      ),
    ).toThrow();
  });
  it('runs repeatable multi-environment studies without changing formal personalities or rules', () => {
    const rules = structuredClone(defaultRules),
      pool = [...aiPersonalityOrder];
    const options = { gamesPerSeed: 1, seeds: [41, 42] };
    const first = runNoiseEcologyStudy(options);
    expect(first).toEqual(runNoiseEcologyStudy(options));
    for (const mode of Object.values(first.results)) {
      expect(mode.control15.pooled.groups.all!.players).toBe(38);
      expect(mode.candidate10.seeds.map((r) => r.fingerprint)).toEqual(
        mode.control15.seeds.map((r) => r.fingerprint),
      );
      expect(mode.control15.seeds[0]).not.toHaveProperty('samples');
    }
    expect(defaultRules).toEqual(rules);
    expect(aiPersonalityOrder).toEqual(pool);
    expect(first.formalChanged).toBe(false);
  });
  it('rejects invalid and overlapping study inputs without starting simulation', () => {
    for (const options of [
      { gamesPerSeed: 0, seeds: [1] },
      { gamesPerSeed: 1, seeds: [] },
      { gamesPerSeed: 1, seeds: [1, 1] },
      { gamesPerSeed: 2, seeds: [1, (1 + 0x9e3779b1) >>> 0] },
      { gamesPerSeed: 1, seeds: [1], modes: [] },
    ])
      expect(() => runNoiseEcologyStudy(options)).toThrow();
    expect(() => simulateClientEcology(0, 1, 0.15, 'pace_bid')).toThrow();
    expect(() => simulateClientEcology(1, 1, 0.2, 'pace_bid')).toThrow();
  });
});
