import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { achievementCatalog } from './catalog';
import {
  achievementPresentation,
  selectAchievements,
  type AchievementFilters,
} from './presentation';
import {
  achievementColumns,
  achievementLayoutKey,
  loadAchievementColumns,
  saveAchievementColumns,
} from './layout-preferences';
import { achievementGlyphs } from '@/components/game/achievement-badge';
const all: AchievementFilters = {
  query: '',
  category: 'all',
  status: 'all',
  sort: 'catalog',
};
describe('presentation-only catalog and deterministic filters', () => {
  it('covers exactly the 30 existing IDs with concise summaries, detailed notes and unique local glyphs', () => {
    const ids = achievementCatalog.map((a) => a.id).sort();
    expect(Object.keys(achievementPresentation).sort()).toEqual(ids);
    expect(Object.keys(achievementGlyphs).sort()).toEqual(ids);
    expect(new Set(Object.values(achievementGlyphs)).size).toBe(30);
    for (const a of achievementCatalog) {
      expect(achievementPresentation[a.id].summary.length).toBeLessThanOrEqual(
        25,
      );
      expect(achievementPresentation[a.id].note.length).toBeGreaterThan(10);
    }
  });
  it('combines case-insensitive ID/name, classification and completion without mutation', () => {
    const achieved = Object.freeze({
        A01: '2026-10-15T00:00:00.000Z',
        F01: '2026-10-16T00:00:00.000Z',
      }),
      progress = Object.freeze({ A01: 12, A02: 12 });
    expect(
      selectAchievements(
        { ...all, query: ' a0 ', category: 'A', status: 'pending' },
        progress,
        achieved,
      ).map((a) => a.id),
    ).toEqual(['A02', 'A03']);
    expect(
      selectAchievements({ ...all, query: '礼物' }, {}, {}).map((a) => a.id),
    ).toEqual(['E05']);
    expect(
      selectAchievements({ ...all, query: 'a01', category: 'F' }, {}, achieved),
    ).toEqual([]);
    expect(
      selectAchievements(
        { ...all, status: 'achieved' },
        progress,
        achieved,
      ).map((a) => a.id),
    ).toEqual(['A01', 'F01']);
    expect(achievementCatalog[0]!.id).toBe('A01');
    expect(progress.A01).toBe(12);
  });
  it('sorts recent first with ID ties, and progress by bounded target ratio rather than raw money', () => {
    const at = '2026-10-15T00:00:00.000Z';
    expect(
      selectAchievements(
        { ...all, sort: 'recent' },
        {},
        { A01: at, E05: at, F01: '2026-10-16T00:00:00.000Z' },
      )
        .slice(0, 4)
        .map((a) => a.id),
    ).toEqual(['F01', 'A01', 'E05', 'A02']);
    expect(
      selectAchievements(
        { ...all, sort: 'progress' },
        { A02: 5, D03: 400, E05: 999 },
        { A01: at },
      )
        .slice(0, 4)
        .map((a) => a.id),
    ).toEqual(['A01', 'E05', 'A02', 'D03']);
    expect(selectAchievements(all, {}, {})).toHaveLength(30);
  });
});
describe('optional display preference and static responsive contract', () => {
  it('does not write on loading invalid, missing or unsupported data; unavailable storage is nonfatal', () => {
    for (const raw of [
      null,
      'bad',
      '{}',
      '{"version":2,"columns":"3"}',
      '{"version":1,"columns":3}',
      '{"version":1,"columns":"4"}',
    ])
      expect(
        loadAchievementColumns({
          getItem: () => raw,
          setItem: () => {
            throw Error('must not write');
          },
        }),
      ).toBe('auto');
    expect(loadAchievementColumns(null)).toBe('auto');
    expect(
      loadAchievementColumns({
        getItem: () => {
          throw Error('blocked');
        },
        setItem: () => {},
      }),
    ).toBe('auto');
    expect(saveAchievementColumns(null, '3')).toBe(false);
    expect(
      saveAchievementColumns(
        {
          getItem: () => null,
          setItem: () => {
            throw Error('quota');
          },
        },
        '3',
      ),
    ).toBe(false);
  });
  it.each(achievementColumns)(
    'round-trips %s independently of player data and ordinary preferences',
    (columns) => {
      const values = new Map<string, string>([
        ['bidding-player-profile-v1', 'untouched'],
        ['bidding-ui-preferences-v1', 'untouched'],
      ]);
      const storage = {
        getItem: (k: string) => values.get(k) ?? null,
        setItem: (k: string, v: string) => {
          values.set(k, v);
        },
      };
      expect(saveAchievementColumns(storage, columns)).toBe(true);
      expect(loadAchievementColumns(storage)).toBe(columns);
      expect(values.size).toBe(3);
      expect(values.get('bidding-player-profile-v1')).toBe('untouched');
      expect(values.get(achievementLayoutKey)).toBe(
        JSON.stringify({ version: 1, columns }),
      );
    },
  );
  it('uses available container width, manual upper bounds, capped content and scrollable dialog, not a rendered-layout proof', () => {
    const css = readFileSync(
      new URL('../../../app/globals.css', import.meta.url),
      'utf8',
    );
    for (const source of [
      'container:achievement-collection / inline-size',
      'max-width:1200px',
      '@container achievement-collection (min-width:620px)',
      '.achievement-grid:not([data-columns="1"])',
      '@container achievement-collection (min-width:980px)',
      '.achievement-grid[data-columns="auto"],.achievement-grid[data-columns="3"]',
      'max-height:calc(100dvh - 40px); overflow-y:auto',
    ])
      expect(css).toContain(source);
  });
});
