import { describe, expect, it } from 'vitest';

import { startClientGame } from '../game/client-session';
import { getPublicPlayerRanking } from './public-ranking';

describe('public ranking projection', () => {
  it('returns twenty players with the human highlighted and exact-score shared ranks', () => {
    const game = startClientGame('isaac', 42);
    game.players[0]!.score = 123.4567;
    game.players[1]!.score = 123.4567;
    game.players[2]!.score = 50;
    const ranking = getPublicPlayerRanking(game, 'score');
    expect(ranking).toHaveLength(20);
    expect(ranking.slice(0, 3).map((entry) => entry.rank)).toEqual([1, 1, 3]);
    expect(ranking[0]).toMatchObject({
      playerId: 'human',
      name: '你',
      isHuman: true,
      score: 123.4567,
    });
  });

  it('sorts money without using score, rounded text or random tie breaking', () => {
    const game = startClientGame('isaac', 42);
    game.players.forEach((player, index) => {
      player.money = index;
      player.score = 1000 - index;
    });
    const ranking = getPublicPlayerRanking(game, 'money');
    expect(ranking[0]?.playerId).toBe('ai-19');
    expect(ranking.at(-1)?.playerId).toBe('human');
    expect(getPublicPlayerRanking(game, 'money')).toEqual(ranking);
  });

  it('does not mutate the game or expose secret actions, rewards, profiles or effects', () => {
    const game = startClientGame('eden', 99);
    const before = structuredClone(game);
    const entries = getPublicPlayerRanking(game, 'score');
    expect(Object.keys(entries[0]!)).toEqual([
      'playerId',
      'name',
      'characterName',
      'isHuman',
      'score',
      'money',
      'rank',
    ]);
    expect(JSON.stringify(entries)).not.toMatch(
      /quoteProfile|personalities|items|pendingRoomTurns|rooms|rewards/,
    );
    expect(game).toEqual(before);
  });
});
