// @vitest-environment happy-dom
import { act, createElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ReplayFieldChart } from '@/components/game/replay-field-chart';
import { ReplayScoreTimeline } from '@/components/game/replay-score-timeline';
import { ReplayEvents } from '@/components/game/replay-events';
import { ReplayMoneyTimeline } from '@/components/game/replay-money-timeline';
import { createGameSession, reduceGameSession } from './game-session';
import { canonicalJson, copySnapshot } from './replay-record';
import * as decisions from '../game/ai-decision';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root, host: HTMLDivElement;
beforeEach(() => {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  localStorage.clear();
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.restoreAllMocks();
});
function log(count = 15) {
  let s = reduceGameSession(createGameSession(42), {
    type: 'start_game',
    characterId: 'jacob_esau',
  });
  for (let i = 0; i < count; i++) {
    s = reduceGameSession(s, {
      type: 'submit_player_turn',
      turn: {
        playerId: 'human',
        actions: [{ type: 'bid', group: 'A', amount: 1 }],
      },
    });
    s = reduceGameSession(s, { type: 'advance_room' });
  }
  return s.replay!;
}
function el<T extends Element = HTMLElement>(selector: string): T {
  const e = host.querySelector<T>(selector);
  if (!e) throw new Error(selector);
  return e;
}
function button(label: string) {
  const b = [...host.querySelectorAll('button')].find(
    (b) =>
      b.textContent?.trim() === label || b.getAttribute('aria-label') === label,
  );
  if (!b) throw new Error(label);
  return b;
}
async function click(target: HTMLElement) {
  await act(async () => target.click());
}
async function render(node: ReactNode) {
  await act(async () => root.render(node));
}
async function setRange(label: string, value: number) {
  const input = el<HTMLInputElement>('input[aria-label="' + label + '"]');
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value',
    )!.set!.call(input, String(value));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
}
const score = (v: number) => v.toFixed(2);
function chartBox(chart: SVGSVGElement) {
  vi.spyOn(chart, 'getBoundingClientRect').mockReturnValue({
    left: 0,
    top: 0,
    right: 925,
    bottom: 363,
    width: 925,
    height: 363,
    x: 0,
    y: 0,
    toJSON() {},
  });
}
const viewport = (svg: SVGSVGElement) => [
  Number(svg.dataset.rangeStart),
  Number(svg.dataset.rangeEnd),
];

describe('replay chart and grouped event interactions', () => {
  it('draws independent floor money paths and supports both mouse and keyboard room navigation', async () => {
    const l = log(7),
      onRoom = vi.fn(),
      before = canonicalJson(l);
    await render(
      createElement(ReplayMoneyTimeline, {
        log: l,
        playerId: 'human',
        roomIndex: 0,
        name: (id) => l.playerNames[id]!,
        onRoom,
      }),
    );
    const paths = host.querySelectorAll('.replay-money-series');
    expect(paths).toHaveLength(2);
    expect(paths[0]!.getAttribute('d')!.match(/L /g)).toHaveLength(5);
    expect(paths[1]!.getAttribute('d')!.match(/L /g)).toHaveLength(2);
    expect(host.querySelectorAll('.replay-money-point')).toHaveLength(7);
    expect(el('.replay-money-timeline').textContent).toContain(
      '第2层 · 重置 600',
    );
    const last = el('.replay-money-point[aria-label^="查看F2-R2"]');
    await act(async () =>
      last.dispatchEvent(
        new MouseEvent('click', { bubbles: true, cancelable: true }),
      ),
    );
    expect(onRoom).toHaveBeenLastCalledWith(6);
    await act(async () =>
      last.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: ' ',
          bubbles: true,
          cancelable: true,
        }),
      ),
    );
    expect(onRoom).toHaveBeenCalledTimes(2);
    expect(canonicalJson(l)).toBe(before);
  });
  it('formats grouped event summaries and numeric badges to two or four digits while preserving raw details', async () => {
    const l = log(1),
      record = copySnapshot(l.rooms[0]!);
    record.settlement.roomScoreSummaries.human!.finalScore = 99.0832;
    record.settlement.events = [
      {
        type: 'score',
        playerId: 'human',
        amount: 99.0832,
        message: '本房间获得 99.0832 分。',
      },
    ];
    record.entryEvents = [];
    const before = canonicalJson(record),
      props = {
        record,
        playerId: 'human',
        name: (id: string) => l.playerNames[id]!,
        allPlayers: true,
      };
    await render(
      createElement(ReplayEvents, { ...props, score: (v) => v.toFixed(2) }),
    );
    expect(el('.replay-player-event-stats').textContent).toContain('99.08');
    expect(el('.replay-event-amount').textContent).toBe('99.08');
    expect(el('.replay-event-precise').textContent).toContain('99.0832');
    expect(el('.replay-events li > div > p').textContent).toBe(
      '本房间获得 99.08 分。',
    );
    await render(
      createElement(ReplayEvents, { ...props, score: (v) => v.toFixed(4) }),
    );
    expect(el('.replay-event-amount').textContent).toBe('99.0832');
    expect(canonicalJson(record)).toBe(before);
  });
  it('renders old score and new score as separate segments without replacing their semantic colors', async () => {
    const l = log(2),
      record = l.rooms[1]!,
      before = canonicalJson(record);
    await render(
      createElement(ReplayFieldChart, {
        record,
        playerId: 'human',
        name: (id) => l.playerNames[id]!,
        score,
        onInspect: vi.fn(),
      }),
    );
    await click(button('累计积分'));
    expect(host.querySelectorAll('.replay-bar-before')).toHaveLength(20);
    for (const p of record.settlement.players) {
      const column = el('[data-player-id="' + p.id + '"]');
      const old = record.settlement.playersBefore.find(
        (b) => b.id === p.id,
      )!.score;
      expect(
        Number(
          column
            .querySelector('.replay-bar-before')!
            .getAttribute('data-value'),
        ),
      ).toBe(old);
      expect(
        Number(
          column
            .querySelector('.replay-comparison-bar')!
            .getAttribute('data-value'),
        ),
      ).toBe(p.score);
      const gain = column.querySelector('.replay-bar-gain');
      if (p.score > old)
        expect(Number(gain!.getAttribute('data-value'))).toBe(p.score - old);
      else expect(gain).toBeNull();
    }
    expect(el('.replay-bar-legend').textContent).toContain('本房新增');
    expect(el('.replay-chart-readout').textContent).toContain('入房累计');
    expect(canonicalJson(record)).toBe(before);
  });
  it('overlays entry and after money, covering zero, equal, refunded and increasing balances', async () => {
    const l = log(6),
      record = copySnapshot(l.rooms[5]!);
    record.settlement.playersBefore[0]!.money = 500;
    record.previousPlayers![0]!.money = 3;
    record.settlement.players[0]!.money = 510;
    record.settlement.players[1]!.money = 0;
    record.settlement.players[2]!.money =
      record.settlement.playersBefore[2]!.money;
    record.settlement.events.push({
      type: 'refund',
      playerId: 'human',
      amount: 10,
      message: '返款10。',
    });
    await render(
      createElement(ReplayFieldChart, {
        record,
        playerId: 'human',
        name: (id) => l.playerNames[id]!,
        score,
        onInspect: vi.fn(),
      }),
    );
    await click(button('结算资金'));
    expect(host.querySelectorAll('.replay-bar-money-before')).toHaveLength(20);
    expect(host.querySelectorAll('.replay-bar-money-after')).toHaveLength(20);
    const p = el('[data-player-id="human"]');
    expect(
      p.querySelector('.replay-bar-money-before')!.getAttribute('data-value'),
    ).toBe('500');
    expect(
      p.querySelector('.replay-bar-money-after')!.getAttribute('data-value'),
    ).toBe('510');
    expect(el('.replay-chart-readout').textContent).toContain('返款 10');
    expect(
      el('[data-player-id="ai-1"] .replay-bar-money-after').getAttribute(
        'height',
      ),
    ).toBe('0');
    for (const r of host.querySelectorAll('rect'))
      expect(Number(r.getAttribute('height'))).toBeGreaterThanOrEqual(0);
    expect(el('.replay-muted').textContent).toContain('不相加');
  });
  it('zooms, resets and selects room ranges without changing focused player, selected room, AI or archive', async () => {
    const l = log(),
      before = canonicalJson(l),
      name = (id: string) => l.playerNames[id]!;
    localStorage.setItem('untouched', before);
    const onFocusPlayer = vi.fn(),
      onInspectAt = vi.fn(),
      decide = vi.spyOn(decisions, 'decideAiTurn');
    await render(
      createElement(ReplayScoreTimeline, {
        log: l,
        roomIndex: 4,
        playerId: 'human',
        name,
        score,
        onFocusPlayer,
        onInspectAt,
      }),
    );
    const svg = el<SVGSVGElement>('.replay-timeline-svg'),
      ranking = el('.replay-timeline-leaderboard').textContent;
    expect(viewport(svg)).toEqual([0, 15]);
    for (const path of host.querySelectorAll('.replay-player-series')) {
      expect(path.getAttribute('d')!.match(/ L /g)).toHaveLength(15);
      expect(path.getAttribute('d')).not.toMatch(/ [HV] /);
    }
    await click(button('放大积分走势'));
    expect(viewport(svg)[1]! - viewport(svg)[0]!).toBeLessThan(15);
    await setRange('走势范围起点', 3);
    await setRange('走势范围终点', 9);
    expect(viewport(svg)).toEqual([3, 9]);
    expect(el('.replay-timeline-current-label').textContent).toBe('F1-R5');
    expect(el('.replay-timeline-leaderboard').textContent).toBe(ranking);
    expect(
      host.querySelectorAll('.replay-timeline-inspect-point'),
    ).toHaveLength(7);
    await click(button('缩小积分走势'));
    expect(viewport(svg)[1]! - viewport(svg)[0]!).toBeGreaterThan(6);
    await click(button('重置视图'));
    expect(viewport(svg)).toEqual([0, 15]);
    expect(onFocusPlayer).not.toHaveBeenCalled();
    expect(onInspectAt).not.toHaveBeenCalled();
    expect(decide).not.toHaveBeenCalled();
    expect(canonicalJson(l)).toBe(before);
    expect(localStorage.getItem('untouched')).toBe(before);
  });
  it('contains wheel zoom within the plot, allows page zoom, and pans via Shift wheel', async () => {
    const l = log();
    await render(
      createElement(ReplayScoreTimeline, {
        log: l,
        roomIndex: 5,
        playerId: 'human',
        name: (id) => l.playerNames[id]!,
        score,
        onFocusPlayer: vi.fn(),
        onInspectAt: vi.fn(),
      }),
    );
    const svg = el<SVGSVGElement>('.replay-timeline-svg');
    chartBox(svg);
    const wheel = async (options: WheelEventInit) => {
      const e = new WheelEvent('wheel', {
        bubbles: true,
        cancelable: true,
        ...options,
      });
      // happy-dom's WheelEvent omits inherited MouseEvent coordinates/modifiers.
      for (const key of [
        'clientX',
        'clientY',
        'ctrlKey',
        'metaKey',
        'shiftKey',
      ] as const)
        Object.defineProperty(e, key, {
          value: options[key] ?? (key.startsWith('client') ? 0 : false),
        });
      await act(async () => svg.dispatchEvent(e));
      return e;
    };
    expect(
      (await wheel({ clientX: 400, clientY: 150, deltaY: -100 }))
        .defaultPrevented,
    ).toBe(true);
    const after = viewport(svg);
    expect(after[1]! - after[0]!).toBeCloseTo(12);
    expect(
      (await wheel({ clientX: 400, clientY: 150, deltaY: -100, ctrlKey: true }))
        .defaultPrevented,
    ).toBe(false);
    expect(
      (await wheel({ clientX: 20, clientY: 150, deltaY: -100 }))
        .defaultPrevented,
    ).toBe(false);
    expect(viewport(svg)).toEqual(after);
    await wheel({ clientX: 400, clientY: 150, deltaY: 100, shiftKey: true });
    expect(viewport(svg)[0]).toBeGreaterThan(after[0]!);
    expect(viewport(svg)[1]! - viewport(svg)[0]!).toBeCloseTo(12);
    await wheel({ clientX: 400, clientY: 150, deltaY: 0, deltaX: -100 });
    expect(viewport(svg)[0]).toBeLessThan(after[0]! + 1.44);
  });
  it('suppresses drag clicks but keeps subsequent mouse and keyboard point navigation', async () => {
    const l = log(),
      onInspectAt = vi.fn(),
      onFocusPlayer = vi.fn();
    await render(
      createElement(ReplayScoreTimeline, {
        log: l,
        roomIndex: 5,
        playerId: 'human',
        name: (id) => l.playerNames[id]!,
        score,
        onFocusPlayer,
        onInspectAt,
      }),
    );
    const svg = el<SVGSVGElement>('.replay-timeline-svg');
    chartBox(svg);
    await click(button('放大积分走势'));
    const initial = viewport(svg);
    await act(async () => {
      svg.dispatchEvent(
        new PointerEvent('pointerdown', {
          bubbles: true,
          pointerId: 1,
          button: 0,
          clientX: 500,
          clientY: 150,
        }),
      );
      svg.dispatchEvent(
        new PointerEvent('pointermove', {
          bubbles: true,
          pointerId: 1,
          clientX: 350,
          clientY: 150,
        }),
      );
      svg.dispatchEvent(
        new PointerEvent('pointerup', {
          bubbles: true,
          pointerId: 1,
          clientX: 350,
          clientY: 150,
        }),
      );
    });
    expect(viewport(svg)[0]).toBeGreaterThan(initial[0]!);
    expect(svg.classList.contains('is-dragging')).toBe(false);
    const point = el('.replay-timeline-inspect-point');
    await act(async () =>
      point.dispatchEvent(
        new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 }),
      ),
    );
    expect(onInspectAt).not.toHaveBeenCalled();
    expect(onFocusPlayer).not.toHaveBeenCalled();
    await act(async () =>
      point.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'Enter',
          bubbles: true,
          cancelable: true,
        }),
      ),
    );
    expect(onInspectAt).toHaveBeenCalledOnce();
    onInspectAt.mockClear();
    await act(async () => {
      point.dispatchEvent(
        new PointerEvent('pointerdown', {
          bubbles: true,
          pointerId: 2,
          button: 0,
          clientX: 500,
          clientY: 150,
        }),
      );
      point.dispatchEvent(
        new PointerEvent('pointerup', {
          bubbles: true,
          pointerId: 2,
          clientX: 500,
          clientY: 150,
        }),
      );
      point.dispatchEvent(
        new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 }),
      );
    });
    expect(onInspectAt).toHaveBeenCalledOnce();
  });
  it('locates an off-screen selected room and bounds repeated zoom for short partial replays', async () => {
    const l = log(7);
    await render(
      createElement(ReplayScoreTimeline, {
        log: l,
        roomIndex: 0,
        playerId: 'human',
        name: (id) => l.playerNames[id]!,
        score,
        onFocusPlayer: vi.fn(),
        onInspectAt: vi.fn(),
      }),
    );
    const svg = el<SVGSVGElement>('.replay-timeline-svg');
    await setRange('走势范围起点', 4);
    expect(host.querySelector('.replay-timeline-current')).toBeNull();
    await click(button('定位参考房间'));
    expect(host.querySelector('.replay-timeline-current')).not.toBeNull();
    for (let i = 0; i < 8; i++) await click(button('放大积分走势'));
    expect(viewport(svg)[1]! - viewport(svg)[0]!).toBeCloseTo(2);
    expect(button('放大积分走势').disabled).toBe(true);
    expect(svg.textContent).not.toContain('F2-R3');
  });
  it('groups events into 20 player entries, defaults to focus, and preserves a unique chronological fallback', async () => {
    const l = log(1),
      record = copySnapshot(l.rooms[0]!);
    record.entryEvents.push({
      type: 'money',
      playerId: 'ai-2',
      itemId: 'money_bag',
      amount: 4,
      message: '偷钱袋从 ai-1 窃取 4 资金。',
    });
    const before = canonicalJson(record),
      total = record.entryEvents.length + record.settlement.events.length;
    await render(
      createElement(ReplayEvents, {
        record,
        playerId: 'human',
        name: (id) => l.playerNames[id]!,
        allPlayers: true,
      }),
    );
    expect(host.querySelectorAll('.replay-player-event')).toHaveLength(20);
    expect(el('.replay-player-event').getAttribute('data-player-id')).toBe(
      'human',
    );
    expect(
      el('.replay-player-event-toggle').getAttribute('aria-expanded'),
    ).toBe('true');
    expect(
      host.querySelectorAll(
        '.replay-player-event-toggle[aria-expanded="true"]',
      ),
    ).toHaveLength(1);
    const target = el('[data-player-id="ai-1"]');
    await click(target.querySelector<HTMLButtonElement>('button')!);
    expect(target.querySelector('.replay-related-event')!.textContent).toBe(
      '关联事件',
    );
    const source = el('[data-player-id="ai-2"]');
    const transferSequence = record.entryEvents.length;
    expect(
      target.querySelector('[data-event-sequence="' + transferSequence + '"]'),
    ).not.toBeNull();
    expect(
      source.querySelector('[data-event-sequence="' + transferSequence + '"]'),
    ).not.toBeNull();
    await click(button('展开全部'));
    expect(
      host.querySelectorAll('.replay-player-event-body[hidden]'),
    ).toHaveLength(0);
    await click(button('收起全部'));
    expect(
      host.querySelectorAll('.replay-player-event-body[hidden]'),
    ).toHaveLength(20);
    await click(button('原始顺序'));
    const chronological = [
      ...host.querySelectorAll('[data-event-sequence]'),
    ].map((e) => Number(e.getAttribute('data-event-sequence')));
    expect(chronological).toEqual(
      Array.from({ length: total }, (_, i) => i + 1),
    );
    expect(el('.replay-timeline-section').textContent).toContain(
      total + '条原始事件',
    );
    await click(button('按玩家'));
    expect(host.querySelectorAll('.replay-player-event')).toHaveLength(20);
    expect(canonicalJson(record)).toBe(before);
  });
  it('keeps no-event entries compact and reopens only the newly focused player', async () => {
    const l = log(1),
      record = copySnapshot(l.rooms[0]!);
    record.entryEvents = [];
    record.settlement.events = [
      { type: 'cost', playerId: 'ai-1', amount: 1, message: '扣款。' },
    ];
    const props = {
      record,
      name: (id: string) => l.playerNames[id]!,
      allPlayers: true,
    };
    await render(createElement(ReplayEvents, { ...props, playerId: 'human' }));
    expect(
      el<HTMLButtonElement>('[data-player-id="human"] button').disabled,
    ).toBe(true);
    expect(el('[data-player-id="human"]').textContent).toContain('无相关事件');
    await render(createElement(ReplayEvents, { ...props, playerId: 'ai-1' }));
    expect(
      el('[data-player-id="ai-1"] button').getAttribute('aria-expanded'),
    ).toBe('true');
    expect(
      host.querySelectorAll(
        '.replay-player-event-toggle[aria-expanded="true"]',
      ),
    ).toHaveLength(1);
  });
});
