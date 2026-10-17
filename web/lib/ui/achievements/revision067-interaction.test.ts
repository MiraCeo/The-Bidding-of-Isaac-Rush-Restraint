// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { AchievementProgress } from '@/components/game/achievement-progress';
import { AchievementNotice } from '@/components/game/achievement-notice';
import { AchievementFeedbackContext } from '@/components/game/achievement-feedback-context';
import { GameHeader } from '@/components/game/game-header';
import { createPlayerProfile, playerProfileKey } from '../player-profile';
import { gameSaveKey } from '../game-save';
import { appendCf, cfRoom, cfNow } from './revision058.test-helper';

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
  vi.restoreAllMocks();
});
const click = (el: HTMLElement) => act(async () => el.click());
const popup = () => document.querySelector<HTMLElement>('[role=dialog]')!;

it('removes the legacy goal prompt without changing highest earned metal, next goal or filter matching', async () => {
  const profile = appendCf(createPlayerProfile(cfNow), cfRoom(0, { code: 1 }));
  const raw = JSON.stringify(profile);
  localStorage.setItem(playerProfileKey, raw);
  await act(async () =>
    root.render(createElement(AchievementProgress, { profile })),
  );
  const card = () => node.querySelector<HTMLElement>('#achievement-A01')!;
  expect(node.textContent).not.toContain('冲刺');
  expect(
    card().querySelector('.achievement-badge')!.getAttribute('data-tier'),
  ).toBe('bronze');
  expect(card().querySelector('progress')!.getAttribute('max')).toBe('20');
  expect(card().querySelector('.achievement-progress-value')!.textContent).toBe(
    '1 / 20',
  );
  await act(async () => {
    const tier = node.querySelectorAll('select')[3]!;
    tier.value = 'gold';
    tier.dispatchEvent(new Event('change', { bubbles: true }));
  });
  expect(card().getAttribute('data-achieved')).toBe('false');
  expect(
    card().querySelector('.achievement-badge')!.getAttribute('data-tier'),
  ).toBe('gold');
  expect(node.textContent).not.toContain('冲刺');
  expect(JSON.stringify(profile)).toBe(raw);
  expect(localStorage.getItem(playerProfileKey)).toBe(raw);
});

it('opens an unfiltered read-only overview, distinguishes cards and medals, and restores focus and active filters', async () => {
  const profile = appendCf(createPlayerProfile(cfNow), cfRoom(0, { code: 1 }));
  const raw = JSON.stringify(profile);
  localStorage.setItem(playerProfileKey, raw);
  localStorage.setItem(gameSaveKey, 'keep');
  await act(async () =>
    root.render(createElement(AchievementProgress, { profile })),
  );
  await act(async () => {
    const status = node.querySelectorAll('select')[0]!;
    status.value = 'achieved';
    status.dispatchEvent(new Event('change', { bubbles: true }));
  });
  const before = node.querySelector('.achievement-sections')!.innerHTML;
  const opener = node.querySelector<HTMLButtonElement>(
    '.achievement-overview-open',
  )!;
  opener.focus();
  await click(opener);
  expect(popup().querySelector('h2')!.textContent).toBe('成就总览');
  const metrics = [...popup().querySelectorAll('dd')].map(
    (el) => el.textContent,
  );
  expect(metrics).toEqual(['1 / 117', '1 / 57', '1 / 5']);
  expect(
    popup().querySelectorAll('.achievement-overview-category'),
  ).toHaveLength(6);
  expect(
    popup().querySelectorAll('.achievement-overview-recent li'),
  ).toHaveLength(1);
  expect(
    popup().querySelector('.achievement-overview-recent')!.textContent,
  ).toContain('失败乃成功之母');
  expect(popup().textContent).not.toContain('败而不馁');
  await click(
    popup().querySelector<HTMLElement>('[aria-label="关闭成就总览"]')!,
  );
  expect(document.activeElement).toBe(opener);
  expect(node.querySelector('.achievement-sections')!.innerHTML).toBe(before);
  expect(node.querySelectorAll('select')[0]!.value).toBe('achieved');
  expect(localStorage.getItem(playerProfileKey)).toBe(raw);
  expect(localStorage.getItem(gameSaveKey)).toBe('keep');
  expect(JSON.stringify(profile)).toBe(raw);
});

it('updates an open overview on profile rollback without displaying old recent earned notes or granting anything', async () => {
  const empty = createPlayerProfile(cfNow);
  const profile = appendCf(empty, cfRoom(0, { code: 1 }));
  await act(async () =>
    root.render(createElement(AchievementProgress, { profile })),
  );
  await click(node.querySelector<HTMLElement>('.achievement-overview-open')!);
  expect(popup().querySelector('time')).not.toBeNull();
  await act(async () =>
    root.render(createElement(AchievementProgress, { profile: empty })),
  );
  expect(popup().querySelector('time')).toBeNull();
  expect(popup().textContent).toContain('尚无已达成的成就');
  expect(popup().querySelector('dd')!.textContent).toBe('0 / 117');
  expect(localStorage.length).toBe(0);
});

it('keeps a large saved batch intact behind an explicit expand control without a timer, focus capture or duplicate visible tier labels', async () => {
  const dismiss = vi.fn();
  const timer = vi.spyOn(globalThis, 'setTimeout');
  await act(async () =>
    root.render(
      createElement(AchievementNotice, {
        ids: ['A01', 'A08', 'A09', 'A01'],
        onDismiss: dismiss,
      }),
    ),
  );
  const notice = node.querySelector('.achievement-notice')!;
  expect(notice.querySelectorAll(':scope > ul > li')).toHaveLength(2);
  expect(notice.querySelectorAll('li')).toHaveLength(3);
  const more = notice.querySelector('details')!;
  expect(more.open).toBe(false);
  expect(more.querySelector('summary')!.textContent).toContain('其余 1 枚');
  expect(notice.querySelector('.achievement-tier')).toBeNull();
  expect(notice.querySelector('output')!.textContent).toContain('金徽章');
  expect(timer).not.toHaveBeenCalled();
  expect(notice.querySelector('[autofocus]')).toBeNull();
  await click(notice.querySelector('button')!);
  expect(dismiss).toHaveBeenCalledOnce();
  expect(localStorage.length).toBe(0);
});

it('uses the shared header feedback slot in both modes, aligns goal tracks and leaves unearned detail cards neutral', () => {
  for (const name of ['classic', 'survival']) {
    const source = readFileSync(`components/game/${name}-game-app.tsx`, 'utf8');
    expect(source).toContain('<AchievementFeedbackContext.Provider');
    expect(source).toContain('<AchievementNotice');
  }
  const css = readFileSync('app/globals.css', 'utf8');
  expect(css).toContain('.achievement-notice { position:relative;');
  expect(css).not.toContain('.achievement-notice { position:fixed;');
  expect(css).toContain('.achievement-card-progress { display:grid;');
  expect(css).not.toContain('.achievement-goal-tier');
  expect(css).toContain(
    '.achievement-series-detail li[data-selected="true"] { outline:none; }',
  );
  const source = readFileSync(
    'components/game/achievement-progress.tsx',
    'utf8',
  );
  expect(source).not.toContain('冲刺');
});

it('renders saved feedback after navigation and optional HUD, never before the product header or over the body', async () => {
  const feedback = createElement(AchievementNotice, {
    ids: ['A01'],
    onDismiss: () => {},
  });
  await act(async () =>
    root.render(
      createElement(
        AchievementFeedbackContext.Provider,
        { value: feedback },
        createElement(GameHeader, { navigation: '导航', context: '当前房间' }),
      ),
    ),
  );
  expect([...node.children].map((el) => el.className)).toEqual([
    'topbar',
    'page-context-bar',
    'achievement-notice',
  ]);
  await act(async () =>
    root.render(
      createElement(
        AchievementFeedbackContext.Provider,
        { value: feedback },
        createElement(GameHeader, {
          navigation: '导航',
          context: '当前房间',
          showContext: false,
        }),
      ),
    ),
  );
  expect([...node.children].map((el) => el.className)).toEqual([
    'topbar',
    'achievement-notice',
  ]);
  expect(node.textContent).not.toContain('当前房间');
  expect(localStorage.length).toBe(0);
});
