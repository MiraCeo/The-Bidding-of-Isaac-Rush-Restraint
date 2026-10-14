import { characterNames } from '../game/characters';
import type { ActiveClientGameState } from '../game/client-session';

export type PublicRankingView = 'score' | 'money';

export interface PublicRankingEntry {
  playerId: string;
  name: string;
  characterName: string;
  isHuman: boolean;
  score: number;
  money: number;
  rank: number;
}

/** A public projection: never return hidden rewards, draft turns or AI analysis. */
export function getPublicPlayerRanking(
  game: ActiveClientGameState,
  view: PublicRankingView,
): PublicRankingEntry[] {
  const entries = game.players
    .map((player) => ({
      playerId: player.id,
      name:
        player.id === game.humanPlayerId
          ? '你'
          : (game.aiProfiles[player.id]?.name ?? player.id),
      characterName: player.characterId
        ? characterNames[player.characterId]
        : '未知角色',
      isHuman: player.id === game.humanPlayerId,
      score: player.score,
      money: player.money,
      rank: 0,
    }))
    .sort((left, right) => right[view] - left[view]);

  entries.forEach((entry, index) => {
    const previous = entries[index - 1];
    entry.rank =
      previous && previous[view] === entry[view] ? previous.rank : index + 1;
  });
  return entries;
}
