import type { AchievementId } from './catalog';

export const achievementTiers = ['bronze', 'silver', 'gold'] as const;
export type AchievementTier = (typeof achievementTiers)[number];
export const achievementTierLabels: Readonly<Record<AchievementTier, string>> =
  {
    bronze: '铜',
    silver: '银',
    gold: '金',
  };
/** First collection pass: existing badges only, no thresholds, storage or rewards.
 * Explicit complete config makes later balancing independent of earned records. */
export const achievementCollectionMetadata: Readonly<
  Record<AchievementId, { tier: AchievementTier; hidden: boolean }>
> = {
  A01: { tier: 'bronze', hidden: false },
  A02: { tier: 'silver', hidden: false },
  A03: { tier: 'gold', hidden: true },
  B01: { tier: 'bronze', hidden: false },
  B02: { tier: 'silver', hidden: false },
  B03: { tier: 'silver', hidden: false },
  B04: { tier: 'bronze', hidden: false },
  B05: { tier: 'bronze', hidden: false },
  B06: { tier: 'bronze', hidden: false },
  C01: { tier: 'bronze', hidden: false },
  C02: { tier: 'bronze', hidden: false },
  C03: { tier: 'silver', hidden: false },
  C04: { tier: 'bronze', hidden: false },
  C05: { tier: 'bronze', hidden: false },
  C06: { tier: 'bronze', hidden: false },
  C07: { tier: 'gold', hidden: true },
  D01: { tier: 'bronze', hidden: false },
  D02: { tier: 'bronze', hidden: false },
  D03: { tier: 'silver', hidden: false },
  D04: { tier: 'bronze', hidden: false },
  D05: { tier: 'bronze', hidden: false },
  D06: { tier: 'bronze', hidden: false },
  E01: { tier: 'bronze', hidden: false },
  E02: { tier: 'bronze', hidden: false },
  E03: { tier: 'bronze', hidden: false },
  E04: { tier: 'bronze', hidden: false },
  E05: { tier: 'silver', hidden: false },
  E06: { tier: 'bronze', hidden: false },
  E07: { tier: 'silver', hidden: false },
  E08: { tier: 'gold', hidden: false },
  F01: { tier: 'bronze', hidden: false },
  F02: { tier: 'gold', hidden: true },
  F03: { tier: 'silver', hidden: false },
  F04: { tier: 'silver', hidden: false },
  F05: { tier: 'silver', hidden: false },
  F06: { tier: 'silver', hidden: false },
};
