import type { ItemDefinition } from '@/lib/game/item-types';
import { getItemBadges } from '@/lib/ui/item-badges';

interface ItemBadgesProps {
  item: ItemDefinition;
  compact?: boolean;
}

export function ItemBadges({ item, compact = false }: ItemBadgesProps) {
  return (
    <ul
      className={`item-badges${compact ? ' item-badges-compact' : ''}`}
      aria-label="道具标签"
    >
      {getItemBadges(item, !compact).map((badge) => (
        <li
          key={`${badge.kind}:${badge.label}`}
          className={`item-badge item-badge-${badge.tone}`}
          data-kind={badge.kind}
        >
          {badge.label}
        </li>
      ))}
    </ul>
  );
}
