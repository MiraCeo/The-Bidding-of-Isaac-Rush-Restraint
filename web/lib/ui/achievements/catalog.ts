import type { CharacterId } from '../../game/item-types';
import { revision057CharacterRequirements } from './revision057-catalog';
import {
  revision065Catalog,
  revision065Categories,
  revision065Series,
  type Revision065Id,
  type Revision065Definition,
} from './revision065-catalog';
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
export const stageAchievementCatalogVersion = 6;
// Stable IDs and original bronze thresholds/permissions stay unchanged.
// The 0.6.5 layer adds five room-counted series; public numbers append only.
export const achievementCatalog: readonly Revision065Definition[] =
  revision065Catalog.map((a) => {
    const series = revision065Series.find((s) => s.ids.includes(a.id));
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
export const achievementCategories = revision065Categories;
export type AchievementId = Revision065Id;
export type AchievementDefinition = Revision065Definition;
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
