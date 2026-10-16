import { Dialog } from '@base-ui/react/dialog';
import { Check, X } from 'lucide-react';
import { characterCatalog } from '@/lib/game';
import {
  achievementCategories,
  characterAchievementRequirements,
  type AchievementDefinition,
  type AchievementId,
  achievementCatalog,
} from '@/lib/ui/achievements/catalog';
import { achievementDetailPresentation } from '@/lib/ui/achievements/detail-presentation';
import { achievementNumber } from '@/lib/ui/achievements/numbering';
import { achievementCollectionNotes } from '@/lib/ui/achievements/collection-notes';
import {
  achievementCollectionMetadata,
  achievementTierLabels,
} from '@/lib/ui/achievements/collection-metadata';
import { AchievementBadge } from './achievement-badge';

/** Shared conditions once, independent rows/time preserved; browsing never writes. */
export function AchievementDetail({
  definition: a,
  progress,
  achievedAt,
  onShowRules,
  series,
  allProgress = {},
  allAchieved = {},
}: {
  definition: AchievementDefinition;
  progress: number;
  achievedAt?: string;
  onShowRules: () => void;
  series?: { name: string; ids: readonly AchievementId[] };
  allProgress?: Partial<Record<AchievementId, number>>;
  allAchieved?: Partial<Record<AchievementId, string>>;
}) {
  const ids = series?.ids ?? [a.id];
  const roles = characterCatalog.filter((c) =>
    characterAchievementRequirements[c.id].some((id) => ids.includes(id)),
  );
  const copy = achievementDetailPresentation(a);
  const scope =
    a.scope === 'shared'
      ? '经典 / 生存'
      : a.scope === 'classic'
        ? '经典模式'
        : '生存模式';
  return (
    <>
      <div className="achievement-detail-heading">
        <AchievementBadge id={a.id} achieved={!!achievedAt} />
        <div>
          <span className="achievement-eyebrow">
            {achievementNumber(a.id)} ·{' '}
            {achievementCategories.find((c) => c.id === a.category)!.name}
          </span>
          <Dialog.Title>{series?.name ?? a.name}</Dialog.Title>
          <div className="achievement-detail-meta">
            <span className="achievement-detail-state">
              {series
                ? `已获 ${series.ids.filter((id) => allAchieved[id]).length} / ${series.ids.length}`
                : achievedAt
                  ? '已达成'
                  : '未达成'}
            </span>
            <span>{scope}</span>
            {achievementCollectionMetadata[a.id].hidden && (
              <span>隐藏成就</span>
            )}
          </div>
        </div>
        <Dialog.Close
          className="achievement-detail-close"
          aria-label="关闭成就详情"
        >
          <X aria-hidden="true" size={20} />
        </Dialog.Close>
      </div>
      <Dialog.Description className="achievement-detail-condition">
        {copy.summary}
      </Dialog.Description>
      {series ? (
        <section
          className="achievement-series-detail"
          aria-label="三级独立徽章"
        >
          <ol>
            {series.ids.map((id) => {
              const level = achievementCatalog.find((d) => d.id === id)!,
                at = allAchieved[id];
              return (
                <li
                  key={id}
                  data-achievement-id={id}
                  data-achievement-number={achievementNumber(id)}
                  data-tier={achievementCollectionMetadata[id].tier}
                  data-selected={id === a.id}
                  data-achieved={!!at}
                  aria-label={level.name}
                  aria-description={`${achievementTierLabels[achievementCollectionMetadata[id].tier]}徽章 · ${achievementNumber(id)}`}
                >
                  <div className="achievement-stage-heading">
                    <AchievementBadge id={id} achieved={!!at} />
                    <h3 title={level.name}>{series.name}</h3>
                  </div>
                  {at && (
                    <blockquote
                      className="achievement-stage-note"
                      data-note-id={id}
                    >
                      {achievementCollectionNotes[id]}
                    </blockquote>
                  )}
                  {!at && (
                    <>
                      <span
                        className="achievement-level-progress"
                        aria-label={`${level.name}${level.kind === 'same-match' ? '单局最高进度' : '已记录进度'}`}
                      >
                        {allProgress[id] ?? 0} / {level.target}
                        {copy.unit}
                      </span>
                      <progress
                        aria-label={`${level.name}进度`}
                        value={Math.min(allProgress[id] ?? 0, level.target)}
                        max={level.target}
                      />
                    </>
                  )}
                  {at && (
                    <span
                      className="sr-only achievement-level-progress"
                      aria-label={`${level.name}已记录进度`}
                    >
                      {allProgress[id] ?? 0} / {level.target}
                      {copy.unit}
                    </span>
                  )}
                  <div className="achievement-level-state">
                    {at ? (
                      <>
                        <span className="achievement-level-earned">
                          <Check size={13} aria-hidden="true" />
                          已达成
                        </span>
                        <details className="achievement-time">
                          <summary>
                            <time dateTime={at}>
                              {new Date(at).toLocaleDateString('zh-CN')}
                            </time>
                          </summary>
                          <span className="achievement-exact-time">
                            {new Date(at).toLocaleString('zh-CN')}
                          </span>
                        </details>
                      </>
                    ) : (
                      <span className="sr-only">未达成</span>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
        </section>
      ) : (
        <div className="achievement-single-unit">
          {achievedAt && (
            <blockquote className="achievement-stage-note" data-note-id={a.id}>
              {achievementCollectionNotes[a.id]}
            </blockquote>
          )}
          <dl className="achievement-detail-facts">
            <div>
              <dt>{a.kind === 'same-match' ? '单局最高进度' : '已记录进度'}</dt>
              <dd>
                {progress} / {a.target}
              </dd>
            </div>
            {achievedAt && (
              <div>
                <dt>达成时间</dt>
                <dd>
                  <time dateTime={achievedAt}>
                    {new Date(achievedAt).toLocaleString('zh-CN')}
                  </time>
                </dd>
              </div>
            )}
          </dl>
        </div>
      )}
      {roles.length > 0 && (
        <section
          className="achievement-role-requirements"
          aria-label="角色解锁前置"
        >
          {roles.map((c) => (
            <p key={c.id}>
              {c.name}前置：
              {characterAchievementRequirements[c.id]
                .map(
                  (id) =>
                    `${achievementNumber(id)} ${achievementCatalog.find((d) => d.id === id)!.name}`,
                )
                .join(' + ')}
              。
            </p>
          ))}
        </section>
      )}
      <details className="achievement-detail-note">
        <summary>判定细则</summary>
        {copy.rules.map((rule) => (
          <p key={rule}>{rule}</p>
        ))}
      </details>
      <footer className="achievement-detail-footer">
        <button
          type="button"
          className="achievement-system-rules-link"
          onClick={onShowRules}
        >
          查看通用统计规则
        </button>
        <Dialog.Close className="achievement-detail-done">关闭</Dialog.Close>
      </footer>
    </>
  );
}
