import { useId, useMemo, useRef, useState, type MouseEvent } from 'react';
import { Dialog } from '@base-ui/react/dialog';
import { Check, LockKeyhole, Search, Trophy, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { PlayerProfile } from '@/lib/ui/player-profile';
import { characterCatalog } from '@/lib/game';
import {
  achievementCatalog,
  achievementCategories,
  characterAchievementRequirements,
  type AchievementId,
  type AchievementCategory,
} from '@/lib/ui/achievements/catalog';
import { projectAchievementRegistry } from '@/lib/ui/achievements/registry';
import {
  achievementPresentation,
  selectAchievements,
  type AchievementStatusFilter,
  type AchievementSort,
} from '@/lib/ui/achievements/presentation';
import {
  loadAchievementColumns,
  saveAchievementColumns,
  type AchievementColumns,
} from '@/lib/ui/achievements/layout-preferences';
import { getPreferenceStorage } from '@/lib/ui/game-preferences';
import { AchievementBadge } from './achievement-badge';
import { AchievementSystemRules } from './achievement-system-rules';
import { AchievementDetail } from './achievement-detail';
import { useCharacterAccess } from './use-character-access';
const roleSymbols = {
  isaac: '🎲',
  lost: '👻',
  azazel: '🔥',
  eden: '✨',
  jacob_esau: '♊',
};
const dateLabel = (at: string) => new Date(at).toLocaleString('zh-CN');

/** Browsing is read-only. Only explicit manual authorization writes a profile;
 * column choice is an independent, optional display preference. */
export function AchievementProgress({
  profile,
  message = '',
}: {
  profile: PlayerProfile;
  message?: string;
}) {
  const access = useCharacterAccess(false);
  const [query, setQuery] = useState(''),
    [category, setCategory] = useState<AchievementCategory | 'all'>('all'),
    [status, setStatus] = useState<AchievementStatusFilter>('all'),
    [sort, setSort] = useState<AchievementSort>('catalog');
  const [columns, setColumns] = useState(() =>
      loadAchievementColumns(getPreferenceStorage()),
    ),
    [layoutMessage, setLayoutMessage] = useState('');
  const [rulesOpen, setRulesOpen] = useState(false);
  const [selected, setSelected] = useState<AchievementId | null>(null);
  const origin = useRef<HTMLButtonElement | null>(null),
    search = useRef<HTMLInputElement | null>(null);
  const dialogId = useId();
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
    progress: Partial<Record<AchievementId, number>> = view?.progress ?? {},
    completed = Object.keys(achieved).length,
    total = achievementCatalog.length;
  const unlockedRoles = characterCatalog.filter(
    (c) => c.id === 'isaac' || view?.characterUnlocks[c.id],
  ).length;
  const entries = selectAchievements(
    { query, category, status, sort },
    progress,
    achieved,
  );
  const detail = achievementCatalog.find((a) => a.id === selected);
  const openDetail = (
    id: AchievementId,
    event: MouseEvent<HTMLButtonElement>,
  ) => {
    origin.current = event.currentTarget;
    setSelected(id);
  };
  const changeColumns = (value: AchievementColumns) => {
    setColumns(value);
    setLayoutMessage(
      saveAchievementColumns(getPreferenceStorage(), value)
        ? ''
        : '排列已应用于本页；本地偏好未保存。',
    );
  };
  const resetFilters = () => {
    setQuery('');
    setCategory('all');
    setStatus('all');
    setSort('catalog');
  };
  return (
    <Dialog.Root
      open={!!detail || rulesOpen}
      onOpenChange={(open) => {
        if (!open) {
          setSelected(null);
          setRulesOpen(false);
        }
      }}
    >
      <section className="achievement-progress" aria-label="成就与角色解锁">
        <header className="achievement-overview">
          <div className="achievement-overview-heading">
            <div>
              <span className="achievement-eyebrow">
                <Trophy aria-hidden="true" size={14} /> 成长收藏
              </span>
              <h3>成就总览</h3>
            </div>
            <strong aria-label={`已达成${completed}项，共${total}项`}>
              {completed}
              <span> / {total}</span>
            </strong>
          </div>
          <progress aria-label="成就完成率" value={completed} max={total} />
          <div className="achievement-overview-caption">
            <span>完成率 {((completed / total) * 100).toFixed(1)}%</span>
            <span>
              <Users aria-hidden="true" size={14} /> 已解锁角色 {unlockedRoles}{' '}
              / {characterCatalog.length}
            </span>
          </div>
        </header>
        <div className="achievement-browser">
          <div className="achievement-toolbar">
            <label className="achievement-search">
              <Search aria-hidden="true" size={17} />
              <span className="sr-only">搜索成就名称或编号</span>
              <input
                ref={search}
                type="search"
                value={query}
                placeholder="搜索成就名称 / 编号"
                onChange={(e) => setQuery(e.target.value)}
              />
            </label>
            <label>
              达成状态
              <select
                value={status}
                onChange={(e) =>
                  setStatus(e.target.value as AchievementStatusFilter)
                }
              >
                <option value="all">全部状态</option>
                <option value="achieved">已达成</option>
                <option value="pending">未达成</option>
              </select>
            </label>
            <label>
              排序
              <select
                value={sort}
                onChange={(e) => setSort(e.target.value as AchievementSort)}
              >
                <option value="catalog">编号顺序</option>
                <option value="recent">最近达成</option>
                <option value="progress">进度优先</option>
              </select>
            </label>
            <label>
              排列
              <select
                value={columns}
                onChange={(e) =>
                  changeColumns(e.target.value as AchievementColumns)
                }
              >
                <option value="auto">自动排列</option>
                <option value="1">1 列</option>
                <option value="2">2 列</option>
                <option value="3">3 列</option>
              </select>
            </label>
          </div>
          <fieldset className="achievement-categories">
            <legend className="sr-only">成就分类</legend>
            <button
              type="button"
              aria-pressed={category === 'all'}
              onClick={() => setCategory('all')}
            >
              全部{' '}
              <span>
                {completed}/{total}
              </span>
            </button>
            {achievementCategories.map((c) => (
              <button
                type="button"
                id={`achievement-category-${c.id}`}
                key={c.id}
                aria-pressed={category === c.id}
                onClick={() => setCategory(c.id)}
              >
                {c.name}{' '}
                <span>
                  {
                    achievementCatalog.filter(
                      (a) => a.category === c.id && achieved[a.id],
                    ).length
                  }
                  /
                  {achievementCatalog.filter((a) => a.category === c.id).length}
                </span>
              </button>
            ))}
          </fieldset>
          {layoutMessage && (
            <output className="achievement-browser-note" aria-live="polite">
              {layoutMessage}
            </output>
          )}
          <div className="achievement-list-heading">
            <output>
              显示 {entries.length} / {total} 项
            </output>
            <span>点击徽章查看详情</span>
          </div>
          <div className="achievement-grid" data-columns={columns}>
            {entries.map((a) => {
              const at = achieved[a.id],
                value = progress[a.id] ?? 0;
              return (
                <button
                  type="button"
                  id={`achievement-${a.id}`}
                  className="achievement-card"
                  key={a.id}
                  data-achieved={!!at}
                  aria-label={`查看${a.id} ${a.name}详情`}
                  aria-haspopup="dialog"
                  aria-controls={detail ? dialogId : undefined}
                  onClick={(e) => openDetail(a.id, e)}
                >
                  <AchievementBadge id={a.id} achieved={!!at} />
                  <span className="achievement-card-copy">
                    <span className="achievement-card-heading">
                      <strong>{a.name}</strong>
                      <span className="achievement-card-state">
                        {at ? (
                          <>
                            <Check size={12} aria-hidden="true" /> 已达成
                          </>
                        ) : a.target === 1 ? (
                          <>
                            <LockKeyhole size={12} aria-hidden="true" />
                            <span className="sr-only">未达成</span>
                          </>
                        ) : null}
                      </span>
                    </span>
                    <span className="achievement-summary">
                      {achievementPresentation[a.id].summary}
                    </span>
                    {a.target > 1 && (
                      <span className="achievement-card-progress">
                        <span className="sr-only">
                          {a.kind === 'same-match'
                            ? '单局最高进度'
                            : '已记录进度'}
                          ：
                        </span>
                        {Math.min(value, a.target)} / {a.target}
                        <progress
                          aria-label={`${a.name}进度`}
                          value={Math.min(value, a.target)}
                          max={a.target}
                        />
                      </span>
                    )}
                  </span>
                </button>
              );
            })}
          </div>
          {!entries.length && (
            <div className="achievement-empty">
              <Search aria-hidden="true" size={26} />
              <h4>没有符合条件的成就</h4>
              <p>换个名称、编号或筛选条件试试。</p>
              <Button variant="secondary" onClick={resetFilters}>
                清除筛选
              </Button>
            </div>
          )}
          <button
            type="button"
            className="achievement-system-rules-link"
            aria-haspopup="dialog"
            onClick={(e) => {
              origin.current = e.currentTarget;
              setSelected(null);
              setRulesOpen(true);
            }}
          >
            成就统计规则
          </button>
          <p className="achievement-browser-note">
            只展示已成功保存的进度
            {!view ? '；尚无0.5成长记账，不据旧对局补发' : ''}。
          </p>
        </div>
        <section
          className="achievement-characters"
          aria-labelledby="achievement-characters-heading"
        >
          <header className="achievement-characters-heading">
            <div>
              <h3 id="achievement-characters-heading">角色解锁</h3>
              <p>成就前置与手动授权分别记录。</p>
            </div>
            <Button
              variant="secondary"
              disabled={
                access.busy ||
                access.invalid ||
                access.available.length === characterCatalog.length
              }
              onClick={() => void access.unlockAll()}
            >
              一键解锁全部角色
            </Button>
          </header>
          <div className="achievement-character-grid">
            {characterCatalog.map((c) => {
              const permission = view?.characterUnlocks[c.id],
                unlocked = c.id === 'isaac' || !!permission;
              return (
                <article
                  className="achievement-role"
                  key={c.id}
                  data-unlocked={unlocked}
                >
                  <div className="achievement-role-heading">
                    <span aria-hidden="true">{roleSymbols[c.id]}</span>
                    <h4>{c.name}</h4>
                    {unlocked ? (
                      <Check aria-hidden="true" size={14} />
                    ) : (
                      <LockKeyhole aria-hidden="true" size={14} />
                    )}
                  </div>
                  <p className="achievement-role-state">
                    {c.id === 'isaac'
                      ? '默认开放'
                      : permission?.conditionId === 'manual-all'
                        ? '手动授权'
                        : unlocked
                          ? '成就解锁'
                          : '未解锁'}
                  </p>
                  <ul>
                    {characterAchievementRequirements[c.id].map((id) => (
                      <li key={id}>
                        <button
                          type="button"
                          data-achieved={!!achieved[id]}
                          aria-label={`查看${c.name}前置 ${achievementCatalog.find((a) => a.id === id)!.name}`}
                          aria-haspopup="dialog"
                          onClick={(e) => openDetail(id, e)}
                        >
                          {achieved[id] ? (
                            <Check size={12} aria-hidden="true" />
                          ) : (
                            <span
                              className="achievement-role-dot"
                              aria-hidden="true"
                            />
                          )}
                          {achievementCatalog.find((a) => a.id === id)!.name}
                          <span className="sr-only">
                            {' '}
                            · {achieved[id] ? '已达成' : '未达成'}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                  {permission && (
                    <time dateTime={permission.unlockedAt}>
                      {dateLabel(permission.unlockedAt)}
                    </time>
                  )}
                </article>
              );
            })}
          </div>
          <output className="achievement-browser-note" aria-live="polite">
            {access.operationMessage || access.message}
          </output>
        </section>
      </section>
      <Dialog.Portal>
        <Dialog.Backdrop className="achievement-dialog-backdrop" />
        <Dialog.Popup
          className="achievement-dialog"
          id={dialogId}
          finalFocus={() =>
            origin.current?.isConnected ? origin.current : search.current
          }
        >
          {rulesOpen ? (
            <AchievementSystemRules />
          ) : (
            detail && (
              <AchievementDetail
                definition={detail}
                progress={progress[detail.id] ?? 0}
                achievedAt={achieved[detail.id]}
                onShowRules={() => {
                  setSelected(null);
                  setRulesOpen(true);
                }}
              />
            )
          )}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
