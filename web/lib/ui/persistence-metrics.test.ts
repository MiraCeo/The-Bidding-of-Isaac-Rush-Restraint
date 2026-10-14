import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import {
  measurePersistence,
  persistenceMetrics,
  resetPersistenceMetrics,
  maximumPersistenceSamples,
} from './persistence-metrics';
import { startSurvivalClient } from './survival-client';
import {
  serializeSurvivalCheckpoint,
  saveSurvivalProgress,
  loadSurvivalCheckpoint,
  survivalSaveKey,
  survivalLastCompletedKey,
} from './survival-persistence';
import { createGameSession, reduceGameSession } from './game-session';
import {
  persistGameSession,
  loadAutoSave,
  parseGameSave,
  gameSaveKey,
} from './game-save';
import { playLongRun } from './survival-long-run';
const context = {
  mode: 'classic' as const,
  operation: 'save' as const,
  phase: 'room_action',
};
beforeEach(resetPersistenceMetrics);
afterEach(() => {
  vi.restoreAllMocks();
  resetPersistenceMetrics();
});
describe('bounded passive persistence timings', () => {
  it('returns the exact original result and measures once without mutating the action', () => {
    const now = vi
        .spyOn(performance, 'now')
        .mockReturnValueOnce(1)
        .mockReturnValueOnce(4),
      result = { unchanged: true };
    const action = vi.fn(() => result);
    expect(measurePersistence(context, action, () => true)).toBe(result);
    expect(action).toHaveBeenCalledOnce();
    expect(persistenceMetrics()).toEqual([
      { ...context, success: true, durationMs: 3 },
    ]);
    now.mockRestore();
  });
  it('preserves the original exception and handles missing or broken timers and diagnostic predicates', () => {
    const error = Error('original failure');
    vi.spyOn(performance, 'now').mockImplementation(() => {
      throw Error('timer');
    });
    expect(() =>
      measurePersistence(
        context,
        () => {
          throw error;
        },
        () => true,
      ),
    ).toThrow(error);
    expect(
      measurePersistence(
        context,
        () => 17,
        () => {
          throw Error('predicate');
        },
      ),
    ).toBe(17);
    expect(persistenceMetrics()).toEqual([
      { ...context, success: false, durationMs: null },
      { ...context, success: false, durationMs: null },
    ]);
  });
  it('bounds records, returns defensive copies and excludes game or profile contents', () => {
    for (let i = 0; i < maximumPersistenceSamples + 10; i++)
      measurePersistence(
        { ...context, phase: 'phase-' + i },
        () => true,
        (result) => result,
      );
    const records = persistenceMetrics();
    expect(records).toHaveLength(60);
    expect(records[0]!.phase).toBe('phase-10');
    records[0]!.phase = 'edited';
    expect(persistenceMetrics()[0]!.phase).toBe('phase-10');
    expect(Object.keys(records[0]!).sort()).toEqual([
      'durationMs',
      'mode',
      'operation',
      'phase',
      'success',
    ]);
  });
  it('keeps classic storage bytes, draft caching and exact recovery behavior unchanged', () => {
    const data = new Map<string, string>(),
      writes: string[] = [],
      storage = {
        getItem: (k: string) => data.get(k) ?? null,
        setItem: (k: string, v: string) => {
          writes.push(k);
          data.set(k, v);
        },
        removeItem: (k: string) => {
          data.delete(k);
        },
      };
    const session = reduceGameSession(createGameSession(42), {
      type: 'start_game',
      characterId: 'isaac',
    });
    expect(persistGameSession(storage, session)).toBe(true);
    const checkpoint = data.get(gameSaveKey)!;
    expect(parseGameSave(checkpoint).session.game).toEqual(session.game);
    expect(loadAutoSave(storage).session!.game).toEqual(session.game);
    writes.length = 0;
    const draft = structuredClone(session.draft!);
    draft.amounts.A.bid = 17;
    expect(persistGameSession(storage, { ...session, draft })).toBe(true);
    expect(writes).toHaveLength(1);
    expect(data.get(gameSaveKey)).toBe(checkpoint);
    expect(
      persistenceMetrics().map((sample) => [
        sample.mode,
        sample.operation,
        sample.success,
      ]),
    ).toEqual([
      ['classic', 'save', true],
      ['classic', 'load', true],
      ['classic', 'save', true],
    ]);
  });
  it('records survival checkpoint success and partial archive failure without losing a saved checkpoint', () => {
    const game = playLongRun(3).game,
      data = new Map<string, string>(),
      storage = {
        getItem: (k: string) => data.get(k) ?? null,
        setItem: (k: string, v: string) => {
          if (k === survivalLastCompletedKey) throw Error('quota');
          data.set(k, v);
        },
        removeItem: (k: string) => {
          data.delete(k);
        },
      };
    expect(saveSurvivalProgress(storage, game)).toEqual({
      checkpointSaved: true,
      archiveSaved: false,
    });
    expect(data.get(survivalSaveKey)).toBeDefined();
    expect(loadSurvivalCheckpoint(storage).document!.game).toEqual(game);
    expect(
      persistenceMetrics().map((sample) => [
        sample.mode,
        sample.operation,
        sample.success,
      ]),
    ).toEqual([
      ['survival', 'save', false],
      ['survival', 'load', true],
    ]);
  });
  it('leaves unreadable survival source untouched and marks the load as incomplete', () => {
    const session = startSurvivalClient('isaac', 42),
      source = serializeSurvivalCheckpoint(session.game),
      bad = source.slice(0, -5),
      data = new Map([[survivalSaveKey, bad]]);
    expect(
      loadSurvivalCheckpoint({
        getItem: (key: string) => data.get(key) ?? null,
      }).document,
    ).toBeNull();
    expect(data.get(survivalSaveKey)).toBe(bad);
    expect(persistenceMetrics()[0]!.success).toBe(false);
  });
});
