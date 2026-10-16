import type { CharacterId } from '../../game/item-types';
import {
  revision057Catalog,
  revision057Categories,
  revision057CharacterRequirements,
  type Revision057Id,
  type Revision057Definition,
} from './revision057-catalog';
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
export const achievementCatalog = revision057Catalog;
export const achievementCategories = revision057Categories;
export type AchievementId = Revision057Id;
export type AchievementDefinition = Revision057Definition;
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
