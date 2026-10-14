import { describe, expect, it } from 'vitest';
import {
  createModeSession,
  reduceModeSession,
  getModeSessionIdentity,
} from './mode-session';
import {
  createGameSession,
  reduceGameSession,
  type GameSession,
} from './game-session';
import { serializeGameCheckpoint, parseGameSave } from './game-save';

describe('explicit internal mode session boundary', () => {
  it('wraps classic without changing its legacy state, replay or checkpoint shape', () => {
    const mode = createModeSession({ mode: 'classic', seed: 42 });
    expect(getModeSessionIdentity(mode)).toBe('classic');
    if (mode.mode !== 'classic') throw new Error('Expected classic mode.');
    expect(mode.session).toEqual(createGameSession(42));
    const next = reduceModeSession(mode, {
      mode: 'classic',
      action: { type: 'start_game', characterId: 'lost' },
    });
    if (next.mode !== 'classic') throw new Error('Expected classic mode.');
    expect(next.session).toEqual(
      reduceGameSession(createGameSession(42), {
        type: 'start_game',
        characterId: 'lost',
      }),
    );
    expect(next.session.game).not.toHaveProperty('mode');
    expect(
      parseGameSave(serializeGameCheckpoint(next.session)).session,
    ).toEqual(next.session);
  });

  it('routes survival only through the experimental session and prevents cross-mode commands', () => {
    const classic = createModeSession({ mode: 'classic', seed: 42 });
    const survival = createModeSession({
      mode: 'survival',
      characterId: 'isaac',
      seed: 42,
      cutLines: Array(7).fill(0),
      bossRewards: 'standard',
    });
    expect(getModeSessionIdentity(survival)).toBe('survival');
    expect(
      reduceModeSession(classic, {
        mode: 'survival',
        action: { type: 'advance_floor' },
      }),
    ).toBe(classic);
    expect(
      reduceModeSession(survival, {
        mode: 'classic',
        action: { type: 'start_game', characterId: 'lost' },
      }),
    ).toBe(survival);
    const next = reduceModeSession(survival, {
      mode: 'survival',
      action: {
        type: 'submit_player_turn',
        turn: { playerId: 'human', actions: [{ type: 'withdraw' }] },
      },
    });
    if (next.mode !== 'survival') throw new Error('Expected survival mode.');
    expect(next.game.phase).toBe('room_result');
    expect(next).not.toHaveProperty('session');
  });

  it('returns the identical wrapper for rejected commands', () => {
    const classic = createModeSession({ mode: 'classic', seed: 42 });
    expect(
      reduceModeSession(classic, {
        mode: 'classic',
        action: { type: 'advance_room' },
      }),
    ).toBe(classic);
    const survival = createModeSession({
      mode: 'survival',
      characterId: 'isaac',
      seed: 42,
      cutLines: Array(7).fill(0),
      bossRewards: 'standard',
    });
    expect(
      reduceModeSession(survival, {
        mode: 'survival',
        action: { type: 'advance_room' },
      }),
    ).toBe(survival);
  });

  it('rejects a coerced survival state before it can be exported as a misleading classic v3 checkpoint', () => {
    const survival = createModeSession({
      mode: 'survival',
      characterId: 'isaac',
      seed: 42,
      cutLines: Array(7).fill(0),
      bossRewards: 'standard',
    });
    if (survival.mode !== 'survival') throw new Error('Expected survival.');
    const invalid = {
      game: survival.game,
      draft: null,
      turns: [],
      replay: null,
    } as unknown as GameSession;
    expect(() => serializeGameCheckpoint(invalid)).toThrow(
      '不能将带生存模式身份的状态导出为经典存档',
    );
  });
});
