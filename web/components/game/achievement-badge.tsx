import {
  HeartCrack,
  CircleDashed,
  Repeat2,
  Handshake,
  Coins,
  Split,
  Eye,
  Flag,
  ShieldCheck,
  Sunrise,
  PackageX,
  PackagePlus,
  Dices,
  Eclipse,
  HandCoins,
  Percent,
  TrendingUp,
  Sprout,
  Clover,
  Wallet,
  Dice1,
  Layers,
  Crown,
  Flame,
  Gift,
  Footprints,
  DoorOpen,
  Gauge,
  ListChecks,
  Hourglass,
  type LucideIcon,
} from 'lucide-react';
import type { AchievementId } from '@/lib/ui/achievements/catalog';

// One distinct code-native glyph per achievement; no remote art or copied game assets.
export const achievementGlyphs: Readonly<Record<AchievementId, LucideIcon>> = {
  A01: CircleDashed,
  A02: Repeat2,
  A03: Footprints,
  B01: Handshake,
  B02: Coins,
  B03: Split,
  B04: Eye,
  C01: Flag,
  C02: ShieldCheck,
  C03: Sunrise,
  C04: PackageX,
  C05: PackagePlus,
  C06: Dices,
  C07: Eclipse,
  D01: HandCoins,
  D02: Percent,
  D03: TrendingUp,
  D04: Sprout,
  D05: Clover,
  D06: Wallet,
  E01: Dice1,
  E02: Layers,
  E03: Crown,
  E04: Flame,
  E05: Gift,
  F01: Hourglass,
  F02: DoorOpen,
  F03: Gauge,
  F04: ListChecks,
  F05: HeartCrack,
};
export function AchievementBadge({
  id,
  achieved = false,
}: {
  id: AchievementId;
  achieved?: boolean;
}) {
  const Glyph = achievementGlyphs[id];
  return (
    <span
      className="achievement-badge"
      data-category={id[0]}
      data-achieved={achieved}
      aria-hidden="true"
    >
      <Glyph strokeWidth={1.65} />
    </span>
  );
}
