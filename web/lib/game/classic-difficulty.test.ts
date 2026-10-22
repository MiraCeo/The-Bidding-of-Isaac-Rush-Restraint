import { expect, it } from 'vitest';
import { startClientGame, clientGameReducer } from './client-session';
import {
  classicAiPolicy,
  classicDifficulties,
  readClassicAiSettings,
  classicReplayId,
} from './classic-difficulty';
import { defaultRules } from './config';
import { validateTurn } from './turns';
import type { ActiveClientGameState } from './client-session';
const settings = (difficulty: (typeof classicDifficulties)[number]) => ({
  policy: classicAiPolicy,
  difficulty,
});
const bid = (g: ActiveClientGameState) =>
  clientGameReducer(g, {
    type: 'submit_player_turn',
    turn: {
      playerId: 'human',
      actions: [{ type: 'bid', group: 'A', amount: 1 }],
    },
  }) as ActiveClientGameState;
it.each([42, 91, 31415])(
  'keeps highest exactly equal to original classic AI, seed %s, with no extra main-stream draws',
  (seed) => {
    let original = startClientGame('jacob_esau', seed),
      highest = startClientGame('jacob_esau', seed, settings('highest'));
    for (let i = 0; i < 15; i++) {
      const { classicAi: _ai, ...plain } = highest;
      expect(plain).toEqual(original);
      original = bid(original);
      highest = bid(highest);
      expect(highest.revealedAiDecisions).toEqual(original.revealedAiDecisions);
      original = clientGameReducer(original, {
        type: 'advance_room',
      }) as ActiveClientGameState;
      highest = clientGameReducer(highest, {
        type: 'advance_room',
      }) as ActiveClientGameState;
    }
    expect(highest.finalRanking).toEqual(original.finalRanking);
  },
  20000,
);
it('uses real deterministic tiered decisions while keeping roster, map and starting funds identical', () => {
  const first = classicDifficulties.map((d) =>
    startClientGame('isaac', 42, settings(d)),
  );
  for (const g of first) {
    expect(g.players).toEqual(first[0]!.players);
    expect(g.rooms).toEqual(first[0]!.rooms);
  }
  const samples = first.map((g) => bid(g));
  expect(
    new Set(samples.map((g) => JSON.stringify(g.pendingRoomTurns))).size,
  ).toBeGreaterThan(1);
  for (let i = 0; i < samples.length; i++)
    expect(
      bid(startClientGame('isaac', 42, settings(classicDifficulties[i]!))),
    ).toEqual(samples[i]);
});
it.each(classicDifficulties)(
  'does not consult the human secret target or amount at %s',
  (difficulty) => {
    const game = startClientGame('isaac', 91, settings(difficulty));
    const submit = (group: 'A' | 'B', amount: number) =>
      clientGameReducer(game, {
        type: 'submit_player_turn',
        turn: { playerId: 'human', actions: [{ type: 'bid', group, amount }] },
      }) as ActiveClientGameState;
    expect(submit('A', 1).revealedAiDecisions).toEqual(
      submit('B', 100).revealedAiDecisions,
    );
  },
);
it.each(classicDifficulties)(
  'produces only legal actions through fifteen rooms at %s without changing the locked setting',
  (difficulty) => {
    let g = startClientGame('isaac', 42, settings(difficulty));
    for (let i = 0; i < 15; i++) {
      const players = g.players;
      g = bid(g);
      for (const turn of g.pendingRoomTurns!)
        expect(
          validateTurn(
            players.find((p) => p.id === turn.playerId)!,
            turn,
            defaultRules,
          ),
        ).toEqual([]);
      expect(g.classicAi).toEqual(settings(difficulty));
      g = clientGameReducer(g, {
        type: 'advance_room',
      }) as ActiveClientGameState;
    }
    expect(g.phase).toBe('game_result');
  },
  20000,
);
it('validates policy/enum exactly and gives distinct replay identities while preserving legacy IDs', () => {
  const id = classicReplayId(42, 'isaac', '20-personality-client-1-818e3e55');
  expect(id).toBe('ISAAC-0000002a-isaac-818e3e55');
  expect(
    new Set(
      classicDifficulties.map((d) =>
        classicReplayId(
          42,
          'isaac',
          '20-personality-client-1-818e3e55',
          settings(d),
        ),
      ),
    ).size,
  ).toBe(4);
  for (const value of [
    null,
    { policy: classicAiPolicy, difficulty: 'impossible' },
    { policy: 'future', difficulty: 'highest' },
    { ...settings('easy'), forecastError: 99 },
  ])
    expect(() => readClassicAiSettings(value)).toThrow();
  const input = settings('easy'),
    g = startClientGame('isaac', 42, input);
  input.difficulty = 'highest';
  expect(g.classicAi!.difficulty).toBe('easy');
});
it('checks a bounded fixed-policy challenge sample without assuming per-match monotonic ranking', () => {
  const rows = classicDifficulties.map((difficulty) => {
    const ranks: number[] = [],
      scores: number[] = [];
    let bids = 0,
      disruptions = 0,
      withdrawals = 0;
    for (const seed of [42, 91, 31415, 7301, 8501, 9001]) {
      let g = startClientGame('isaac', seed, settings(difficulty));
      for (let i = 0; i < 15; i++) {
        const amount = Math.min(
          g.players.find((p) => p.isHuman)!.money,
          Math.round(defaultRules.floorStartingMoney[g.floorIndex]! * 0.25),
        );
        g = clientGameReducer(g, {
          type: 'submit_player_turn',
          turn: {
            playerId: 'human',
            actions: [
              amount > 0
                ? { type: 'bid', group: 'A', amount }
                : { type: 'withdraw' },
            ],
          },
        }) as ActiveClientGameState;
        for (const turn of g.pendingRoomTurns!.filter(
          (t) => t.playerId !== 'human',
        ))
          for (const action of turn.actions) {
            if (action.type === 'bid') bids++;
            else if (action.type === 'disrupt') disruptions++;
            else withdrawals++;
          }
        g = clientGameReducer(g, {
          type: 'advance_room',
        }) as ActiveClientGameState;
      }
      expect(g.phase).toBe('game_result');
      const rank = g.finalRanking!.findIndex((r) => r.playerId === 'human') + 1;
      expect(rank).toBeGreaterThan(0);
      ranks.push(rank);
      scores.push(g.finalRanking![rank - 1]!.finalScore);
    }
    return {
      difficulty,
      ranks,
      meanRank: ranks.reduce((a, b) => a + b, 0) / ranks.length,
      meanScore: scores.reduce((a, b) => a + b, 0) / scores.length,
      bids,
      disruptions,
      withdrawals,
    };
  });
  console.info('classic-tiered-1 fixed-policy sample:', JSON.stringify(rows));
}, 30000);
