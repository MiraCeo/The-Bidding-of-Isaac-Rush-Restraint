import { Trophy } from 'lucide-react';
import {
  achievementCatalog,
  type AchievementId,
} from '@/lib/ui/achievements/catalog';
import {
  achievementCollectionMetadata,
  achievementTierLabels,
} from '@/lib/ui/achievements/collection-metadata';
import { achievementCollectionNotes } from '@/lib/ui/achievements/collection-notes';
import { AchievementBadge } from './achievement-badge';

/** Ephemeral saved-only feedback. No timer, focus capture, storage or awarding. */
export function AchievementNotice({
  ids,
  onDismiss,
}: {
  ids: readonly AchievementId[];
  onDismiss: () => void;
}) {
  const entries = [...new Set(ids)].flatMap((id) => {
    const a = achievementCatalog.find((a) => a.id === id);
    return a ? [a] : [];
  });
  if (!entries.length) return null;
  return (
    <aside className="achievement-notice" aria-label="新成就已保存">
      <output className="sr-only" aria-live="polite" aria-atomic="true">
        成就已保存：
        {entries
          .map(
            (a) =>
              achievementTierLabels[achievementCollectionMetadata[a.id].tier] +
              '徽章 ' +
              a.name,
          )
          .join('、')}
      </output>
      <header className="achievement-notice-heading">
        <Trophy size={19} aria-hidden="true" />
        <div>
          <strong>成就达成 · {entries.length} 枚新徽章</strong>
          <span>已保存</span>
        </div>
        <button type="button" onClick={onDismiss}>
          知道了
        </button>
      </header>
      <ul className="achievement-notice-list">
        {entries.slice(0, 2).map((a) => {
          const tier = achievementCollectionMetadata[a.id].tier;
          return (
            <li className="achievement-notice-item" key={a.id} data-tier={tier}>
              <AchievementBadge id={a.id} achieved />
              <div>
                <span className="achievement-notice-title">
                  <strong>{a.name}</strong>
                </span>
                <p>{achievementCollectionNotes[a.id]}</p>
              </div>
            </li>
          );
        })}
      </ul>
      {entries.length > 2 && (
        <details className="achievement-notice-more">
          <summary>查看其余 {entries.length - 2} 枚徽章</summary>
          <ul className="achievement-notice-list">
            {entries.slice(2).map((a) => (
              <li
                className="achievement-notice-item"
                key={a.id}
                data-tier={achievementCollectionMetadata[a.id].tier}
              >
                <AchievementBadge id={a.id} achieved />
                <div>
                  <strong>{a.name}</strong>
                  <p>{achievementCollectionNotes[a.id]}</p>
                </div>
              </li>
            ))}
          </ul>
        </details>
      )}
    </aside>
  );
}
