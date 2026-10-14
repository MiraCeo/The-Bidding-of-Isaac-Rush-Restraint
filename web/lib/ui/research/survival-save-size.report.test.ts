import { it, expect } from 'vitest';
import { gzipSync, gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { canonicalJson } from '../../shared/json-facts';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  packResearchReferences,
  unpackResearchReferences,
} from './survival-size-codec';
import {
  parseSurvivalCheckpoint,
  parseSurvivalReplay,
  serializeSurvivalCheckpoint,
} from '../survival-persistence';
import {
  serializeSurvivalBackup as makeBackup,
  parseSurvivalBackup,
} from '../survival-backup';
import { createPlayerProfile } from '../player-profile';
const bytes = (s: string) => Buffer.byteLength(s, 'utf8');
function time(action: () => unknown) {
  action();
  const values = [];
  for (let i = 0; i < 5; i++) {
    const started = performance.now();
    action();
    values.push(performance.now() - started);
  }
  values.sort((a, b) => a - b);
  return { medianMs: values[2]!, maximumMs: values[4]! };
}
function profile(doc: Record<string, unknown>) {
  return Object.entries(doc)
    .map(([key, value]) => ({
      key,
      bytes: bytes(JSON.stringify(key) + ':' + JSON.stringify(value)),
    }))
    .sort((a, b) => b.bytes - a.bytes);
}
it.skipIf(process.env.SURVIVAL_SAVE_SIZE_STUDY !== '1')(
  'measures lossless storage candidates against original v4 validators',
  () => {
    const directory = resolve('work', 'survival-save-size-study');
    mkdirSync(directory, { recursive: true });
    const results = [];
    for (const fixture of [
      'isaac-official',
      'jacob_esau-official',
      'jacob_esau-structural',
    ]) {
      const checkpointSource = readFileSync(
          resolve(
            'work',
            'survival-long-run-optimized',
            fixture + '-checkpoint.json',
          ),
          'utf8',
        ),
        replaySource = readFileSync(
          resolve(
            'work',
            'survival-long-run-optimized',
            fixture + '-replay.json',
          ),
          'utf8',
        );
      const checkpoint = parseSurvivalCheckpoint(checkpointSource),
        replay = parseSurvivalReplay(replaySource),
        backupSource = makeBackup(
          checkpoint.game,
          checkpoint.draft,
          createPlayerProfile(),
        );
      const breakdown = profile(
        replay.replay as unknown as Record<string, unknown>,
      );
      const roomFields = new Map<string, number>();
      for (const room of replay.replay.rooms)
        for (const entry of profile(room as unknown as Record<string, unknown>))
          roomFields.set(
            entry.key,
            (roomFields.get(entry.key) ?? 0) + entry.bytes,
          );
      const snapshots = replay.replay.rooms.flatMap((r) => [
        ...r.playersBefore,
        ...r.players,
      ]);
      const inventoryBytes = snapshots.reduce(
        (sum, p) => sum + bytes(JSON.stringify(p.items)),
        0,
      );
      const totals = {
        snapshots: snapshots.length,
        inventoryInstancesRepeated: snapshots.reduce(
          (sum, p) => sum + p.items.length,
          0,
        ),
        uniqueItemInstances: new Set(
          snapshots.flatMap((p) => p.items.map((i) => i.instanceId)),
        ).size,
        inventoryBytes,
      };
      const compressed = [];
      for (const [kind, source] of [
        ['checkpoint', checkpointSource],
        ['replay', replaySource],
        ['backup', backupSource],
      ] as const) {
        const original = JSON.parse(source),
          packed = packResearchReferences(original),
          packedSource = JSON.stringify(packed);
        expect(JSON.stringify(unpackResearchReferences(packed))).toBe(source);
        const packedRawGzip = gzipSync(packedSource, { level: 6 }),
          rawGzip = gzipSync(source, { level: 6 });
        const envelope = JSON.stringify({
          format: 'survival-research-gzip-1',
          compression: 'gzip',
          encoding: 'base64',
          data: rawGzip.toString('base64'),
        });
        const packedEnvelope = JSON.stringify({
          format: 'survival-research-gzip-refs-1',
          compression: 'gzip',
          encoding: 'base64',
          data: packedRawGzip.toString('base64'),
        });
        const unpacked = gunzipSync(rawGzip, {
          maxOutputLength: 8 * 1024 * 1024,
        }).toString('utf8');
        expect(unpacked).toBe(source);
        const referenceRestored = JSON.stringify(
          unpackResearchReferences(
            JSON.parse(
              gunzipSync(packedRawGzip, {
                maxOutputLength: 8 * 1024 * 1024,
              }).toString('utf8'),
            ),
          ),
        );
        expect(referenceRestored).toBe(source);
        if (kind === 'checkpoint')
          expect(parseSurvivalCheckpoint(unpacked).game).toEqual(
            checkpoint.game,
          );
        else if (kind === 'replay')
          expect(parseSurvivalReplay(unpacked).replay).toEqual(replay.replay);
        else
          expect(parseSurvivalBackup(unpacked).checkpoint.game).toEqual(
            checkpoint.game,
          );
        compressed.push({
          kind,
          originalBytes: bytes(source),
          originalUtf16Bytes: source.length * 2,
          gzipBytes: rawGzip.length,
          gzipJsonEnvelopeBytes: bytes(envelope),
          referenceJsonBytes: bytes(packedSource),
          referenceGzipBytes: packedRawGzip.length,
          referenceGzipEnvelopeBytes: bytes(packedEnvelope),
          dictionaryNodes: packed.nodes.length,
          timings: {
            gzipLevel6: time(() => gzipSync(source, { level: 6 })),
            gunzip: time(() =>
              gunzipSync(rawGzip, { maxOutputLength: 8 * 1024 * 1024 }),
            ),
            referenceEncode: time(() => packResearchReferences(original)),
            referenceDecode: time(() => unpackResearchReferences(packed)),
          },
        });
      }
      const compactBackup = JSON.stringify({
        candidate: 'checkpoint-plus-profile-only',
        checkpoint: JSON.parse(checkpointSource),
        profile: createPlayerProfile(),
      });
      const rawCheckpoint = JSON.parse(checkpointSource),
        snapshotDigest = createHash('sha256')
          .update(canonicalJson(rawCheckpoint.snapshot))
          .digest('hex');
      const {
        snapshot: _snapshot,
        checksum: _checksum,
        ...commandFields
      } = rawCheckpoint;
      const commandsOnly = JSON.stringify({
        candidate: 'commands-with-snapshot-sha256',
        ...commandFields,
        snapshotDigest,
      });
      const reconstructedSnapshot = JSON.parse(
        serializeSurvivalCheckpoint(checkpoint.game, checkpoint.draft),
      ).snapshot;
      expect(
        createHash('sha256')
          .update(canonicalJson(reconstructedSnapshot))
          .digest('hex'),
      ).toBe(snapshotDigest);
      results.push({
        fixture,
        compressed,
        replayBreakdown: breakdown,
        roomFields: [...roomFields]
          .map(([key, bytes]) => ({ key, bytes }))
          .sort((a, b) => b.bytes - a.bytes),
        snapshots: totals,
        commandsOnlyCandidateBytes: bytes(commandsOnly),
        commandsOnlyGzipJsonBytes: bytes(
          JSON.stringify({
            format: 'survival-research-gzip-1',
            compression: 'gzip',
            encoding: 'base64',
            data: gzipSync(commandsOnly, { level: 6 }).toString('base64'),
          }),
        ),
        compactBackupCandidateBytes: bytes(compactBackup),
        compactBackupGzipBytes: gzipSync(compactBackup, { level: 6 }).length,
        compactBackupGzipJsonBytes: bytes(
          JSON.stringify({
            format: 'survival-research-gzip-1',
            compression: 'gzip',
            encoding: 'base64',
            data: gzipSync(compactBackup, { level: 6 }).toString('base64'),
          }),
        ),
      });
    }
    writeFileSync(
      resolve(directory, 'report.json'),
      JSON.stringify(
        {
          kind: 'survival-save-size-research-1',
          createdAt: new Date().toISOString(),
          runtime: process.version,
          scope:
            'Experimental encodings only. No production formats, storage keys, game versions or player data changed.',
          results,
        },
        null,
        2,
      ),
    );
    console.log(JSON.stringify(results, null, 2));
  },
  120000,
);
