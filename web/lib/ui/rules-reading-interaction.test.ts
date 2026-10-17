// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { GameRules } from '@/components/game/game-rules';
import { createGameRuleSections } from './game-rules';
import { itemCatalog } from '../game/item-catalog';
import { itemPresentations } from '../game/item-presentation';
import { gameSaveKey } from './game-save';
import { playerProfileKey } from './player-profile';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root, node: HTMLDivElement;
beforeEach(() => {
  localStorage.clear();
  localStorage.setItem(gameSaveKey, 'checkpoint-untouched');
  localStorage.setItem(playerProfileKey, 'profile-untouched');
  node = document.createElement('div');
  document.body.append(node);
  root = createRoot(node);
});
afterEach(async () => {
  await act(async () => root.unmount());
  node.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
const mount = () => act(async () => root.render(createElement(GameRules)));
const click = (el: HTMLElement) => act(async () => el.click());
const search = async (value: string) =>
  act(async () => {
    const input = node.querySelector<HTMLInputElement>('input[type=search]')!;
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value',
    )!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
const unchanged = () => {
  expect(localStorage.getItem(gameSaveKey)).toBe('checkpoint-untouched');
  expect(localStorage.getItem(playerProfileKey)).toBe('profile-untouched');
  expect(localStorage.length).toBe(2);
};

it('retains all authoritative chapter copy, definitions, formulas and item presentations with the same ten unique targets', async () => {
  await mount();
  for (const section of createGameRuleSections()) {
    const el = node.querySelector<HTMLElement>(`#rule-${section.id}`)!;
    expect(el).not.toBeNull();
    for (const text of section.paragraphs.slice(section.comparison ? 1 : 0))
      expect(el.textContent).toContain(
        section.id === 'actions' ? text.replace('：', '') : text,
      );
    if (section.formula) {
      expect(el.textContent).toContain(section.formula.expression);
      expect(el.textContent).toContain(section.formula.caption);
    }
    for (const row of section.comparison?.rows ?? []) {
      expect(el.textContent).toContain(row.label);
      expect(el.textContent).toContain(row.purpose);
    }
  }
  const links = [
    ...node.querySelectorAll<HTMLAnchorElement>('.rules-contents a'),
  ];
  expect(links).toHaveLength(10);
  expect(new Set(links.map((a) => a.hash)).size).toBe(10);
  for (const link of links)
    expect(node.querySelector(link.hash)).not.toBeNull();
  expect(node.querySelectorAll('.rules-start-steps li')).toHaveLength(3);
  for (const item of itemCatalog)
    expect(node.textContent).toContain(itemPresentations[item.id].description);
  expect(node.querySelector<HTMLDetailsElement>('.rule-catalog')!.open).toBe(
    false,
  );
  unchanged();
});

it('supports directory clicks without IntersectionObserver, opens the item catalog, and highlights one current location', async () => {
  vi.stubGlobal('IntersectionObserver', undefined);
  await mount();
  expect(
    node.querySelector('[aria-current=location]')!.getAttribute('href'),
  ).toBe('#rules-quick-start');
  await click(
    node.querySelector<HTMLAnchorElement>('a[href="#rule-actions"]')!,
  );
  expect(node.querySelectorAll('[aria-current=location]')).toHaveLength(1);
  expect(
    node.querySelector('[aria-current=location]')!.getAttribute('href'),
  ).toBe('#rule-actions');
  await click(node.querySelector<HTMLAnchorElement>('a[href="#rule-items"]')!);
  expect(node.querySelector<HTMLDetailsElement>('.rule-catalog')!.open).toBe(
    true,
  );
  expect(
    node.querySelector('[aria-current=location]')!.getAttribute('href'),
  ).toBe('#rule-items');
  unchanged();
});

it('tracks visible chapters with a scoped observer and disconnects when the rules page leaves', async () => {
  let notify: IntersectionObserverCallback = () => {};
  let margin = '';
  const observe = vi.fn(),
    disconnect = vi.fn();
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      constructor(
        callback: IntersectionObserverCallback,
        options: IntersectionObserverInit,
      ) {
        notify = callback;
        margin = options.rootMargin ?? '';
      }
      observe = observe;
      disconnect = disconnect;
    },
  );
  await mount();
  expect(observe).toHaveBeenCalledTimes(10);
  expect(margin).not.toContain('%');
  [...node.querySelectorAll<HTMLElement>('[data-rule-target]')].forEach(
    (el, index) => {
      vi.spyOn(el, 'getBoundingClientRect').mockReturnValue(
        new DOMRect(0, (index - 4) * 200 + 24, 500, 180),
      );
    },
  );
  const target = node.querySelector('#rule-market')!;
  await act(async () =>
    notify(
      [
        {
          isIntersecting: true,
          target,
          boundingClientRect: { top: 30 },
        } as IntersectionObserverEntry,
      ],
      {} as IntersectionObserver,
    ),
  );
  expect(
    node.querySelector('[aria-current=location]')!.getAttribute('href'),
  ).toBe('#rule-market');
  vi.spyOn(document.documentElement, 'scrollHeight', 'get').mockReturnValue(
    window.innerHeight + 1,
  );
  await act(async () => notify([], {} as IntersectionObserver));
  expect(
    node.querySelector('[aria-current=location]')!.getAttribute('href'),
  ).toBe('#rule-items');
  await act(async () => window.dispatchEvent(new Event('resize')));
  expect(observe).toHaveBeenCalledTimes(20);
  expect(disconnect).toHaveBeenCalledOnce();
  await act(async () => root.render(null));
  expect(disconnect).toHaveBeenCalledTimes(2);
  unchanged();
});

it('shows result counts for effect searches and empty results, then clears back to the entire catalog with input focus', async () => {
  await mount();
  await click(node.querySelector<HTMLAnchorElement>('a[href="#rule-items"]')!);
  await search('福袋');
  expect(node.querySelectorAll('.rule-item-card')).toHaveLength(1);
  expect(node.querySelector('.rule-search-feedback output')!.textContent).toBe(
    `显示 1 / ${itemCatalog.length} 件道具`,
  );
  await search('不存在的道具关键词');
  expect(node.querySelectorAll('.rule-item-card')).toHaveLength(0);
  expect(node.querySelector('.empty-result')!.textContent).toContain(
    '没有匹配',
  );
  await click(
    node.querySelector<HTMLButtonElement>('.rule-search-feedback button')!,
  );
  const input = node.querySelector<HTMLInputElement>('input[type=search]')!;
  expect(input.value).toBe('');
  expect(document.activeElement).toBe(input);
  expect(node.querySelectorAll('.rule-item-card')).toHaveLength(
    itemCatalog.length,
  );
  expect(node.querySelector('.rule-search-feedback button')).toBeNull();
  unchanged();
});

it('keeps tutorial navigation explicit and optional without a page-load callback or storage mutation', async () => {
  const tutorial = vi.fn();
  await act(async () =>
    root.render(
      createElement<{ onOpenTutorial?: () => void }>(GameRules, {
        onOpenTutorial: tutorial,
      }),
    ),
  );
  expect(tutorial).not.toHaveBeenCalled();
  await click(
    node.querySelector<HTMLButtonElement>('.rules-overview-heading > button')!,
  );
  expect(tutorial).toHaveBeenCalledOnce();
  await mount();
  expect(node.querySelector('.rules-overview-heading > button')).toBeNull();
  unchanged();
});

it('uses one bounded reading rail, an ordinary-PC sticky directory and a visible current state without changing the settings selectors', () => {
  const css = readFileSync('app/globals.css', 'utf8');
  expect(css).toContain('max-width:1280px; margin-inline:auto;');
  expect(css).toContain(
    '.rules-reading-column { width:100%; min-width:0; max-width:none; margin:0; }',
  );
  expect(css).toContain('.rules-contents a[aria-current="location"]');
  expect(css).toContain('@media (max-width: 900px)');
  expect(css).toContain('.setting-select select { font-size: .78rem; }');
  expect(css).toContain('.rules-overview-description');
});
