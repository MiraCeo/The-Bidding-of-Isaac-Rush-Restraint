import type { ItemId } from '../game/item-types';
import { persistedItemNames } from './item-labels';

export const itemAtlas = {
  cellSize: 32,
  columns: 20,
  rows: 40,
  width: 640,
  height: 1280,
} as const;
export const itemAtlases = {
  collectibles: itemAtlas,
  trinkets: { cellSize: 32, columns: 20, rows: 10, width: 640, height: 320 },
  pickups: { cellSize: 32, columns: 1, rows: 1, width: 32, height: 32 },
} as const;
export type ItemAtlasId = keyof typeof itemAtlases;
type SpriteArt = {
  kind: 'sprite';
  sheet?: ItemAtlasId;
  row: number;
  column: number;
  visualAlias?: string;
};
type PendingArt = { kind: 'pending'; reason: string };
/** User-supplied one-based row-column coordinates; this is art metadata, not game data. */
export const itemArt: Readonly<Record<ItemId, SpriteArt | PendingArt>> = {
  moms_knife: { kind: 'sprite', row: 6, column: 13 },
  sacred_heart: { kind: 'sprite', row: 10, column: 1 },
  brimstone: { kind: 'sprite', row: 6, column: 17 },
  moms_heart: { kind: 'sprite', row: 14, column: 14 },
  lucky_foot: { kind: 'sprite', row: 3, column: 6 },
  transcendence: { kind: 'sprite', row: 2, column: 1 },
  short_brimstone: { kind: 'sprite', row: 14, column: 13 },
  pentagram: { kind: 'sprite', row: 3, column: 11 },
  guppys_collar: { kind: 'sprite', row: 11, column: 11 },
  holy_mantle: { kind: 'sprite', row: 16, column: 11 },
  twenty_twenty: { kind: 'sprite', row: 13, column: 3 },
  blood_of_the_martyr: { kind: 'sprite', row: 1, column: 8 },
  steam_sale: { kind: 'sprite', row: 4, column: 3 },
  money_bag: {
    kind: 'sprite',
    sheet: 'trinkets',
    row: 8,
    column: 20,
    visualAlias: '幸运袋',
  },
  poor_charm: { kind: 'sprite', row: 20, column: 3, visualAlias: '乞丐宝' },
  grab_bag: { kind: 'sprite', sheet: 'pickups', row: 1, column: 1 },
  score_charm: {
    kind: 'sprite',
    sheet: 'trinkets',
    row: 7,
    column: 19,
    visualAlias: '泪滴护符',
  },
  interest: { kind: 'sprite', row: 12, column: 6, visualAlias: '小猪存钱罐' },
  d6: { kind: 'sprite', row: 6, column: 4 },
  wooden_cross: { kind: 'sprite', sheet: 'trinkets', row: 7, column: 1 },
  more_options: { kind: 'sprite', row: 21, column: 12 },
  more_options_question: { kind: 'sprite', row: 13, column: 7 },
  dark_princes_crown: { kind: 'sprite', row: 22, column: 20 },
  eternal_d6: { kind: 'sprite', row: 31, column: 6 },
  whore_of_babylon: { kind: 'sprite', row: 7, column: 1 },
  guppys_tail: { kind: 'sprite', row: 7, column: 12 },
};
export function itemVisualAlias(id: ItemId): string {
  const art = itemArt[id];
  return [
    art.kind === 'sprite' ? (art.visualAlias ?? '') : '',
    persistedItemNames[id] ?? '',
  ]
    .filter(Boolean)
    .join(' ');
}
export function atlasCell(
  row: number,
  column: number,
  sheet: ItemAtlasId = 'collectibles',
) {
  const atlas = itemAtlases[sheet];
  if (
    !Number.isInteger(row) ||
    !Number.isInteger(column) ||
    row < 1 ||
    row > atlas.rows ||
    column < 1 ||
    column > atlas.columns
  )
    throw new RangeError('道具图集坐标超出范围。');
  return {
    x: (column - 1) * atlas.cellSize,
    y: (row - 1) * atlas.cellSize,
    columnIndex: column - 1,
    rowIndex: row - 1,
  };
}
