import { achievementCollectionNotes } from './collection-notes';
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  achievementCollectionMetadata,
  achievementTierLabels,
  achievementTiers,
} from './collection-metadata';
import {
  achievementCatalog,
  characterAchievementRequirements,
} from './catalog';
import {
  achievementPresentation,
  selectAchievements,
  groupAchievementEntries,
  achievementListPresentation,
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
  it('covers 87 active and two retired IDs with concise summaries and stable family glyphs', () => {
    const ids = [...achievementCatalog.map((a) => a.id), 'A02', 'A04'].sort();
    expect(Object.keys(achievementPresentation).sort()).toEqual(ids);
    expect(Object.keys(achievementCollectionNotes).sort()).toEqual(ids);
    expect(Object.keys(achievementGlyphs).sort()).toEqual(ids);
    expect(new Set(Object.values(achievementGlyphs)).size).toBe(63);
    for (const a of achievementCatalog) {
      expect(achievementCollectionNotes[a.id].length).toBeGreaterThan(3);
      expect(achievementCollectionNotes[a.id].length).toBeLessThanOrEqual(60);
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
    ).toEqual(['A03', 'A05', 'A06', 'A07', 'A08', 'A09']);
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
    ).toEqual(['F01', 'A01', 'E05', 'A03']);
    expect(
      selectAchievements(
        { ...all, sort: 'progress' },
        { A10: 3, D03: 400, E05: 999 },
        { A01: at },
      )
        .slice(0, 4)
        .map((a) => a.id),
    ).toEqual(['A01', 'E05', 'A10', 'D03']);
    expect(selectAchievements(all, {}, {})).toHaveLength(87);
  });
});
describe('metal config and soft-concealed list policy', () => {
  it('covers active and historical IDs with revised grades and visible role prerequisites', () => {
    expect(Object.keys(achievementCollectionMetadata).sort()).toEqual(
      [...achievementCatalog.map((a) => a.id), 'A02', 'A04'].sort(),
    );
    expect(
      achievementTiers.map(
        (t) =>
          achievementCatalog.filter(
            (a) => achievementCollectionMetadata[a.id].tier === t,
          ).length,
      ),
    ).toEqual([32, 32, 23]);
    expect(Object.values(achievementTierLabels)).toEqual(['铜', '银', '金']);
    expect(
      Object.entries(achievementCollectionMetadata)
        .filter(([, m]) => m.hidden)
        .map(([id]) => id)
        .sort(),
    ).toEqual(['A05', 'B03', 'B12', 'B13', 'C07', 'C09', 'F02', 'F12']);
    for (const ids of Object.values(characterAchievementRequirements))
      for (const id of ids)
        expect(achievementCollectionMetadata[id].hidden).toBe(false);
    expect(achievementCollectionMetadata.A01.tier).toBe('bronze');
    expect(achievementCollectionMetadata.A02.tier).toBe('silver');
    expect(achievementCollectionMetadata.A03.tier).toBe('silver');
  });
  it.each(['A05', 'B03', 'B12', 'B13', 'C07', 'C09', 'F02', 'F12'] as const)(
    'does not match concealed %s by true name until earned; ID and generic search remain usable',
    (id) => {
      const a = achievementCatalog.find((a) => a.id === id)!;
      expect(achievementListPresentation(id, false)).toMatchObject({
        name: '???',
        hidden: true,
      });
      expect(selectAchievements({ ...all, query: a.name }, {}, {})).toEqual([]);
      expect(
        selectAchievements({ ...all, query: id.toLowerCase() }, {}, {}).map(
          (a) => a.id,
        ),
      ).toEqual([id]);
      expect(
        selectAchievements(
          { ...all, query: a.name },
          {},
          { [id]: '2026-10-15T00:00:00.000Z' },
        ).map((a) => a.id),
      ).toEqual([id]);
      expect(achievementListPresentation(id, true)).toMatchObject({
        name: a.name,
        hidden: false,
      });
    },
  );
  it('combines tier with existing filters and does not disclose hidden progress through ranking', () => {
    expect(
      selectAchievements({ ...all, tier: 'gold' }, {}, {}).map((a) => a.id),
    ).toEqual([
      'A07',
      'A09',
      'A12',
      'A15',
      'B08',
      'B13',
      'B15',
      'B17',
      'B19',
      'B21',
      'B23',
      'B25',
      'C07',
      'C09',
      'D08',
      'D14',
      'D16',
      'E08',
      'E10',
      'F02',
      'F09',
      'F10',
      'F12',
    ]);
    expect(
      selectAchievements({ ...all, tier: 'gold', category: 'E' }, {}, {}).map(
        (a) => a.id,
      ),
    ).toEqual(['E08', 'E10']);
    const secret = Object.freeze({ A05: 1, C07: 1 }),
      at = '2026-10-15T00:00:00.000Z';
    expect(
      selectAchievements({ ...all, sort: 'progress' }, secret, {}),
    ).toEqual(selectAchievements({ ...all, sort: 'progress' }, {}, {}));
    expect(
      selectAchievements({ ...all, tier: 'gold', status: 'achieved' }, secret, {
        C07: at,
      }).map((a) => a.id),
    ).toEqual(['C07']);
    expect(
      selectAchievements({ ...all, tier: 'bronze', query: 'A02' }, {}, {}),
    ).toEqual([]);
    expect(secret).toEqual({ A05: 1, C07: 1 });
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

describe('category sections preserve sorted input within a real category boundary', () => {
  it('starts each category on an independent grid, omits empty groups, and never loses or duplicates an entry', () => {
    const entries = selectAchievements(
      { ...all, sort: 'progress' },
      { D03: 999, A02: 4, E05: 2 },
      {},
    );
    const groups = groupAchievementEntries(entries);
    expect(groups.map((g) => g.category.id)).toEqual([
      'A',
      'B',
      'C',
      'D',
      'E',
      'F',
    ]);
    expect(groups.map((g) => g.items.length)).toEqual([13, 24, 9, 16, 14, 11]);
    expect(new Set(groups.flatMap((g) => g.items.map((a) => a.id))).size).toBe(
      87,
    );
    for (const g of groups)
      expect(g.items).toEqual(
        entries.filter((a) => a.category === g.category.id),
      );
    expect(groupAchievementEntries([])).toEqual([]);
    expect(
      groupAchievementEntries(
        selectAchievements({ ...all, tier: 'gold' }, {}, {}),
      ).map((g) => g.category.id),
    ).toEqual(['A', 'B', 'C', 'D', 'E', 'F']);
  });
});
