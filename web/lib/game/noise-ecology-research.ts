import { decideAiTurn } from './ai-decision';
import { aiPersonalityOrder } from './ai-personality';
import { characterOrder } from './characters';
import { defaultRules } from './config';
import {
  createClientResearchReducer,
  getCurrentRoom,
  startClientGame,
  type ActiveClientGameState,
} from './client-session';
import type { PlayerTurn } from './item-types';
import {
  NoiseEcologyCollector,
  ecologyGroups,
  scoreQuantiles,
  type EcologyCluster,
  type EcologyProfile,
  type NoiseEcologySummary,
} from './noise-ecology-diagnostics';
import { simulateAiGames } from './simulation';
import { mergeResearchMetrics } from './balance-research';

export type EcologyMode = 'research19' | 'client_pace_bid' | 'client_withdraw';
export const ecologyModes: readonly EcologyMode[] = [
  'research19',
  'client_pace_bid',
  'client_withdraw',
];
const ratio = (a: number, b: number) => (b === 0 ? 0 : a / b);

/** Uses only public remaining money and location. Never chooses by hidden item ID or future outcome. */
export function ecologyHumanTurn(
  state: ActiveClientGameState,
  policy: 'pace_bid' | 'withdraw',
): PlayerTurn {
  const human = state.players.find((p) => p.isHuman)!;
  if (policy === 'withdraw' || human.money <= 0)
    return { playerId: 'human', actions: [{ type: 'withdraw' }] };
  const remainingRooms =
    state.rooms[state.floorIndex]!.length - state.roomIndex;
  const amount = Math.min(
    human.money,
    Math.max(1, Math.round(human.money / remainingRooms)),
  );
  return {
    playerId: 'human',
    actions: [
      {
        type: 'bid',
        group: (state.floorIndex * 5 + state.roomIndex) % 2 === 0 ? 'A' : 'B',
        amount,
      },
    ],
  };
}
export function simulateClientEcology(
  games: number,
  seed: number,
  noise: number,
  policy: 'pace_bid' | 'withdraw',
) {
  if (
    !Number.isInteger(games) ||
    games <= 0 ||
    (noise !== 0.1 && noise !== 0.15)
  )
    throw new RangeError('Invalid client ecology inputs.');
  const collector = new NoiseEcologyCollector();
  const reducer = createClientResearchReducer(
    (player, floor, rules, random, options) =>
      decideAiTurn(player, floor, rules, random, {
        ...options,
        experiments: { gamblerQuoteNoiseRatio: noise },
      }),
  );
  for (let i = 0; i < games; i += 1) {
    let state = startClientGame(
      characterOrder[i % characterOrder.length]!,
      (seed + i * 0x9e3779b1) >>> 0,
    );
    const profiles = new Map<string, EcologyProfile>(
      Object.entries(state.aiProfiles).map(([id, p]) => [
        id,
        { doctrine: p.doctrine, personalities: p.personalities },
      ]),
    );
    collector.beginGame(
      i + 1,
      state.rooms,
      state.players,
      profiles,
      Object.entries(state.aiProfiles).map(([id, p]) => [id, p.quoteProfile]),
    );
    while (state.phase !== 'game_result') {
      const room = getCurrentRoom(state);
      collector.entry(room, state.players);
      const next = reducer(state, {
        type: 'submit_player_turn',
        turn: ecologyHumanTurn(state, policy),
      });
      if (next.phase !== 'room_result' || !next.roomSettlement)
        throw new Error('Client did not settle.');
      collector.room(
        room,
        state.players,
        next.revealedAiDecisions,
        next.roomSettlement,
      );
      const advanced = reducer(next, { type: 'advance_room' });
      if (advanced.phase === 'character_selection')
        throw new Error('Unexpected restart.');
      state = advanced;
    }
    collector.endGame(state.players);
  }
  return collector.summarize();
}

export function pairedGamblerDifference(
  control: readonly EcologyCluster[],
  candidate: readonly EcologyCluster[],
  field: 'scoreSum' | 'winners',
) {
  if (control.length !== candidate.length)
    throw new Error('Unpaired ecology games.');
  const rows = control.map((base, i) => {
    const next = candidate[i]!;
    if (base.game !== next.game || base.players !== next.players)
      throw new Error('Gambler cohort drift.');
    return { players: base.players, delta: next[field] - base[field] };
  });
  const players = rows.reduce((sum, r) => sum + r.players, 0);
  const difference = ratio(
    rows.reduce((sum, r) => sum + r.delta, 0),
    players,
  );
  const sumSquares = rows.reduce(
    (sum, r) => sum + (r.delta - difference * r.players) ** 2,
    0,
  );
  const standardError =
    players > 0 && rows.length > 1
      ? Math.sqrt((rows.length / (rows.length - 1)) * sumSquares) / players
      : null;
  return {
    games: rows.length,
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

export function poolEcologyReports(reports: readonly NoiseEcologySummary[]) {
  const groups = Object.fromEntries(
    ecologyGroups.map((name) => {
      const rows = reports.map((r) => r.groups[name]);
      const counters = Object.fromEntries(
        (
          [
            'players',
            'winners',
            'actualCost',
            'quotes',
            'clamps',
            'secondaryQuotes',
            'secondaryClamps',
            'coopAttempts',
            'coopHits',
            'coopPlacements',
          ] as const
        ).map((key) => [key, rows.reduce((sum, r) => sum + r[key], 0)]),
      ) as Record<
        | 'players'
        | 'winners'
        | 'actualCost'
        | 'quotes'
        | 'clamps'
        | 'secondaryQuotes'
        | 'secondaryClamps'
        | 'coopAttempts'
        | 'coopHits'
        | 'coopPlacements',
        number
      >;
      return [
        name,
        {
          ...counters,
          score: mergeResearchMetrics(rows.map((r) => r.score)),
          beforeCrown: mergeResearchMetrics(rows.map((r) => r.beforeCrown)),
          money: mergeResearchMetrics(rows.map((r) => r.money)),
          quantiles: scoreQuantiles(reports.flatMap((r) => r.samples[name])),
          winnerRate: ratio(counters.winners!, counters.players!),
          clampRate: ratio(counters.clamps!, counters.quotes!),
          secondaryClampRate: ratio(
            counters.secondaryClamps!,
            counters.secondaryQuotes!,
          ),
          coopHitRate: ratio(counters.coopHits!, counters.coopAttempts!),
          coopPlacementRate: ratio(
            counters.coopPlacements!,
            counters.coopAttempts!,
          ),
        },
      ];
    }),
  );
  const rooms = Object.fromEntries(
    [...new Set(reports.flatMap((r) => Object.keys(r.rooms)))].map((key) => [
      key,
      Object.fromEntries(
        (
          [
            'decisions',
            'participated',
            'noMoney',
            'initialSum',
            'retroSum',
            'finalSum',
          ] as const
        ).map((field) => [
          field,
          reports.reduce((sum, r) => sum + (r.rooms[key]?.[field] ?? 0), 0),
        ]),
      ),
    ]),
  );
  const late = Object.fromEntries(
    ['1', '2', '3'].map((key) => [
      key,
      Object.fromEntries(
        (['decisions', 'noMoney'] as const).map((field) => [
          field,
          reports.reduce((sum, r) => sum + (r.late[key]?.[field] ?? 0), 0),
        ]),
      ),
    ]),
  );
  const aiWinnerSlots = reports.reduce(
    (sum, r) => sum + r.groups.all.winners,
    0,
  );
  const players = reports.reduce((sum, r) => sum + r.groups.all.players, 0);
  const lateCharacters = Object.fromEntries(
    [...new Set(reports.flatMap((r) => Object.keys(r.lateCharacters)))].map(
      (key) => [
        key,
        Object.fromEntries(
          (['decisions', 'noMoney'] as const).map((field) => [
            field,
            reports.reduce(
              (sum, r) => sum + (r.lateCharacters[key]?.[field] ?? 0),
              0,
            ),
          ]),
        ),
      ],
    ),
  );
  const doctrines = Object.fromEntries(
    (['balanced', 'cooperative', 'chaotic'] as const).map((name) => {
      const rows = reports.map((r) => r.doctrines[name]!);
      const count = rows.reduce((sum, r) => sum + r.players, 0),
        winners = rows.reduce((sum, r) => sum + r.winners, 0);
      return [
        name,
        {
          players: count,
          winners,
          winnerRate: ratio(winners, count),
          championShareAmongAI: ratio(winners, aiWinnerSlots),
          populationShare: ratio(count, players),
        },
      ];
    }),
  );
  return {
    games: reports.reduce((sum, r) => sum + r.games, 0),
    groups,
    rooms,
    late,
    lateCharacters,
    doctrines,
    humanWins: reports.reduce((sum, r) => sum + r.humanWins, 0),
    allWinnerSlots: reports.reduce((sum, r) => sum + r.allWinnerSlots, 0),
  };
}

export function runNoiseEcologyStudy(options: {
  gamesPerSeed: number;
  seeds: readonly number[];
  modes?: readonly EcologyMode[];
  onProgress?: (mode: EcologyMode, noise: number, seed: number) => void;
}) {
  const modes = options.modes ?? ecologyModes;
  if (
    !Number.isInteger(options.gamesPerSeed) ||
    options.gamesPerSeed <= 0 ||
    !options.seeds.length ||
    new Set(options.seeds).size !== options.seeds.length ||
    options.seeds.some(
      (s) => !Number.isInteger(s) || s < 0 || s > 0xffffffff,
    ) ||
    !modes.length ||
    new Set(modes).size !== modes.length ||
    modes.some((m) => !ecologyModes.includes(m))
  )
    throw new RangeError('Invalid noise ecology inputs.');
  const worlds = new Set<number>();
  for (const seed of options.seeds)
    for (let i = 0; i < options.gamesPerSeed; i += 1) {
      const gameSeed = (seed + i * 0x9e3779b1) >>> 0;
      if (worlds.has(gameSeed))
        throw new RangeError('Overlapping ecology worlds.');
      worlds.add(gameSeed);
    }
  const results = Object.fromEntries(
    modes.map((mode) => {
      const run = (noise: number) =>
        options.seeds.map((seed) => {
          const report =
            mode === 'research19'
              ? simulateAiGames(
                  options.gamesPerSeed,
                  seed,
                  { ...defaultRules, playerCount: 19 },
                  {
                    doctrinePopulation: {
                      balanced: 9,
                      cooperative: 5,
                      chaotic: 5,
                    },
                    enablePersonalities: true,
                    personalityPool: aiPersonalityOrder,
                    personalityCountMinimum: 2,
                    personalityCountMaximum: 4,
                    enableSituationAnalysis: true,
                    enableItemAnalysis: true,
                    enableDoubleActions: true,
                    research: {
                      randomization: 'per-player-room',
                      gamblerQuoteNoiseRatio: noise,
                      collectNoiseEcology: true,
                    },
                  },
                ).research!.noiseEcology!
              : simulateClientEcology(
                  options.gamesPerSeed,
                  seed,
                  noise,
                  mode === 'client_pace_bid' ? 'pace_bid' : 'withdraw',
                );
          options.onProgress?.(mode, noise, seed);
          return { seed, report };
        });
      const control = run(0.15),
        candidate = run(0.1);
      candidate.forEach((r, i) => {
        if (r.report.fingerprint !== control[i]!.report.fingerprint)
          throw new Error('Exogenous ecology drift.');
      });
      const pair = (
        base: NoiseEcologySummary[],
        next: NoiseEcologySummary[],
      ) => ({
        score: pairedGamblerDifference(
          base.flatMap((r) => r.clusters),
          next.flatMap((r) => r.clusters),
          'scoreSum',
        ),
        winnerRate: pairedGamblerDifference(
          base.flatMap((r) => r.clusters),
          next.flatMap((r) => r.clusters),
          'winners',
        ),
      });
      const compact = (rows: typeof control) => ({
        pooled: poolEcologyReports(rows.map((r) => r.report)),
        seeds: rows.map(
          ({ seed, report: { samples: _, clusters: __, ...report } }) => ({
            seed,
            ...report,
          }),
        ),
      });
      return [
        mode,
        {
          control15: compact(control),
          candidate10: compact(candidate),
          paired: {
            pooled: pair(
              control.map((r) => r.report),
              candidate.map((r) => r.report),
            ),
            seeds: options.seeds.map((seed, i) => ({
              seed,
              ...pair([control[i]!.report], [candidate[i]!.report]),
            })),
          },
        },
      ];
    }),
  );
  return {
    gamesPerSeed: options.gamesPerSeed,
    seeds: [...options.seeds],
    modes: [...modes],
    noises: [0.15, 0.1],
    excluded: ['all_in'],
    formalChanged: false,
    results,
  };
}
