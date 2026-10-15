import { it, expect } from 'vitest';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import {
  fixedCapacityTraces,
  capacityFixture,
  padProfileTo,
  profileBytes,
  type CapacityShape,
} from './growth-capacity.test-helper';
import {
  readPlayerProfile,
  playerProfileKey,
  type PlayerProfile,
} from '../player-profile';
import {
  readAchievementRegistry,
  projectAchievementRegistry,
  appendAchievementEvent,
  manuallyUnlockAchievementCharacters,
  achievementReceiptLimit,
  achievementRegistryByteLimit,
} from './registry';
import { completionReceiptLimit } from '../completion-registry';
import { canonicalJson } from '../../shared/json-facts';
import { sha256Hex } from '../../shared/sha256';
import { decodeAchievementEvent } from './event-codec';
import { saveClassicClient } from './client-persistence';
import { gameSaveKey } from '../game-save';
import type { GameSession } from '../game-session';
const enabled = process.env.GROWTH_CAPACITY_REPORT === '1';
function timing(work: () => unknown, n = 3) {
  const times: number[] = [];
  for (let i = 0; i < n; i++) {
    const t = performance.now();
    work();
    times.push(performance.now() - t);
  }
  const sorted = [...times].sort((a, b) => a - b);
  return { samplesMs: times, medianMs: sorted[Math.floor(sorted.length / 2)] };
}
const nextUnit = {
  source: 'live' as const,
  mode: 'classic' as const,
  root: sha256Hex('report-next-root'),
  parent: null,
  authorityHash: sha256Hex('report-next-authority'),
  event: decodeAchievementEvent({
    stage: 'entry',
    position: 0,
    values: [0, 10],
  }),
};
async function clientSave(p: PlayerProfile, session: GameSession) {
  const before = JSON.stringify(p),
    values = new Map([[playerProfileKey, before]]);
  let profileWrites = 0;
  const storage = {
    getItem: (k: string) => values.get(k) ?? null,
    setItem: (k: string, v: string) => {
      values.set(k, v);
      if (k === playerProfileKey) profileWrites++;
    },
    removeItem: (k: string) => {
      values.delete(k);
    },
  };
  const coordinator = {
    exclusive: async <T>(_n: string, work: () => T) => work(),
  };
  const t = performance.now(),
    result = await saveClassicClient(storage, session, {
      expectedSource: null,
      coordinator,
    }),
    ms = performance.now() - t;
  const committed = values.get(playerProfileKey)!;
  if (result.message) {
    expect(committed).toBe(before);
    expect(result.session.growth!.acknowledged).toBe(29);
  } else {
    expect(result.session.growth!.acknowledged).toBe(30);
    expect(
      readAchievementRegistry(JSON.parse(committed))!.receipts,
    ).toHaveLength(readAchievementRegistry(p)!.receipts.length + 1);
  }
  let repeatedMs: number | null = null;
  if (!result.message) {
    const t2 = performance.now();
    await saveClassicClient(storage, result.session, {
      expectedSource: storage.getItem(gameSaveKey),
      coordinator,
    });
    repeatedMs = performance.now() - t2;
    expect(values.get(playerProfileKey)).toBe(committed);
    expect(profileWrites).toBe(1);
  }
  return {
    firstMs: ms,
    repeatedMs,
    profileWrites,
    result: result.message ? 'pending-checkpoint-only' : 'committed',
    ack: result.session.growth!.acknowledged,
    profileUnchanged: committed === before,
    checkpointBytes: Buffer.byteLength(values.get(gameSaveKey)!),
    message: result.message,
  };
}
it.runIf(enabled)(
  'reports bounded growth, combined budgets and exact production adapter behavior without browser storage',
  async () => {
    const traces = fixedCapacityTraces(),
      rows: unknown[] = [],
      start = performance.now(),
      heapStart = process.memoryUsage().heapUsed;
    for (const shape of ['classic', 'mixed', 'structural'] as CapacityShape[])
      for (const count of [64, 256, 1024, 2000, 2048]) {
        const f = capacityFixture(traces, count, shape, 200, 32768),
          raw = JSON.stringify(f.profile),
          bytes = profileBytes(f.profile),
          moduleBytes = Buffer.byteLength(canonicalJson(f.registry));
        let valid: PlayerProfile;
        try {
          valid = readPlayerProfile(JSON.parse(raw));
        } catch (error) {
          rows.push({
            shape,
            count,
            profileBytes: bytes,
            moduleBytes,
            status: 'budget-rejected',
            reason: error instanceof Error ? error.message : String(error),
          });
          continue;
        }
        const before = canonicalJson(valid);
        const read = timing(() => readPlayerProfile(JSON.parse(raw))),
          project = timing(() => projectAchievementRegistry(valid));
        const append = timing(() => {
          if (count === achievementReceiptLimit)
            expect(() => appendAchievementEvent(valid, nextUnit)).toThrow(
              '容量',
            );
          else
            expect(
              readAchievementRegistry(appendAchievementEvent(valid, nextUnit))!
                .receipts,
            ).toHaveLength(count + 1);
        });
        const grant = timing(() =>
          expect(
            readAchievementRegistry(manuallyUnlockAchievementCharacters(valid))!
              .manualUnlockAllAt,
          ).not.toBeNull(),
        );
        const saved = await clientSave(valid, f.probe);
        expect(canonicalJson(valid)).toBe(before);
        rows.push({
          shape,
          count,
          fixtureScope: f.scope,
          completedTemplates: f.completedTemplates,
          historyRows: valid.history.length,
          moduleBytes,
          profileBytes: bytes,
          utf16ValueEstimate: raw.length * 2,
          read,
          project,
          append,
          manualGrant: grant,
          clientSave: saved,
        });
      }
    const base = capacityFixture(traces, 64),
      near = padProfileTo(base.profile, 1024 * 1024),
      over = padProfileTo(base.profile, 1024 * 1024 + 1);
    expect(readPlayerProfile(near)).toEqual(near);
    expect(() => readPlayerProfile(over)).toThrow();
    const nearResult = await clientSave(near, base.probe);
    expect(nearResult.profileUnchanged).toBe(true);
    const combined = capacityFixture(traces, 2048, 'mixed', 200, 32768).profile;
    const completion = combined.progression.modules
      .completionRegistryV1 as unknown as { receipts: Record<string, boolean> };
    for (
      let i = Object.keys(completion.receipts).length;
      i < completionReceiptLimit;
      i++
    )
      completion.receipts[
        `classic/${sha256Hex('synthetic-observed-completion-' + i)}`
      ] = false;
    const combinedBytes = profileBytes(combined);
    expect(() => readPlayerProfile(combined)).toThrow();
    const report = {
      date: '2026-10-15',
      scope:
        'Node automation using in-memory storage and injected coordination; no browser, physical quota, real user data or gameplay FPS.',
      provenance: {
        measuredInputsSha256: Object.fromEntries(
          [
            './growth-capacity.report.test.ts',
            './growth-capacity.test-helper.ts',
            './client-persistence.ts',
            './registry.ts',
            './lifecycle.ts',
            './event-codec.ts',
            './evaluation.ts',
            './facts.ts',
            '../player-profile.ts',
            '../completion-registry.ts',
            '../game-save.ts',
          ].map((path) => [
            path,
            createHash('sha256')
              .update(readFileSync(new URL(path, import.meta.url)))
              .digest('hex'),
          ]),
        ),
        classicSeed: 42,
        classicUnits: traces.classic.growth!.units.length,
        survivalSeed: 3,
        survivalDifficulty: 'highest',
        survivalHumanEliminationFloor: traces.survival.game.humanEliminatedAt,
        survivalUnits: traces.survival.growth!.units.length,
        structuralUnits: traces.templates.structural.length,
        scaling:
          'Only metrics copied from fixed traces; new roots/authority hashes/keys are synthetic. 78-unit shape is synthetic, not a played match.',
      },
      runtime: {
        node: process.version,
        v8: process.versions.v8,
        platform: process.platform,
        arch: process.arch,
      },
      limits: {
        growthReceipts: achievementReceiptLimit,
        growthModuleBytes: achievementRegistryByteLimit,
        profileBytes: 1024 * 1024,
        completionReceipts: completionReceiptLimit,
      },
      rows,
      nearProfileLimit: {
        bytes: profileBytes(near),
        oneByteOverRejected: true,
        clientSave: nearResult,
      },
      combinedIndependentCaps: {
        growth: 2048,
        completion: 8192,
        history: 200,
        padding: 32768,
        profileBytes: combinedBytes,
        rejected: true,
        note: 'Separate module receipt caps are not a promise they fit the shared 1MiB profile.',
      },
      theoreticalReceiptOnly: {
        classic30UnitMatches: Math.floor(2048 / 30),
        classicRemainingUnits: 2048 % 30,
        synthetic78UnitMatches: Math.floor(2048 / 78),
        syntheticRemainingUnits: 2048 % 78,
        note: 'Arithmetic only; branches, human elimination, extensions and byte cap change actual lifetime. Not 68 played matches.',
      },
      elapsedMs: performance.now() - start,
      heapUsedStart: heapStart,
      heapUsedEnd: process.memoryUsage().heapUsed,
      memoryNote:
        'Process snapshots only; no forced GC and not peak or browser memory.',
    };
    const dir = new URL('../../../work/v050-stability/step3/', import.meta.url);
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      new URL('growth-capacity.json', dir),
      JSON.stringify(report, null, 2),
    );
  },
  120000,
);
