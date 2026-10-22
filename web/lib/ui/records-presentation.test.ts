// @vitest-environment happy-dom
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { it, expect, vi } from 'vitest';
import { CompletionHistoryPanel } from '@/components/game/completion-history-panel';
import { createPlayerProfile } from './player-profile';
import { completionRecordFixture } from './completion-registry.test-helper';
import type { LibraryFilters } from '@/components/game/replay-library-panel';
import { readFileSync } from 'node:fs';

const filters: LibraryFilters = {
  role: 'all',
  difficulty: 'all',
  completion: 'all',
};
function draw(
  mode: 'classic' | 'survival',
  choice: LibraryFilters = filters,
  message = '',
) {
  const profile = createPlayerProfile();
  profile.history = [
    completionRecordFixture(1),
    { ...completionRecordFixture(2), characterId: 'lost' },
    {
      ...completionRecordFixture(3, 'survival'),
      status: 'eliminated',
      eliminationFloorIndex: 1,
    },
  ];
  const before = structuredClone(profile),
    el = document.createElement('div');
  el.innerHTML = renderToStaticMarkup(
    createElement(CompletionHistoryPanel, {
      profile,
      message,
      mode,
      filters: choice,
      onFiltersChange: vi.fn(),
      decimals: 4,
    }),
  );
  expect(profile).toEqual(before);
  return el;
}
it('shows real completion results without promising replay availability or adding destructive actions', () => {
  const el = draw('classic'),
    rows = el.querySelectorAll('[data-history-key]');
  expect(rows).toHaveLength(2);
  expect(rows[0]!.getAttribute('data-history-key')).toBe(
    completionRecordFixture(2).key,
  );
  expect(
    rows[0]!.querySelector('.character-art')!.getAttribute('data-character-id'),
  ).toBe('lost');
  expect(el.textContent).toContain('不承诺每条记录都保留完整回放');
  expect(el.querySelectorAll('button')).toHaveLength(0);
  expect(el.querySelector('.records-score')!.textContent).toBe(
    (10.1234 + 2).toFixed(4),
  );
});
it('filters history by the same role, actual difficulty and completion state without treating partial clips as final results', () => {
  expect(
    draw('classic', { ...filters, role: 'lost' }).querySelectorAll(
      '[data-history-key]',
    ),
  ).toHaveLength(1);
  expect(
    draw('classic', { ...filters, difficulty: 'ungraded' }).querySelectorAll(
      '[data-history-key]',
    ),
  ).toHaveLength(2);
  expect(
    draw('classic', { ...filters, difficulty: 'standard' }).querySelectorAll(
      '[data-history-key]',
    ),
  ).toHaveLength(0);
  expect(
    draw('survival', { ...filters, difficulty: 'standard' }).querySelectorAll(
      '[data-history-key]',
    ),
  ).toHaveLength(1);
  expect(
    draw('survival', { ...filters, completion: 'partial' }).querySelectorAll(
      '[data-history-key]',
    ),
  ).toHaveLength(0);
  expect(draw('survival').textContent).toContain('第2层淘汰');
});
it('does not show fallback empty history or a zero count when the profile cannot be verified', () => {
  const el = draw('classic', filters, '原档案不可读取');
  expect(el.querySelector('output')!.textContent).toContain('原档案不可读取');
  expect(el.querySelector('table')).toBeNull();
  expect(el.textContent).not.toContain('0 条符合筛选');
  expect(el.textContent).toContain('记录暂不可核验');
});

it('keeps wide tables inside their focusable scroll containers instead of widening the page', () => {
  const css = readFileSync('app/globals.css', 'utf8');
  expect(css).toContain(
    '.records-source-panel, .progress-records>.data-management { min-width:0; }',
  );
  expect(css).toContain('.records-source-panel[hidden] { display:none; }');
  expect(css).toContain(
    '.progress-records .progress-history-wrap table { min-width:730px;',
  );
  const history = draw('classic');
  expect(
    history
      .querySelector('[aria-label="完成结果列表"]')!
      .getAttribute('tabindex'),
  ).toBe('0');
});
