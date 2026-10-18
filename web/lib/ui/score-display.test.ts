import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { GameResult } from '@/components/game/game-result';
import { RoomRanking } from '@/components/game/room-ranking';
import { RoomResult } from '@/components/game/room-result';
import {
  clientGameReducer,
  startClientGame,
  type ActiveClientGameState,
} from '../game/client-session';
import { calculateFinalScore } from '../game/item-scoring';

function settledGame(): ActiveClientGameState {
  const state = clientGameReducer(startClientGame('isaac', 42), {
    type: 'submit_player_turn',
    turn: {
      playerId: 'human',
      actions: [{ type: 'bid', group: 'A', amount: 25 }],
    },
  });
  if (state.phase !== 'room_result') throw new Error('Expected settled game');
  return state;
}

describe('score display preferences do not change scoring', () => {
  it('reuses the same ranking page and table classes without needing a fabricated settlement', () => {
    const game = startClientGame('isaac', 42);
    const before = structuredClone(game);
    const markup = renderToStaticMarkup(
      createElement(RoomRanking, {
        variant: 'public',
        game,
        onReturn: () => {},
      }),
    );
    expect(markup).toContain('class="ranking-stage game-tools-stage"');
    expect(markup).toContain('class="result-table ranking-table"');
    expect(markup.match(/<th scope="col"(?:\s|>)/g)).toHaveLength(4);
    expect(markup).toContain('class="ranking-player-cell"');
    expect(markup).not.toMatch(
      /本轮行动|本房积分|获得道具|进入下一房间|<dialog/,
    );
    expect(game).toEqual(before);
  });

  it('uses the selected precision in result summaries and the already existing room ranking', () => {
    const game = settledGame();
    const before = structuredClone(game);
    const score = game.roomSettlement!.roomScoreSummaries.human!.finalScore;
    const total = game.players.find((player) => player.id === 'human')!.score;
    const result = renderToStaticMarkup(
      createElement(RoomResult, {
        game,
        onAdvance: () => {},
        onShowRanking: () => {},
        scoreDecimals: 4,
      }),
    ).replace(/<[^>]+>/g, '');
    const ranking = renderToStaticMarkup(
      createElement(RoomRanking, {
        game,
        onAdvance: () => {},
        onSwitch: () => {},
        scoreDecimals: 4,
      }),
    ).replace(/<[^>]+>/g, '');
    expect(result).toContain(`本房积分+${score.toFixed(4)}`);
    expect(result).toContain(`→本房积分 ${score.toFixed(4)}`);
    expect(ranking).toContain(total.toFixed(4));
    expect(game).toEqual(before);
    const table = renderToStaticMarkup(
      createElement(RoomRanking, {
        game,
        onAdvance: () => {},
        onSwitch: () => {},
      }),
    );
    expect(table).toContain('class="result-table ranking-table"');
    expect(table.match(/<th scope="col"(?:\s|>)/g)).toHaveLength(7);
  });

  it('uses the selected precision in the final hero, podium and table', () => {
    const active = settledGame();
    const game = {
      ...active,
      phase: 'game_result' as const,
      finalRanking: active.players
        .map((player) => ({
          playerId: player.id,
          finalScore: calculateFinalScore(player),
        }))
        .sort((a, b) => b.finalScore - a.finalScore),
    };
    const before = structuredClone(game);
    const markup = renderToStaticMarkup(
      createElement(GameResult, {
        game,
        onRestart: () => {},
        scoreDecimals: 4,
      }),
    );
    const text = markup.replace(/<[^>]+>/g, '');
    const humanScore = game.finalRanking.find(
      (entry) => entry.playerId === 'human',
    )!.finalScore;
    expect(text).toContain(`你以 ${humanScore.toFixed(4)} 分`);
    expect(text).toContain(game.finalRanking[0]!.finalScore.toFixed(4));
    expect(game).toEqual(before);
  });
});
