// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { AchievementProgress } from '@/components/game/achievement-progress';
import { achievementCatalog, type AchievementId } from './catalog';
import { achievementCollectionNotes } from './collection-notes';
import { createPlayerProfile, playerProfileKey } from '../player-profile';
import {
  appendAchievementEvent,
  compactAchievementProfile,
  projectAchievementRegistry,
  readAchievementRegistry,
} from './registry';
import { decodeAchievementEvent } from './event-codec';
import { sha256Hex } from '../../shared/sha256';
import {
  serializePlayerProfileBackup,
  parsePlayerProfileBackup,
} from '../player-profile-file';
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
const mount = async (p = createPlayerProfile()) =>
  act(async () =>
    root.render(createElement(AchievementProgress, { profile: p })),
  );
const card = (id: AchievementId) =>
  node.querySelector<HTMLButtonElement>(`#achievement-${id}`)!;
const click = async (n: HTMLElement) => act(async () => n.click());
const dialog = () => document.querySelector<HTMLElement>('[role=dialog]')!;
const close = async () =>
  click(dialog().querySelector('[aria-label="关闭成就详情"]')!);
async function search(value: string) {
  await act(async () => {
    const input = node.querySelector<HTMLInputElement>('input[type=search]')!;
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value',
    )!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
async function tier(value: string) {
  await act(async () => {
    const select = node.querySelectorAll('select')[3]!;
    select.value = value;
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
}
const at = new Date('2026-10-15T00:00:00.000Z');
function earned(id: 'A03' | 'C07' | 'F02') {
  let p = createPlayerProfile(at),
    parent: string | null = null;
  for (let i = 0; i < (id === 'A03' ? 5 : 1); i++) {
    const event =
      id === 'F02'
        ? decodeAchievementEvent({
            stage: 'final',
            position: 5,
            values: [1, 1, null],
          })
        : decodeAchievementEvent({
            stage: 'room',
            position: i,
            values: [
              id === 'A03' ? 1 : 0,
              id === 'C07' ? 2 ** 9 + 2 ** 10 : 0,
              0,
              0,
              1,
            ],
          });
    p = appendAchievementEvent(
      p,
      {
        source: 'live',
        mode: id === 'F02' ? 'survival' : 'classic',
        root: sha256Hex('hidden-' + id),
        parent,
        authorityHash: sha256Hex(id + '-' + i),
        event,
      },
      at,
    );
    parent = readAchievementRegistry(p)!.receipts.at(-1)!.key;
  }
  return p;
}
it.each(['A03', 'C07', 'F02'] as const)(
  'conceals %s including ARIA and glyph but reveals true details without writes and restores focus',
  async (id) => {
    const p = createPlayerProfile(at),
      before = JSON.stringify(p),
      a = achievementCatalog.find((a) => a.id === id)!;
    localStorage.setItem(playerProfileKey, before);
    await mount(p);
    const origin = card(id);
    origin.focus();
    expect(origin.textContent).toContain('???');
    expect(origin.textContent).toContain('金徽章');
    expect(origin.outerHTML).not.toContain(a.name);
    expect(
      origin.querySelector('.achievement-badge svg')!.getAttribute('class'),
    ).toContain('circle-question-mark');
    expect(origin.querySelector('progress')).toBeNull();
    expect(node.textContent).not.toContain(a.name);
    await click(origin);
    expect(dialog().textContent).toContain(a.name);
    expect(dialog().textContent).toContain(a.condition);
    expect(dialog().textContent).toContain('金徽章');
    expect(dialog().textContent).toContain('达成后解锁');
    expect(dialog().textContent).not.toContain(achievementCollectionNotes[id]);
    expect(
      dialog()
        .querySelector('.achievement-badge')!
        .getAttribute('data-concealed'),
    ).toBe('false');
    await close();
    expect(document.activeElement).toBe(origin);
    expect(card(id).textContent).toContain('???');
    expect(localStorage.getItem(playerProfileKey)).toBe(before);
    expect(JSON.stringify(p)).toBe(before);
  },
);
it.each(['A03', 'C07', 'F02'] as const)(
  'uses existing %s proof/time immediately, remains byte-identical, and conceals again on rollback',
  async (id) => {
    for (const compact of [false, true]) {
      const original = earned(id),
        p = compact ? compactAchievementProfile(original) : original;
      const before = JSON.stringify(p),
        projection = projectAchievementRegistry(p)!;
      localStorage.setItem(playerProfileKey, before);
      await mount(p);
      expect(card(id).textContent).toContain(
        achievementCatalog.find((a) => a.id === id)!.name,
      );
      expect(card(id).getAttribute('data-concealed')).toBe('false');
      expect(card(id).textContent).toContain('已达成');
      await click(card(id));
      expect(dialog().querySelector('time')!.dateTime).toBe(at.toISOString());
      expect(dialog().querySelector('blockquote')!.textContent).toBe(
        achievementCollectionNotes[id],
      );
      await close();
      expect(JSON.stringify(p)).toBe(before);
      expect(localStorage.getItem(playerProfileKey)).toBe(before);
      expect(projectAchievementRegistry(p)).toEqual(projection);
      await mount(createPlayerProfile(at));
      expect(card(id).textContent).toContain('???');
    }
  },
);
it('filters by metal with fixed global totals and resets all filters without writing player data', async () => {
  const p = earned('A03'),
    before = JSON.stringify(p);
  await mount(p);
  const overview = node.querySelector('.achievement-overview')!.textContent;
  expect(node.querySelector('.achievement-tier-totals')!.textContent).toBe(
    '铜 1 / 21银 0 / 11金 1 / 4',
  );
  await tier('gold');
  expect(node.querySelectorAll('.achievement-card')).toHaveLength(4);
  expect(node.querySelector('.achievement-overview')!.textContent).toBe(
    overview,
  );
  await search('A01');
  expect(node.querySelectorAll('.achievement-card')).toHaveLength(0);
  await click(
    [...node.querySelectorAll<HTMLButtonElement>('button')].find(
      (b) => b.textContent === '清除筛选',
    )!,
  );
  expect(node.querySelectorAll('.achievement-card')).toHaveLength(36);
  expect(node.querySelectorAll('select')[3]!.value).toBe('all');
  expect(localStorage.length).toBe(0);
  expect(JSON.stringify(p)).toBe(before);
});
it('does not leak hidden names via search or progress order after merely opening details', async () => {
  await mount();
  await click(card('A03'));
  await close();
  await search('屡战屡败');
  expect(node.querySelectorAll('.achievement-card')).toHaveLength(0);
  await search('a03');
  expect(node.querySelectorAll('.achievement-card')).toHaveLength(1);
  expect(card('A03').textContent).toContain('???');
  await mount(earned('A03'));
  await search('屡战屡败');
  expect(node.querySelectorAll('.achievement-card')).toHaveLength(1);
  expect(card('A03').textContent).toContain('屡战屡败');
  expect(localStorage.length).toBe(0);
});
it('retains schema3 and prospective six-achievement evidence without creating tier/hidden persistence fields', async () => {
  let p = createPlayerProfile(at);
  p = appendAchievementEvent(
    p,
    {
      source: 'live',
      mode: 'classic',
      root: sha256Hex('complete'),
      parent: null,
      authorityHash: sha256Hex('final'),
      event: decodeAchievementEvent({
        stage: 'complete',
        position: 0,
        values: [0, 1],
      }),
    },
    at,
  );
  const raw = JSON.stringify(p);
  await mount(p);
  await tier('silver');
  expect(card('E07').textContent).toContain('银徽章');
  expect(card('E07').textContent).toContain('已达成');
  expect(JSON.stringify(p)).toBe(raw);
  expect(raw).not.toContain('hidden');
  expect(raw).not.toContain('tier');
  expect(
    (p.progression.modules.achievementRegistryV1 as { version: number })
      .version,
  ).toBe(3);
  expect(
    parsePlayerProfileBackup(serializePlayerProfileBackup(p)).profile,
  ).toEqual(p);
});
