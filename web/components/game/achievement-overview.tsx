import { Dialog } from '@base-ui/react/dialog';
import {
  Award,
  Coins,
  Compass,
  Footprints,
  Handshake,
  ShieldCheck,
  Shuffle,
  Trophy,
  Users,
  X,
  type LucideIcon,
} from 'lucide-react';
import type { MouseEvent } from 'react';
import {
  achievementCatalog,
  achievementCategories,
  type AchievementCategory,
  type AchievementId,
} from '@/lib/ui/achievements/catalog';
import {
  achievementCollectionMetadata,
  achievementTiers,
  achievementTierLabels,
} from '@/lib/ui/achievements/collection-metadata';
import {
  selectAchievementCards,
  summarizeAchievementCards,
} from '@/lib/ui/achievements/series';
import { AchievementBadge } from './achievement-badge';

type Props = {
  achieved: Partial<Record<AchievementId, string>>;
  unlockedRoles: number;
  roleCount: number;
};

const categoryGlyphs: Readonly<Record<AchievementCategory, LucideIcon>> = {
  A: Footprints,
  B: Handshake,
  C: Shuffle,
  D: Coins,
  E: Compass,
  F: ShieldCheck,
};

/** Existing saved facts only: no score, recommendation, unlock or storage writes. */
function totals(achieved: Props['achieved']) {
  return achievementTiers.map((tier) => {
    const entries = achievementCatalog.filter(
      (a) => achievementCollectionMetadata[a.id].tier === tier,
    );
    return {
      tier,
      earned: entries.filter((a) => achieved[a.id]).length,
      total: entries.length,
    };
  });
}

export function AchievementOverview({
  achieved,
  unlockedRoles,
  roleCount,
  onOpen,
}: Props & {
  onOpen: (event: MouseEvent<HTMLButtonElement>) => void;
}) {
  const completed = achievementCatalog.filter((a) => achieved[a.id]).length;
  const total = achievementCatalog.length;
  return (
    <header className="achievement-overview">
      <div className="achievement-overview-heading">
        <h3>
          <Trophy aria-hidden="true" size={17} />
          成就总览
        </h3>
        <strong aria-label={`已达成${completed}项，共${total}项`}>
          {completed}
          <span> / {total}</span>
        </strong>
        <span className="achievement-overview-caption">
          完成率 {((completed / total) * 100).toFixed(1)}%
        </span>
        <button
          className="achievement-overview-open"
          type="button"
          aria-haspopup="dialog"
          onClick={onOpen}
        >
          查看总览
        </button>
      </div>
      <progress aria-label="成就完成率" value={completed} max={total} />
      <div className="achievement-overview-bottom">
        <div className="achievement-tier-totals" aria-label="各等级收藏进度">
          {totals(achieved).map((t) => (
            <span key={t.tier} data-tier={t.tier}>
              {achievementTierLabels[t.tier]} {t.earned} / {t.total}
            </span>
          ))}
        </div>
        <span className="achievement-overview-roles">
          <Users aria-hidden="true" size={14} />
          已解锁角色 {unlockedRoles} / {roleCount}
        </span>
      </div>
    </header>
  );
}

export function AchievementOverviewDetail({
  achieved,
  unlockedRoles,
  roleCount,
}: Props) {
  const completed = achievementCatalog.filter((a) => achieved[a.id]).length;
  const cards = selectAchievementCards(
    {
      query: '',
      category: 'all',
      status: 'all',
      sort: 'collection',
      tier: 'all',
    },
    {},
    achieved,
  );
  const cardTotals = summarizeAchievementCards(cards, achieved);
  const recent = achievementCatalog
    .filter((a) => achieved[a.id])
    .sort(
      (a, b) =>
        Date.parse(achieved[b.id]!) - Date.parse(achieved[a.id]!) ||
        achievementCatalog.indexOf(a) - achievementCatalog.indexOf(b),
    )
    .slice(0, 3);
  return (
    <>
      <div className="achievement-detail-heading achievement-overview-dialog-heading">
        <div>
          <p className="eyebrow achievement-overview-eyebrow">
            ACHIEVEMENT OVERVIEW
          </p>
          <Dialog.Title>成就总览</Dialog.Title>
        </div>
        <Dialog.Close
          className="achievement-detail-close achievement-overview-close"
          aria-label="关闭成就总览"
        >
          <X size={18} aria-hidden="true" />
        </Dialog.Close>
      </div>
      <Dialog.Description className="sr-only">
        已保存的收藏记录，不随列表筛选改变。
      </Dialog.Description>
      <dl className="achievement-overview-metrics">
        <div>
          <dt>已获徽章</dt>
          <dd>
            {completed} <span>/ {achievementCatalog.length}</span>
          </dd>
        </div>
        <div>
          <dt>已点亮成就</dt>
          <dd>
            {cardTotals.earned} <span>/ {cardTotals.total}</span>
          </dd>
        </div>
        <div>
          <dt>已解锁角色</dt>
          <dd>
            {unlockedRoles} <span>/ {roleCount}</span>
          </dd>
        </div>
      </dl>
      <div className="achievement-overview-metals" aria-label="各等级徽章统计">
        {totals(achieved).map((t) => (
          <article
            className="achievement-metal-card"
            key={t.tier}
            data-tier={t.tier}
            aria-label={`${achievementTierLabels[t.tier]}徽章收藏统计`}
          >
            <span
              className="achievement-badge"
              data-tier={t.tier}
              data-achieved={t.earned > 0}
              aria-hidden="true"
            >
              <span className="achievement-badge-pips">
                {Array.from(
                  { length: achievementTiers.indexOf(t.tier) + 1 },
                  (_, index) => (
                    <i key={index} />
                  ),
                )}
              </span>
              <Award strokeWidth={1.65} />
              <span className="achievement-badge-rank">
                {achievementTierLabels[t.tier]}
              </span>
            </span>
            <div>
              <strong>
                {t.earned} <span>/ {t.total}</span>
              </strong>
              <span className="achievement-metal-label">
                {achievementTierLabels[t.tier]}徽章
              </span>
            </div>
          </article>
        ))}
      </div>
      <section
        className="achievement-overview-categories"
        aria-label="分类徽章进度"
      >
        <h3>分类徽章进度</h3>
        <div className="achievement-overview-category-grid">
          {achievementCategories.map((category) => {
            const entries = achievementCatalog.filter(
              (a) => a.category === category.id,
            );
            const earned = entries.filter((a) => achieved[a.id]).length;
            const Glyph = categoryGlyphs[category.id];
            return (
              <div
                key={category.id}
                className="achievement-overview-category"
                data-earned={earned > 0}
              >
                <span
                  className="achievement-overview-category-icon"
                  aria-hidden="true"
                >
                  <Glyph size={18} strokeWidth={1.65} />
                </span>
                <div className="achievement-overview-category-copy">
                  <span className="achievement-overview-category-name">
                    {category.name}
                  </span>
                  <span className="achievement-overview-category-count">
                    已获 <strong>{earned}</strong> 枚 / 共 {entries.length} 枚
                  </span>
                </div>
                <progress
                  aria-label={`${category.name}徽章完成率`}
                  value={earned}
                  max={entries.length}
                />
              </div>
            );
          })}
        </div>
      </section>
      <section className="achievement-overview-recent" aria-label="最近达成">
        <h3>最近达成</h3>
        {recent.length ? (
          <ul>
            {recent.map((a) => (
              <li key={a.id}>
                <AchievementBadge id={a.id} achieved />
                <strong>{a.name}</strong>
                <time dateTime={achieved[a.id]}>
                  {new Date(achieved[a.id]!).toLocaleDateString('zh-CN')}
                </time>
              </li>
            ))}
          </ul>
        ) : (
          <p>尚无已达成的成就。</p>
        )}
      </section>
      <footer className="achievement-detail-footer achievement-overview-footer">
        <Dialog.Close className="achievement-detail-done">关闭</Dialog.Close>
      </footer>
    </>
  );
}
