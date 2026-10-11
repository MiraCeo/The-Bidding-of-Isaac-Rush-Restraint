import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import manifest from '../../assets/items/manifest.json';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { itemArt, atlasCell, itemAtlas, itemAtlases } from './item-art';
import { itemCatalog } from '../game/item-catalog';
import { itemPresentations } from '../game/item-presentation';
import { ItemIcon, ItemArtAvailability } from '@/components/game/item-icon';
import { GameRules } from '@/components/game/game-rules';
import type { ItemId } from '../game/item-types';

const coords: Array<[ItemId, number, number]> = [
  ['moms_knife', 6, 13],
  ['sacred_heart', 10, 1],
  ['brimstone', 6, 17],
  ['moms_heart', 14, 14],
  ['short_brimstone', 14, 13],
  ['lucky_foot', 3, 6],
  ['transcendence', 2, 1],
  ['pentagram', 3, 11],
  ['guppys_collar', 11, 11],
  ['holy_mantle', 16, 11],
  ['twenty_twenty', 13, 3],
  ['blood_of_the_martyr', 1, 8],
  ['steam_sale', 4, 3],
  ['poor_charm', 20, 3],
  ['interest', 12, 6],
  ['d6', 6, 4],
  ['more_options', 21, 12],
  ['more_options_question', 13, 7],
  ['dark_princes_crown', 22, 20],
  ['eternal_d6', 31, 6],
  ['whore_of_babylon', 7, 1],
  ['guppys_tail', 7, 12],
];
describe('user-supplied item atlas', () => {
  it('keeps canonical resources in one folder with verified manifest hashes and no root duplicates', () => {
    for (const resource of manifest.resources) {
      const file = readFileSync(
        new URL(`../../assets/items/${resource.file}`, import.meta.url),
      );
      expect(createHash('sha256').update(file).digest('hex')).toBe(
        resource.sha256,
      );
      expect(file.readUInt32BE(16)).toBe(resource.width);
      expect(file.readUInt32BE(20)).toBe(resource.height);
      expect(
        existsSync(
          new URL(`../../../${resource.sourceFilename}`, import.meta.url),
        ),
      ).toBe(false);
    }
  });
  it('renders the native 32×32 grab-bag pickup as its own atlas instead of an emoji', () => {
    const bytes = readFileSync(
      new URL('../../assets/items/grab-bag.png', import.meta.url),
    );
    expect(bytes.readUInt32BE(16)).toBe(32);
    expect(bytes.readUInt32BE(20)).toBe(32);
    expect(itemArt.grab_bag).toMatchObject({
      kind: 'sprite',
      sheet: 'pickups',
      row: 1,
      column: 1,
    });
    const html = renderToStaticMarkup(
      createElement(ItemIcon, { itemId: 'grab_bag' }),
    );
    expect(html).toContain('data-icon-atlas="pickups"');
    expect(html).toContain('--item-atlas-rows:1');
    expect(() => atlasCell(2, 1, 'pickups')).toThrow();
  });
  it('preserves the original transparent 20×10 trinket sheet', () => {
    const runtime = readFileSync(
      new URL('../../assets/items/trinket-sprite.png', import.meta.url),
    );
    expect(createHash('sha256').update(runtime).digest('hex')).toBe(
      manifest.resources.find((r) => r.id === 'trinkets')!.sha256,
    );
    expect(runtime.readUInt32BE(16)).toBe(itemAtlases.trinkets.width);
    expect(runtime.readUInt32BE(20)).toBe(itemAtlases.trinkets.height);
    expect(runtime[25]).toBe(6);
  });
  it.each([
    ['wooden_cross', 7, 1],
    ['score_charm', 7, 19],
    ['money_bag', 8, 20],
  ] as const)('maps %s to the trinket sheet %s-%s', (id, row, column) => {
    expect(itemArt[id]).toMatchObject({
      kind: 'sprite',
      sheet: 'trinkets',
      row,
      column,
    });
    const html = renderToStaticMarkup(createElement(ItemIcon, { itemId: id }));
    expect(html).toContain('data-icon-atlas="trinkets"');
    expect(html).toContain('--item-atlas-rows:10');
    expect(atlasCell(row, column, 'trinkets')).toMatchObject({
      x: (column - 1) * 32,
      y: (row - 1) * 32,
    });
  });
  it('checks bounds against the chosen atlas instead of stretching a 10-row sheet to 40 rows', () => {
    expect(() => atlasCell(11, 1, 'trinkets')).toThrow();
    expect(() => atlasCell(11, 1, 'collectibles')).not.toThrow();
  });
  it('uses visual aliases without introducing lucky-bag drops or changing the +10/steal mechanics', () => {
    expect(itemArt.score_charm).toMatchObject({ visualAlias: '泪滴护符' });
    expect(itemArt.money_bag).toMatchObject({ visualAlias: '幸运袋' });
    expect(itemPresentations.score_charm.description).toContain('额外加 10 分');
    expect(itemPresentations.money_bag.description).toContain('窃取');
    expect(itemPresentations.money_bag.description).not.toContain('福袋');
    const html = renderToStaticMarkup(
      createElement(ItemIcon, { itemId: 'money_bag' }),
    );
    expect(html).toContain('名称与效果不变');
  });
  it('preserves the original PNG bytes and validates the exact 20×40 layout', () => {
    const runtime = readFileSync(
      new URL('../../assets/items/collectibles-sprite.png', import.meta.url),
    );
    expect(createHash('sha256').update(runtime).digest('hex')).toBe(
      manifest.resources.find((r) => r.id === 'collectibles')!.sha256,
    );
    expect(runtime.subarray(0, 8)).toEqual(
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    );
    expect(runtime.readUInt32BE(16)).toBe(itemAtlas.width);
    expect(runtime.readUInt32BE(20)).toBe(itemAtlas.height);
    expect(runtime[25]).toBe(6); // RGBA: preserve transparency instead of painting a background.
    expect(itemAtlas.width).toBe(20 * 32);
    expect(itemAtlas.height).toBe(40 * 32);
  });
  it.each(coords)(
    'maps %s to the supplied one-based cell %s-%s',
    (id, row, column) => {
      expect(itemArt[id]).toMatchObject({ kind: 'sprite', row, column });
      expect(atlasCell(row, column)).toEqual({
        x: (column - 1) * 32,
        y: (row - 1) * 32,
        columnIndex: column - 1,
        rowIndex: row - 1,
      });
    },
  );
  it('covers all 26 IDs with pictures and no pending assets', () => {
    expect(Object.keys(itemArt).sort()).toEqual(
      itemCatalog.map((i) => i.id).sort(),
    );
    expect(
      Object.entries(itemArt).filter(([, a]) => a.kind === 'sprite'),
    ).toHaveLength(26);
    expect(
      Object.entries(itemArt)
        .filter(([, a]) => a.kind === 'pending')
        .map(([id]) => id)
        .sort(),
    ).toEqual([]);
  });
  it('keeps aliases as artwork only and does not change catalog names or descriptions', () => {
    const before = JSON.stringify({ itemCatalog, itemPresentations });
    expect(itemArt.poor_charm).toMatchObject({ visualAlias: '乞丐宝' });
    expect(itemArt.interest).toMatchObject({ visualAlias: '小猪存钱罐' });
    const markup = renderToStaticMarkup(createElement(GameRules));
    expect(markup).toContain('穷人护符');
    expect(markup).toContain('利息');
    expect(markup.match(/data-icon-kind="sprite"/g)).toHaveLength(26);
    expect(markup.match(/data-icon-kind="fallback"/g) ?? []).toHaveLength(0);
    expect(JSON.stringify({ itemCatalog, itemPresentations })).toBe(before);
  });
  it('renders native-cell indexes and shared responsive icon sizes without per-tile image URLs', () => {
    const html = renderToStaticMarkup(
      createElement(ItemIcon, { itemId: 'moms_knife', size: 'room' }),
    );
    expect(html).toContain('--item-sprite-column:12');
    expect(html).toContain('--item-sprite-row:5');
    expect(html).toContain('item-icon-room');
    expect(html).not.toContain('<img');
    expect(html).not.toContain('http');
  });
  it('renders a hidden placeholder with no item ID, coordinate, asset or tooltip', () => {
    const html = renderToStaticMarkup(
      createElement(ItemIcon, { hidden: true, size: 'room' }),
    );
    expect(html).toContain('data-icon-kind="hidden"');
    expect(html).toContain('>?<');
    expect(html).not.toMatch(
      /data-item-id|sprite-column|sprite-row|title=|src=|background/,
    );
  });
  it('retains a safe resource-load fallback for mapped art', () => {
    const failed = renderToStaticMarkup(
      createElement(
        ItemArtAvailability.Provider,
        { value: { collectibles: false, trinkets: true, pickups: true } },
        createElement(ItemIcon, { itemId: 'd6' }),
      ),
    );
    expect(failed).toContain('data-icon-kind="fallback"');
    expect(failed).not.toContain('sprite-column');
  });
  it('rejects zero-based, fractional and out-of-range coordinates', () => {
    for (const [row, col] of [
      [0, 1],
      [1, 0],
      [41, 1],
      [1, 21],
      [1.5, 3],
      [NaN, 2],
    ])
      expect(() => atlasCell(row!, col!)).toThrow();
  });
});
