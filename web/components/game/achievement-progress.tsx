import { useMemo } from 'react';
import { Button } from '@/components/ui/button';
import type { PlayerProfile } from '@/lib/ui/player-profile';
import { characterCatalog } from '@/lib/game';
import {
  achievementCatalog,
  achievementCategories,
  characterAchievementRequirements,
} from '@/lib/ui/achievements/catalog';
import { projectAchievementRegistry } from '@/lib/ui/achievements/registry';
import { useCharacterAccess } from './use-character-access';

/** Read-only catalog/projection. Merely visiting this page never activates or awards. */
export function AchievementProgress({
  profile,
  message = '',
}: {
  profile: PlayerProfile;
  message?: string;
}) {
  const access = useCharacterAccess(false);
  const projection = useMemo(() => {
    try {
      return {
        view: message ? null : projectAchievementRegistry(profile),
        error: message,
      };
    } catch (error) {
      return {
        view: null,
        error:
          error instanceof Error
            ? error.message
            : '成就档案未核验，原资料保留。',
      };
    }
  }, [profile, message]);
  if (projection.error)
    return (
      <section className="settings-group">
        <h3>成就暂不可核验</h3>
        <output className="save-message">{projection.error}</output>
        <p>
          未将未知资料显示为零进度，也未重置档案；可在存档与备份中恢复有效快照。
        </p>
      </section>
    );
  const view = projection.view,
    achieved = view?.achievedAt ?? {},
    completed = Object.keys(achieved).length;
  return (
    <section className="achievement-progress" aria-label="成就与角色解锁">
      <header className="settings-group">
        <h3>成就 · {completed} / 30</h3>
        <p>
          6类成就，6项角色前置与24项收藏挑战。A–E在正式经典与生存间累计，F仅生存；不统计教学、AI个人事件或旧历史。
        </p>
        {!view && <p>尚无0.5成长记账；此处仅展示目录，不读取旧对局补发。</p>}
        <p>
          以下只展示已成功保存的进度；同局型展示已记录的单局最高进度，不代表当前连续数。
        </p>
      </header>
      <section
        className="settings-group"
        aria-labelledby="achievement-characters"
      >
        <h3 id="achievement-characters">角色解锁</h3>
        <div className="achievement-character-grid">
          {characterCatalog.map((character) => {
            const permission = view?.characterUnlocks[character.id],
              unlocked = character.id === 'isaac' || !!permission;
            return (
              <article
                className="achievement-role"
                key={character.id}
                data-unlocked={unlocked}
              >
                <h4>
                  {character.name} · {unlocked ? '可用' : '未解锁'}
                </h4>
                <p>
                  {character.id === 'isaac'
                    ? '默认开放'
                    : permission?.conditionId === 'manual-all'
                      ? '手动授权；不代表下列成就已完成。'
                      : '完成全部前置成就后解锁。'}
                </p>
                <ul>
                  {characterAchievementRequirements[character.id].map((id) => (
                    <li key={id}>
                      <a href={`#achievement-${id}`}>
                        {achievementCatalog.find((a) => a.id === id)!.name}
                      </a>{' '}
                      · {achieved[id] ? '已达成' : '未达成'}
                    </li>
                  ))}
                </ul>
                {permission && (
                  <time dateTime={permission.unlockedAt}>
                    {new Date(permission.unlockedAt).toLocaleString('zh-CN')}
                  </time>
                )}
              </article>
            );
          })}
        </div>
        <div className="data-actions">
          <Button
            variant="secondary"
            disabled={
              access.busy || access.invalid || access.available.length === 5
            }
            onClick={() => void access.unlockAll()}
          >
            一键解锁全部角色
          </Button>
          <output>{access.operationMessage || access.message}</output>
        </div>
      </section>
      {achievementCategories.map((category) => (
        <section
          className="settings-group"
          key={category.id}
          aria-labelledby={`achievement-category-${category.id}`}
        >
          <h3 id={`achievement-category-${category.id}`}>
            {category.name} ·{' '}
            {
              achievementCatalog.filter(
                (a) => a.category === category.id && achieved[a.id],
              ).length
            }{' '}
            / {category.count}
          </h3>
          <div className="achievement-grid">
            {achievementCatalog
              .filter((a) => a.category === category.id)
              .map((a) => {
                const at = achieved[a.id],
                  progress = view?.progress[a.id] ?? 0,
                  roles = characterCatalog.filter((c) =>
                    characterAchievementRequirements[c.id].includes(a.id),
                  );
                return (
                  <article
                    id={`achievement-${a.id}`}
                    className="achievement-card"
                    key={a.id}
                    data-achieved={!!at}
                    tabIndex={-1}
                  >
                    <div className="achievement-card-heading">
                      <h4>
                        {a.id} · {a.name}
                      </h4>
                      <span>{at ? '已达成' : '未达成'}</span>
                    </div>
                    <p>{a.condition}</p>
                    <p className="achievement-meta">
                      {a.scope === 'shared' ? '经典／生存通用' : '仅生存'} ·{' '}
                      {roles.length
                        ? `角色前置：${roles.map((c) => c.name).join('、')}`
                        : '收藏挑战'}
                    </p>
                    <label>
                      {a.kind === 'same-match' ? '单局最高进度' : '已记录进度'}
                      ：{progress} / {a.target}
                      <progress
                        aria-label={`${a.name}进度`}
                        value={Math.min(progress, a.target)}
                        max={a.target}
                      />
                    </label>
                    {at ? (
                      <time dateTime={at}>
                        达成于 {new Date(at).toLocaleString('zh-CN')}
                      </time>
                    ) : (
                      <small>尚未达成</small>
                    )}
                  </article>
                );
              })}
          </div>
        </section>
      ))}
    </section>
  );
}
