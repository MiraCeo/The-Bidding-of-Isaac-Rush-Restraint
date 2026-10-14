// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { GameTutorial } from '@/components/game/game-tutorial';
import * as ai from '../game/survival-ai';
import * as session from '../game/survival-session';
(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root, container: HTMLDivElement;
beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  localStorage.clear();
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});
function button(text: string) {
  const b = [...container.querySelectorAll<HTMLButtonElement>('button')].find(
    (b) => b.textContent?.trim() === text,
  );
  if (!b) throw new Error('Missing ' + text);
  return b;
}
async function click(text: string) {
  await act(async () => button(text).click());
}
describe('six survival lessons are interactive and isolated', () => {
  it('calculates a formal ledger, answers lessons and switches back to unchanged basic teaching without writes', async () => {
    localStorage.setItem('sentinel', 'original-match');
    const a = vi.spyOn(ai, 'decideSurvivalAiTurn'),
      b = vi.spyOn(session, 'startSurvivalGame');
    await act(async () =>
      root.render(createElement(GameTutorial, { mode: 'survival' })),
    );
    expect(
      container.querySelectorAll('[aria-label="生存教学课程"] button'),
    ).toHaveLength(6);
    await click('计算本层分数');
    expect(
      container.querySelector('.survival-tutorial-ledger')?.textContent,
    ).toContain('本层新增积分470.00');
    expect(
      container.querySelector('.survival-tutorial-ledger')?.textContent,
    ).toContain('本层生存分S530.00');
    await click('不包含，只累计R和余额兑换');
    expect(container.textContent).toContain('回答正确');
    await click('下一课');
    const select = container.querySelector<HTMLSelectElement>(
      '[aria-label="淘汰示例"]',
    )!;
    await act(async () => {
      select.value = 'wipeout';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(container.textContent).toContain('团灭无冠军');
    await click('仍至少淘汰末位两人');
    await click('下一课');
    expect(container.textContent).toContain('早淘汰高分者');
    await click('存活者');
    await click('下一课');
    expect(container.textContent).toContain('雅阁和以扫');
    await click('不会，只根据已有构筑规划');
    await click('下一课');
    await click('不会，四档规则完全相同');
    await click('下一课');
    await click('不能，续玩需要检查点或完整备份');
    expect(container.textContent).toContain('已练习 6/6 课');
    await click('基础教学');
    expect(
      container.querySelectorAll('[aria-label="教学课程"] button'),
    ).toHaveLength(5);
    expect(localStorage.length).toBe(1);
    expect(localStorage.getItem('sentinel')).toBe('original-match');
    expect(a).not.toHaveBeenCalled();
    expect(b).not.toHaveBeenCalled();
  });
});
