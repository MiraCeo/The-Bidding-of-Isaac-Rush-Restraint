import type { AchievementId } from './catalog';
import { revision057Metadata } from './revision057-catalog';
export {
  achievementTiers,
  achievementTierLabels,
  type AchievementTier,
} from './v056-collection-metadata';
export const achievementCollectionMetadata = Object.fromEntries(
  revision057Metadata,
) as Readonly<
  Record<AchievementId, { tier: 'bronze' | 'silver' | 'gold'; hidden: boolean }>
>;
