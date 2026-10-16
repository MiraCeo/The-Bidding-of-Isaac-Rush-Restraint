import type { AchievementId } from './catalog';
import { revision065Metadata } from './revision065-catalog';
export {
  achievementTiers,
  achievementTierLabels,
  type AchievementTier,
} from './v056-collection-metadata';
export const achievementCollectionMetadata = Object.fromEntries(
  revision065Metadata,
) as Readonly<
  Record<AchievementId, { tier: 'bronze' | 'silver' | 'gold'; hidden: boolean }>
>;
