// @vitest-environment happy-dom
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import { ProgressOverview } from '@/components/game/progress-overview';
import { overviewMatches, overviewProfile } from './progress-overview';
import { createGameSession, reduceGameSession } from './game-session';
import { createPlayerProfile } from './player-profile';
import {
  classicCompletionFixture,
  completionRecordFixture,
} from './completion-registry.test-helper';
import {
  registerCompletion,
  completionRegistryModule,
} from './completion-registry';
import { playLongRun } from './survival-long-run';
import { classicAiPolicy } from '../game/classic-difficulty';
import { readFileSync } from 'node:fs';

it('keeps both empty modes unstarted without inventing a character, score or progress', () => {
  const c = createGameSession(77),
    before = structuredClone(c);
  const models = overviewMatches(c, null);
  expect(models.map((m) => m.state)).toEqual(['empty', 'empty']);
  for (const m of models) {
    expect(m.characterId).toBeNull();
    expect(m.metrics).toEqual([]);
    expect(m.progress).toBeNull();
  }
  expect(c).toEqual(before);
});
it('uses the recorded classic final order and score, and actual settled room count', () => {
  const c = classicCompletionFixture(),
    before = structuredClone(c);
  if (c.game.phase !== 'game_result') throw Error('final');
  const own = c.game.finalRanking.find((e) => e.playerId === 'human')!;
  const m = overviewMatches(c, null)[0]!;
  expect(m.state).toBe('complete');
  expect(m.metrics.map((x) => x.value)).toEqual([
    c.game.finalRanking.findIndex((e) => e.playerId === 'human') + 1,
    own.finalScore,
  ]);
  expect(m.progress).toEqual({ value: 15, max: 15, label: '已结算 15/15 房' });
  expect(m.difficulty).toContain('未分档');
  expect(c).toEqual(before);
  const active = reduceGameSession(createGameSession(1), {
    type: 'start_game',
    characterId: 'jacob_esau',
    classicAi: { difficulty: 'standard', policy: classicAiPolicy },
  });
  expect(overviewMatches(active, null)[0]!.characterId).toBe('jacob_esau');
});
it('retains early-eliminated personal facts during AI continuation and final recorded results', () => {
  const run = playLongRun(1, 'isaac', 'standard');
  const continuing = run.states.find(
    (g) => g.phase !== 'competition_complete' && !!g.eliminated.human,
  )!;
  expect(continuing).toBeDefined();
  const before = structuredClone(continuing),
    frozen = continuing.eliminated.human!;
  const m = overviewMatches(createGameSession(1), {
    game: continuing,
    draft: null,
  })[1]!;
  expect(m.state).toBe('ai-running');
  expect(m.location).toBe(`你在第 ${frozen.floorIndex + 1} 层淘汰`);
  expect(m.metrics.map((x) => x.value)).toEqual([
    frozen.floorIndex + 1,
    frozen.cumulativeScore,
  ]);
  expect(m.progress).toBeNull();
  expect(continuing).toEqual(before);
  const final = overviewMatches(createGameSession(1), {
    game: run.game,
    draft: null,
  })[1]!;
  const own = run.game.finalRanking.find((e) => e.playerId === 'human')!;
  expect(final.metrics.map((x) => x.value)).toEqual([own.rank, own.finalScore]);
  expect(final.location).toBe(m.location);
});
it('separates retained history from registry counts and does not backfill or combine scores', () => {
  const p = createPlayerProfile();
  p.history = [
    completionRecordFixture(1),
    completionRecordFixture(2, 'survival'),
  ];
  const before = structuredClone(p);
  const old = overviewProfile(p, '');
  expect(old.scope).toBe('已保留历史');
  expect([old.total, old.classic, old.survival, old.historyCount]).toEqual([
    2, 1, 1, 2,
  ]);
  const current = registerCompletion(
    p,
    { ...completionRecordFixture(3), rank: 1 },
    [],
    true,
  );
  const model = overviewProfile(current, '');
  expect(model.scope).toBe('统一登记累计');
  expect([
    model.total,
    model.classic,
    model.survival,
    model.champions,
    model.historyCount,
  ]).toEqual([1, 1, 0, 1, 3]);
  expect(model.note).toContain('2条历史不自动补入');
  expect(p).toEqual(before);
});
it('sorts the last three results by completion time without rewriting original history order', () => {
  const p = createPlayerProfile();
  p.history = Array.from({ length: 5 }, (_, i) => ({
    ...completionRecordFixture(i),
    completedAt: `2026-10-${String(10 + i).padStart(2, '0')}T03:00:00.000Z`,
  })).reverse();
  const before = structuredClone(p);
  expect(overviewProfile(p, '').recent.map((r) => r.replayId)).toEqual([
    'fixture-classic-4',
    'fixture-classic-3',
    'fixture-classic-2',
  ]);
  expect(p).toEqual(before);
});
it('never labels unreadable or invalid profile data as zero', () => {
  const p = createPlayerProfile();
  const unavailable = overviewProfile(p, '原档案不可读取');
  expect(unavailable.total).toBeNull();
  expect(unavailable.historyCount).toBeNull();
  expect(unavailable.error).toContain('不可读取');
  p.progression.modules[completionRegistryModule] = { version: -1 };
  const invalid = overviewProfile(p, '');
  expect(invalid.total).toBeNull();
  expect(invalid.recent).toEqual([]);
  expect(invalid.error).not.toBe('');
});
it('renders the existing pixel character, current preferences and truthful limited data sources', () => {
  const c = classicCompletionFixture();
  const p = createPlayerProfile();
  p.history = [completionRecordFixture(1)];
  const html = renderToStaticMarkup(
    createElement(ProgressOverview, {
      classic: c,
      survival: null,
      profile: p,
      profileMessage: '',
      classicSaveMessage: '保存失败，原局保留',
      survivalSaveMessage: '暂无需要保存的对局',
      decimals: 4,
      onClassic: vi.fn(),
      onSurvival: vi.fn(),
      onOpen: vi.fn(),
    }),
  );
  const node = document.createElement('div');
  node.innerHTML = html;
  expect(
    node
      .querySelector('[data-overview-mode=classic] .character-art')!
      .getAttribute('data-character-id'),
  ).toBe('isaac');
  expect(
    node.querySelector(
      '[data-overview-mode=classic] [data-overview-metric=score]',
    )!.textContent,
  ).toMatch(/\.\d{4}$/);
  expect(node.textContent).toContain('保存失败，原局保留');
  expect(node.textContent).toContain('不代表终身累计');
  expect(node.textContent).toContain('不代表每局都有完整回放');
});

it('keeps progress navigation reachable on narrow screens without changing the other tab contents', () => {
  const css = readFileSync('app/globals.css', 'utf8');
  expect(css).toContain(
    'main:is(:has(.ai-personality-guide),.progress-page)>.topbar:not(.topbar-with-session) .topbar-inner { display:grid;',
  );
  expect(css).toContain(
    '.overview-matches { grid-template-columns:minmax(0,1fr); }',
  );
  expect(css).toContain(
    '.overview-character .character-art-figure { width:128px; height:128px; background-size:128px 128px; }',
  );
});
