import {
  selectAchievementCards,
  groupAchievementCards,
  seriesForAchievement,
  independentGroupForAchievement,
  summarizeAchievementCards,
  achievementCardGoal,
} from '@/lib/ui/achievements/series';
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
import { hasCurrentAchievementBaseline } from '@/lib/ui/achievements/baseline';
import { achievementNumber } from '@/lib/ui/achievements/numbering';
import { projectAchievementRegistry } from '@/lib/ui/achievements/registry';
import {
  achievementListPresentation,
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
import {
  achievementCollectionMetadata,
  achievementTiers,
  achievementTierLabels,
  type AchievementTier,
} from '@/lib/ui/achievements/collection-metadata';
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
    [sort, setSort] = useState<AchievementSort>('catalog'),
    [tier, setTier] = useState<AchievementTier | 'all'>('all');
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
  const badgeEntries = selectAchievements(
    { query, category, status, sort, tier },
    progress,
    achieved,
  );
  // Category buttons are navigation facets: query/status/tier affect every
  // count, but selecting A must not zero the other available categories.
  const matchingCards = selectAchievementCards(
    { query, category: 'all', status, sort, tier },
    progress,
    achieved,
  );
  const entries =
    category === 'all'
      ? matchingCards
      : matchingCards.filter((card) => card.definition.category === category);
  const allCards = summarizeAchievementCards(matchingCards, achieved);
  const categoryCards = achievementCategories.map((c) => ({
    ...c,
    ...summarizeAchievementCards(
      matchingCards.filter((card) => card.definition.category === c.id),
      achieved,
    ),
  }));
  const cardCountHint =
    '已获卡片 / 当前筛选匹配卡片；系列任一级达成计一张，仅统计匹配的子级';
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
    setTier('all');
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
        {!hasCurrentAchievementBaseline(profile) && (
          <output className="save-message">
            旧版本成就已停用，清理尚待成功保存；对局、回放及手动角色授权保留。
          </output>
        )}
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
          <div className="achievement-tier-totals" aria-label="各等级收藏进度">
            {achievementTiers.map((t) => {
              const badges = achievementCatalog.filter(
                (a) => achievementCollectionMetadata[a.id].tier === t,
              );
              return (
                <span key={t} data-tier={t}>
                  {achievementTierLabels[t]}{' '}
                  {badges.filter((a) => achieved[a.id]).length} /{' '}
                  {badges.length}
                </span>
              );
            })}
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
            <label>
              徽章等级
              <select
                value={tier}
                onChange={(e) =>
                  setTier(e.target.value as AchievementTier | 'all')
                }
              >
                <option value="all">全部等级</option>
                {achievementTiers.map((t) => (
                  <option key={t} value={t}>
                    {achievementTierLabels[t]}徽章
                  </option>
                ))}
              </select>
            </label>
          </div>
          <fieldset className="achievement-categories">
            <legend className="sr-only">成就分类，按当前筛选统计卡片</legend>
            <button
              type="button"
              aria-pressed={category === 'all'}
              onClick={() => setCategory('all')}
              title={cardCountHint}
              data-category="all"
              data-earned={allCards.earned}
              data-total={allCards.total}
            >
              全部{' '}
              <span>
                {allCards.earned}/{allCards.total}
              </span>
            </button>
            {categoryCards.map((c) => (
              <button
                type="button"
                id={`achievement-category-${c.id}`}
                key={c.id}
                aria-pressed={category === c.id}
                onClick={() => setCategory(c.id)}
                title={cardCountHint}
                data-category={c.id}
                data-earned={c.earned}
                data-total={c.total}
              >
                {c.name}{' '}
                <span>
                  {c.earned}/{c.total}
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
              显示 {entries.length} 张卡片，涵盖 {badgeEntries.length} / {total}{' '}
              枚徽章
            </output>
            <span title={cardCountHint}>
              分类按卡片计数 · 分类内排序 · 点击徽章查看详情
            </span>
          </div>
          <div className="achievement-sections">
            {groupAchievementCards(entries).map(
              ({ category: group, items }) => (
                <section
                  className="achievement-section"
                  key={group.id}
                  aria-labelledby={`achievement-section-${group.id}`}
                >
                  <header className="achievement-section-heading">
                    <span
                      className="achievement-section-index"
                      aria-hidden="true"
                    >
                      {group.id}
                    </span>
                    <h4 id={`achievement-section-${group.id}`}>{group.name}</h4>
                    <span
                      className="achievement-section-rule"
                      aria-hidden="true"
                    />
                    <span className="achievement-section-count">
                      已获卡片{' '}
                      {summarizeAchievementCards(items, achieved).earned} /{' '}
                      {items.length}
                    </span>
                  </header>
                  <div className="achievement-grid" data-columns={columns}>
                    {items.map((card) => {
                      const a = card.definition;
                      const at = achieved[a.id],
                        listing = achievementListPresentation(a.id, !!at),
                        badgeTier = achievementCollectionMetadata[a.id].tier;
                      const goal = achievementCardGoal(card, achieved),
                        goalListing = goal
                          ? achievementListPresentation(goal.id, false)
                          : null,
                        value = goal ? (progress[goal.id] ?? 0) : 0,
                        showGoal = !!goal && !goalListing?.hidden;
                      return (
                        <button
                          type="button"
                          id={`achievement-${card.id}`}
                          className="achievement-card"
                          key={card.id}
                          data-focused-id={a.id}
                          data-goal-id={showGoal ? goal.id : undefined}
                          data-achievement-number={achievementNumber(a.id)}
                          data-achieved={!!at}
                          data-partial={
                            !!card.series &&
                            card.matchingCompleted > 0 &&
                            card.matchingCompleted < card.matchingIds.length
                          }
                          data-tier={badgeTier}
                          data-concealed={listing.hidden}
                          aria-label={`查看${achievementNumber(a.id)} ${listing.hidden ? '隐藏成就' : listing.name}详情，${at ? '已获' : '未获'}${achievementTierLabels[badgeTier]}徽章`}
                          aria-haspopup="dialog"
                          aria-controls={detail ? dialogId : undefined}
                          onClick={(e) => openDetail(a.id, e)}
                        >
                          <AchievementBadge
                            id={a.id}
                            achieved={!!at}
                            concealed={listing.hidden}
                          />
                          <span className="achievement-card-copy">
                            <span className="achievement-card-heading">
                              <strong>
                                {card.series ? card.name : listing.name}
                              </strong>
                              <span className="achievement-card-state">
                                {card.series && card.matchingIds.length > 1 ? (
                                  <span>
                                    已获 {card.matchingCompleted} /{' '}
                                    {card.matchingIds.length}
                                    {card.completed ===
                                      card.series.ids.length && ' · 全部达成'}
                                  </span>
                                ) : at ? (
                                  <>
                                    <Check size={12} aria-hidden="true" />{' '}
                                    已达成
                                  </>
                                ) : card.series ||
                                  listing.hidden ||
                                  a.target === 1 ? (
                                  <>
                                    <LockKeyhole size={12} aria-hidden="true" />
                                    <span
                                      className={
                                        card.series ? undefined : 'sr-only'
                                      }
                                    >
                                      未达成
                                    </span>
                                  </>
                                ) : null}
                              </span>
                            </span>
                            {independentGroupForAchievement(a.id) && (
                              <span className="achievement-series-stages">
                                经典历程
                              </span>
                            )}
                            <span className="achievement-summary">
                              {showGoal && card.series
                                ? `${at ? '下一目标' : '当前目标'}：${goalListing!.summary}`
                                : listing.summary}
                            </span>
                            {card.series && (
                              <span className="achievement-series-stages">
                                {card.matchingIds.map((id) => (
                                  <span
                                    key={id}
                                    data-earned={!!achieved[id]}
                                    data-tier={
                                      achievementCollectionMetadata[id].tier
                                    }
                                  >
                                    {
                                      achievementTierLabels[
                                        achievementCollectionMetadata[id].tier
                                      ]
                                    }{' '}
                                    {achieved[id] ? '✓' : '○'}
                                  </span>
                                ))}
                              </span>
                            )}
                            {showGoal && value >= goal.target && (
                              <span className="achievement-card-ready">
                                待新正式结算确认
                              </span>
                            )}
                            {showGoal && (goal.target > 1 || !!card.series) && (
                              <span className="achievement-card-progress">
                                <span className="sr-only">
                                  {goal.kind === 'same-match'
                                    ? '单局最高进度'
                                    : '已记录进度'}
                                  ：
                                </span>
                                {Math.min(value, goal.target)} / {goal.target}
                                <progress
                                  aria-label={`${goal.name}${at ? '下一目标' : '当前目标'}进度`}
                                  value={Math.min(value, goal.target)}
                                  max={goal.target}
                                />
                              </span>
                            )}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </section>
              ),
            )}
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
                        : permission?.conditionId === 'legacy:E01+A02'
                          ? '旧版成就解锁（保留）'
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
                          {achievementNumber(id)}{' '}
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
      {view && Object.keys(view.legacyAchievements).length > 0 && (
        <section className="settings-group" aria-label="旧版成就纪念">
          <h3>旧版成就纪念</h3>
          <p>保留原达成时间，不计当前徽章总数，也不转换为新版失败对局数。</p>
          {(['A02', 'A04'] as const).map((id) =>
            view.legacyAchievements[id] ? (
              <p key={id}>
                {id} ·{' '}
                {id === 'A02'
                  ? '屡败屡战（旧版：累计竞拍失败10次）'
                  : '重整旗鼓（旧版：同局失败后再次获奖）'}{' '}
                ·{' '}
                <time dateTime={view.legacyAchievements[id]}>
                  {dateLabel(view.legacyAchievements[id]!)}
                </time>
              </p>
            ) : null,
          )}
        </section>
      )}
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
                series={seriesForAchievement(detail.id)}
                allProgress={progress}
                allAchieved={achieved}
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
