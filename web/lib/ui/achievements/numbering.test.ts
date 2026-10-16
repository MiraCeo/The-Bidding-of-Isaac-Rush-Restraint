import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  achievementCatalog,
  characterAchievementRequirements,
} from './catalog';
import {
  achievementIdForNumber,
  achievementNumber,
  achievementNumbering,
  achievementNumberOrder,
  compareAchievementNumbers,
} from './numbering';
import { achievementSeries, selectAchievementCards } from './series';
import {
  achievementPresentation,
  selectAchievements,
  type AchievementFilters,
} from './presentation';
import { revision058Catalog } from './revision058-catalog';
import { achievementSeriesCopy } from './series-copy';
import { achievementCollectionMetadata } from './collection-metadata';
import { currentAchievementBaseline } from './baseline';
import { appendCf, cfNow, cfRoom } from './revision058.test-helper';
import { createPlayerProfile, readPlayerProfile } from '../player-profile';
import { projectAchievementRegistry } from './registry';

const all: AchievementFilters = {
  query: '',
  category: 'all',
  status: 'all',
  sort: 'catalog',
};
describe('0.5.12 public numbers, stable persistence keys and trigger copy', () => {
  it('assigns each of the 107 active medals one contiguous category number with no retired aliases', () => {
    expect(achievementNumbering).toHaveLength(107);
    expect(new Set(achievementNumbering.map((a) => a.id)).size).toBe(107);
    expect(new Set(achievementNumbering.map((a) => a.number)).size).toBe(107);
    expect(achievementNumbering.map((a) => a.id).sort()).toEqual(
      achievementCatalog.map((a) => a.id).sort(),
    );
    for (const [category, ids] of Object.entries(achievementNumberOrder)) {
      ids.forEach((id, i) => {
        const number = `${category}${String(i + 1).padStart(2, '0')}`;
        expect(achievementNumber(id)).toBe(number);
        expect(achievementIdForNumber(` ${number.toLowerCase()} `)).toBe(id);
        expect(id[0]).toBe(category);
      });
      expect(
        achievementIdForNumber(`${category}${ids.length + 1}`),
      ).toBeUndefined();
    }
    expect(() => achievementNumber('A02')).toThrow('没有正式编号');
    expect(() => achievementNumber('A04')).toThrow('没有正式编号');
    expect(achievementIdForNumber('B10')).toBe('B17'); // Former deferred label is NOT a new candidate.
    expect(achievementIdForNumber('E13')).toBe('E11');
    expect(achievementIdForNumber('F11')).toBe('F07');
    for (const value of ['', 'A1', 'Z01', 'A00', 'A99', 'A01+B01'])
      expect(achievementIdForNumber(value)).toBeUndefined();
  });
  it('keeps all 25 bronze/silver/gold groups consecutive, and keeps independent classic cards independent', () => {
    expect(Object.keys(achievementSeriesCopy).sort()).toEqual(
      achievementSeries.map((s) => s.id).sort(),
    );
    for (const series of achievementSeries) {
      const numbers = series.ids.map((id) => achievementNumber(id));
      const start = Number(numbers[0]!.slice(1));
      expect(numbers.map((n) => Number(n.slice(1)))).toEqual([
        start,
        start + 1,
        start + 2,
      ]);
      expect(
        series.ids.map((id) => achievementCollectionMetadata[id].tier),
      ).toEqual(['bronze', 'silver', 'gold']);
    }
    const cards = selectAchievementCards(all, {}, {});
    expect(cards).toHaveLength(57);
    expect(
      cards.filter((c) => ['E06', 'E09', 'E10'].includes(c.id)),
    ).toHaveLength(3);
    const first = cards.map((c) => c.series?.ids[0] ?? c.id);
    expect(first).toEqual([...first].sort(compareAchievementNumbers));
  });
  it('uses only the public number for search, including collisions with old keys and hidden names', () => {
    for (const { id, number } of achievementNumbering) {
      expect(
        selectAchievements({ ...all, query: number.toLowerCase() }, {}, {}).map(
          (a) => a.id,
        ),
      ).toEqual([id]);
    }
    expect(
      selectAchievements({ ...all, query: 'A02' }, {}, {}).map((a) => a.id),
    ).toEqual(['A08']);
    expect(
      selectAchievements({ ...all, query: 'B02' }, {}, {}).map((a) => a.id),
    ).toEqual(['B14']);
    expect(
      selectAchievements({ ...all, query: 'B23' }, {}, {}).map((a) => a.id),
    ).toEqual(['B12']);
    expect(selectAchievements({ ...all, query: '两败俱伤' }, {}, {})).toEqual(
      [],
    );
    expect(
      selectAchievementCards(
        { ...all, query: 'A03', status: 'achieved' },
        {},
        { A01: cfNow.toISOString() },
      ),
    ).toEqual([]);
  });
  it('describes a concrete trigger and target for every tier without changing targets, scopes or evaluator identities', () => {
    for (const a of achievementCatalog) {
      const prior = revision058Catalog.find((old) => old.id === a.id)!;
      expect({ ...a, name: prior.name, condition: prior.condition }).toEqual(
        prior,
      );
    }
    for (const series of achievementSeries) {
      series.ids.forEach((id, i) => {
        const a = achievementCatalog.find((a) => a.id === id)!;
        const copy = achievementPresentation[id];
        expect(a.name).toBe(
          series.id === 'S-SURVIVAL'
            ? revision058Catalog.find((old) => old.id === id)!.name
            : `${series.name} ${['I', 'II', 'III'][i]}`,
        );
        expect(copy.summary).toContain(String(a.target));
        expect(copy.summary).not.toContain(series.name + '：');
        expect(copy.note).toBe(a.condition);
        expect(a.condition).toContain(String(a.target));
        expect(copy.summary.length).toBeLessThanOrEqual(25);
      });
    }
    expect(achievementPresentation.A13.summary).toContain('后续房获奖');
    expect(achievementPresentation.B05.note).toContain(
      '先取得资格后被道具消除不计',
    );
    expect(achievementPresentation.F04.note).toContain('不从中间层拼接');
  });
  it('inherits the fixed baseline, receipt bytes, progress, timestamps and role requirements without writing a migration', () => {
    const missed = cfRoom(0, { code: 1 });
    missed.values[5] = 1;
    missed.values[9] = 1;
    const p = appendCf(createPlayerProfile(cfNow), missed);
    const raw = JSON.stringify(p);
    const view = projectAchievementRegistry(p)!;
    expect(currentAchievementBaseline).toBe(1);
    expect(
      characterAchievementRequirements.lost.map(achievementNumber),
    ).toEqual(['E01', 'A08']);
    expect(
      characterAchievementRequirements.eden.map(achievementNumber),
    ).toEqual(['E05']);
    for (const { id } of achievementNumbering)
      expect(achievementPresentation[id]).toBeDefined();
    selectAchievements(all, view.progress, view.achievedAt);
    selectAchievementCards(all, view.progress, view.achievedAt);
    expect(JSON.stringify(p)).toBe(raw);
    const restored = readPlayerProfile(JSON.parse(raw));
    expect(JSON.stringify(restored)).toBe(raw);
    expect(projectAchievementRegistry(restored)).toEqual(view);
    expect(Object.keys(view.achievedAt).sort()).toEqual(['A01', 'B05']);
    expect(achievementNumber('B05')).toBe('B11');
  });
  it('keeps current master-table number, name, summary and full condition synchronized with runtime', () => {
    const table = readFileSync(
      new URL('../../../../docs/规划/成就总表.md', import.meta.url),
      'utf8',
    ).replace(/\r\n/g, '\n');
    for (const a of achievementCatalog) {
      const number = achievementNumber(a.id);
      expect(table).toContain(
        `| [${number}](#${number.toLowerCase()}) | ${a.id} | ${a.name} |`,
      );
      expect(table).toContain(`### ${number}\n`);
      const section = table.split(`### ${number}\n`)[1]!.split('\n### ')[0]!;
      expect(section).toContain(`- **完整条件**：${a.condition}`);
      expect(section).toContain(
        `- **列表摘要**：${achievementPresentation[a.id].summary}`,
      );
      expect(section).toContain(
        `- **判定说明**：${achievementPresentation[a.id].note}`,
      );
    }
  });
});
