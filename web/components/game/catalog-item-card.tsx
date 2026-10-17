import type { ItemDefinition } from '@/lib/game/item-types';
import { itemPresentations } from '@/lib/game/item-presentation';
import { getItemBadges } from '@/lib/ui/item-badges';
import { ItemIcon } from './item-icon';

/** Reference-only layout. Pool/rarity are fixed attributes, not item effects. */
export function CatalogItemCard({ item }: { item: ItemDefinition }) {
  const badges = getItemBadges(item);
  const attributes = badges.filter(
    (badge) => badge.kind === 'pool' || badge.kind === 'rarity',
  );
  const effects = badges.filter(
    (badge) => badge.kind === 'effect' || badge.kind === 'stacking',
  );
  return (
    <article className="rule-item-card" data-item-id={item.id}>
      <div className="rule-item-art" aria-hidden="true">
        <ItemIcon itemId={item.id} size="large" />
      </div>
      <header className="rule-item-heading">
        <h4>{item.name}</h4>
        <ul className="rule-item-attributes" aria-label="道具属性">
          {attributes.map((badge) => (
            <li
              key={badge.kind}
              className={`item-badge-${badge.tone}`}
              data-kind={badge.kind}
              title={`${badge.kind === 'pool' ? '道具池' : '稀有度'}：${badge.label}`}
            >
              <span className="sr-only">
                {badge.kind === 'pool' ? '道具池：' : '稀有度：'}
              </span>
              {badge.label}
            </li>
          ))}
        </ul>
      </header>
      <p>{itemPresentations[item.id].description}</p>
      <ul className="item-badges rule-item-effects" aria-label="道具效果">
        {effects.map((badge) => (
          <li
            key={`${badge.kind}:${badge.label}`}
            className={`item-badge item-badge-${badge.tone}`}
            data-emphasis={
              badge.kind === 'stacking' || badge.label === '随机触发'
                ? 'trait'
                : 'primary'
            }
            data-kind={badge.kind}
          >
            {badge.label}
          </li>
        ))}
      </ul>
    </article>
  );
}
