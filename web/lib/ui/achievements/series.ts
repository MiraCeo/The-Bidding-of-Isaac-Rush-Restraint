import {
  achievementCatalog,
  achievementCategories,
  type AchievementId,
} from './catalog';
import { selectAchievements, type AchievementFilters } from './presentation';
import {
  achievementCollectionMetadata,
  achievementTiers,
} from './collection-metadata';
import { revision057Series } from './revision057-catalog';
export const achievementSeries = revision057Series;
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
    const focus =
      (filters.status === 'achieved'
        ? [...eligible].reverse().find((id) => achieved[id])
        : eligible.find((id) => !achieved[id])) ?? eligible.at(-1)!;
    return [
      {
        id: a.id,
        name: series?.name ?? a.name,
        definition: achievementCatalog.find((d) => d.id === focus)!,
        series,
        matchingIds: eligible,
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
      const ratio = (c: typeof a) =>
        achieved[c.definition.id]
          ? 1
          : achievementCollectionMetadata[c.definition.id].hidden
            ? 0
            : Math.min(progress[c.definition.id] ?? 0, c.definition.target) /
              c.definition.target;
      const d = ratio(b) - ratio(a);
      if (d) return d;
    }
    return a.id.localeCompare(b.id);
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
