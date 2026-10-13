import { describe, it, expect } from 'vitest';
import { characterOrder } from '../game/characters';
import { survivalDifficulties } from '../game/survival-difficulty';
import {
  survivalGameReducer,
  type SurvivalGameState,
} from '../game/survival-session';
import { startSurvivalClient, survivalDraft } from './survival-client';
import {
  loadSurvivalCheckpoint,
  parseSurvivalCheckpoint,
  serializeSurvivalCheckpoint,
  saveSurvivalProgress,
  survivalSaveKey,
  survivalLastCompletedKey,
  survivalSaveMessage,
  parseSurvivalReplay,
} from './survival-persistence';
import {
  serializeSurvivalBackup,
  parseSurvivalBackup,
} from './survival-backup';
import { createPlayerProfile, playerProfileKey } from './player-profile';
import { restoreSurvivalBackupProgress } from './survival-restore';

function next(game: SurvivalGameState) {
  return survivalGameReducer(
    game,
    game.phase === 'room_action'
      ? game.activePlayerIds.includes('human')
        ? {
            type: 'submit_player_turn',
            turn: { playerId: 'human', actions: [{ type: 'withdraw' }] },
          }
        : { type: 'submit_ai_room' }
      : {
          type: game.phase === 'room_result' ? 'advance_room' : 'advance_floor',
        },
  );
}
function complete() {
  let game = startSurvivalClient('isaac', 42).game;
  while (game.phase !== 'competition_complete') game = next(game);
  return game;
}
const finished = complete();
describe('P0 survival five-stage recovery and failure boundaries', () => {
  for (const difficulty of survivalDifficulties)
    it.each(characterOrder)(
      `preserves drafts, room result, layer result, AI-only room and final across checkpoint and backup: ${difficulty} / %s`,
      (characterId) => {
        let game = startSurvivalClient(characterId, 42, difficulty).game;
        const draft = survivalDraft(game)!;
        draft.amounts.A.bid = 17;
        draft.amounts.B.bid = 23;
        draft.selectedAction = { kind: 'withdraw', groups: [] };
        const phases: {
          game: SurvivalGameState;
          draft: ReturnType<typeof survivalDraft>;
        }[] = [{ game, draft }];
        game = next(game);
        phases.push({ game, draft: null });
        while (game.phase !== 'floor_result') game = next(game);
        phases.push({ game, draft: null });
        let aiCaptured = false;
        while (game.phase !== 'competition_complete') {
          if (
            !aiCaptured &&
            game.phase === 'room_action' &&
            !game.activePlayerIds.includes('human')
          ) {
            phases.push({ game, draft: null });
            aiCaptured = true;
          }
          game = next(game);
        }
        expect(aiCaptured).toBe(true);
        phases.push({ game, draft: null });
        for (const phase of phases) {
          const checkpoint = parseSurvivalCheckpoint(
            serializeSurvivalCheckpoint(phase.game, phase.draft),
          );
          expect(checkpoint.game).toEqual(phase.game);
          expect(checkpoint.draft).toEqual(phase.draft);
          const backup = parseSurvivalBackup(
            serializeSurvivalBackup(
              phase.game,
              phase.draft,
              createPlayerProfile(),
            ),
          );
          expect(backup.checkpoint.game).toEqual(phase.game);
          expect(backup.checkpoint.draft).toEqual(phase.draft);
          if (phase.game.phase !== 'competition_complete')
            expect(next(checkpoint.game)).toEqual(next(phase.game));
          expect(checkpoint.game.aiDifficulty).toBe(difficulty);
        }
      },
    );
  it('saves final checkpoint even when the larger replay hits quota, retaining the previous archive', () => {
    const values = new Map([
      [
        survivalSaveKey,
        serializeSurvivalCheckpoint(startSurvivalClient('lost', 99).game),
      ],
      [survivalLastCompletedKey, 'old-archive'],
    ]);
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => {
        if (key === survivalLastCompletedKey) throw new Error('quota');
        values.set(key, value);
      },
      removeItem: (key: string) => {
        values.delete(key);
      },
    };
    const result = saveSurvivalProgress(storage, finished);
    expect(result).toEqual({ checkpointSaved: true, archiveSaved: false });
    expect(survivalSaveMessage(result)).toContain('最近完成回放未保存');
    expect(loadSurvivalCheckpoint(storage).document!.game).toEqual(finished);
    expect(values.get(survivalLastCompletedKey)).toBe('old-archive');
    storage.setItem = (key, value) => {
      values.set(key, value);
    };
    expect(saveSurvivalProgress(storage, finished)).toEqual({
      checkpointSaved: true,
      archiveSaved: true,
    });
    expect(
      parseSurvivalReplay(values.get(survivalLastCompletedKey)!).replay.final!
        .ranking,
    ).toEqual(finished.finalRanking);
  });
  it('keeps previous checkpoint and archive when checkpoint storage fails', () => {
    const values = new Map([
      [survivalSaveKey, 'old-checkpoint'],
      [survivalLastCompletedKey, 'old-archive'],
    ]);
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: () => {
        throw new Error('blocked');
      },
      removeItem: () => {},
    };
    const result = saveSurvivalProgress(storage, finished);
    expect(result.checkpointSaved).toBe(false);
    expect(survivalSaveMessage(result)).toContain('自动保存失败');
    expect(values.get(survivalSaveKey)).toBe('old-checkpoint');
    expect(values.get(survivalLastCompletedKey)).toBe('old-archive');
  });
  it.each([false, true])(
    'rolls back paired backup restore if profile write fails, whether an old checkpoint exists: %s',
    (hadCheckpoint) => {
      const values = new Map([[playerProfileKey, 'old-profile']]);
      if (hadCheckpoint) values.set(survivalSaveKey, 'old-checkpoint');
      const storage = {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => {
          if (key === playerProfileKey) throw new Error('profile quota');
          values.set(key, value);
        },
        removeItem: (key: string) => {
          values.delete(key);
        },
      };
      expect(() =>
        restoreSurvivalBackupProgress(
          storage,
          finished,
          null,
          createPlayerProfile(),
        ),
      ).toThrow('已恢复原存储');
      expect(values.get(playerProfileKey)).toBe('old-profile');
      expect(values.get(survivalSaveKey)).toBe(
        hadCheckpoint ? 'old-checkpoint' : undefined,
      );
    },
  );
  it('restores paired checkpoint and explicitly selected profile together', () => {
    const values = new Map<string, string>(),
      storage = {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => {
          values.set(key, value);
        },
        removeItem: (key: string) => {
          values.delete(key);
        },
      },
      profile = createPlayerProfile();
    profile.progression.statistics.example = 123;
    restoreSurvivalBackupProgress(storage, finished, null, profile);
    expect(loadSurvivalCheckpoint(storage).document!.game).toEqual(finished);
    expect(JSON.parse(values.get(playerProfileKey)!)).toEqual(profile);
  });
});
