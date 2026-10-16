import {
  achievementCatalog,
  achievementCategories,
  type AchievementId,
  type AchievementDefinition,
} from './catalog';
import { selectAchievements, type AchievementFilters } from './presentation';
import {
  achievementCollectionMetadata,
  achievementTiers,
} from './collection-metadata';
import { revision065Series } from './revision065-catalog';
import { compareAchievementNumbers } from './numbering';
export const achievementSeries = revision065Series;
export const seriesForAchievement = (id: AchievementId) =>
  achievementSeries.find((s) => s.ids.includes(id));
export function selectAchievementCards(
  filters: AchievementFilters,
  progress: Partial<Record<AchievementId, number>>,
  achieved: Partial<Record<AchievementId, string>>,
) {
  const matches = selectAchievements(filters, progress, achieved),
    matched = new Set(matches.map((a) => a.id));
  const cards = achievementCatalog.flatMap((a) => {
    const series = seriesForAchievement(a.id);
    if (series && a.id !== series.anchor) return [];
    const ids = series?.ids ?? [a.id],
      eligible = ids.filter((id) => matched.has(id));
    if (!eligible.length) return [];
    // Show the highest earned MATCHING stage, never a future tier in place of
    // an owned medal. Pending/tier/child-ID filters still restrict the focus.
    const focus =
      [...eligible].reverse().find((id) => achieved[id]) ?? eligible[0]!;
    return [
      {
        id: a.id,
        name: series?.name ?? a.name,
        definition: achievementCatalog.find((d) => d.id === focus)!,
        series,
        matchingIds: eligible,
        matchingCompleted: eligible.filter((id) => achieved[id]).length,
        completed: ids.filter((id) => achieved[id]).length,
      },
    ];
  });
  return cards.sort((a, b) => {
    if (filters.sort === 'recent') {
      const latest = (c: typeof a) =>
        c.matchingIds
          .flatMap((id) => (achieved[id] ? [achieved[id]!] : []))
          .sort()
          .at(-1) ?? '';
      const d = latest(b).localeCompare(latest(a));
      if (d) return d;
    }
    if (filters.sort === 'progress') {
      const ratio = (c: typeof a) => {
        const goal = achievementCardGoal(c, achieved);
        if (!goal) return 1;
        if (achievementCollectionMetadata[goal.id].hidden) return 0;
        return Math.min(progress[goal.id] ?? 0, goal.target) / goal.target;
      };
      const d = ratio(b) - ratio(a);
      if (d) return d;
    }
    if (filters.sort === 'collection') {
      const rank = (card: typeof a) =>
        card.series
          ? 0
          : achievementTiers.indexOf(
              achievementCollectionMetadata[card.definition.id].tier,
            ) + 1;
      const difference = rank(a) - rank(b);
      if (difference) return difference;
    }
    const first = (card: typeof a) => card.series?.ids[0] ?? card.id;
    return compareAchievementNumbers(first(a)!, first(b)!);
  });
}
export function groupAchievementCards(
  cards: ReturnType<typeof selectAchievementCards>,
) {
  return achievementCategories.flatMap((category) => {
    const items = cards.filter((c) => c.definition.category === category.id);
    return items.length ? [{ category, items }] : [];
  });
}
/** A card represents an earned medal, not the next unearned medal. Keep its
 * goal separate, and inside the active filter range. Never infer acquisition
 * from counters or move backwards to a missing legacy lower stage. */
export function achievementCardGoal(
  card: {
    definition: AchievementDefinition;
    series?: { ids: readonly AchievementId[] };
    matchingIds: readonly AchievementId[];
  },
  achieved: Partial<Record<AchievementId, string>>,
): AchievementDefinition | null {
  if (!achieved[card.definition.id]) return card.definition;
  if (!card.series) return null;
  const index = card.series.ids.indexOf(card.definition.id);
  const next = card.series.ids
    .slice(index + 1)
    .find((id) => card.matchingIds.includes(id) && !achieved[id]);
  return next ? achievementCatalog.find((a) => a.id === next)! : null;
}
/** Browser counts are cards, not child badges. A partial series counts once if
 * an earned child matches ALL active filters; a different earned tier cannot
 * satisfy a pending/silver-only card. This never changes collection records. */
export function summarizeAchievementCards(
  cards: ReturnType<typeof selectAchievementCards>,
  achieved: Partial<Record<AchievementId, string>>,
) {
  return {
    earned: cards.filter((card) =>
      card.matchingIds.some((id) => !!achieved[id]),
    ).length,
    total: cards.length,
  };
}
export function tierForStage(id: AchievementId) {
  return achievementTiers.indexOf(achievementCollectionMetadata[id].tier) + 1;
}

export const independentAchievementGroups = [
  {
    id: 'S-CLASSIC',
    name: '经典历程',
    ids: ['E06', 'E09', 'E10'] as readonly AchievementId[],
  },
];
export const independentGroupForAchievement = (id: AchievementId) =>
  independentAchievementGroups.find((g) => g.ids.includes(id));
