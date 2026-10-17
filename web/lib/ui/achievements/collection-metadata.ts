import type { AchievementId } from './catalog';
import { revision066Metadata } from './revision066-catalog';
export {
  achievementTiers,
  achievementTierLabels,
  type AchievementTier,
} from './v056-collection-metadata';
export const achievementCollectionMetadata = Object.fromEntries(
  revision066Metadata,
) as Readonly<
  Record<AchievementId, { tier: 'bronze' | 'silver' | 'gold'; hidden: boolean }>
>;
