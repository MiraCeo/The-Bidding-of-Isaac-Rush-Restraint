import { it, expect } from 'vitest';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { achievementCharacters } from './catalog';
import {
  studyPolicies,
  playAchievementStudy,
  summarizeStudyRows,
  type StudyMatch,
} from './difficulty-study.test-helper';
import packageInfo from '../../../package.json';
import {
  summarizeStudyCampaigns,
  summarizeStudyOverlaps,
} from './difficulty-study-stats.test-helper';
const enabled = process.env.ACHIEVEMENT_DIFFICULTY_REPORT === '1';
const merging = process.env.ACHIEVEMENT_STUDY_MERGE === '1';
it.skipIf(!enabled || merging)(
  'measures achievement difficulty under fixed scripted policies and official match rules',
  () => {
    const samples = Number(process.env.ACHIEVEMENT_STUDY_SEEDS ?? 20),
      offset = Number(process.env.ACHIEVEMENT_STUDY_OFFSET ?? 0),
      tag = process.env.ACHIEVEMENT_STUDY_TAG ?? 'main';
    if (
      !Number.isInteger(samples) ||
      samples < 1 ||
      samples > 40 ||
      !Number.isInteger(offset) ||
      offset < 0 ||
      offset + samples > 40 ||
      !/^[a-z0-9-]+$/.test(tag)
    )
      throw Error('Invalid study parameters');
    const dir = 'work/achievement-difficulty-study/' + tag;
    mkdirSync(dir, { recursive: true });
    const files = [
      'lib/game/config.ts',
      'lib/game/survival-rules.ts',
      'lib/game/survival-difficulty.ts',
      'lib/game/room-engine.ts',
      'lib/ui/achievements/catalog.ts',
      'lib/ui/achievements/lifecycle.ts',
      'lib/ui/achievements/registry.ts',
      'lib/ui/achievements/difficulty-study.test-helper.ts',
      'lib/ui/achievements/difficulty-study.report.test.ts',
      'lib/ui/achievements/difficulty-study-stats.test-helper.ts',
    ];
    const hashes = Object.fromEntries(
      files.map((f) => [
        f,
        createHash('sha256').update(readFileSync(f)).digest('hex'),
      ]),
    );
    const started = performance.now(),
      rows: StudyMatch[] = [];
    for (let i = offset; i < offset + samples; i++) {
      for (const role of achievementCharacters)
        for (const difficulty of [
          'classic',
          'easy',
          'standard',
          'hard',
          'highest',
        ] as const)
          for (const policy of studyPolicies) {
            const seed = (0x56100000 + Math.imul(i + 1, 7919)) >>> 0,
              row = playAchievementStudy(seed, role, policy, difficulty);
            expect(row.terminal).toBe(true);
            expect(
              row.events.reduce((sum, e) => sum + e.metrics.interest, 0),
            ).toBe(row.metrics.interest);
            expect(
              row.events.reduce((sum, e) => sum + e.metrics.highest, 0),
            ).toBe(row.metrics.highest);
            for (const metric of ['savings', 'stolen'] as const)
              expect(
                row.events.reduce((sum, e) => sum + e.metrics[metric], 0),
              ).toBe(row.metrics[metric]);
            rows.push(row);
          }
      process.stdout.write(`Completed seed ${i + 1}: ${rows.length} matches\n`);
    }
    const report = {
      kind: 'offline-achievement-difficulty',
      notHumanTelemetry: true,
      notCapacityStudy: true,
      version: packageInfo.version,
      source: execFileSync('git', ['rev-parse', 'HEAD'], {
        encoding: 'utf8',
      }).trim(),
      sourceHashes: hashes,
      samplesPerRolePolicyDifficulty: samples,
      seedOffset: offset,
      totalMatches: rows.length,
      policies: studyPolicies,
      opponentDifficulties: ['classic', 'easy', 'standard', 'hard', 'highest'],
      seedFormula:
        '(0x56100000 + (i+1)*7919) >>> 0, same seeds paired across roles/policies/difficulties',
      elapsedMs: performance.now() - started,
      summary: summarizeStudyRows(rows),
      campaigns: summarizeStudyCampaigns(rows),
      overlaps: summarizeStudyOverlaps(rows),
    };
    writeFileSync(dir + '/matches.json', JSON.stringify(rows, null, 2) + '\n');
    writeFileSync(
      dir + '/summary.json',
      JSON.stringify(report, null, 2) + '\n',
    );
    expect(rows).toHaveLength(samples * 5 * 5 * 3);
    for (const [f, h] of Object.entries(hashes))
      expect(createHash('sha256').update(readFileSync(f)).digest('hex')).toBe(
        h,
      );
    process.stdout.write(
      JSON.stringify({
        directory: dir,
        matches: rows.length,
        seconds: report.elapsedMs / 1000,
      }) + '\n',
    );
  },
  1800000,
);

it.skipIf(!enabled || !merging)(
  'merges four fixed non-overlapping five-seed study batches',
  () => {
    const base = 'work/achievement-difficulty-study/',
      rows: StudyMatch[] = [];
    const reports = [0, 1, 2, 3].map((i) => {
      const dir = base + `main-${i}`;
      const report = JSON.parse(readFileSync(dir + '/summary.json', 'utf8'));
      expect(report.seedOffset).toBe(i * 5);
      expect(report.samplesPerRolePolicyDifficulty).toBe(5);
      rows.push(
        ...(JSON.parse(
          readFileSync(dir + '/matches.json', 'utf8'),
        ) as StudyMatch[]),
      );
      return report;
    });
    for (const r of reports) {
      expect(r.sourceHashes).toEqual(reports[0].sourceHashes);
      expect(r.source).toBe(reports[0].source);
    }
    for (const [file, hash] of Object.entries(reports[0].sourceHashes))
      expect(
        createHash('sha256').update(readFileSync(file)).digest('hex'),
      ).toBe(hash);
    expect(rows).toHaveLength(1500);
    expect(
      new Set(
        rows.map((r) => `${r.policy}/${r.difficulty}/${r.role}/${r.seed}`),
      ).size,
    ).toBe(1500);
    const dir = base + 'main';
    mkdirSync(dir, { recursive: true });
    writeFileSync(dir + '/matches.json', JSON.stringify(rows, null, 2) + '\n');
    writeFileSync(
      dir + '/summary.json',
      JSON.stringify(
        {
          ...reports[0],
          seedOffset: 0,
          samplesPerRolePolicyDifficulty: 20,
          totalMatches: rows.length,
          elapsedMs: undefined,
          batchElapsedMs: reports.map((r) => r.elapsedMs),
          summary: summarizeStudyRows(rows),
          campaigns: summarizeStudyCampaigns(rows),
          overlaps: summarizeStudyOverlaps(rows),
        },
        null,
        2,
      ) + '\n',
    );
  },
);
