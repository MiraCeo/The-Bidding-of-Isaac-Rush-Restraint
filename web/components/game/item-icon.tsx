import {
  createContext,
  useContext,
  useEffect,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import atlasUrl from '@/assets/items/collectibles-sprite.png?inline';
import trinketUrl from '@/assets/items/trinket-sprite.png?inline';
import pickupUrl from '@/assets/items/grab-bag.png?inline';
import {
  itemArt,
  atlasCell,
  itemAtlases,
  type ItemAtlasId,
} from '@/lib/ui/item-art';
import { getItemDefinition } from '@/lib/game/item-catalog';
import { itemPresentations } from '@/lib/game/item-presentation';
import type { ItemId } from '@/lib/game/item-types';

export const ItemArtAvailability = createContext<Record<ItemAtlasId, boolean>>({
  collectibles: true,
  trinkets: true,
  pickups: true,
});
const atlasUrls = {
  collectibles: atlasUrl,
  trinkets: trinketUrl,
  pickups: pickupUrl,
} as const;
/** One URL per atlas, with independent loading failure and shared decoded images. */
export function ItemArtProvider({ children }: { children: ReactNode }) {
  const [available, setAvailable] = useState({
    collectibles: true,
    trinkets: true,
    pickups: true,
  });
  useEffect(() => {
    const images = (Object.keys(atlasUrls) as ItemAtlasId[]).map((sheet) => {
      const image = new Image();
      image.onerror = () =>
        setAvailable((current) => ({ ...current, [sheet]: false }));
      image.src = atlasUrls[sheet];
      return image;
    });
    return () => {
      images.forEach((image) => {
        image.onerror = null;
      });
    };
  }, []);
  return (
    <ItemArtAvailability.Provider value={available}>
      <div
        className="item-art-surface"
        style={
          {
            '--item-atlas-url': `url("${atlasUrl}")`,
            '--item-trinket-atlas-url': `url("${trinketUrl}")`,
            '--item-pickup-atlas-url': `url("${pickupUrl}")`,
          } as CSSProperties
        }
      >
        {children}
      </div>
    </ItemArtAvailability.Provider>
  );
}
type ItemIconProps = {
  size?: 'small' | 'medium' | 'large' | 'room';
  className?: string;
} & ({ hidden: true; itemId?: never } | { hidden?: false; itemId: ItemId });

export function ItemIcon(props: ItemIconProps) {
  const available = useContext(ItemArtAvailability);
  const base = `item-icon item-icon-${props.size ?? 'small'} ${props.className ?? ''}`;
  // Never select a resource, expose a coordinate, or read an item ID for hidden loot.
  if (props.hidden)
    return (
      <span
        className={`${base} item-icon-hidden`}
        aria-hidden="true"
        data-icon-kind="hidden"
      >
        ?
      </span>
    );
  const art = itemArt[props.itemId];
  if (art.kind === 'pending' || !available[art.sheet ?? 'collectibles'])
    return (
      <span
        className={`${base} item-icon-fallback`}
        aria-hidden="true"
        data-icon-kind="fallback"
        data-item-id={props.itemId}
      >
        {itemPresentations[props.itemId].emoji}
      </span>
    );
  const sheet = art.sheet ?? 'collectibles';
  const cell = atlasCell(art.row, art.column, sheet);
  return (
    <span
      className={`${base} item-icon-sprite item-icon-atlas-${sheet}`}
      aria-hidden="true"
      data-icon-kind="sprite"
      data-icon-atlas={sheet}
      data-item-id={props.itemId}
      title={
        art.visualAlias
          ? `${getItemDefinition(props.itemId).name}：图标采用${art.visualAlias}，名称与效果不变。`
          : undefined
      }
      style={
        {
          '--item-sprite-column': cell.columnIndex,
          '--item-sprite-row': cell.rowIndex,
          '--item-atlas-columns': itemAtlases[sheet].columns,
          '--item-atlas-rows': itemAtlases[sheet].rows,
        } as CSSProperties
      }
    />
  );
}
