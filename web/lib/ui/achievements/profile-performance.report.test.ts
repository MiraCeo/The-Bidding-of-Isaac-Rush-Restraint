import { expect, it, vi } from 'vitest';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  captureCurrentCorpus,
  buildCurrentLedgerFixture,
  currentCorpusBytes,
  currentCorpusShapes,
} from './closeout-corpus.test-helper';
import { capacityClock } from './closeout-capacity.test-helper';
import {
  serializePlayerProfileBackup,
  parsePlayerProfileBackup,
  restorePlayerProfileBackup,
} from '../player-profile-file';
import { playerProfileKey, readPlayerProfile } from '../player-profile';
import { projectAchievementRegistry } from './registry';
import { canonicalJson } from '../../shared/json-facts';
import { sha256Hex } from '../../shared/sha256';
import {
  assertCorpusRun,
  writeCorpusJson,
  corpusSourceProvenance,
} from '../../../scripts/ledger-corpus-output.mjs';

function samples<T>(work: () => T) {
  const samplesMs: number[] = [];
  let result!: T;
  for (let i = 0; i < 3; i++) {
    const start = performance.now();
    result = work();
    samplesMs.push(performance.now() - start);
  }
  return {
    timing: { samplesMs, medianMs: [...samplesMs].sort((a, b) => a - b)[1]! },
    result,
  };
}
it.runIf(process.env.PROFILE_PERFORMANCE_REPORT === '1')(
  'compares identical production profile-file operations without changing validation or touching browser storage',
  () => {
    const root = fileURLToPath(new URL('../../../', import.meta.url)),
      directory = process.env.PROFILE_PERFORMANCE_RUN_DIR,
      phase = process.env.PROFILE_PERFORMANCE_PHASE;
    if (!directory || !['baseline', 'optimized'].includes(phase ?? ''))
      throw Error('Use report:profile:performance -- baseline|optimized');
    assertCorpusRun(root, directory, 'capacity');
    const source = corpusSourceProvenance(root),
      startedAt = new Date().toISOString(),
      traces = captureCurrentCorpus();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(capacityClock);
    const start = performance.now(),
      rows = [];
    try {
      for (const shape of currentCorpusShapes)
        for (const count of [2048, 8192]) {
          const profile = readPlayerProfile(
            buildCurrentLedgerFixture(traces, count, shape, {
              historyRows: 200,
              paddingChars: 32768,
              completionReceipts: 128,
            }).profile,
          );
          const before = canonicalJson(profile),
            projection = projectAchievementRegistry(profile);
          const serialized = samples(() =>
            serializePlayerProfileBackup(
              profile,
              'profile-performance-fixed-build',
              capacityClock,
            ),
          );
          const parsed = samples(() =>
            parsePlayerProfileBackup(serialized.result),
          );
          expect(parsed.result.profile).toEqual(profile);
          const restored = samples(() => {
            const values = new Map<string, string>([['sentinel', 'keep']]);
            const storage = {
              getItem: (k: string) => values.get(k) ?? null,
              setItem: (k: string, v: string) => {
                values.set(k, v);
              },
            };
            const result = restorePlayerProfileBackup(storage, profile, null);
            return { result, values };
          });
          expect(restored.result.result.profile).toEqual(profile);
          expect(restored.result.values.get('sentinel')).toBe('keep');
          expect(
            JSON.parse(restored.result.values.get(playerProfileKey)!),
          ).toEqual(profile);
          expect(canonicalJson(profile)).toBe(before);
          expect(projectAchievementRegistry(parsed.result.profile)).toEqual(
            projection,
          );
          const row = {
            shape,
            count,
            profileBytes: currentCorpusBytes(profile),
            profileSha256: sha256Hex(before),
            projectionSha256: sha256Hex(canonicalJson(projection)),
            backupSha256: sha256Hex(serialized.result),
            serialize: serialized.timing,
            parse: parsed.timing,
            restore: restored.timing,
          };
          rows.push(row);
          writeCorpusJson(
            root,
            directory,
            `profile-${shape}-${count}.json`,
            row,
          );
        }
      writeCorpusJson(root, directory, 'profile-performance.json', {
        kind: 'profile-file-operation-performance',
        version: 1,
        phase,
        startedAt,
        applicationVersion: JSON.parse(
          readFileSync(resolve(root, 'package.json'), 'utf8'),
        ).version,
        source,
        runtime: {
          node: process.version,
          v8: process.versions.v8,
          platform: process.platform,
          arch: process.arch,
        },
        scope:
          'Same fixed official-metric schema6 synthetic fixtures, full JSON/ledger checks, Node/in-memory only; not browser FPS or physical storage.',
        method:
          'Three samples per operation; median. Date fixed, real performance clock; each restore uses fresh memory storage. Input/backup/projection SHA256 for exact comparison. Assertions excluded from operation timings.',
        rows,
        elapsedMs: performance.now() - start,
      });
    } finally {
      vi.useRealTimers();
    }
  },
  600000,
);
