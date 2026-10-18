import { it, expect, vi } from 'vitest';
import { fileURLToPath } from 'node:url';
import {
  captureCurrentCorpus,
  buildCurrentLedgerFixture,
  currentCorpusShapes,
  currentCorpusBytes,
} from './closeout-corpus.test-helper';
import {
  capacityClock,
  capacitySubmission,
  padCurrentProfileTo,
  probeCurrentSave,
} from './closeout-capacity.test-helper';
import { readPlayerProfile } from '../player-profile';
import {
  readAchievementRegistry,
  projectAchievementRegistry,
  appendAchievementEvent,
  achievementRegistryByteLimit,
} from './registry';
import {
  serializePlayerProfileBackup,
  parsePlayerProfileBackup,
} from '../player-profile-file';
import { packDataFile, unpackDataFile } from '../compressed-file';
import { canonicalJson } from '../../shared/json-facts';
import { sha256Hex } from '../../shared/sha256';
import { decodeAchievementEvent } from './event-codec';
import { applyGrowthContext } from './lifecycle';
import {
  assertCorpusRun,
  writeCorpusJson,
  corpusSourceProvenance,
} from '../../../scripts/ledger-corpus-output.mjs';

const reportSchema = process.env.LEDGER_REPORT_SCHEMA === '8' ? 8 : 6;

function timing(work: () => unknown, n = 3) {
  const samplesMs = [];
  for (let i = 0; i < n; i++) {
    const start = performance.now();
    work();
    samplesMs.push(performance.now() - start);
  }
  const ordered = [...samplesMs].sort((a, b) => a - b);
  return {
    samplesMs,
    medianMs: ordered[Math.floor(ordered.length / 2)]!,
    minMs: ordered[0]!,
    maxMs: ordered.at(-1)!,
  };
}
it.runIf(process.env.LEDGER_CAPACITY_REPORT === '1')(
  `measures schema${reportSchema} capacities and validation cost with unchanged production budgets`,
  async () => {
    const root = fileURLToPath(new URL('../../../', import.meta.url)),
      directory = process.env.LEDGER_CAPACITY_RUN_DIR;
    if (!directory) throw Error('Use npm run report:ledger:capacity');
    assertCorpusRun(root, directory, 'capacity');
    const startedAt = new Date().toISOString(),
      start = performance.now(),
      heapStart = process.memoryUsage().heapUsed;
    const traces = captureCurrentCorpus(),
      source = corpusSourceProvenance(root),
      rows: unknown[] = [];
    // Only Date is fixed for deterministic receipt chronology. High-resolution
    // performance clocks remain real; no GC is forced and heap snapshots are not peaks.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(capacityClock);
    try {
      for (const shape of currentCorpusShapes)
        for (const count of [0, 64, 256, 2048, 4096, 8192, 12288, 16384]) {
          const f = buildCurrentLedgerFixture(traces, count, shape, {
            schema: reportSchema,
            historyRows: 200,
            paddingChars: 32768,
            completionReceipts: 128,
          });
          const raw = canonicalJson(f.profile),
            profileBytes = currentCorpusBytes(f.profile),
            moduleBytes = f.wire ? Buffer.byteLength(canonicalJson(f.wire)) : 0;
          const common = {
            ...f.provenance,
            profileBytes,
            moduleBytes,
            profileSha256: sha256Hex(raw),
          };
          const over =
            profileBytes > 1024 * 1024 ||
            moduleBytes > achievementRegistryByteLimit;
          if (over) {
            expect(() => readPlayerProfile(JSON.parse(raw))).toThrow();
            rows.push({
              ...common,
              status: 'budget-rejected',
              exceeded: {
                profile: profileBytes > 1024 * 1024,
                module: moduleBytes > achievementRegistryByteLimit,
              },
            });
            writeCorpusJson(
              root,
              directory,
              `case-${shape}-${count}.json`,
              rows.at(-1),
            );
            continue;
          }
          const valid = readPlayerProfile(JSON.parse(raw));
          const expected = projectAchievementRegistry(valid),
            snapshot = canonicalJson(valid);
          const read = timing(() => readPlayerProfile(JSON.parse(raw)));
          const project = timing(() => projectAchievementRegistry(valid));
          let next = valid;
          const append = timing(() => {
            next = appendAchievementEvent(
              valid,
              capacitySubmission,
              capacityClock,
            );
          }, 1);
          expect(readAchievementRegistry(next)!.receipts.length).toBe(
            count + 1,
          );
          let batchProfile = valid;
          const batch = timing(() => {
            batchProfile = applyGrowthContext(
              valid,
              traces[0]!.context,
              capacityClock,
            ).profile;
          }, 1);
          expect(readAchievementRegistry(batchProfile)!.receipts.length).toBe(
            count + traces[0]!.context.units.length,
          );
          const duplicate = count
            ? timing(() => {
                const r = f.registry!.receipts[0]!;
                expect(
                  appendAchievementEvent(
                    valid,
                    {
                      source: 'live',
                      mode: r.mode,
                      root: r.root,
                      parent: r.parent,
                      authorityHash: r.authorityHash,
                      event: decodeAchievementEvent(r),
                    },
                    capacityClock,
                  ),
                ).toBe(valid);
              }, 1)
            : null;
          let backup: unknown = null,
            clientSave: unknown = null;
          if ([64, 2048, 8192].includes(count)) {
            const t = performance.now(),
              text = serializePlayerProfileBackup(
                valid,
                `schema${reportSchema}-capacity-measurement`,
                capacityClock,
              );
            const restored = parsePlayerProfileBackup(text).profile;
            const roundTripMs = performance.now() - t;
            expect(restored).toEqual(valid);
            const t2 = performance.now();
            const packed = await packDataFile(text),
              unpacked = await unpackDataFile(packed.source);
            const compressionRoundTripMs = performance.now() - t2;
            expect(unpacked.source).toBe(text);
            backup = {
              roundTripMs,
              compressionRoundTripMs,
              bytes: Buffer.byteLength(text),
              containerBytes: packed.fileBytes,
              compressed: packed.compressed,
            };
            clientSave = await probeCurrentSave(valid);
          }
          expect(canonicalJson(valid)).toBe(snapshot);
          expect(projectAchievementRegistry(valid)).toEqual(expected);
          const row = {
            ...common,
            status: 'accepted',
            read,
            project,
            append,
            batch,
            duplicate,
            backup,
            clientSave,
            heapUsedAfter: process.memoryUsage().heapUsed,
          };
          rows.push(row);
          writeCorpusJson(root, directory, `case-${shape}-${count}.json`, row);
        }
      const base = buildCurrentLedgerFixture(traces, 64, 'mixed-branches', {
        schema: reportSchema,
      }).profile;
      const near = padCurrentProfileTo(base, 1024 * 1024);
      expect(readPlayerProfile(near)).toEqual(near);
      expect(() =>
        readPlayerProfile(padCurrentProfileTo(base, 1024 * 1024 + 1)),
      ).toThrow();
      const nearSave = await probeCurrentSave(near);
      expect(nearSave.result).toBe('pending');
      const quota = await probeCurrentSave(base, true);
      expect(quota.result).toBe('pending');
      const combination = buildCurrentLedgerFixture(
        traces,
        2048,
        'mixed-branches',
        {
          schema: reportSchema,
          historyRows: 200,
          paddingChars: 32768,
          completionReceipts: 8192,
        },
      );
      const combinationBytes = currentCorpusBytes(combination.profile),
        combinationFits = combinationBytes <= 1024 * 1024;
      if (combinationFits)
        expect(readPlayerProfile(combination.profile)).toEqual(
          combination.profile,
        );
      else expect(() => readPlayerProfile(combination.profile)).toThrow();
      writeCorpusJson(root, directory, 'capacity.json', {
        kind: `schema${reportSchema}-capacity-baseline`,
        version: 1,
        startedAt,
        source,
        runtime: {
          node: process.version,
          v8: process.versions.v8,
          platform: process.platform,
          arch: process.arch,
        },
        scope:
          'Node in-memory fixtures and injected coordination only. Synthetic scale/branches; no gameplay FPS, browser, physical storage or universal lifetime guarantee.',
        timingNotes:
          'read/project 3 samples; append/duplicate/backup/client save 1. Fresh validations outside transaction-only cache; no process cold-start claim. Date fixed, performance clocks real.',
        templates: traces.map((t) => ({
          id: t.id,
          units: t.context.units.length,
          humanEliminatedAt: t.humanEliminatedAt,
          sha256: sha256Hex(canonicalJson(t.context)),
        })),
        limits: {
          moduleBytes: achievementRegistryByteLimit,
          profileBytes: 1024 * 1024,
          growthReceipts: 16384,
          completionReceipts: 8192,
        },
        rows,
        boundaries: {
          exactProfileBytes: currentCorpusBytes(near),
          oneByteOverRejected: true,
          nearSave,
          quota,
          combination: {
            growth: 2048,
            completion: 8192,
            history: 200,
            padding: 32768,
            profileBytes: combinationBytes,
            accepted: combinationFits,
          },
        },
        elapsedMs: performance.now() - start,
        heapUsedStart: heapStart,
        heapUsedEnd: process.memoryUsage().heapUsed,
        memoryNote:
          'Process snapshots, not peak or browser memory; no forced GC.',
      });
    } finally {
      vi.useRealTimers();
    }
  },
  600000,
);
