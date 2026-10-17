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
    if (page === '设置' || page === '规则') {
      expect(heading.querySelector('.utility-page-heading-actions')).toBeNull();
      await click('游戏', node.querySelector('.main-nav')!);
    } else {
      expect(
        heading.querySelector('.utility-page-heading-actions')!.textContent,
      ).toContain('返回主菜单');
      await click('返回主菜单', heading);
    }
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
  'hides the pre-game %s step on settings/rules/progress and restores character selection without starting a match',
  async (mode) => {
    await mount();
    await click(mode === 'classic' ? '经典模式' : '生存模式');
    const selection = node.querySelector('.character-stage')!.innerHTML;
    expect(
      node.querySelector('.page-context-bar .character-step'),
    ).not.toBeNull();
    for (const page of ['设置', '规则', '进度']) {
      await click(page, node.querySelector('.main-nav')!);
      shell(page);
      expect(node.querySelector('.page-context-bar')).toBeNull();
      if (page === '设置' || page === '规则') {
        await act(async () =>
          window.dispatchEvent(
            new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
          ),
        );
      } else
        await click('返回游戏', node.querySelector('.ranking-page-heading')!);
      shell('游戏');
      expect(
        node.querySelector('.page-context-bar .character-step'),
      ).not.toBeNull();
      expect(node.querySelector('.character-stage')!.innerHTML).toBe(selection);
    }
    expect(localStorage.getItem(gameSaveKey)).toBeNull();
    expect(localStorage.getItem(survivalSaveKey)).toBeNull();
    expect(localStorage.getItem(playerProfileKey)).toBeNull();
  },
);
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
      if (page === '设置' || page === '规则')
        expect(node.querySelector('.page-context-bar')).toBeNull();
      else
        expect(
          node.querySelector('.page-context-bar .round-status'),
        ).not.toBeNull();
      const heading = node.querySelector(
        '.ranking-stage > .ranking-page-heading',
      )!;
      if (page === '设置' || page === '规则') {
        expect(
          heading.querySelector('.utility-page-title-line > h2'),
        ).not.toBeNull();
        expect(
          heading.querySelector(
            '.utility-page-title-line > .utility-page-description',
          ),
        ).not.toBeNull();
      }
      if (page === '规则') {
        expect(
          node.querySelector('#room-utilities > .utility-page-actions'),
        ).toBeNull();
        expect(node.querySelector('#room-utilities')!.textContent).not.toMatch(
          /返回后继续选择角色|返回主菜单，不改变|当前报价保留，返回后|返回当前结算阶段/,
        );
        await click('道具图鉴', node.querySelector('.rules-tabs')!);
        expect(heading.querySelector('.rule-search-feedback')).toBeNull();
        expect(
          node.querySelector(
            '.rule-item-directory footer.rule-search-feedback',
          ),
        ).not.toBeNull();
        expect(
          node.querySelector<HTMLElement>('.rule-item-directory')!.hidden,
        ).toBe(false);
        expect(node.querySelectorAll('.rule-item-card')).toHaveLength(
          mode === 'survival' ? 25 : 26,
        );
        if (mode === 'survival')
          expect(
            node.querySelector('.rule-item-grid')!.textContent,
          ).not.toContain('黑王子之冠');
        await click('玩法规则', node.querySelector('.rules-tabs')!);
      }
      expect(localStorage.getItem(key)).toBe(before);
      if (page === '设置' || page === '规则') {
        expect(
          heading.querySelector('.utility-page-heading-actions'),
        ).toBeNull();
        await click('游戏', node.querySelector('.main-nav')!);
      } else {
        expect(
          heading.querySelector('.utility-page-heading-actions')!.textContent,
        ).toContain('返回游戏');
        await click('返回游戏', heading);
      }
      shell('游戏');
      expect(node.querySelector('#bid-A')).toBe(input);
      expect(
        node.querySelector('.page-context-bar .status-chip-money'),
      ).not.toBeNull();
      expect(localStorage.getItem(key)).toBe(before);
    }
    const value = input.value;
    await click('进度', node.querySelector('.main-nav')!);
    shell('进度');
    expect(
      node.querySelector(
        '.progress-stage .utility-page-title-line > .utility-page-description',
      ),
    ).not.toBeNull();
    expect(node.querySelector('.page-context-bar')).toBeNull();
    await click('成就');
    expect(node.querySelectorAll('.achievement-card')).toHaveLength(57);
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
    for (const page of ['设置', '规则', '进度']) {
      await click(page, node.querySelector('.main-nav')!);
      shell(page);
      expect(node.querySelector('.page-context-bar')).toBeNull();
      expect(localStorage.getItem(key)).toBe(before);
      if (page === '设置' || page === '规则') {
        await act(async () =>
          window.dispatchEvent(
            new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
          ),
        );
      } else
        await click('返回游戏', node.querySelector('.ranking-page-heading')!);
      shell('游戏');
      expect(
        node.querySelector(
          mode === 'classic'
            ? '.page-context-bar .round-status'
            : '.survival-status',
        ),
      ).not.toBeNull();
    }
    expect(node.textContent).toContain('进入下一房间');
    expect(localStorage.getItem(key)).toBe(before);
  },
);
