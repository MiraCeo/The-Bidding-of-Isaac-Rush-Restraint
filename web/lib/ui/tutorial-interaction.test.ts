// @vitest-environment happy-dom
import { act, createElement, StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ClassicGameApp as GameApp } from '@/components/game/classic-game-app';
import { createGameSession, reduceGameSession } from './game-session';
import { gameSaveKey } from './game-save';
import { serializeSessionFixture as serializeGameSave } from './save-fixture.test-helper';
import * as rooms from '../game/rooms';
import * as ai from '../game/ai-decision';
import { appVersion, saveCompatibility } from './game-version';

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
  document.querySelector('meta[data-version-test]')?.remove();
  vi.restoreAllMocks();
});
async function mount() {
  await act(async () =>
    root.render(createElement(StrictMode, null, createElement(GameApp))),
  );
}
function element<T extends Element>(selector: string): T {
  const value = container.querySelector<T>(selector);
  if (!value) throw new Error(`Missing ${selector}`);
  return value;
}
function button(label: string, scope: Element = container): HTMLButtonElement {
  const found = Array.from(scope.querySelectorAll('button')).find(
    (b) => b.textContent?.trim() === label,
  );
  if (!found) throw new Error(`Missing ${label}`);
  return found;
}
async function click(target: HTMLElement) {
  await act(async () => target.click());
}
async function input(selector: string, value: string) {
  const target = element<HTMLInputElement>(selector);
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value',
    )!.set!.call(target, value);
    target.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
async function lesson(index: number) {
  await click(
    element('nav[aria-label="教学课程"]').querySelectorAll<HTMLButtonElement>(
      'button',
    )[index]!,
  );
}
async function rulesTutorial() {
  await click(button('规则', element('nav[aria-label="主导航"]')));
  await click(button('进入交互式教程'));
}

describe('tutorial and version interface without a real browser', () => {
  it('enters from home without creating a real game and preserves the chosen character', async () => {
    const generate = vi.spyOn(rooms, 'generateFloor'),
      decide = vi.spyOn(ai, 'decideAiTurn');
    await mount();
    await click(
      element<HTMLInputElement>('input[name="character"][value="lost"]'),
    );
    await click(button('新手教程'));
    expect(element('#room-utilities-title').textContent).toBe('新手教程');
    expect(
      container.querySelectorAll('nav[aria-label="主导航"] button'),
    ).toHaveLength(5);
    expect(container.querySelector('.tutorial-market-metrics')).toBeNull();
    await click(button('提交教学行动'));
    expect(element('.tutorial-market-metrics').textContent).toContain(
      '共同基准线',
    );
    expect(container.querySelector('#tutorial-rewards-title')).toBeNull();
    expect(generate).not.toHaveBeenCalled();
    expect(decide).not.toHaveBeenCalled();
    expect(localStorage.getItem(gameSaveKey)).toBeNull();
    await click(button('返回游戏'));
    expect(
      element<HTMLInputElement>('input[name="character"][value="lost"]')
        .checked,
    ).toBe(true);
  });
  it('shows live quote effects, then locks input after explicit submission and allows deterministic reset', async () => {
    await mount();
    await rulesTutorial();
    await lesson(1);
    await input('#tutorial-amount-A', '20');
    const preview = element('.tutorial-quote .quote-preview').textContent;
    expect(preview).toContain('实际扣款14');
    expect(preview).toContain('市场等价25');
    await click(button('提交教学行动'));
    const market = element('.tutorial-market-metrics').textContent;
    expect(container.querySelector('#tutorial-amount-A')).toBeNull();
    await click(button('重做本课'));
    await input('#tutorial-amount-A', '20');
    await click(button('提交教学行动'));
    expect(element('.tutorial-market-metrics').textContent).toBe(market);
  });
  it('blocks illegal double bids without revealing results', async () => {
    await mount();
    await rulesTutorial();
    await lesson(3);
    await input('#tutorial-amount-A', '40');
    await input('#tutorial-amount-B', '30');
    expect(button('提交教学行动').disabled).toBe(true);
    expect(element('.tutorial-quote .action-error').textContent).toContain(
      '50%',
    );
    expect(container.querySelector('.tutorial-market-metrics')).toBeNull();
    await input('#tutorial-amount-A', '25');
    await input('#tutorial-amount-B', '25');
    await click(button('提交教学行动'));
    expect(element('.tutorial-market-metrics').textContent).toContain('21');
  });
  it('walks through five lessons and actual withdrawal/floor semantics without starting the game', async () => {
    await mount();
    await click(button('新手教程'));
    for (let index = 0; index < 5; index++) {
      await click(button(index === 4 ? '提交教学观望' : '提交教学行动'));
      await click(button('下一步：看奖励'));
      expect(element('#tutorial-rewards-title').textContent).toContain('资格');
      await click(button('下一步：看积分'));
      if (index < 4) await click(button('下一课'));
      else {
        await click(button('演示换层'));
        expect(element('#tutorial-floor-title').textContent).toContain(
          '资金重置',
        );
        expect(
          element('.tutorial-panel .tutorial-market-metrics').textContent,
        ).toContain('20 → 500');
        await click(button('完成本次练习'));
      }
    }
    expect(element('.tutorial-complete').textContent).toContain('5 / 5');
    expect(localStorage.getItem(gameSaveKey)).toBeNull();
    await click(button('返回游戏'));
    expect(container.textContent).toContain('选择角色');
  });
  it('preserves a live game, its replay and editable draft while practising from rules', async () => {
    const saved = reduceGameSession(createGameSession(42), {
      type: 'start_game',
      characterId: 'jacob_esau',
    });
    saved.draft!.amounts.A.bid = 19;
    localStorage.setItem(gameSaveKey, serializeGameSave(saved));
    await mount();
    const originalInput = element<HTMLInputElement>(
      'input[aria-label="竞拍奖励 A 的数值"]',
    );
    const before = localStorage.getItem(gameSaveKey)!;
    await rulesTutorial();
    await lesson(3);
    await click(button('提交教学行动'));
    await click(button('下一步：看奖励'));
    expect(localStorage.getItem(gameSaveKey)).toBe(before);
    await act(async () =>
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
      ),
    );
    expect(element('input[aria-label="竞拍奖励 A 的数值"]')).toBe(
      originalInput,
    );
    expect(originalInput.value).toBe('19');
    expect(localStorage.getItem(gameSaveKey)).toBe(before);
  });
  it('keeps tutorial available with blocked browser storage', async () => {
    vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => {
      throw new Error('blocked');
    });
    await mount();
    await click(button('新手教程'));
    await click(button('提交教学行动'));
    expect(element('#tutorial-market-title')).toBeDefined();
    await click(button('返回游戏'));
    expect(container.textContent).toContain('选择角色');
  });
  it('shows visible app/build/rules/file versions and copied feedback without editing gameplay', async () => {
    const meta = document.createElement('meta');
    meta.name = 'bidding-offline-build';
    meta.content = '0.2.0-abcdef123456';
    meta.dataset.versionTest = 'true';
    document.head.append(meta);
    await mount();
    await click(button('设置', element('nav[aria-label="主导航"]')));
    await click(element<HTMLElement>('.settings-version-details summary'));
    expect(element('.about-version').textContent).toContain(appVersion);
    expect(element('.version-values').textContent).toContain(meta.content);
    expect(element('.version-values').textContent).toContain(saveCompatibility);
    expect(element<HTMLTextAreaElement>('#version-feedback').readOnly).toBe(
      true,
    );
    expect(element('.version-history').textContent).toContain('0.1.0');
    const clipboard = vi
      .spyOn(navigator.clipboard, 'writeText')
      .mockResolvedValue(undefined);
    await click(button('复制版本信息'));
    expect(clipboard).toHaveBeenCalledWith(
      expect.stringContaining(meta.content),
    );
    expect(localStorage.getItem(gameSaveKey)).toBeNull();
  });
  it('keeps selectable version information when copying is blocked', async () => {
    await mount();
    await click(button('设置', element('nav[aria-label="主导航"]')));
    await click(element<HTMLElement>('.settings-version-details summary'));
    vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(
      new Error('blocked'),
    );
    await click(button('复制版本信息'));
    expect(element('.about-version output').textContent).toContain('手动复制');
    expect(element<HTMLTextAreaElement>('#version-feedback').value).toContain(
      '存档格式：v3',
    );
  });
});
