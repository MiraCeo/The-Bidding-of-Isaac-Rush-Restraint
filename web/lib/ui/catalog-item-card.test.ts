// @vitest-environment happy-dom
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { CatalogItemCard } from '@/components/game/catalog-item-card';
import { ItemBadges } from '@/components/game/item-badges';
import { ItemArtAvailability } from '@/components/game/item-icon';
import { itemCatalog } from '../game/item-catalog';
import { itemPresentations } from '../game/item-presentation';
import { getItemBadges } from './item-badges';

const render = (index: number) => {
  const el = document.createElement('div');
  el.innerHTML = renderToStaticMarkup(
    createElement(CatalogItemCard, { item: itemCatalog[index]! }),
  );
  return el;
};

it('gives every item exactly two fixed attributes and leaves all effect facts in the lower group', () => {
  const before = JSON.stringify({ itemCatalog, itemPresentations });
  for (let i = 0; i < itemCatalog.length; i++) {
    const item = itemCatalog[i]!,
      el = render(i),
      badges = getItemBadges(item);
    const attributes = [...el.querySelectorAll('.rule-item-attributes li')];
    expect(attributes.map((a) => a.getAttribute('data-kind'))).toEqual([
      'pool',
      'rarity',
    ]);
    expect(
      attributes.every((a, index) =>
        a.textContent!.endsWith(badges[index]!.label),
      ),
    ).toBe(true);
    const effects = [...el.querySelectorAll('.rule-item-effects li')];
    expect(effects.map((a) => a.textContent)).toEqual(
      badges.slice(2).map((b) => b.label),
    );
    expect(el.querySelector('.rule-item-effects [data-kind=pool]')).toBeNull();
    expect(
      el.querySelector('.rule-item-effects [data-kind=rarity]'),
    ).toBeNull();
    expect(el.querySelector('h4')!.textContent).toBe(item.name);
    expect(el.querySelector('.rule-item-card>p')!.textContent).toBe(
      itemPresentations[item.id].description,
    );
  }
  expect(JSON.stringify({ itemCatalog, itemPresentations })).toBe(before);
});

it('reserves a separate large-icon rail rather than keeping the icon inside the title', () => {
  for (let i = 0; i < itemCatalog.length; i++) {
    const el = render(i);
    expect(
      el
        .querySelector('.rule-item-art .item-icon-large')!
        .getAttribute('data-item-id'),
    ).toBe(itemCatalog[i]!.id);
    expect(el.querySelector('.rule-item-heading .item-icon')).toBeNull();
    expect(
      el.querySelector('.rule-item-heading .rule-item-attributes'),
    ).not.toBeNull();
    expect(
      el.querySelector('.rule-item-art')!.getAttribute('aria-hidden'),
    ).toBe('true');
  }
});

it('keeps random and stacking traits readable but distinct from primary effect labels', () => {
  for (let i = 0; i < itemCatalog.length; i++) {
    const el = render(i);
    for (const tag of el.querySelectorAll('.rule-item-effects li')) {
      expect(tag.getAttribute('data-emphasis')).toBe(
        tag.getAttribute('data-kind') === 'stacking' ||
          tag.textContent === '随机触发'
          ? 'trait'
          : 'primary',
      );
    }
  }
});

it('retains the name, effect and large emoji fallback when an atlas is unavailable', () => {
  const item = itemCatalog[0]!;
  const html = renderToStaticMarkup(
    createElement(
      ItemArtAvailability.Provider,
      { value: { collectibles: false, trinkets: false, pickups: false } },
      createElement(CatalogItemCard, { item }),
    ),
  );
  const el = document.createElement('div');
  el.innerHTML = html;
  expect(
    el.querySelector('.rule-item-art .item-icon-fallback.item-icon-large'),
  ).not.toBeNull();
  expect(el.querySelector('h4')!.textContent).toBe(item.name);
  expect(el.querySelector('.rule-item-card>p')!.textContent).toBe(
    itemPresentations[item.id].description,
  );
});

it('does not change the shared badges used by room rewards and inventories', () => {
  const el = document.createElement('div');
  el.innerHTML = renderToStaticMarkup(
    createElement(ItemBadges, { item: itemCatalog[0]! }),
  );
  expect(
    [...el.querySelectorAll('li')].map((a) => a.getAttribute('data-kind')),
  ).toEqual(['pool', 'rarity', 'effect', 'stacking']);
  expect(el.querySelector('.rule-item-attributes')).toBeNull();
  expect(el.querySelector('ul')!.getAttribute('aria-label')).toBe('道具标签');
});

it('scopes artwork and attribute styling to catalog cards without fixed heights, truncation or sprite transforms', () => {
  const css = readFileSync('app/globals.css', 'utf8');
  expect(css).toContain('.rule-item-art { grid-column:1; grid-row:1 / 4;');
  expect(css).toContain('.rule-item-art .item-icon { --item-icon-size:64px;');
  expect(css).toContain(
    '.rule-item-attributes { display:inline-grid; grid-template-columns:repeat(2,minmax(0,1fr));',
  );
  expect(css).toContain('.rule-item-effects { grid-column:2; align-self:end;');
  const heading = css.split('.rule-item-card h4 {')[1]!.split('}')[0]!;
  expect(heading).toContain('overflow-wrap:anywhere');
  expect(heading).not.toContain('ellipsis');
  expect(css.split('.rule-item-card {')[1]!.split('}')[0]!).not.toContain(
    'height:',
  );
});

it('enlarges only dialog artwork and typography while keeping its return action compact', () => {
  const css = readFileSync('app/globals.css', 'utf8');
  expect(css).toContain('width:min(800px,calc(100vw - 32px))');
  expect(css).toContain(
    '.final-item-dialog .rule-item-art .item-icon { --item-icon-size:160px;',
  );
  expect(css).toContain(
    '.final-item-dialog .rule-item-heading h4 { color:#fff2d5; font-size:1.75rem;',
  );
  expect(css).toContain(
    '.final-item-dialog-actions { display:flex; justify-content:flex-end;',
  );
  const action = css.split('.final-item-done {')[1]!.split('}')[0]!;
  expect(action).not.toContain('width:');
  expect(css).toContain(
    '.final-item-dialog .rule-item-art .item-icon { --item-icon-size:96px; }',
  );
});
