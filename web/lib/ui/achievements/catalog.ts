import type { CharacterId } from '../../game/item-types';
import { revision057CharacterRequirements } from './revision057-catalog';
import {
  revision065Series,
  type Revision065Id,
  type Revision065Definition,
} from './revision065-catalog';
import {
  revision066Catalog,
  revision066Categories,
} from './revision066-catalog';
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
// Stable IDs and role prerequisites stay unchanged. 0.6.6 adjusts only the
// approved balance targets/conditions, retaining the 0.6.5 series identities.
export const achievementCatalog: readonly Revision065Definition[] =
  revision066Catalog.map((a) => {
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
export const achievementCategories = revision066Categories;
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
