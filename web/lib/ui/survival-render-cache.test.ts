// @vitest-environment happy-dom
import { createElement, act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { GameApp } from '@/components/game/game-app';
import { startSurvivalClient, activeModeKey } from './survival-client';
import {
  serializeSurvivalCheckpoint,
  survivalSaveKey,
} from './survival-persistence';
import * as records from './survival-record';
(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
it('reuses factual replay snapshot across UI-only renders but invalidates it after a real command', async () => {
  localStorage.clear();
  const session = startSurvivalClient('isaac', 42);
  localStorage.setItem(activeModeKey, 'survival');
  localStorage.setItem(
    survivalSaveKey,
    serializeSurvivalCheckpoint(session.game, session.draft),
  );
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container),
    spy = vi.spyOn(records, 'createSurvivalReplay');
  try {
    await act(async () => root.render(createElement(GameApp)));
    const count = spy.mock.calls.length;
    const nav = container.querySelector('nav')!,
      button = (label: string, scope: Element = container) => {
        const b = [...scope.querySelectorAll<HTMLButtonElement>('button')].find(
          (b) => b.textContent?.trim() === label,
        );
        if (!b) throw new Error('Missing ' + label);
        return b;
      };
    await act(async () => button('规则', nav).click());
    await act(async () => button('游戏', nav).click());
    await act(async () => button('设置', nav).click());
    await act(async () => button('游戏', nav).click());
    expect(spy.mock.calls.length).toBe(count);
    await act(async () => button('出价竞拍').click());
    expect(spy.mock.calls.length).toBe(count + 1);
  } finally {
    await act(async () => root.unmount());
    container.remove();
    spy.mockRestore();
  }
});
