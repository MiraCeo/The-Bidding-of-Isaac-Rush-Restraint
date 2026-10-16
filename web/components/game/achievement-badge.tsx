import type { AchievementId as V056Id } from '@/lib/ui/achievements/v056-catalog';
import { revision057NewSeries } from '@/lib/ui/achievements/revision057-catalog';
import { revision058NewSeries } from '@/lib/ui/achievements/revision058-catalog';
import {
  RotateCcw,
  Unplug,
  Ban,
  ShieldPlus,
  FlagTriangleRight,
  CircleDollarSign,
  BadgeDollarSign,
  Scale,
  Route,
  PackageCheck,
  Armchair,
  Banknote,
  Vault,
  Gem,
  Receipt,
  PiggyBank,
  Waves,
  BookOpen,
  GraduationCap,
  PersonStanding,
  ShieldHalf,
  EqualNot,
  Map,
  MapPinned,
  Ship,
  Mountain,
  MountainSnow,
  CircleHelp,
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
  Ungroup,
  Target,
  Compass,
  Award,
  UsersRound,
  Trophy,
  type LucideIcon,
} from 'lucide-react';
import type { AchievementId } from '@/lib/ui/achievements/catalog';

import {
  achievementCollectionMetadata,
  achievementTierLabels,
  achievementTiers,
} from '@/lib/ui/achievements/collection-metadata';

// Stable code-native family glyphs; new tiers share the family and differ by metal.
const legacyGlyphs: Readonly<Record<V056Id, LucideIcon>> = {
  A01: CircleDashed,
  A02: Repeat2,
  A03: Footprints,
  B01: Handshake,
  B02: Coins,
  B03: Split,
  B04: Eye,
  B05: Ungroup,
  B06: Target,
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
  E06: Compass,
  E07: Award,
  E08: UsersRound,
  F01: Hourglass,
  F02: DoorOpen,
  F03: Gauge,
  F04: ListChecks,
  F05: HeartCrack,
  F06: Trophy,
  A04: RotateCcw,
  A05: FlagTriangleRight,
  B07: CircleDollarSign,
  B08: BadgeDollarSign,
  B09: Scale,
  B11: Route,
  C08: PackageCheck,
  C09: Armchair,
  D07: Banknote,
  D08: Vault,
  D09: Gem,
  D10: Receipt,
  D11: PiggyBank,
  D12: Waves,
  E09: BookOpen,
  E10: GraduationCap,
  E11: PersonStanding,
  E12: ShieldHalf,
  E15: EqualNot,
  F07: Map,
  F08: MapPinned,
  F09: Ship,
  F10: Mountain,
  F12: MountainSnow,
};
export const achievementGlyphs = {
  ...legacyGlyphs,
  ...Object.fromEntries(
    [...revision057NewSeries, ...revision058NewSeries].flatMap((s) =>
      s.ids.map((id) => [
        id,
        legacyGlyphs[
          s.anchor === 'A10'
            ? 'A02'
            : s.anchor === 'A13'
              ? 'A04'
              : (s.anchor as V056Id)
        ],
      ]),
    ),
  ),
  B12: Unplug,
  B13: Ban,
  E16: ShieldPlus,
} as Readonly<Record<AchievementId, LucideIcon>>;
export function AchievementBadge({
  id,
  achieved = false,
  concealed = false,
}: {
  id: AchievementId;
  achieved?: boolean;
  concealed?: boolean;
}) {
  const Glyph = concealed ? CircleHelp : achievementGlyphs[id];
  const tier = achievementCollectionMetadata[id].tier;
  return (
    <span
      className="achievement-badge"
      data-category={id[0]}
      data-tier={tier}
      data-concealed={concealed}
      data-achieved={achieved}
      aria-hidden="true"
    >
      <span className="achievement-badge-pips">
        {Array.from({ length: achievementTiers.indexOf(tier) + 1 }, (_, i) => (
          <i key={i} />
        ))}
      </span>
      <Glyph strokeWidth={1.65} />
      <span className="achievement-badge-rank">
        {achievementTierLabels[tier]}
      </span>
    </span>
  );
}
