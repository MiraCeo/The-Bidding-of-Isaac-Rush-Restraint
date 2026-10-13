import { describe, expect, it } from 'vitest';
import { survivalDifficulties } from '../game/survival-difficulty';
import {
  startSurvivalGame,
  survivalGameReducer,
} from '../game/survival-session';
import { survivalOfficialCutLines } from '../game/survival-rules';
import { startSurvivalClient, reduceSurvivalClient } from './survival-client';
import {
  parseSurvivalCheckpoint,
  serializeSurvivalCheckpoint,
  parseSurvivalReplay,
  serializeSurvivalReplay,
} from './survival-persistence';
import { createSurvivalReplay } from './survival-record';
import {
  parseSurvivalBackup,
  serializeSurvivalBackup,
} from './survival-backup';
import { createPlayerProfile } from './player-profile';
import { withChecksum } from './survival-json';

describe('difficulty-specific facts and compatible continuation', () => {
  it('defaults new client matches to standard with distinct difficulty identities', () => {
    expect(startSurvivalClient('isaac', 42).game.aiDifficulty).toBe('standard');
    const identities = survivalDifficulties.map(
      (d) => createSurvivalReplay(startSurvivalClient('isaac', 42, d).game).id,
    );
    expect(new Set(identities).size).toBe(4);
  });
  it.each(survivalDifficulties)(
    'round trips checkpoint, factual replay, backup and the next turn: %s',
    (difficulty) => {
      const session = reduceSurvivalClient(
        startSurvivalClient('isaac', 42, difficulty),
        {
          type: 'submit_player_turn',
          turn: { playerId: 'human', actions: [{ type: 'withdraw' }] },
        },
      );
      const checkpoint = parseSurvivalCheckpoint(
        serializeSurvivalCheckpoint(session.game, session.draft),
      );
      expect(checkpoint.game).toEqual(session.game);
      const replay = createSurvivalReplay(session.game);
      expect(replay.compatibility).toMatch(/^survival-client-4-/);
      expect(
        parseSurvivalReplay(serializeSurvivalReplay(replay)).replay,
      ).toEqual(replay);
      expect(
        parseSurvivalBackup(
          serializeSurvivalBackup(
            session.game,
            session.draft,
            createPlayerProfile(),
          ),
        ).checkpoint.game,
      ).toEqual(session.game);
      expect(
        survivalGameReducer(checkpoint.game, { type: 'advance_room' }),
      ).toEqual(survivalGameReducer(session.game, { type: 'advance_room' }));
    },
  );
  it('continues old client2 checkpoints as unchanged highest with original identity', () => {
    const game = startSurvivalGame({
      seed: 42,
      characterId: 'lost',
      cutLines: survivalOfficialCutLines,
      buildId: '0.3.1-frozen',
    });
    const original = createSurvivalReplay(game);
    expect(original.compatibility).toMatch(/^survival-client-2-/);
    const restored = parseSurvivalCheckpoint(
      serializeSurvivalCheckpoint(game),
    ).game;
    expect(restored.aiDifficulty).toBeUndefined();
    expect(restored).toEqual(game);
    expect(createSurvivalReplay(restored)).toEqual(original);
    const action = {
      type: 'submit_player_turn' as const,
      turn: { playerId: 'human', actions: [{ type: 'withdraw' as const }] },
    };
    expect(survivalGameReducer(restored, action)).toEqual(
      survivalGameReducer(game, action),
    );
  });
  it.each(survivalDifficulties)(
    'continues historical client3 tier %s without opting into role-aware AI',
    (aiDifficulty) => {
      const game = startSurvivalGame({
        seed: 42,
        characterId: 'azazel',
        cutLines: survivalOfficialCutLines,
        aiDifficulty,
      });
      const log = createSurvivalReplay(game);
      expect(log.compatibility).toMatch(/^survival-client-3-/);
      const restored = parseSurvivalCheckpoint(
        serializeSurvivalCheckpoint(game),
      ).game;
      expect(restored.aiPolicy).toBeUndefined();
      expect(restored).toEqual(game);
      expect(createSurvivalReplay(restored).id).toBe(log.id);
      const action = {
        type: 'submit_player_turn' as const,
        turn: { playerId: 'human', actions: [{ type: 'withdraw' as const }] },
      };
      expect(survivalGameReducer(restored, action)).toEqual(
        survivalGameReducer(game, action),
      );
    },
  );
  it('rejects unknown difficulty and changed rule facts even with a recalculated checksum', () => {
    const source = JSON.parse(
      serializeSurvivalCheckpoint(startSurvivalClient('isaac', 42).game),
    );
    for (const difficulty of ['impossible', 'highest']) {
      const changed = structuredClone(source);
      delete changed.checksum;
      changed.ruleFacts.parameters.aiDifficulty = difficulty;
      expect(() =>
        parseSurvivalCheckpoint(JSON.stringify(withChecksum(changed))),
      ).toThrow();
    }
    expect(() =>
      startSurvivalGame({
        seed: 42,
        characterId: 'isaac',
        cutLines: survivalOfficialCutLines,
        aiDifficulty: 'unknown' as never,
      }),
    ).toThrow();
  });
  it('rejects an unknown policy or a policy marker without difficulty before replaying commands', () => {
    const source = JSON.parse(
      serializeSurvivalCheckpoint(startSurvivalClient('isaac', 42).game),
    );
    for (const change of [
      { aiPolicy: 'unknown' },
      { aiPolicy: 'role-aware-1', aiDifficulty: undefined },
    ]) {
      const changed = structuredClone(source);
      delete changed.checksum;
      Object.assign(changed.ruleFacts.parameters, change);
      if (
        change.aiDifficulty === undefined &&
        Object.hasOwn(change, 'aiDifficulty')
      )
        delete changed.ruleFacts.parameters.aiDifficulty;
      expect(() =>
        parseSurvivalCheckpoint(JSON.stringify(withChecksum(changed))),
      ).toThrow();
    }
  });
});
