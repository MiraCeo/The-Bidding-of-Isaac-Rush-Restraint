// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { GameRules } from '@/components/game/game-rules';
import { UtilityPageHeading } from '@/components/game/utility-page-heading';
import { createGameRuleSections } from './game-rules';
import { itemCatalog } from '../game/item-catalog';
import { survivalItemCatalog } from '../game/survival-content';
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

it('retains all authoritative chapter copy, definitions, formulas and item presentations with the same nine gameplay targets and separate catalog panel', async () => {
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
  expect(links).toHaveLength(9);
  expect(new Set(links.map((a) => a.hash)).size).toBe(9);
  for (const link of links)
    expect(node.querySelector(link.hash)).not.toBeNull();
  expect(node.querySelectorAll('.rules-start-steps li')).toHaveLength(3);
  for (const item of itemCatalog)
    expect(node.textContent).toContain(itemPresentations[item.id].description);
  expect(node.querySelector<HTMLElement>('.rule-item-directory')!.hidden).toBe(
    true,
  );
  expect(node.querySelector('.rule-catalog')).toBeNull();
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
  await click(
    node.querySelector<HTMLButtonElement>(
      '.rules-tabs button[aria-controls$=items]',
    )!,
  );
  expect(node.querySelector<HTMLElement>('.rule-item-directory')!.hidden).toBe(
    false,
  );
  expect(
    node.querySelector<HTMLElement>('.rules-tab-panel[aria-label=玩法规则]')!
      .hidden,
  ).toBe(true);
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
  expect(observe).toHaveBeenCalledTimes(9);
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
  ).toBe('#rule-floors');
  await act(async () => window.dispatchEvent(new Event('resize')));
  expect(observe).toHaveBeenCalledTimes(18);
  expect(disconnect).toHaveBeenCalledOnce();
  await click(
    node.querySelector<HTMLButtonElement>(
      '.rules-tabs button[aria-controls$=items]',
    )!,
  );
  expect(disconnect).toHaveBeenCalledTimes(2);
  await click(
    node.querySelector<HTMLButtonElement>(
      '.rules-tabs button[aria-controls$=rules]',
    )!,
  );
  expect(observe).toHaveBeenCalledTimes(27);
  await act(async () => root.render(null));
  expect(disconnect).toHaveBeenCalledTimes(3);
  unchanged();
});

it('shows result counts for effect searches and empty results, then clears back to the entire catalog with input focus', async () => {
  await mount();
  await click(
    node.querySelector<HTMLButtonElement>(
      '.rules-tabs button[aria-controls$=items]',
    )!,
  );
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
  await click(node.querySelector<HTMLButtonElement>('.rule-search-clear')!);
  const input = node.querySelector<HTMLInputElement>('input[type=search]')!;
  expect(input.value).toBe('');
  expect(document.activeElement).toBe(input);
  expect(node.querySelectorAll('.rule-item-card')).toHaveLength(
    itemCatalog.length,
  );
  expect(node.querySelector('.rule-search-clear')).toBeNull();
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
  expect(css).toContain(
    '.rules-manual { --rules-ink:#ded1bd; --rules-muted:#bead95; width:100%; max-width:none; margin:0;',
  );
  expect(css).toContain(
    '.rules-reading-column { width:100%; min-width:0; max-width:none; margin:0; }',
  );
  expect(css).toContain('.rules-contents a[aria-current="location"]');
  expect(css).toContain('@media (max-width: 900px)');
  expect(css).toContain('.setting-select select { font-size: .78rem; }');
  expect(css).toContain('.rules-overview-description');
});

it('keeps the query across peer tabs with no inactive focus targets or profile writes', async () => {
  await mount();
  expect(
    node.querySelector('.ranking-page-heading .rule-directory-tools'),
  ).toBeNull();
  const rules = node.querySelector<HTMLElement>(
    '.rules-tab-panel[aria-label=玩法规则]',
  )!;
  const items = node.querySelector<HTMLElement>('.rule-item-directory')!;
  const tabs = [
    ...node.querySelectorAll<HTMLButtonElement>('.rules-tabs button'),
  ];
  expect(tabs.map((el) => el.textContent)).toEqual(['玩法规则', '道具图鉴']);
  await click(tabs[1]!);
  expect(
    node.querySelector('.rules-page-heading .rule-search-feedback'),
  ).toBeNull();
  expect(
    node.querySelector('.rules-page-heading .rule-search > .sr-only')!
      .textContent,
  ).toBe('查找道具');
  expect(
    node.querySelector(
      '.rule-item-directory footer.rule-search-feedback output',
    ),
  ).not.toBeNull();
  expect(node.querySelector('.rules-source-note')).toBeNull();
  expect(
    node.querySelector('.ranking-page-heading .rule-directory-tools'),
  ).not.toBeNull();
  expect(
    node.querySelector('.rule-item-directory .rule-directory-tools'),
  ).toBeNull();
  expect(node.querySelector('.rule-directory-heading')).toBeNull();
  expect(node.textContent).not.toContain('这里是通用道具说明');
  expect(
    [...node.querySelectorAll('.ranking-page-heading button')].some((el) =>
      /返回游戏|返回主菜单/.test(el.textContent ?? ''),
    ),
  ).toBe(false);
  expect(tabs[1]!.getAttribute('aria-current')).toBe('page');
  expect(rules.hidden).toBe(true);
  expect(rules.hasAttribute('inert')).toBe(true);
  expect(items.hidden).toBe(false);
  expect(items.hasAttribute('inert')).toBe(false);
  await search('屏障');
  await click(tabs[0]!);
  expect(
    node.querySelector('.ranking-page-heading .rule-directory-tools'),
  ).toBeNull();
  expect(items.hidden).toBe(true);
  expect(items.hasAttribute('inert')).toBe(true);
  await click(tabs[1]!);
  expect(
    node.querySelector<HTMLInputElement>('input[type=search]')!.value,
  ).toBe('屏障');
  expect(node.querySelectorAll('.rule-item-card')).toHaveLength(2);
  unchanged();
});

it('places an opted-in subtitle next to the title without moving the eyebrow or return actions', async () => {
  await act(async () =>
    root.render(
      createElement(
        UtilityPageHeading,
        {
          eyebrow: 'GAME RULES',
          title: '规则',
          titleId: 'test-heading',
          inlineDescription: true,
          description: '现行机制与道具说明',
        },
        createElement('button', null, '返回游戏'),
      ),
    ),
  );
  const line = node.querySelector('.utility-page-title-line')!;
  expect([...line.children].map((el) => el.tagName)).toEqual(['H2', 'P']);
  expect(line.querySelector('p')!.textContent).toBe('现行机制与道具说明');
  expect(
    node.querySelector('.utility-page-heading-copy > .eyebrow')!.textContent,
  ).toBe('GAME RULES');
  expect(
    node.querySelector('.utility-page-heading-actions button')!.textContent,
  ).toBe('返回游戏');
  const css = readFileSync('app/globals.css', 'utf8');
  expect(css).toContain(
    '.utility-page-title-line { display:flex; flex-wrap:wrap; align-items:baseline;',
  );
  expect(css).toContain('.rules-tab-panel[hidden] { display:none; }');
  expect(css).toContain(
    '.utility-page-heading-actions>.rule-directory-tools { width:260px;',
  );
  expect(css).toContain('.rule-chapter p { max-width:none;');
  expect(css).toContain('.rules-page-heading { min-height:54px; }');
  expect(css).toContain(
    '.rules-page-heading .rule-search input { display:block; height:36px;',
  );
  for (const file of [
    'game-settings',
    'progress-center',
    'game-rules',
    'survival-game-app',
  ])
    expect(readFileSync(`components/game/${file}.tsx`, 'utf8')).toContain(
      'inlineDescription',
    );
  unchanged();
});

it('keeps survival gameplay and its 25-item pool separate from classic rules and the excluded item', async () => {
  await act(async () =>
    root.render(
      createElement<{
        gameplay?: import('react').ReactNode;
        catalog?: readonly (typeof itemCatalog)[number][];
      }>(GameRules, {
        gameplay: createElement('p', null, '生存专用说明保留'),
        catalog: survivalItemCatalog,
      }),
    ),
  );
  expect(
    node.querySelector('.rules-tab-panel[aria-label=玩法规则]')!.textContent,
  ).toBe('生存专用说明保留');
  expect(node.querySelector('#rule-flow')).toBeNull();
  await click(
    node.querySelector<HTMLButtonElement>(
      '.rules-tabs button[aria-controls$=items]',
    )!,
  );
  expect(node.querySelectorAll('.rule-item-card')).toHaveLength(25);
  expect(node.querySelector('.rule-item-grid')!.textContent).not.toContain(
    '黑王子之冠',
  );
  expect(node.querySelector('.rule-search-feedback')!.textContent).toContain(
    '显示 25 / 25 件道具',
  );
  unchanged();
});
