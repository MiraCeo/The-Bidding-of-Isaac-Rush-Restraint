import { describe, expect, it, vi } from 'vitest';
import * as client from '../game/client-session';
import { createGameSession, reduceGameSession } from './game-session';
import {
  gameSaveKey,
  loadAutoSave,
  parseGameSave,
  serializeGameBackup,
  serializeGameCheckpoint,
  persistGameSession,
} from './game-save';
import { parseReplay, serializeReplay } from './game-replay';
import { createPlayerProfile } from './player-profile';
import {
  serializeSurvivalCheckpoint,
  serializeSurvivalReplay,
  parseSurvivalCheckpoint,
  parseSurvivalReplay,
  survivalSaveKey,
  survivalLastCompletedKey,
  loadSurvivalCheckpoint,
  saveSurvivalProgress,
} from './survival-persistence';
import { serializeSurvivalBackup } from './survival-backup';
import { startSurvivalClient } from './survival-client';
import { createSurvivalReplay } from './survival-record';
import { parseModeDataFile, readModeDataFile } from './mode-data';
import { packDataFile } from './compressed-file';
import { withChecksum, checkChecksum } from './file-json';
import * as survivalKernel from '../game/survival-session';
import { playerProfileKey } from './player-profile';
import { gamePreferencesKey } from './game-preferences';
import { activeReplayKey, draftSaveKey, lastCompletedKey } from './game-save';
import oldCheckpoint from './fixtures/checkpoint-v2-lost-20261012.json';
import oldReplay from './fixtures/replay-v2-lost-20261012.json';
function fixture() {
  let s = reduceGameSession(createGameSession(42), {
    type: 'start_game',
    characterId: 'lost',
  });
  s = reduceGameSession(s, {
    type: 'submit_player_turn',
    turn: { playerId: 'human', actions: [{ type: 'withdraw' }] },
  });
  return s;
}
describe('current v5 match protocol without losing current data', () => {
  it('can recompute a document checksum without nesting its old checksum into the hash', () => {
    const doc = withChecksum({ text: 'current' }),
      resigned = withChecksum(doc);
    expect(resigned).toEqual(doc);
    expect(() => checkChecksum(resigned)).not.toThrow();
  });
  const classic = fixture(),
    survival = startSurvivalClient('isaac', 42, 'hard'),
    profile = createPlayerProfile();
  const documents = [
    serializeGameCheckpoint(classic),
    serializeGameBackup(classic, profile),
    serializeReplay(classic.replay!, 'test'),
    serializeSurvivalCheckpoint(survival.game, survival.draft),
    serializeSurvivalBackup(survival.game, survival.draft, profile),
    serializeSurvivalReplay(createSurvivalReplay(survival.game)),
  ];
  it('uses one explicit version, mode, kind and integrity contract for all six document types', () => {
    for (const source of documents) {
      const doc = JSON.parse(source);
      expect(doc.version).toBe(5);
      expect(['classic', 'survival']).toContain(doc.mode);
      expect(['checkpoint', 'backup', 'replay']).toContain(doc.kind);
      expect(doc.checksum).toMatch(/^[0-9a-f]{8}$/);
      const parsed = parseModeDataFile(source, 'arbitrary.txt');
      expect(parsed.document.version).toBe(5);
      expect(parsed.document.mode).toBe(doc.mode);
    }
  });
  it.each([1, 2, 3, 4, 99])(
    'rejects old or unknown version %s before running either engine, including compressed files',
    async (version) => {
      const start = vi.spyOn(client, 'startClientGame'),
        survivalStart = vi.spyOn(survivalKernel, 'startSurvivalGame');
      try {
        for (const source of documents) {
          const doc = JSON.parse(source);
          doc.version = version;
          const old = JSON.stringify(withChecksum(doc));
          expect(() => parseModeDataFile(old, 'old.json')).toThrow('v5');
          await expect(
            readModeDataFile(
              (await packDataFile(old)).source,
              'old-small.json',
            ),
          ).rejects.toThrow('v5');
        }
        expect(start).not.toHaveBeenCalled();
        expect(survivalStart).not.toHaveBeenCalled();
      } finally {
        start.mockRestore();
        survivalStart.mockRestore();
      }
    },
  );
  it('rejects genuine old fixtures, rather than requiring a synthetic new header on them', () => {
    expect(() => parseGameSave(JSON.stringify(oldCheckpoint))).toThrow('v5');
    expect(() => parseReplay(JSON.stringify(oldReplay))).toThrow('v5');
  });
  it('rejects missing, conflicting and extra header fields even with a regenerated checksum', () => {
    for (const source of documents)
      for (const change of [
        (doc: Record<string, unknown>) => {
          delete doc.mode;
        },
        (doc: Record<string, unknown>) => {
          delete doc.kind;
        },
        (doc: Record<string, unknown>) => {
          doc.mode = 'unknown';
        },
        (doc: Record<string, unknown>) => {
          doc.mode = doc.mode === 'classic' ? 'survival' : 'classic';
        },
        (doc: Record<string, unknown>) => {
          doc.kind = doc.kind === 'replay' ? 'checkpoint' : 'replay';
        },
        (doc: Record<string, unknown>) => {
          doc.extra = 'unsupported';
        },
      ]) {
        const doc = JSON.parse(source) as Record<string, unknown>;
        change(doc);
        expect(() =>
          parseModeDataFile(JSON.stringify(withChecksum(doc)), 'bad.json'),
        ).toThrow();
      }
  });
  it('does not use a checksum to bypass semantic validation or mix up the two modes and purposes', () => {
    expect(() => parseGameSave(documents[2]!)).toThrow();
    expect(() => parseReplay(documents[0]!)).toThrow();
    expect(() => parseSurvivalCheckpoint(documents[0]!)).toThrow();
    expect(() => parseSurvivalReplay(documents[2]!)).toThrow();
    for (const source of [documents[0]!, documents[3]!]) {
      const doc = JSON.parse(source);
      if (doc.mode === 'classic') doc.checkpoint.game.players[0].money++;
      else doc.snapshot.players[0].money++;
      expect(() =>
        parseModeDataFile(JSON.stringify(withChecksum(doc)), 'changed.json'),
      ).toThrow();
    }
  });
  it('isolates v5 storage without reading, migrating, deleting or overwriting old caches, profile or preferences', () => {
    const data = new Map([
        ['bidding-game-save-v1', JSON.stringify(oldCheckpoint)],
        ['bidding-active-replay-v2', JSON.stringify(oldReplay)],
        ['bidding-last-completed-v2', JSON.stringify(oldReplay)],
        ['bidding-game-draft-v2', 'old-draft'],
        ['bidding-survival-checkpoint-v4', 'old-survival'],
        ['bidding-survival-last-completed-v4', 'old-survival-replay'],
        [playerProfileKey, JSON.stringify(profile)],
        [gamePreferencesKey, 'existing-preferences'],
      ]),
      before = new Map(data),
      reads: string[] = [];
    const storage = {
      getItem: (key: string) => {
        reads.push(key);
        return data.get(key) ?? null;
      },
      setItem: (key: string, value: string) => {
        data.set(key, value);
      },
      removeItem: (key: string) => {
        data.delete(key);
      },
    };
    expect(loadAutoSave(storage).session).toBeNull();
    expect(loadSurvivalCheckpoint(storage).document).toBeNull();
    expect(persistGameSession(storage, classic)).toBe(true);
    expect(
      saveSurvivalProgress(storage, survival.game, survival.draft)
        .checkpointSaved,
    ).toBe(true);
    for (const [key, value] of before) expect(data.get(key)).toBe(value);
    for (const key of [
      gameSaveKey,
      activeReplayKey,
      draftSaveKey,
      lastCompletedKey,
      survivalSaveKey,
      survivalLastCompletedKey,
    ])
      expect(key).toMatch(/-v5$/);
    for (const key of before.keys())
      if (key !== playerProfileKey && key !== gamePreferencesKey)
        expect(reads).not.toContain(key);
    expect(loadAutoSave(storage).session!.game).toEqual(classic.game);
    expect(loadSurvivalCheckpoint(storage).document!.game).toEqual(
      survival.game,
    );
  });
  it.each(['save', 'replay'] as const)(
    'rejects v1 %s before running current algorithms',
    (kind) => {
      const s = fixture();
      const source =
        kind === 'save'
          ? JSON.stringify({
              format: 'the-bidding-of-isaac-save',
              version: 1,
              session: s,
            })
          : JSON.stringify({
              format: 'the-bidding-of-isaac-replay',
              version: 1,
              replay: s.replay,
            });
      const start = vi.spyOn(client, 'startClientGame');
      expect(() =>
        kind === 'save' ? parseGameSave(source) : parseReplay(source),
      ).toThrow('v5');
      expect(start).not.toHaveBeenCalled();
      start.mockRestore();
    },
  );
  it('leaves an unsupported automatic v1 document untouched', () => {
    const source = JSON.stringify({
      format: 'the-bidding-of-isaac-save',
      version: 1,
      session: fixture(),
    });
    const data = new Map([[gameSaveKey, source]]);
    const storage = {
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => data.set(k, v),
      removeItem: (k: string) => data.delete(k),
    };
    expect(loadAutoSave(storage).session).toBeNull();
    expect(loadAutoSave(storage).message).toContain('v5');
    expect(data.get(gameSaveKey)).toBe(source);
  });
  it('reads current saves only under the current browser key', () => {
    const s = fixture();
    const source = serializeGameCheckpoint(s);
    const storage = {
      getItem: (k: string) => (k === gameSaveKey ? source : null),
    };
    expect(loadAutoSave(storage).session!.game).toEqual(s.game);
    expect(loadAutoSave(storage).session!.replay!.rooms[0]!.source).toBe(
      'checkpoint-reconstruction',
    );
  });
  it('retains recorded historical provenance inside a current replay and backup', () => {
    const s = fixture();
    s.replay!.rooms[0]!.source = 'save-reconstruction';
    s.replay!.startedBuild = 'historical-source';
    s.replay!.rooms[0]!.build = 'historical-room';
    expect(parseReplay(serializeReplay(s.replay!, 'current')).replay).toEqual(
      s.replay,
    );
    const p = createPlayerProfile();
    p.progression.modules.future = { treeVersion: 5 };
    const backup = parseGameSave(serializeGameBackup(s, p));
    expect(backup.session.replay).toEqual(s.replay);
    expect(backup.profile).toEqual(p);
    expect(backup.profile!.version).toBe(1); // Profile version is intentionally independent.
  });
});
