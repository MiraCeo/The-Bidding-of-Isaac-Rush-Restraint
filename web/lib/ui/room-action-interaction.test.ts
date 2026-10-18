// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { readFileSync } from 'node:fs';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RoomPrototype } from '@/components/game/room-prototype';
import { ClassicGameApp as GameApp } from '@/components/game/classic-game-app';
import {
  startClientGame,
  type ItemId,
  type ActiveClientGameState,
} from '../game';
import { grantItemInstance } from '../game/runtime';
import * as aiDecision from '../game/ai-decision';
import { defaultGamePreferences } from './game-preferences';
import { createGameSession, reduceGameSession } from './game-session';
import { gameSaveKey, loadAutoSave } from './game-save';
import { serializeSessionFixture as serializeGameSave } from './save-fixture.test-helper';

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
  vi.restoreAllMocks();
});
function element<T extends Element>(selector: string): T {
  const value = container.querySelector<T>(selector);
  if (!value) throw new Error(`Missing ${selector}`);
  return value;
}
async function click(selector: string) {
  await act(async () => element<HTMLElement>(selector).click());
}
async function amount(kind: '竞拍' | '扰乱', group: 'A' | 'B', value: number) {
  const input = element<HTMLInputElement>(
    `input[aria-label="${kind}奖励 ${group} 的数值"]`,
  );
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value',
    )!.set!.call(input, String(value));
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
async function mode(kind: '竞拍' | '扰乱') {
  const button = Array.from(
    element('.action-mode-switch').querySelectorAll<HTMLButtonElement>(
      'button',
    ),
  ).find((b) => b.textContent === kind)!;
  await act(async () => button.click());
}
function gameWith(items: ItemId[] = []) {
  const game = startClientGame('isaac', 42);
  const player = game.players.find((p) => p.isHuman)!;
  player.items = [];
  items.forEach((itemId, i) =>
    grantItemInstance(player, {
      itemId,
      instanceId: `compact-${i}`,
      acquiredOrder: i,
    }),
  );
  return game;
}
async function mount(game: ActiveClientGameState, submit = vi.fn()) {
  await act(async () =>
    root.render(
      createElement(RoomPrototype, {
        game,
        onSubmit: submit,
        preferences: { ...defaultGamePreferences },
        preferenceSaveStatus: 'unchanged',
        onPreferencesChange: () => {},
      }),
    ),
  );
  return submit;
}
function numbers(group: 'a' | 'b') {
  return Array.from(
    element(`.reward-column-${group} .quote-preview`).querySelectorAll('dd'),
  ).map((e) => e.textContent);
}

describe('room-wide compact mode and local previews', () => {
  it('shows no actionable quote at zero funds while keeping a valid withdrawal', async () => {
    const game = gameWith();
    game.players.find((p) => p.isHuman)!.money = 0;
    const before = structuredClone(game),
      submit = await mount(game);
    expect(
      container.querySelectorAll('.action-quote-unavailable'),
    ).toHaveLength(2);
    expect(
      container.querySelectorAll('input[type="number"], input[type="range"]'),
    ).toHaveLength(0);
    expect(element<HTMLInputElement>('#bid-A').disabled).toBe(true);
    expect(element<HTMLButtonElement>('.confirm-button').disabled).toBe(true);
    expect(numbers('a')).toEqual(['—', '—', '—', '—']);
    expect(element('.action-summary').textContent).toContain('无可用报价');
    await click('.observe-button');
    expect(element('#action-mode-hint').textContent).toContain(
      '当前无可用报价',
    );
    expect(element<HTMLButtonElement>('.confirm-button').disabled).toBe(false);
    await click('.confirm-button');
    expect(submit).toHaveBeenCalledExactlyOnceWith({
      playerId: 'human',
      actions: [{ type: 'withdraw' }],
    });
    expect(game).toEqual(before);
  });
  it('disables disruption below its positive-integer limit without blocking a one-money bid', async () => {
    const game = gameWith();
    game.players.find((p) => p.isHuman)!.money = 1;
    await mount(game);
    expect(container.querySelectorAll('input[type="number"]')).toHaveLength(2);
    await mode('扰乱');
    expect(
      container.querySelectorAll('.action-quote-unavailable'),
    ).toHaveLength(2);
    expect(element<HTMLButtonElement>('.confirm-button').disabled).toBe(true);
    await mode('竞拍');
    expect(container.querySelectorAll('input[type="number"]')).toHaveLength(2);
    expect(element<HTMLButtonElement>('.confirm-button').disabled).toBe(false);
  });
  it('renders one pair of inputs and retains all four amounts across repeated switches without submitting', async () => {
    const game = gameWith();
    const before = structuredClone(game);
    const decide = vi.spyOn(aiDecision, 'decideAiTurn');
    const submit = await mount(game);
    expect(container.querySelectorAll('.action-option')).toHaveLength(2);
    expect(container.querySelectorAll('input[type="number"]')).toHaveLength(2);
    expect(container.querySelector('#disrupt-A')).toBeNull();
    await amount('竞拍', 'A', 31);
    await amount('竞拍', 'B', 39);
    await mode('扰乱');
    expect(container.querySelector('#bid-A')).toBeNull();
    expect(element<HTMLInputElement>('#disrupt-B').checked).toBe(true);
    await amount('扰乱', 'A', 7);
    await amount('扰乱', 'B', 13);
    await mode('竞拍');
    expect(
      element<HTMLInputElement>('input[aria-label="竞拍奖励 A 的数值"]').value,
    ).toBe('31');
    expect(
      element<HTMLInputElement>('input[aria-label="竞拍奖励 B 的数值"]').value,
    ).toBe('39');
    await mode('扰乱');
    expect(
      element<HTMLInputElement>('input[aria-label="扰乱奖励 A 的数值"]').value,
    ).toBe('7');
    expect(
      element<HTMLInputElement>('input[aria-label="扰乱奖励 B 的数值"]').value,
    ).toBe('13');
    expect(submit).not.toHaveBeenCalled();
    expect(decide).not.toHaveBeenCalled();
    expect(game).toEqual(before);
    await click('.confirm-button');
    expect(submit).toHaveBeenCalledExactlyOnceWith({
      playerId: 'human',
      actions: [{ type: 'disrupt', group: 'B', amount: 13 }],
    });
  });
  it('shows selected quote quantities beside their input and no fictitious quote for the unselected target', async () => {
    await mount(
      gameWith(['steam_sale', 'twenty_twenty', 'brimstone', 'short_brimstone']),
    );
    expect(numbers('a')).toEqual(['25', '18', '31.25', '25']);
    expect(numbers('b')).toEqual(['—', '—', '—', '—']);
    expect(element('.reward-column-a .quote-preview').textContent).toContain(
      '20 – 31.25',
    );
    await mode('扰乱');
    expect(numbers('a')).toEqual(['20', '20', '50', '25']);
    expect(element('.reward-column-a .quote-preview').textContent).toContain(
      '21.25 – 30',
    );
    await click('.reward-column-b .reward-target input');
    expect(numbers('a')).toEqual(['—', '—', '—', '—']);
    expect(numbers('b')).toEqual(['20', '20', '50', '25']);
  });
  it('explains loss of double permission and uses single target radios in the destination mode', async () => {
    const submit = await mount(gameWith(['more_options']));
    await click('#bid-B');
    expect(element<HTMLInputElement>('#bid-A').type).toBe('checkbox');
    await mode('扰乱');
    expect(element('.action-mode-notice').textContent).toContain(
      '仅支持单扰乱',
    );
    expect(element<HTMLInputElement>('#disrupt-A').type).toBe('radio');
    expect(element<HTMLInputElement>('#disrupt-A').checked).toBe(true);
    expect(element<HTMLInputElement>('#disrupt-B').checked).toBe(false);
    await click('.confirm-button');
    expect(submit).toHaveBeenCalledExactlyOnceWith({
      playerId: 'human',
      actions: [{ type: 'disrupt', group: 'A', amount: 20 }],
    });
  });
  it('retains double same-type targets when both permissions exist and applies half-budget to edited double bids', async () => {
    const submit = await mount(
      gameWith(['more_options', 'more_options_question']),
    );
    await click('#bid-B');
    await amount('竞拍', 'A', 99);
    expect(
      element<HTMLInputElement>('input[aria-label="竞拍奖励 A 的数值"]').value,
    ).toBe('30');
    await mode('扰乱');
    await amount('扰乱', 'A', 999);
    await amount('扰乱', 'B', 999);
    expect(numbers('a')).toEqual(['55', '55', '137.5', '68.75']);
    expect(element('.action-summary').textContent).toContain('实际扣款 110');
    await mode('竞拍');
    expect(element<HTMLInputElement>('#bid-A').checked).toBe(true);
    expect(element<HTMLInputElement>('#bid-B').checked).toBe(true);
    await click('.confirm-button');
    expect(submit).toHaveBeenCalledExactlyOnceWith({
      playerId: 'human',
      actions: [
        { type: 'bid', group: 'A', amount: 30 },
        { type: 'bid', group: 'B', amount: 25 },
      ],
    });
  });
  it('caps a newly edited second target in the saved draft rather than only clamping its visible input', async () => {
    await mount(startClientGame('jacob_esau', 42));
    await amount('竞拍', 'A', 40);
    await amount('竞拍', 'B', 999);
    expect(
      element<HTMLInputElement>('input[aria-label="竞拍奖励 B 的数值"]').value,
    ).toBe('20');
    expect(numbers('b')[0]).toBe('20');
    expect(element<HTMLButtonElement>('.confirm-button').disabled).toBe(false);
  });
  it('keeps observation as an unsubmitted draft, marks no active mode, and can return to a quote', async () => {
    const submit = await mount(gameWith());
    await mode('扰乱');
    await amount('扰乱', 'A', 11);
    await click('.observe-button');
    expect(
      container.querySelector('.action-mode-switch [aria-pressed="true"]'),
    ).toBeNull();
    expect(element('.action-summary').textContent).toContain('保存全部资金');
    expect(numbers('a')).toEqual(['—', '—', '—', '—']);
    expect(submit).not.toHaveBeenCalled();
    await mode('扰乱');
    expect(numbers('a')[0]).toBe('11');
    await click('.observe-button');
    await click('.confirm-button');
    expect(submit).toHaveBeenCalledExactlyOnceWith({
      playerId: 'human',
      actions: [{ type: 'withdraw' }],
    });
  });
  it('keeps zero-fund confirmations disabled in either quote mode but permits confirmed observation', async () => {
    const game = gameWith();
    game.players[0]!.money = 0;
    const submit = await mount(game);
    expect(element<HTMLButtonElement>('.confirm-button').disabled).toBe(true);
    await mode('扰乱');
    expect(element<HTMLButtonElement>('.confirm-button').disabled).toBe(true);
    await click('.observe-button');
    expect(element<HTMLButtonElement>('.confirm-button').disabled).toBe(false);
    await click('.confirm-button');
    expect(submit).toHaveBeenCalledExactlyOnceWith({
      playerId: 'human',
      actions: [{ type: 'withdraw' }],
    });
  });
  it('persists mode, target and both amount sets in existing auto saves and restores them on remount', async () => {
    const session = reduceGameSession(createGameSession(42), {
      type: 'start_game',
      characterId: 'jacob_esau',
    });
    localStorage.setItem(gameSaveKey, serializeGameSave(session));
    await act(async () => root.render(createElement(GameApp)));
    await amount('竞拍', 'A', 100);
    await mode('扰乱');
    await click('#disrupt-B');
    await amount('扰乱', 'B', 17);
    await mode('竞拍');
    expect(element('.action-mode-notice').textContent).toContain('超过 60');
    const saved = loadAutoSave(localStorage).session!;
    expect(saved.draft!.amounts.A.bid).toBe(100);
    expect(saved.draft!.amounts.B.disrupt).toBe(17);
    expect(saved.draft!.selectedAction).toEqual({
      kind: 'bid',
      groups: ['A'],
    });
    await act(async () => root.unmount());
    root = createRoot(container);
    await act(async () => root.render(createElement(GameApp)));
    expect(
      element<HTMLInputElement>('input[aria-label="竞拍奖励 A 的数值"]').value,
    ).toBe('100');
    await mode('扰乱');
    expect(
      element<HTMLInputElement>('input[aria-label="扰乱奖励 B 的数值"]').value,
    ).toBe('17');
  });
  it('locks mode, target and amount controls outside the action phase', async () => {
    const game = gameWith();
    game.phase = 'room_result';
    const submit = await mount(game);
    expect(
      element<HTMLButtonElement>('.action-mode-switch button').disabled,
    ).toBe(true);
    expect(element<HTMLInputElement>('.reward-target input').disabled).toBe(
      true,
    );
    expect(element<HTMLFieldSetElement>('.action-pair').disabled).toBe(true);
    await mode('扰乱');
    await click('.confirm-button');
    expect(submit).not.toHaveBeenCalled();
  });
});

describe('action workspace panel layout', () => {
  it('keeps auxiliary controls in the HUD and changes in-flow panel visibility without losing quote drafts', async () => {
    const submit = await mount(gameWith());
    await amount('竞拍', 'A', 37);
    const content = element<HTMLElement>('.room-game-content');
    const rank = element<HTMLElement>('#ranking-drawer');
    const market = element<HTMLElement>('#market-drawer');
    expect(element('.page-context-bar .room-panel-controls')).toBeTruthy();
    expect(content.querySelector('.drawer-tab')).toBeNull();
    expect(rank.hidden).toBe(true);
    expect(market.hidden).toBe(true);
    for (const combination of ['rank', 'both', 'market', 'neither']) {
      if (combination === 'rank' || combination === 'market')
        await click('.drawer-tab-left');
      else await click('.drawer-tab-right');
      expect(content.dataset.rankingOpen).toBe(
        String(combination === 'rank' || combination === 'both'),
      );
      expect(content.dataset.marketOpen).toBe(
        String(combination === 'market' || combination === 'both'),
      );
      expect(rank.hidden).toBe(
        !(combination === 'rank' || combination === 'both'),
      );
      expect(market.hidden).toBe(
        !(combination === 'market' || combination === 'both'),
      );
      expect(
        element<HTMLInputElement>('input[aria-label="竞拍奖励 A 的数值"]')
          .value,
      ).toBe('37');
    }
    expect(submit).not.toHaveBeenCalled();
  });
  it('keeps reward, input and exact preview in the same selected target unit for two actions', async () => {
    const submit = await mount(gameWith(['more_options']));
    await amount('竞拍', 'A', 19);
    await amount('竞拍', 'B', 21);
    for (const group of ['a', 'b']) {
      const unit = element<HTMLElement>('.reward-column-' + group);
      expect(unit.dataset.selected).toBe('true');
      expect(
        unit.querySelectorAll('.item-card,.action-pair,.quote-preview'),
      ).toHaveLength(3);
      expect(numbers(group as 'a' | 'b')[0]).toBe(group === 'a' ? '19' : '21');
    }
    await click('.confirm-button');
    expect(submit).toHaveBeenCalledExactlyOnceWith({
      playerId: 'human',
      actions: [
        { type: 'bid', group: 'A', amount: 19 },
        { type: 'bid', group: 'B', amount: 21 },
      ],
    });
  });
  it('scopes the compact layout to the action page and never fixes the confirmation over its inputs', () => {
    const css = readFileSync('app/globals.css', 'utf8');
    expect(css).toContain(
      '.room-panel-controls .drawer-tab { position:static;',
    );
    expect(css).toContain('.room-game-content>.side-drawer { position:sticky;');
    expect(css).toContain(
      '.room-game-content>.side-drawer[hidden] { display:none; }',
    );
    expect(css).toContain(
      '.room-game-content .action-footer-sticky { position:static;',
    );
    expect(css).toContain(
      '.room-game-content .reward-grid { column-gap:12px; row-gap:0; }',
    );
    expect(css).toContain(
      '.room-game-content .reward-column { grid-template-rows:subgrid; grid-row:span 3; }',
    );
    expect(css).toContain(
      '.room-game-content[data-ranking-open]>.game-stage { grid-column:1; grid-row:1; }',
    );
  });
});

describe('single target entry per reward card', () => {
  it.each([false, true])(
    'moves the native selection to the card header, double=%s, and keeps amount-focus selection',
    async (double) => {
      const submit = await mount(gameWith(double ? ['more_options'] : []));
      expect(container.querySelectorAll('.reward-target input')).toHaveLength(
        2,
      );
      expect(
        container.querySelectorAll(
          '.action-pair input[type=radio], .action-pair input[type=checkbox], button.reward-target',
        ),
      ).toHaveLength(0);
      const a = element<HTMLInputElement>('#bid-A'),
        b = element<HTMLInputElement>('#bid-B');
      expect(a.type).toBe(double ? 'checkbox' : 'radio');
      expect(a.closest('article.item-card')).not.toBeNull();
      expect(b.closest('article.item-card')).not.toBeNull();
      expect(a.getAttribute('aria-describedby')).toBe('action-mode-hint');
      await click('#bid-B');
      expect(b.checked).toBe(true);
      expect(a.checked).toBe(double);
      await act(async () =>
        element<HTMLInputElement>(
          'input[aria-label="竞拍奖励 A 的数值"]',
        ).focus(),
      );
      expect(a.checked).toBe(true);
      expect(b.checked).toBe(double);
      expect(submit).not.toHaveBeenCalled();
    },
  );
});
