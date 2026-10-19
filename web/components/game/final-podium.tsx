import type { ReactNode } from 'react';
import { Crown } from 'lucide-react';
import { characterNames, type CharacterId } from '@/lib/game';
import { CharacterArt } from './character-art';

export interface FinalPodiumEntry {
  playerId: string;
  name: string;
  characterId: CharacterId | null;
  score: number;
  itemCount: number;
  status?: { label: string; active: boolean };
}

export function FinalPodium({
  entries,
  decimals,
  title = '本局领奖台',
  caption = 'TOP 3',
  hasChampion = true,
}: {
  entries: readonly FinalPodiumEntry[];
  decimals: 2 | 4;
  title?: string;
  caption?: ReactNode;
  hasChampion?: boolean;
}) {
  return (
    <section className="classic-final-awards" aria-label={title}>
      <header className="podium-heading">
        <h3>
          <Crown aria-hidden="true" />
          {title}
        </h3>
        <span>{caption}</span>
      </header>
      <div className="podium-grid">
        {entries.slice(0, 3).map((entry, index) => (
          <article
            key={entry.playerId}
            className={`podium-card podium-${index + 1}`}
            data-podium-player={entry.playerId}
            aria-label={`第${index + 1}名 ${entry.name}`}
          >
            <div className="podium-model">
              {entry.characterId && (
                <CharacterArt characterId={entry.characterId} />
              )}
            </div>
            <div className="podium-step">
              <span className="podium-rank">
                {index === 0 && hasChampion && <Crown aria-hidden="true" />}
                <b>{index + 1}</b>
              </span>
            </div>
            <h3>{entry.name}</h3>
            <p>
              {entry.characterId
                ? characterNames[entry.characterId]
                : '未知角色'}
            </p>
            <strong>{entry.score.toFixed(decimals)}</strong>
            <small>
              {entry.itemCount} 件道具
              {entry.status && (
                <span
                  className={
                    entry.status.active ? 'complete-alive' : 'complete-out'
                  }
                >
                  {' '}
                  · {entry.status.label}
                </span>
              )}
            </small>
          </article>
        ))}
      </div>
    </section>
  );
}
