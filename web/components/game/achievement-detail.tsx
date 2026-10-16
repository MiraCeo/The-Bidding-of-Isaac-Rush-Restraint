import { Dialog } from '@base-ui/react/dialog';
import { X } from 'lucide-react';
import { characterCatalog } from '@/lib/game';
import {
  achievementCategories,
  characterAchievementRequirements,
  type AchievementDefinition,
  type AchievementId,
  achievementCatalog,
} from '@/lib/ui/achievements/catalog';
import { achievementPresentation } from '@/lib/ui/achievements/presentation';
import { achievementNumber } from '@/lib/ui/achievements/numbering';
import { achievementCollectionNotes } from '@/lib/ui/achievements/collection-notes';
import {
  achievementCollectionMetadata,
  achievementTierLabels,
} from '@/lib/ui/achievements/collection-metadata';
import { AchievementBadge } from './achievement-badge';

/** Full saved metadata stays here; the collection only needs a compact summary. */
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
  const roles = characterCatalog.filter((c) =>
    characterAchievementRequirements[c.id].includes(a.id),
  );
  return (
    <>
      <div className="achievement-detail-heading">
        <AchievementBadge id={a.id} achieved={!!achievedAt} />
        <div>
          <span className="achievement-eyebrow">
            {achievementNumber(a.id)} ·{' '}
            {achievementCategories.find((c) => c.id === a.category)!.name}
          </span>
          <Dialog.Title>{a.name}</Dialog.Title>
          <span className="achievement-detail-state">
            {achievedAt ? '已达成' : '未达成'}
          </span>
        </div>
        <Dialog.Close
          className="achievement-detail-close"
          aria-label="关闭成就详情"
        >
          <X aria-hidden="true" size={20} />
        </Dialog.Close>
      </div>
      <Dialog.Description className="achievement-detail-condition">
        {a.condition}
      </Dialog.Description>
      <dl className="achievement-detail-facts">
        <div>
          <dt>徽章等级</dt>
          <dd>
            <span
              className="achievement-tier"
              data-tier={achievementCollectionMetadata[a.id].tier}
            >
              {achievementTierLabels[achievementCollectionMetadata[a.id].tier]}
              徽章
            </span>
          </dd>
        </div>
        {achievementCollectionMetadata[a.id].hidden && (
          <div>
            <dt>展示属性</dt>
            <dd>
              隐藏成就 · 未达成时列表隐藏名称与专属图标，详情可查看真实条件。
            </dd>
          </div>
        )}
        <div>
          <dt>适用模式</dt>
          <dd>
            {a.scope === 'shared'
              ? '正式经典 / 生存通用'
              : a.scope === 'classic'
                ? '仅正式经典模式'
                : '仅正式生存模式'}
          </dd>
        </div>
        <div>
          <dt>{a.kind === 'same-match' ? '单局最高进度' : '已记录进度'}</dt>
          <dd>
            {progress} / {a.target}
          </dd>
        </div>
        <div>
          <dt>达成时间</dt>
          <dd>
            {achievedAt ? (
              <time dateTime={achievedAt}>
                {new Date(achievedAt).toLocaleString('zh-CN')}
              </time>
            ) : (
              '尚未达成'
            )}
          </dd>
        </div>
        <div>
          <dt>角色关联</dt>
          <dd>{roles.map((c) => c.name).join('、') || '无 · 收藏挑战'}</dd>
        </div>
      </dl>
      <section className="achievement-detail-note">
        <h4>判定说明</h4>
        <p>{achievementPresentation[a.id].note}</p>
        {roles.map((c) => (
          <p key={c.id}>
            {c.name}前置：
            {characterAchievementRequirements[c.id]
              .map(
                (id) =>
                  `${achievementNumber(id)} ${achievementCatalog.find((a) => a.id === id)!.name}`,
              )
              .join(' + ')}
            。
          </p>
        ))}
      </section>
      {series && (
        <section
          className="achievement-series-detail"
          aria-label="三级独立徽章"
        >
          <h4>
            {series.name} · 已获{' '}
            {series.ids.filter((id) => allAchieved[id]).length} / 3
          </h4>
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
                >
                  <div>
                    <strong>
                      {
                        achievementTierLabels[
                          achievementCollectionMetadata[id].tier
                        ]
                      }
                      徽章 · {achievementNumber(id)}
                    </strong>
                    <span>{at ? '已达成' : '未达成'}</span>
                  </div>
                  <p>{level.condition}</p>
                  <p>
                    已记录进度：{allProgress[id] ?? 0} / {level.target}
                  </p>
                  {at ? (
                    <time dateTime={at}>
                      {new Date(at).toLocaleString('zh-CN')}
                    </time>
                  ) : (
                    <p>尚未达成</p>
                  )}
                  <h5>收藏札记</h5>
                  {at ? (
                    <blockquote>{achievementCollectionNotes[id]}</blockquote>
                  ) : (
                    <p>达成后解锁</p>
                  )}
                </li>
              );
            })}
          </ol>
        </section>
      )}
      {!series && (
        <section className="achievement-collection-note" aria-label="收藏札记">
          <h4>收藏札记</h4>
          {achievedAt ? (
            <blockquote>{achievementCollectionNotes[a.id]}</blockquote>
          ) : (
            <p>达成后解锁</p>
          )}
        </section>
      )}
      <button
        type="button"
        className="achievement-system-rules-link"
        onClick={onShowRules}
      >
        查看通用统计规则
      </button>
      <Dialog.Close className="achievement-detail-done">返回列表</Dialog.Close>
    </>
  );
}
