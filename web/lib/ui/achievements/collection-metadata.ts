import type { AchievementId } from './catalog';
import { revision058Metadata } from './revision058-catalog';
export {
  achievementTiers,
  achievementTierLabels,
  type AchievementTier,
} from './v056-collection-metadata';
export const achievementCollectionMetadata = Object.fromEntries(
  revision058Metadata,
) as Readonly<
  Record<AchievementId, { tier: 'bronze' | 'silver' | 'gold'; hidden: boolean }>
>;
