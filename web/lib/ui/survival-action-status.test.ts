// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { SurvivalActionStatus } from '@/components/game/survival-action-status';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
let node: HTMLDivElement, root: Root;
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
const props = {
  activePlayers: 18,
  cutLine: 325,
  roomScore: 12.3456,
  inheritedScore: 7.1234,
  balanceValue: 100.9876,
  decimals: 2 as const,
  difficulty: '困难',
  policy: '角色适配',
  onReturnMenu: vi.fn(),
  onRestart: vi.fn(),
};
const mount = async (extra = {}) =>
  act(async () =>
    root.render(createElement(SurvivalActionStatus, { ...props, ...extra })),
  );

it('keeps the target and three differently sourced score parts separate, without a provisional total', async () => {
  const before = JSON.stringify(props);
  await mount();
  expect(node.querySelector('.survival-action-goal')!.textContent).toContain(
    '斩杀线 325',
  );
  expect([...node.querySelectorAll('dt')].map((x) => x.textContent)).toEqual([
    '本层房间分',
    '上层继承',
    '当前余额可兑',
  ]);
  expect(
    [...node.querySelectorAll('dd')].map((x) => x.textContent!.trim()),
  ).toEqual(['12.35', '7.12', '100.99（层末为准）']);
  expect(node.textContent).not.toContain('资金 ');
  expect(node.textContent).not.toContain('120.46');
  expect(JSON.stringify(props)).toBe(before);
  expect(localStorage.length).toBe(0);
});
it('honors four-decimal preferences without changing the underlying facts', async () => {
  await mount({ decimals: 4 });
  expect(
    [...node.querySelectorAll('dd')].map((x) => x.textContent!.trim()),
  ).toEqual(['12.3456', '7.1234', '100.9876（层末为准）']);
});
it('leaves difficulty readable and folds only the AI policy, not score parts', async () => {
  await mount();
  const details = node.querySelector('details')!,
    summary = node.querySelector('summary')!;
  expect(details.open).toBe(false);
  expect(summary.textContent).toBe('难度 困难');
  expect(details.textContent).toContain('AI策略 角色适配');
  expect(node.querySelectorAll('details dt, details dd')).toHaveLength(0);
  await act(async () => summary.click());
  expect(details.open).toBe(true);
  expect(node.querySelector('summary')).toBe(summary);
  await act(async () => summary.click());
  expect(details.open).toBe(false);
});
it('keeps return and restart callbacks independent from viewing facts', async () => {
  const onReturnMenu = vi.fn(),
    onRestart = vi.fn();
  await mount({ onReturnMenu, onRestart });
  expect(onReturnMenu).not.toHaveBeenCalled();
  expect(onRestart).not.toHaveBeenCalled();
  await act(async () => node.querySelectorAll('button')[0]!.click());
  expect(onReturnMenu).toHaveBeenCalledTimes(1);
  expect(onRestart).not.toHaveBeenCalled();
  await act(async () => node.querySelectorAll('button')[1]!.click());
  expect(onRestart).toHaveBeenCalledTimes(1);
});
