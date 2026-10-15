import { Dialog } from '@base-ui/react/dialog';
import { X } from 'lucide-react';
import { characterCatalog } from '@/lib/game';
import {
  achievementCategories,
  characterAchievementRequirements,
  type AchievementDefinition,
} from '@/lib/ui/achievements/catalog';
import { achievementPresentation } from '@/lib/ui/achievements/presentation';
import { AchievementBadge } from './achievement-badge';

/** Full saved metadata stays here; the collection only needs a compact summary. */
export function AchievementDetail({
  definition: a,
  progress,
  achievedAt,
}: {
  definition: AchievementDefinition;
  progress: number;
  achievedAt?: string;
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
            {a.id} ·{' '}
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
          <dt>适用模式</dt>
          <dd>
            {a.scope === 'shared' ? '正式经典 / 生存通用' : '仅正式生存模式'}
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
        {roles.length > 0 && (
          <p>
            6项角色前置之一。需完成该角色的全部前置成就；一键解锁仅改变角色权限，不完成任何前置。
          </p>
        )}
        <p>
          仅统计真人的新正式结算，不计教学或AI个人成就。只读回放、重复导入、恢复及重复登记不额外增加进度；旧历史不补发。明确替换档案可回到快照。
        </p>
      </section>
      <Dialog.Close className="achievement-detail-done">返回列表</Dialog.Close>
    </>
  );
}
