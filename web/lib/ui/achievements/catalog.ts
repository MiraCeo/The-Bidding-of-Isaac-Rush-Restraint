import type { CharacterId } from '../../game/item-types';
import { revision057CharacterRequirements } from './revision057-catalog';
import {
  revision058Catalog,
  revision058Categories,
  type Revision058Id,
  type Revision058Definition,
} from './revision058-catalog';
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
export const achievementCatalog = revision058Catalog;
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
