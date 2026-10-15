// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, expect, it } from 'vitest';
import { GameApp } from '@/components/game/game-app';
import { appVersion } from './game-version';
import { createGameSession, reduceGameSession } from './game-session';
import { gameSaveKey, serializeGameCheckpoint } from './game-save';
import {
  activeModeKey,
  startSurvivalClient,
  reduceSurvivalClient,
} from './survival-client';
import {
  survivalSaveKey,
  serializeSurvivalCheckpoint,
} from './survival-persistence';
import { playerProfileKey } from './player-profile';
(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root, node: HTMLDivElement;
beforeEach(() => {
  localStorage.clear();
  node = document.createElement('div');
  document.body.append(node);
  root = createRoot(node);
});
afterEach(async () => {
  await act(async () => root.unmount());
  node.remove();
});
const mount = async () => act(async () => root.render(createElement(GameApp)));
const click = async (label: string, scope: Element = node) =>
  act(async () => {
    const b = [...scope.querySelectorAll<HTMLButtonElement>('button')].find(
      (b) => b.textContent?.trim() === label,
    );
    if (!b) throw Error('Missing ' + label);
    b.click();
  });
function shell(page: string) {
  expect(node.querySelectorAll('.topbar')).toHaveLength(1);
  const header = node.querySelector('.topbar')!;
  expect(header.querySelector('h1')!.textContent).toBe('以撒的竞合：冲 · 慎');
  expect(header.querySelectorAll('.app-version')).toHaveLength(1);
  expect(header.querySelector('.app-version')!.textContent).toBe(
    `v${appVersion}`,
  );
  expect(header.querySelector('.status-chip')).toBeNull();
  expect(header.textContent).not.toContain('主菜单');
  expect(
    [...header.querySelectorAll('nav button')].map((b) => b.textContent),
  ).toEqual(['游戏', '排行', '进度', '设置', '规则']);
  expect(header.querySelector('[aria-current=page]')!.textContent).toBe(page);
}
it('shares a compact header and heading actions across the five menu-origin pages without creating player data', async () => {
  await mount();
  shell('游戏');
  for (const page of ['排行', '进度', '设置', '规则']) {
    await click(page, node.querySelector('.main-nav')!);
    shell(page);
    expect(node.querySelector('.page-context-bar')).toBeNull();
    const heading = node.querySelector(
      '.ranking-stage > .ranking-page-heading',
    )!;
    expect(
      heading.querySelector('.utility-page-heading-copy h2'),
    ).not.toBeNull();
    expect(heading.querySelector('.utility-page-description')).not.toBeNull();
    expect(
      heading.querySelector('.utility-page-heading-actions')!.textContent,
    ).toContain('返回主菜单');
    await click('返回主菜单', heading);
    shell('游戏');
    expect(node.querySelector<HTMLElement>('.mode-menu-stage')!.hidden).toBe(
      false,
    );
  }
  expect(localStorage.getItem(playerProfileKey)).toBeNull();
  expect(localStorage.getItem(gameSaveKey)).toBeNull();
  expect(localStorage.getItem(survivalSaveKey)).toBeNull();
});
it.each(['classic', 'survival'] as const)(
  'keeps the %s bid inputs and real context through ranking/settings/rules; progress is read-only',
  async (mode) => {
    if (mode === 'classic') {
      const s = reduceGameSession(createGameSession(42), {
        type: 'start_game',
        characterId: 'isaac',
      });
      localStorage.setItem(gameSaveKey, serializeGameCheckpoint(s));
    } else
      localStorage.setItem(
        survivalSaveKey,
        serializeSurvivalCheckpoint(
          startSurvivalClient('isaac', 3, 'highest').game,
        ),
      );
    localStorage.setItem(activeModeKey, mode);
    await mount();
    shell('游戏');
    const key = mode === 'classic' ? gameSaveKey : survivalSaveKey,
      before = localStorage.getItem(key),
      profile = localStorage.getItem(playerProfileKey),
      input = node.querySelector<HTMLInputElement>('#bid-A')!;
    expect(input).not.toBeNull();
    expect(
      node.querySelector('.page-context-bar .status-chip-money strong'),
    ).not.toBeNull();
    for (const page of ['排行', '设置', '规则']) {
      await click(page, node.querySelector('.main-nav')!);
      shell(page);
      const heading = node.querySelector(
        '.ranking-stage > .ranking-page-heading',
      )!;
      expect(
        heading.querySelector('.utility-page-heading-actions')!.textContent,
      ).toContain('返回游戏');
      expect(localStorage.getItem(key)).toBe(before);
      await click('返回游戏', heading);
      shell('游戏');
      expect(node.querySelector('#bid-A')).toBe(input);
      expect(localStorage.getItem(key)).toBe(before);
    }
    const value = input.value;
    await click('进度', node.querySelector('.main-nav')!);
    shell('进度');
    expect(
      node.querySelector('.page-context-bar .round-status')!.textContent,
    ).toContain('第 1 层');
    await click('成就');
    expect(node.querySelectorAll('.achievement-card')).toHaveLength(36);
    await click(
      '返回游戏',
      node.querySelector('.progress-stage > .ranking-page-heading')!,
    );
    shell('游戏');
    expect(node.querySelector<HTMLInputElement>('#bid-A')!.value).toBe(value);
    expect(localStorage.getItem(key)).toBe(before);
    expect(localStorage.getItem(playerProfileKey)).toBe(profile);
  },
);
it.each(['classic', 'survival'] as const)(
  'uses the same shell and preserves the %s settled phase when opening a utility',
  async (mode) => {
    if (mode === 'classic') {
      const s = reduceGameSession(
        reduceGameSession(createGameSession(42), {
          type: 'start_game',
          characterId: 'isaac',
        }),
        {
          type: 'submit_player_turn',
          turn: { playerId: 'human', actions: [{ type: 'withdraw' }] },
        },
      );
      localStorage.setItem(gameSaveKey, serializeGameCheckpoint(s));
    } else {
      const s = reduceSurvivalClient(
        startSurvivalClient('isaac', 3, 'highest'),
        {
          type: 'submit_player_turn',
          turn: { playerId: 'human', actions: [{ type: 'withdraw' }] },
        },
      );
      localStorage.setItem(
        survivalSaveKey,
        serializeSurvivalCheckpoint(s.game, s.draft),
      );
    }
    localStorage.setItem(activeModeKey, mode);
    await mount();
    shell('游戏');
    const key = mode === 'classic' ? gameSaveKey : survivalSaveKey,
      before = localStorage.getItem(key);
    await click('设置', node.querySelector('.main-nav')!);
    shell('设置');
    await click('返回游戏', node.querySelector('.ranking-page-heading')!);
    shell('游戏');
    expect(node.textContent).toContain('进入下一房间');
    expect(localStorage.getItem(key)).toBe(before);
  },
);
