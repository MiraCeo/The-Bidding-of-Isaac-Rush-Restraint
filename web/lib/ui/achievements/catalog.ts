import type { CharacterId } from '../../game/item-types';
import { revision057CharacterRequirements } from './revision057-catalog';
import {
  revision058Catalog,
  revision058Categories,
  revision058Series,
  type Revision058Id,
  type Revision058Definition,
} from './revision058-catalog';
import { achievementSeriesCopy } from './series-copy';
export {
  achievementCatalogVersion,
  currentAchievementCatalogVersion,
  milestoneAchievementCatalogVersion,
  achievementCharacters,
  milestoneAchievementIds,
  v053AchievementCatalog,
  legacyAchievementCatalog,
} from './v056-catalog';
export const revisionAchievementCatalogVersion = 4;
export const cfAchievementCatalogVersion = 5;
// Stable IDs, targets and fact semantics stay unchanged. Only player-facing
// series names/conditions are normalized; public numbers live in numbering.ts.
export const achievementCatalog: readonly Revision058Definition[] =
  revision058Catalog.map((a) => {
    const series = revision058Series.find((s) => s.ids.includes(a.id));
    if (!series) return a;
    const copy = achievementSeriesCopy[series.id];
    if (!copy) throw Error(`成就系列缺少条件文案：${series.id}`);
    return {
      ...a,
      // Survival's three named stages are intentional, not missing suffixes.
      name:
        series.id === 'S-SURVIVAL'
          ? a.name
          : `${series.name} ${['I', 'II', 'III'][series.ids.indexOf(a.id)]}`,
      condition: copy.condition(a.target),
    };
  });
export const achievementCategories = revision058Categories;
export type AchievementId = Revision058Id;
export type AchievementDefinition = Revision058Definition;
export type AchievementCategory = (typeof achievementCategories)[number]['id'];
export const characterAchievementRequirements: Readonly<
  Record<CharacterId, readonly AchievementId[]>
> = revision057CharacterRequirements;
export function availableAchievementCharacters(
  achieved: ReadonlySet<AchievementId>,
  manualUnlockAll = false,
): CharacterId[] {
  return (
    Object.keys(characterAchievementRequirements) as CharacterId[]
  ).filter(
    (id) =>
      manualUnlockAll ||
      characterAchievementRequirements[id].every((key) => achieved.has(key)),
  );
}
