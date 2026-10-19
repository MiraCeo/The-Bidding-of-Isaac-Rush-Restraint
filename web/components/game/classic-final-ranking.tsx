import type { ActiveClientGameState } from '@/lib/game';
import type { ScoreDisplayDecimals } from '@/lib/ui/game-preferences';
import { FinalPlayerRanking } from './final-player-ranking';

/** Compare adjacent recorded entries, never resort or infer a tied placing. */
export function classicFinalGapLabel(
  score: number,
  previous: number | undefined,
  decimals: ScoreDisplayDecimals,
) {
  if (previous === undefined) return '榜首';
  const gap = previous - score;
  if (gap === 0) return '与上一名同分';
  const magnitude = Math.abs(gap);
  const value = magnitude.toFixed(decimals);
  if (Number(value) === 0)
    return `${gap > 0 ? '距上一名' : '较上一名高'}不足${(10 ** -decimals).toFixed(decimals)}分`;
  return `${gap > 0 ? '距上一名差' : '较上一名高'}${value}分`;
}

export function ClassicFinalRanking({
  game,
  scoreDecimals,
}: {
  game: ActiveClientGameState;
  scoreDecimals: ScoreDisplayDecimals;
}) {
  const players = new Map(game.players.map((player) => [player.id, player]));
  return (
    <FinalPlayerRanking
      scoreDecimals={scoreDecimals}
      rows={game.finalRanking.map((entry, index) => ({
        ...entry,
        rank: index + 1,
        name:
          entry.playerId === game.humanPlayerId
            ? '你'
            : (game.aiProfiles[entry.playerId]?.name ?? entry.playerId),
        isHuman: entry.playerId === game.humanPlayerId,
        player: players.get(entry.playerId),
        profile: game.aiProfiles[entry.playerId],
        gapLabel: classicFinalGapLabel(
          entry.finalScore,
          game.finalRanking[index - 1]?.finalScore,
          scoreDecimals,
        ),
      }))}
    />
  );
}
