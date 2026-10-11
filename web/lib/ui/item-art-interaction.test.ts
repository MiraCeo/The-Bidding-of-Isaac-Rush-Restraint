// @vitest-environment happy-dom
import { act, createElement, StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ItemIcon, ItemArtProvider } from '@/components/game/item-icon';
import { GameApp } from '@/components/game/game-app';
import { createGameSession, reduceGameSession } from './game-session';
import { gameSaveKey, serializeGameSave } from './game-save';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root, container: HTMLDivElement;
beforeEach(() => {
  localStorage.clear();
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
async function mount(node: ReturnType<typeof createElement>) {
  await act(async () => root.render(node));
}
function element<T extends Element>(selector: string): T {
  const value = container.querySelector<T>(selector);
  if (!value) throw new Error(`Missing ${selector}`);
  return value;
}
function button(label: string, scope: Element = container) {
  const value = Array.from(
    scope.querySelectorAll<HTMLButtonElement>('button'),
  ).find((b) => b.textContent?.trim() === label);
  if (!value) throw new Error(`Missing ${label}`);
  return value;
}
async function click(target: HTMLElement) {
  await act(async () => target.click());
}

describe('shared atlas rendering in the client', () => {
  it('isolates a pickup image failure from the two sprite sheets', async () => {
    const images: Array<{ onerror: (() => void) | null; src: string }> = [];
    class FakeImage {
      onerror: (() => void) | null = null;
      src = '';
      constructor() {
        images.push(this);
      }
    }
    vi.stubGlobal('Image', FakeImage);
    await mount(
      createElement(
        ItemArtProvider,
        null,
        createElement(
          'div',
          null,
          createElement(ItemIcon, { itemId: 'grab_bag' }),
          createElement(ItemIcon, { itemId: 'd6' }),
          createElement(ItemIcon, { itemId: 'wooden_cross' }),
        ),
      ),
    );
    expect(images).toHaveLength(3);
    await act(async () => images[2]!.onerror!());
    expect(
      element('[data-item-id="grab_bag"]').getAttribute('data-icon-kind'),
    ).toBe('fallback');
    expect(element('[data-item-id="d6"]').getAttribute('data-icon-kind')).toBe(
      'sprite',
    );
    expect(
      element('[data-item-id="wooden_cross"]').getAttribute('data-icon-kind'),
    ).toBe('sprite');
  });
  it('finds custom items by their supplied artwork names without renaming or changing them', async () => {
    await mount(createElement(GameApp));
    await click(button('规则', element('nav[aria-label="主导航"]')));
    const input = element<HTMLInputElement>('input[type="search"]');
    for (const [alias, name] of [
      ['泪滴护符', '积分护符'],
      ['幸运袋', '偷钱袋'],
      ['乞丐宝', '穷人护符'],
      ['妈妈的心脏', '以撒的心脏'],
      ['短程硫磺火', '硫磺火宝宝'],
    ]) {
      await act(async () => {
        Object.getOwnPropertyDescriptor(
          HTMLInputElement.prototype,
          'value',
        )!.set!.call(input, alias);
        input.dispatchEvent(new Event('input', { bubbles: true }));
      });
      expect(container.querySelectorAll('.rule-item-card')).toHaveLength(1);
      expect(element('.rule-item-card h4').textContent).toBe(name);
    }
  });
  it('isolates trinket load failure from collectible sprites and keeps hidden loot anonymous', async () => {
    const images: Array<{ onerror: (() => void) | null; src: string }> = [];
    class FakeImage {
      onerror: (() => void) | null = null;
      src = '';
      constructor() {
        images.push(this);
      }
    }
    vi.stubGlobal('Image', FakeImage);
    await mount(
      createElement(
        ItemArtProvider,
        null,
        createElement(
          'div',
          null,
          createElement(ItemIcon, { itemId: 'd6' }),
          createElement(ItemIcon, { itemId: 'wooden_cross' }),
          createElement(ItemIcon, { hidden: true }),
        ),
      ),
    );
    expect(images).toHaveLength(3);
    expect(
      element('[data-item-id="wooden_cross"]').getAttribute('data-icon-atlas'),
    ).toBe('trinkets');
    await act(async () => images[1]!.onerror!());
    expect(
      element('[data-item-id="wooden_cross"]').getAttribute('data-icon-kind'),
    ).toBe('fallback');
    expect(element('[data-item-id="d6"]').getAttribute('data-icon-kind')).toBe(
      'sprite',
    );
    expect(
      element('[data-icon-kind="hidden"]').hasAttribute('data-icon-atlas'),
    ).toBe(false);
    expect(
      element<HTMLElement>('.item-art-surface').style.getPropertyValue(
        '--item-trinket-atlas-url',
      ),
    ).toContain('url(');
  });
  it('switches all mapped icons to safe fallbacks when the one atlas resource fails', async () => {
    const images: Array<{ onerror: (() => void) | null; src: string }> = [];
    class FailedImage {
      onerror: (() => void) | null = null;
      src = '';
      constructor() {
        images.push(this);
      }
    }
    vi.stubGlobal('Image', FailedImage);
    await mount(
      createElement(
        ItemArtProvider,
        null,
        createElement(
          'div',
          null,
          createElement(ItemIcon, { itemId: 'd6' }),
          createElement(ItemIcon, { itemId: 'brimstone' }),
          createElement(ItemIcon, { hidden: true }),
        ),
      ),
    );
    expect(
      container.querySelectorAll('[data-icon-kind="sprite"]'),
    ).toHaveLength(2);
    await act(async () => images[0]!.onerror!());
    expect(
      container.querySelectorAll('[data-icon-kind="fallback"]'),
    ).toHaveLength(2);
    expect(
      container.querySelectorAll('[data-icon-kind="hidden"]'),
    ).toHaveLength(1);
    expect(
      element<HTMLElement>('.item-art-surface').style.getPropertyValue(
        '--item-atlas-url',
      ),
    ).toContain('url(');
  });
  it('shows mapped inventory/catalog icons without changing the live draft or stored game', async () => {
    const session = reduceGameSession(createGameSession(42), {
      type: 'start_game',
      characterId: 'isaac',
    });
    localStorage.setItem(gameSaveKey, serializeGameSave(session));
    await mount(createElement(StrictMode, null, createElement(GameApp)));
    const before = localStorage.getItem(gameSaveKey)!;
    await click(element<HTMLButtonElement>('[aria-label="查看角色构筑"]'));
    expect(
      element('.player-build-content [data-item-id="d6"]').getAttribute(
        'data-icon-kind',
      ),
    ).toBe('sprite');
    await click(button('规则', element('nav[aria-label="主导航"]')));
    expect(
      container.querySelectorAll('.rule-item-grid [data-icon-kind="sprite"]'),
    ).toHaveLength(26);
    expect(
      container.querySelectorAll('.rule-item-grid [data-icon-kind="fallback"]'),
    ).toHaveLength(0);
    await click(button('游戏', element('nav[aria-label="主导航"]')));
    expect(localStorage.getItem(gameSaveKey)).toBe(before);
  });
});
