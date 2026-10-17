// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { CharacterSelection } from '@/components/game/character-selection';
import { defaultGamePreferences } from './game-preferences';
import { gameSaveKey } from './game-save';
import { playerProfileKey, createPlayerProfile } from './player-profile';
import { manuallyUnlockAchievementCharacters } from './achievements/registry';

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
  vi.restoreAllMocks();
});
const start = vi.fn();
const mount = (extra: Partial<Parameters<typeof CharacterSelection>[0]> = {}) =>
  act(async () =>
    root.render(
      createElement(CharacterSelection, {
        onStart: start,
        preferences: defaultGamePreferences,
        preferenceSaveStatus: 'unchanged',
        onPreferencesChange: () => {},
        ...extra,
      }),
    ),
  );
const click = (el: HTMLElement) => act(async () => el.click());

it('offers only Isaac without selecting or starting him automatically; locked states do not enter the role names', async () => {
  start.mockClear();
  await mount();
  expect(node.querySelector('.page-context-bar')).toBeNull();
  expect(node.querySelector('.character-mode-label')!.textContent).toBe(
    '经典模式',
  );
  expect(node.querySelectorAll('.character-card')).toHaveLength(5);
  expect(
    node.querySelectorAll('.character-card[data-locked=true]'),
  ).toHaveLength(4);
  expect(
    [...node.querySelectorAll('.character-name')].every(
      (el) => !el.textContent!.includes('未解锁'),
    ),
  ).toBe(true);
  expect(
    node.querySelector('.character-state[data-state=available]')!.textContent,
  ).toBe('可选');
  expect(node.querySelector('.character-check')).toBeNull();
  const radio = node.querySelector<HTMLInputElement>('input[value=isaac]')!;
  expect(radio.checked).toBe(false);
  expect(
    node.querySelector<HTMLButtonElement>('.character-start-button')!.disabled,
  ).toBe(true);
  expect(start).not.toHaveBeenCalled();
  await click(radio);
  expect(
    node.querySelector('.character-state[data-state=selected]')!.textContent,
  ).toBe('已选择');
  expect(
    node.querySelector('.character-current-selection strong')!.textContent,
  ).toBe('以撒');
  expect(start).not.toHaveBeenCalled();
  await click(node.querySelector('.character-start-button')!);
  expect(start).toHaveBeenCalledExactlyOnceWith('isaac');
});

it('aligns five comparison sections and retains readable prerequisites and described-by targets', async () => {
  await mount();
  for (const card of node.querySelectorAll('.character-card')) {
    expect(
      card.querySelector('.character-unlock-condition small'),
    ).not.toBeNull();
    expect(card.querySelectorAll('.character-detail')).toHaveLength(2);
    const descriptions = card
      .querySelector('input')!
      .getAttribute('aria-describedby')!
      .split(' ');
    expect(descriptions).toHaveLength(3);
    for (const id of descriptions)
      expect(document.getElementById(id)).not.toBeNull();
  }
  expect(node.textContent).toContain('非将军之过 I + 屡败屡战 I');
  expect(node.textContent).toContain('两件不相同的随机道具（不含福袋）');
  expect(node.textContent).toContain(
    '每层初始资金提高 20%，双行动不承受 0.75 倍积分修正。',
  );
});

it('ends selection at the primary action and isolates the original recovery message without touching stored data', async () => {
  const message = '自动存档未读取：对局成长上下文不一致，原对局与档案保留。';
  localStorage.setItem(gameSaveKey, 'untouched-checkpoint');
  await mount({ startMessage: message, onReturnMenu: () => {} });
  const notice = node.querySelector('.character-session-message')!;
  expect(notice.textContent).toContain(message);
  expect(notice.querySelector('output')!.tagName).toBe('OUTPUT');
  expect(node.querySelector('.character-access')).toBeNull();
  expect(node.textContent).not.toContain('默认开放以撒；其余角色按成就解锁');
  expect(node.textContent).not.toContain('一键解锁全部角色');
  expect(node.textContent).not.toContain('角色决定初始道具与每层资金特性');
  const grid = node.querySelector('.character-grid')!,
    footer = node.querySelector('.character-footer')!;
  expect(
    grid.compareDocumentPosition(footer) & Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
  expect(footer.nextElementSibling).toBeNull();
  expect(
    footer.querySelector('.character-secondary-actions')!.textContent,
  ).toContain('返回主菜单');
  expect(
    footer.querySelector('.character-secondary-actions')!.textContent,
  ).toContain('新手教程');
  expect(
    footer.querySelector('.character-start-actions .character-start-button'),
  ).not.toBeNull();
  expect(localStorage.getItem(gameSaveKey)).toBe('untouched-checkpoint');
});

it('preserves externally controlled selection and independent manual permissions on remount', async () => {
  const profile = JSON.stringify(
    manuallyUnlockAchievementCharacters(createPlayerProfile()),
  );
  localStorage.setItem(playerProfileKey, profile);
  const select = vi.fn();
  await mount({ selected: 'eden', onSelect: select });
  expect(
    node.querySelector<HTMLInputElement>('input[value=eden]')!.checked,
  ).toBe(true);
  expect(
    node.querySelectorAll('.character-card[data-locked=true]'),
  ).toHaveLength(0);
  await click(node.querySelector<HTMLInputElement>('input[value=lost]')!);
  expect(select).toHaveBeenCalledExactlyOnceWith('lost');
  expect(
    node.querySelector<HTMLInputElement>('input[value=eden]')!.checked,
  ).toBe(true);
  expect(localStorage.getItem(playerProfileKey)).toBe(profile);
});

it('keeps survival difficulty, pool exclusions and explicit start behavior', async () => {
  const difficulty = vi.fn();
  await mount({
    mode: 'survival',
    aiDifficulty: 'hard',
    onDifficultyChange: difficulty,
  });
  expect(node.querySelector('.character-mode-label')!.textContent).toBe(
    '生存模式',
  );
  const options = node.querySelectorAll<HTMLInputElement>(
    '.survival-difficulty-options input',
  );
  expect([...options].map((o) => o.value)).toEqual([
    'easy',
    'standard',
    'hard',
    'highest',
  ]);
  expect(
    node.querySelector<HTMLInputElement>(
      '.survival-difficulty-options input[value=hard]',
    )!.checked,
  ).toBe(true);
  expect(node.textContent).not.toContain('每层基础资金1000');
  expect(node.textContent).toContain('不含福袋与黑王子之冠');
  expect(
    node.querySelector('.survival-difficulty-help')!.hasAttribute('open'),
  ).toBe(false);
  expect(
    node.querySelector('.survival-difficulty-help')!.textContent,
  ).toContain('困难或最高难度');
  await click(
    node.querySelector<HTMLInputElement>(
      '.survival-difficulty-options input[value=highest]',
    )!,
  );
  expect(difficulty).toHaveBeenCalledExactlyOnceWith('highest');
});

it('removes the legacy vh-sized cards and grid-column footer conflict without clipping long descriptions', () => {
  const css = readFileSync('app/globals.css', 'utf8');
  expect(css).not.toContain('min-height: 54vh');
  expect(css).not.toContain('min-height: 24vh');
  expect(css).not.toContain('.character-check {');
  expect(css).toContain('grid-template-rows:subgrid; grid-row:span 5');
  expect(css).toContain('.character-footer { display:flex;');
  expect(css).toContain('.character-start-button { width:180px;');
  expect(css).toContain('.character-secondary-actions>button { width:auto;');
  expect(css).not.toContain('.character-access>button');
  expect(css).toContain('image-rendering:pixelated');
  expect(css).not.toContain('.character-start-button { grid-column:');
});

it('uses all six supplied portraits in five options with both paired members visible', async () => {
  await mount();
  const portraits = node.querySelectorAll('.character-art');
  expect(
    [...portraits].map((el) => el.getAttribute('data-character-id')),
  ).toEqual(['isaac', 'lost', 'azazel', 'eden', 'jacob_esau']);
  expect(node.querySelector('.character-emoji')).toBeNull();
  expect(node.querySelectorAll('.character-art-figure')).toHaveLength(6);
  const expected = ['isaac', 'lost', 'azazel', 'eden', 'jacob', 'esau'];
  [...node.querySelectorAll<HTMLElement>('.character-art-figure')].forEach(
    (figure, index) => {
      const data = readFileSync(
        'assets/characters/' + expected[index] + '.png',
      ).toString('base64');
      expect(figure.style.backgroundImage).toBe(
        'url("data:image/png;base64,' + data + '")',
      );
    },
  );
  expect(
    node
      .querySelector('[data-character-id=jacob_esau]')!
      .querySelectorAll('.character-art-figure'),
  ).toHaveLength(2);
  expect(node.querySelector('.character-art img')).toBeNull();
});

it('uses player-facing maximum difficulty copy without development history or rule-number banners', async () => {
  await mount({ mode: 'survival', aiDifficulty: 'highest' });
  expect(
    node.querySelector('.survival-difficulty-description')!.textContent,
  ).toBe('完整强度的生存AI，不额外削弱。');
  expect(node.textContent).not.toContain('0.3.1');
  expect(node.textContent).not.toContain('斩杀线200');
});
