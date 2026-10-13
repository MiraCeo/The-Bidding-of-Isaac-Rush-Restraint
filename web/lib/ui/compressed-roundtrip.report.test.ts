import { it, expect } from 'vitest';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { playLongRun, longRunAction } from './survival-long-run';
import { packDataFile, unpackDataFile } from './compressed-file';
import { readModeDataFile } from './mode-data';
import {
  serializeSurvivalCheckpoint,
  serializeSurvivalReplay,
  parseSurvivalCheckpoint,
} from './survival-persistence';
import { serializeSurvivalBackup } from './survival-backup';
import { createSurvivalReplay } from './survival-record';
import { createPlayerProfile } from './player-profile';
import { survivalGameReducer } from '../game/survival-session';
import { survivalDraft } from './survival-client';
it.skipIf(process.env.COMPRESSED_ROUNDTRIP_STUDY !== '1')(
  'simulates six official matches, saves compressed data to disk, rereads and resumes them',
  async () => {
    const dir = resolve('work', 'compressed-roundtrip-v1');
    mkdirSync(dir, { recursive: true });
    const now = new Date('2026-10-13T12:00:00Z'),
      results = [];
    const cases = [
      { seed: 3, role: 'isaac', difficulty: 'highest', policy: 'withdraw' },
      {
        seed: 3,
        role: 'jacob_esau',
        difficulty: 'highest',
        policy: 'withdraw',
      },
      { seed: 42, role: 'lost', difficulty: 'standard', policy: 'withdraw' },
      { seed: 87, role: 'azazel', difficulty: 'hard', policy: 'pace' },
      { seed: 20261013, role: 'eden', difficulty: 'easy', policy: 'pace' },
      { seed: 99, role: 'jacob_esau', difficulty: 'standard', policy: 'pace' },
    ] as const;
    for (const scenario of cases) {
      const run = playLongRun(
          scenario.seed,
          scenario.role,
          scenario.difficulty,
          scenario.policy,
        ),
        game = run.game,
        log = createSurvivalReplay(game),
        profile = createPlayerProfile(now);
      profile.progression.statistics.roundtripExample = scenario.seed;
      const active = run.states.find(
          (s) =>
            s.phase === 'room_action' &&
            s.roomRecords.length >= 1 &&
            s.activePlayerIds.includes('human'),
        )!,
        draft = survivalDraft(active)!;
      draft.selectedAction = { kind: 'withdraw', groups: [] };
      draft.amounts.A.bid = Math.max(1, Math.min(17, active.players[0]!.money));
      const files = [];
      for (const [kind, source] of [
        ['checkpoint', serializeSurvivalCheckpoint(game, null, now)],
        ['replay', serializeSurvivalReplay(log, 'compression-test', now)],
        ['backup', serializeSurvivalBackup(game, null, profile, now)],
        ['resume', serializeSurvivalCheckpoint(active, draft, now)],
      ] as const) {
        const base = `${scenario.seed}-${scenario.role}-${kind}`,
          packed = await packDataFile(source);
        expect(packed.compressed).toBe(true);
        writeFileSync(resolve(dir, base + '.original.json'), source);
        writeFileSync(resolve(dir, base + '.compressed.json'), packed.source);
        const disk = readFileSync(
            resolve(dir, base + '.compressed.json'),
            'utf8',
          ),
          original = readFileSync(
            resolve(dir, base + '.original.json'),
            'utf8',
          ),
          unpacked = await unpackDataFile(disk);
        expect(original).toBe(source);
        expect(unpacked.source).toBe(original);
        writeFileSync(resolve(dir, base + '.restored.json'), unpacked.source);
        const restoredFile = readFileSync(
          resolve(dir, base + '.restored.json'),
          'utf8',
        );
        expect(restoredFile).toBe(original);
        const candidate = await readModeDataFile(
          disk,
          base + '.compressed.json',
        );
        if (kind === 'replay') {
          expect(candidate.kind).toBe('survival-replay');
          if (candidate.kind === 'survival-replay')
            expect(candidate.document.replay).toEqual(log);
        } else if (kind === 'backup') {
          expect(candidate.kind).toBe('survival-backup');
          if (candidate.kind === 'survival-backup') {
            expect(candidate.document.checkpoint.game).toEqual(game);
            expect(candidate.document.profile).toEqual(profile);
          }
        } else {
          expect(candidate.kind).toBe('survival-checkpoint');
          if (candidate.kind === 'survival-checkpoint') {
            expect(candidate.document.game).toEqual(
              kind === 'resume' ? active : game,
            );
            expect(candidate.document.draft).toEqual(
              kind === 'resume' ? draft : null,
            );
          }
        }
        if (kind === 'resume') {
          let restored = parseSurvivalCheckpoint(unpacked.source).game;
          while (restored.phase !== 'competition_complete')
            restored = survivalGameReducer(
              restored,
              longRunAction(restored, scenario.policy),
            );
          expect(restored).toEqual(game);
        }
        files.push({
          kind,
          filename: base + '.compressed.json',
          originalFilename: base + '.original.json',
          restoredFilename: base + '.restored.json',
          originalBytes: packed.originalBytes,
          compressedBytes: packed.fileBytes,
          sha256: createHash('sha256').update(disk).digest('hex'),
          originalSha256: createHash('sha256').update(original).digest('hex'),
          restoredSha256: createHash('sha256')
            .update(restoredFile)
            .digest('hex'),
          verified: true,
        });
      }
      results.push({
        ...scenario,
        floors: game.floorRecords.length,
        rooms: game.roomRecords.length,
        commands: game.commandLog.length,
        humanEliminatedAt: game.humanEliminatedAt,
        survivors: game.activePlayerIds.length,
        files,
      });
    }
    writeFileSync(
      resolve(dir, 'report.json'),
      JSON.stringify(
        {
          kind: 'production-compression-roundtrip-1',
          createdAt: new Date().toISOString(),
          native:
            'CompressionStream/DecompressionStream gzip; inner v4 unchanged',
          results,
        },
        null,
        2,
      ),
    );
    console.log(JSON.stringify(results, null, 2));
  },
  180000,
);
