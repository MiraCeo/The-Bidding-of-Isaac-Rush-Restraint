// @vitest-environment happy-dom
import { achievementNumber } from './numbering';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, it, expect } from 'vitest';
import { AchievementProgress } from '../../../components/game/achievement-progress';
import {
  createPlayerProfile,
  playerProfileKey,
  type PlayerProfile,
} from '../player-profile';
import { appendCf, cfRoom, cfNow } from './revision058.test-helper';
import { projectAchievementRegistry } from './registry';
import { gameSaveKey } from '../game-save';
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
function bronzeProfile() {
  const missed = cfRoom(0, { code: 1 });
  missed.values[5] = 1;
  missed.values[9] = 1;
  return appendCf(createPlayerProfile(cfNow), missed); // Exactly A01 and B05 bronze.
}
const mount = (profile: PlayerProfile) =>
  act(async () => root.render(createElement(AchievementProgress, { profile })));
const card = (id: string) =>
  node.querySelector<HTMLButtonElement>('#achievement-' + id)!;
const click = (el: HTMLElement) => act(async () => el.click());
const facets = () => node.querySelector<HTMLElement>('[data-category=all]')!;
async function select(index: number, value: string) {
  await act(async () => {
    const el = node.querySelectorAll('select')[index]!;
    el.value = value;
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
}
async function search(value: string) {
  await act(async () => {
    const el = node.querySelector<HTMLInputElement>('input[type=search]')!;
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value',
    )!.set!.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
function expectStage(id: string, focus: string, tier: string, earned: boolean) {
  expect(card(id).dataset.focusedId).toBe(focus);
  expect(card(id).dataset.tier).toBe(tier);
  expect(card(id).dataset.achieved).toBe(String(earned));
  expect(
    card(id).querySelector<HTMLElement>('.achievement-badge')!.dataset.tier,
  ).toBe(tier);
  expect(
    card(id).querySelector<HTMLElement>('.achievement-badge')!.dataset.achieved,
  ).toBe(String(earned));
}
it('reproduces the reported two-bronze profile and renders only the highest earned bronze in all view', async () => {
  const p = bronzeProfile();
  expect(Object.keys(projectAchievementRegistry(p)!.achievedAt).sort()).toEqual(
    ['A01', 'B05'],
  );
  await mount(p);
  expectStage('A01', 'A01', 'bronze', true);
  expectStage('B05', 'B05', 'bronze', true);
  for (const id of ['A01', 'B05']) {
    expect(card(id).querySelector('.achievement-tier')).toBeNull();
    expect(card(id).querySelector('.achievement-badge-rank')!.textContent).toBe(
      '铜',
    );
    expect(card(id).getAttribute('aria-label')).toContain('已获铜徽章');
    expect(
      card(id)
        .querySelector('.achievement-card-state')!
        .getAttribute('aria-label'),
    ).toBe('已获 1 / 3');
    expect(card(id).dataset.partial).toBe('true');
  }
  expect(facets().textContent).toContain('2/57');
  expect(card('A01').dataset.goalId).toBe('A08');
  expect(card('A01').querySelector('progress')!.max).toBe(20);
  expect(card('A01').querySelector('progress')!.value).toBe(1);
  expect(card('A01').querySelector('.achievement-summary')!.textContent).toBe(
    '下一阶：累计正常竞拍失败20次',
  );
  expect(card('B05').dataset.goalId).toBe('B18');
  expect(card('B05').querySelector('progress')!.max).toBe(5);
  expect(card('B05').querySelector('progress')!.value).toBe(1);
});
it.each(['silver', 'gold'] as const)(
  'never marks the filtered unearned %s tier acquired because of its bronze sibling',
  async (tier) => {
    const p = bronzeProfile(),
      raw = JSON.stringify(p);
    localStorage.setItem(playerProfileKey, raw);
    localStorage.setItem(gameSaveKey, 'keep');
    await mount(p);
    await select(3, tier);
    expectStage('A01', tier === 'silver' ? 'A08' : 'A09', tier, false);
    expectStage('B05', tier === 'silver' ? 'B18' : 'B19', tier, false);
    for (const id of ['A01', 'B05']) {
      expect(card(id).dataset.partial).toBe('false');
      expect(
        card(id)
          .querySelector('.achievement-card-state')!
          .getAttribute('aria-label'),
      ).toBe('未达成');
      expect(
        card(id)
          .querySelector('.achievement-card-state')!
          .getAttribute('aria-label'),
      ).not.toContain('已获');
      expect(
        card(id).querySelectorAll('.achievement-stage-dots [data-earned=true]'),
      ).toHaveLength(0);
      expect(
        card(id).querySelectorAll('.achievement-stage-dots > [data-tier]'),
      ).toHaveLength(1);
    }
    expect(facets().dataset.earned).toBe('0');
    await select(0, 'achieved');
    expect(node.querySelectorAll('.achievement-card')).toHaveLength(0);
    expect(facets().textContent).toContain('0/0');
    expect(localStorage.getItem(playerProfileKey)).toBe(raw);
    expect(localStorage.getItem(gameSaveKey)).toBe('keep');
    expect(JSON.stringify(p)).toBe(raw);
  },
);
it('advances the all-view representative from bronze to silver to gold only after actual earned state changes, and rolls back read-only', async () => {
  const bronze = bronzeProfile();
  let p = bronze;
  await mount(p);
  expectStage('A01', 'A01', 'bronze', true);
  for (let i = 1; i < 20; i++) p = appendCf(p, cfRoom(0, { code: 1 }));
  await mount(p);
  expectStage('A01', 'A08', 'silver', true);
  expect(card('A01').textContent).toContain('已获 2 / 3');
  expect(card('A01').querySelector('progress')!.max).toBe(100);
  expect(card('A01').querySelector('progress')!.value).toBe(20);
  for (let i = 20; i < 100; i++) p = appendCf(p, cfRoom(0, { code: 1 }));
  await mount(p);
  expectStage('A01', 'A09', 'gold', true);
  expect(card('A01').textContent).toContain('已获 3 / 3');
  expect(card('A01').textContent).toContain('全部达成');
  expect(card('A01').querySelector('progress')).toBeNull();
  expect(card('A01').dataset.goalId).toBeUndefined();
  expect(card('A01').dataset.partial).toBe('false');
  await mount(bronze);
  expectStage('A01', 'A01', 'bronze', true);
  expect(card('A01').textContent).toContain('已获 1 / 3');
});
it('keeps explicit child-ID and pending searches locked without borrowing lower-stage collection text or highlighting', async () => {
  await mount(bronzeProfile());
  await search(achievementNumber('A09'));
  expectStage('A01', 'A09', 'gold', false);
  expect(card('A01').textContent).toContain('未达成');
  expect(card('A01').textContent).not.toContain('已获');
  await search('失败乃成功之母');
  await select(0, 'pending');
  expectStage('A01', 'A08', 'silver', false);
  expect(
    card('A01')
      .querySelector('.achievement-card-state')!
      .getAttribute('aria-label')!
      .trim(),
  ).toBe('已获 0 / 2');
  expect(card('A01').dataset.partial).toBe('false');
  expect(facets().dataset.earned).toBe('0');
  await select(0, 'achieved');
  expectStage('A01', 'A01', 'bronze', true);
  expect(
    card('A01')
      .querySelector('.achievement-card-state')!
      .getAttribute('aria-label')!
      .trim(),
  ).toBe('已达成');
  expect(card('A01').querySelector('progress')).toBeNull();
  expect(card('A01').textContent).not.toContain('下一阶');
});
it('keeps full three-level details and real dates while filtered cards show only their own acquisition state', async () => {
  const p = bronzeProfile(),
    raw = JSON.stringify(p);
  await mount(p);
  await select(3, 'gold');
  await click(card('A01'));
  const popup = document.querySelector<HTMLElement>('[role=dialog]')!;
  const levels = popup.querySelectorAll('.achievement-series-detail li');
  expect(levels).toHaveLength(3);
  expect(popup.querySelector('[data-achievement-id=A01] time')).not.toBeNull();
  expect(popup.querySelector('[data-achievement-id=A09] time')).toBeNull();
  await click(popup.querySelector('[aria-label="关闭成就详情"]')!);
  expectStage('A01', 'A09', 'gold', false);
  await select(3, 'all');
  await select(1, 'recent');
  expectStage('A01', 'A01', 'bronze', true);
  await select(1, 'progress');
  expectStage('B05', 'B05', 'bronze', true);
  expect(JSON.stringify(p)).toBe(raw);
  expect(localStorage.length).toBe(0);
});
