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
import { createGameSession, reduceGameSession } from './game-session';
import {
  serializeGameCheckpoint,
  serializeGameBackup,
  parseGameSave,
} from './game-save';
import { serializeReplay } from './game-replay';
import { sameReplayResults } from './data-management';
it.skipIf(process.env.COMPRESSED_ROUNDTRIP_STUDY !== '1')(
  'simulates eleven current matches in both modes, saves to disk, rereads and resumes them',
  async () => {
    const dir = resolve('work', 'protocol-v5-roundtrip');
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
        mode: 'survival',
        ...scenario,
        floors: game.floorRecords.length,
        rooms: game.roomRecords.length,
        commands: game.commandLog.length,
        humanEliminatedAt: game.humanEliminatedAt,
        survivors: game.activePlayerIds.length,
        files,
      });
    }
    const classicResults = [];
    for (const [index, role] of (
      ['isaac', 'lost', 'azazel', 'eden', 'jacob_esau'] as const
    ).entries()) {
      const seed = 20261013 + index;
      let session = reduceGameSession(createGameSession(seed), {
        type: 'start_game',
        characterId: role,
      });
      const states = [session];
      while (session.game.phase !== 'game_result') {
        session = reduceGameSession(
          session,
          session.game.phase === 'room_action'
            ? {
                type: 'submit_player_turn',
                turn: { playerId: 'human', actions: [{ type: 'withdraw' }] },
              }
            : { type: 'advance_room' },
        );
        states.push(session);
      }
      const active = states.find(
        (s) => s.game.phase === 'room_action' && s.turns.length === 1,
      )!;
      active.draft!.amounts.A.bid = 17;
      const profile = createPlayerProfile(now);
      profile.progression.statistics.roundtripExample = seed;
      const files = [];
      for (const [kind, source] of [
        ['checkpoint', serializeGameCheckpoint(session, now)],
        ['replay', serializeReplay(session.replay!, 'current-test', now)],
        ['backup', serializeGameBackup(session, profile, now)],
        ['resume', serializeGameCheckpoint(active, now)],
      ] as const) {
        const base = `classic-${seed}-${role}-${kind}`,
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
        expect(unpacked.source).toBe(original);
        writeFileSync(resolve(dir, base + '.restored.json'), unpacked.source);
        const restored = readFileSync(
          resolve(dir, base + '.restored.json'),
          'utf8',
        );
        expect(restored).toBe(original);
        const candidate = await readModeDataFile(
          disk,
          base + '.compressed.json',
        );
        expect(candidate.document.mode).toBe('classic');
        expect(candidate.document.version).toBe(5);
        if (kind === 'replay') {
          expect(candidate.kind).toBe('replay');
          if (candidate.kind === 'replay')
            expect(candidate.document.replay).toEqual(session.replay);
        } else {
          expect(candidate.kind).toBe(
            kind === 'backup' ? 'backup' : 'checkpoint',
          );
          if (candidate.kind === 'checkpoint' || candidate.kind === 'backup') {
            const expected = kind === 'resume' ? active : session;
            expect(candidate.document.session.game).toEqual(expected.game);
            expect(candidate.document.session.draft).toEqual(expected.draft);
            expect(
              sameReplayResults(
                candidate.document.session.replay,
                expected.replay,
              ),
            ).toBe(true);
            if (kind === 'backup')
              expect(candidate.document.profile).toEqual(profile);
          }
        }
        if (kind === 'resume') {
          let resumed = parseGameSave(unpacked.source).session;
          while (resumed.game.phase !== 'game_result')
            resumed = reduceGameSession(
              resumed,
              resumed.game.phase === 'room_action'
                ? {
                    type: 'submit_player_turn',
                    turn: {
                      playerId: 'human',
                      actions: [{ type: 'withdraw' }],
                    },
                  }
                : { type: 'advance_room' },
            );
          expect(resumed.game).toEqual(session.game);
          expect(sameReplayResults(resumed.replay, session.replay)).toBe(true);
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
          restoredSha256: createHash('sha256').update(restored).digest('hex'),
          verified: true,
        });
      }
      classicResults.push({
        mode: 'classic',
        seed,
        role,
        rooms: session.replay!.rooms.length,
        files,
      });
    }
    writeFileSync(
      resolve(dir, 'report.json'),
      JSON.stringify(
        {
          kind: 'production-current-v5-roundtrip-1',
          createdAt: new Date().toISOString(),
          native:
            'CompressionStream/DecompressionStream gzip; current v5 both modes',
          results,
          classicResults,
        },
        null,
        2,
      ),
    );
    console.log(JSON.stringify(results, null, 2));
  },
  180000,
);
