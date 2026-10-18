// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { classicDifficulties } from '../game/classic-difficulty';
import { GameApp } from '@/components/game/game-app';
import { PlayerStatistics } from '@/components/game/player-statistics';
import { gameSaveKey, parseGameSave } from './game-save';
import {
  playerProfileKey,
  createPlayerProfile,
  readPlayerProfile,
} from './player-profile';
import { registerCompletion } from './completion-registry';
import { completionRecordFixture } from './completion-registry.test-helper';
(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root,
  node: HTMLDivElement,
  descriptor: PropertyDescriptor | undefined;
beforeEach(() => {
  localStorage.clear();
  node = document.createElement('div');
  document.body.append(node);
  root = createRoot(node);
  descriptor = Object.getOwnPropertyDescriptor(navigator, 'locks');
  Object.defineProperty(navigator, 'locks', {
    configurable: true,
    value: {
      request: async (_n: string, _o: unknown, work: () => unknown) => work(),
    },
  });
});
afterEach(async () => {
  await act(async () => root.unmount());
  node.remove();
  vi.restoreAllMocks();
  if (descriptor) Object.defineProperty(navigator, 'locks', descriptor);
  else Reflect.deleteProperty(navigator, 'locks');
});
const click = async (label: string, scope: Element = node) =>
  act(async () => {
    const b = [...scope.querySelectorAll<HTMLButtonElement>('button')].find(
      (b) => b.textContent?.trim() === label,
    );
    if (!b) throw Error('Missing ' + label);
    b.click();
  });
const render = async (e: ReturnType<typeof createElement>) =>
  act(async () => root.render(e));
it('starts classic with a real chosen setting, locks it, preserves it across utilities/reload, and keeps survival selection independent', async () => {
  await render(createElement(GameApp));
  await click('经典模式');
  const picker = node.querySelector('.classic-difficulty-picker')!;
  expect(
    picker.querySelector<HTMLInputElement>('input[value=highest]')!.checked,
  ).toBe(true);
  const before = localStorage.getItem(playerProfileKey);
  await act(async () =>
    picker.querySelector<HTMLInputElement>('input[value=easy]')!.click(),
  );
  expect(localStorage.getItem(gameSaveKey)).toBeNull();
  expect(localStorage.getItem(playerProfileKey)).toBe(before);
  await act(async () =>
    node.querySelector<HTMLInputElement>('.character-radio')!.click(),
  );
  await click('开始游戏');
  const source = localStorage.getItem(gameSaveKey)!;
  expect(parseGameSave(source).session.game).toMatchObject({
    classicAi: { policy: 'classic-tiered-1', difficulty: 'easy' },
  });
  expect(node.querySelector('.classic-difficulty-picker')).toBeNull();
  expect(node.querySelector('.page-context-bar')!.textContent).toContain(
    '难度 简单',
  );
  await click('设置', node.querySelector('.main-nav')!);
  await act(async () =>
    window.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
    ),
  );
  expect(localStorage.getItem(gameSaveKey)).toBe(source);
  await click('返回主菜单');
  await click('生存模式');
  expect(
    node.querySelector<HTMLInputElement>(
      '.survival-difficulty-options input[value=standard]',
    )!.checked,
  ).toBe(true);
  await act(async () =>
    node
      .querySelector<HTMLInputElement>(
        '.survival-difficulty-options input[value=hard]',
      )!
      .click(),
  );
  await click('返回主菜单');
  await click('经典模式');
  expect(node.querySelector('.page-context-bar')!.textContent).toContain(
    '难度 简单',
  );
  expect(
    parseGameSave(localStorage.getItem(gameSaveKey)!).session.game,
  ).toMatchObject({ classicAi: { difficulty: 'easy' } });
  await act(async () => root.unmount());
  root = createRoot(node);
  await render(createElement(GameApp));
  expect(node.querySelector('.page-context-bar')!.textContent).toContain(
    '难度 简单',
  );
  expect(node.querySelector('.classic-difficulty-picker')).toBeNull();
});
it('filters registered classic counts by actual difficulty and keeps old aggregate rows ungraded rather than standard/highest', async () => {
  let p = createPlayerProfile();
  for (const [i, d] of [undefined, ...classicDifficulties].entries())
    p = registerCompletion(
      p,
      {
        ...completionRecordFixture(i),
        ...(d ? { aiDifficulty: d } : {}),
      },
      [],
      false,
    );
  p = readPlayerProfile(p);
  await render(
    createElement(PlayerStatistics, {
      profile: p,
      message: '',
      mode: 'classic',
      decimals: 2,
      onFiltersChange: () => {},
    }),
  );
  const select = node.querySelector<HTMLSelectElement>(
    'select[aria-label="统计难度"]',
  )!;
  expect(
    node.querySelector('.statistics-cards article strong')!.textContent,
  ).toBe('5');
  for (const d of ['easy', 'standard', 'hard', 'highest', 'ungraded']) {
    await act(async () => {
      select.value = d;
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(
      node.querySelector('.statistics-cards article strong')!.textContent,
    ).toBe('1');
  }
  expect(select.querySelector('option[value=ungraded]')!.textContent).toBe(
    '原版（未分档）',
  );
});
