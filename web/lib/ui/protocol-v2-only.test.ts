import { describe, expect, it, vi } from 'vitest';
import * as client from '../game/client-session';
import { createGameSession, reduceGameSession } from './game-session';
import {
  gameSaveKey,
  loadAutoSave,
  parseGameSave,
  serializeGameBackup,
  serializeGameCheckpoint,
} from './game-save';
import { parseReplay, serializeReplay } from './game-replay';
import { createPlayerProfile } from './player-profile';
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
describe('v2-only match protocols without losing current data', () => {
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
      ).toThrow('v2');
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
    expect(loadAutoSave(storage).message).toContain('v2');
    expect(data.get(gameSaveKey)).toBe(source);
  });
  it('keeps already-written v2 saves under the existing browser key readable', () => {
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
  it('retains recorded historical provenance inside a v2 replay and backup', () => {
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
