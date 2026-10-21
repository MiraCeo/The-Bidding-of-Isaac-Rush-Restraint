import { describe, expect, it } from 'vitest';
import {
  classicAiPolicy,
  classicDifficulties,
} from '../../game/classic-difficulty';
import {
  createCharacterSelectionState,
  clientGameReducer,
} from '../../game/client-session';
import {
  createStudyController,
  playAchievementStudy,
} from './difficulty-study.test-helper';
import { defaultRules } from '../../game/config';
import {
  classicTierSeed,
  classicTierTerminalHash,
  classicTierTrace,
  runClassicTierMatch,
} from './classic-tier-study.test-helper';

describe('isolated classic tier diagnostics', () => {
  it('uses 60 distinct held-out seed blocks and rejects out-of-plan inputs', () => {
    const seeds = Array.from({ length: 60 }, (_, i) => classicTierSeed(i));
    expect(new Set(seeds).size).toBe(60);
    for (const i of [-1, 60, 0.5, NaN])
      expect(() => classicTierSeed(i)).toThrow();
  });
  it.each(['easy', 'highest'] as const)(
    'is trajectory-equivalent to the growth runner: %s',
    (difficulty) => {
      const trace = classicTierTrace();
      let terminalHash = '';
      playAchievementStudy(
        classicTierSeed(0),
        'isaac',
        'public-ai',
        'classic',
        {
          room: trace.update,
          terminal: (game) => {
            if ('activePlayerIds' in game) throw Error('Unexpected survival');
            terminalHash = classicTierTerminalHash(game);
          },
        },
        { policy: classicAiPolicy, difficulty },
      );
      const row = runClassicTierMatch(0, 'isaac', 'public-ai', difficulty);
      expect(row.traceHash).toBe(trace.digest());
      expect(row.terminalHash).toBe(terminalHash);
      expect(row.floors.reduce((n, f) => n + f.turns, 0)).toBe(285);
    },
  );
  it('keeps the entire initial world paired and highest identical to the legacy path', () => {
    const rows = classicDifficulties.map((d) =>
      runClassicTierMatch(1, 'lost', 'pace', d),
    );
    expect(new Set(rows.map((r) => r.initialWorld)).size).toBe(1);
    const ctrl = createStudyController(classicTierSeed(1), 'pace'),
      trace = classicTierTrace();
    let game = clientGameReducer(
      createCharacterSelectionState(classicTierSeed(1)),
      { type: 'start_game', characterId: 'lost' },
    );
    for (let n = 0; game.phase !== 'game_result'; n++) {
      if (n > 32 || game.phase === 'character_selection')
        throw Error('Invalid legacy study state');
      if (game.phase === 'room_action') {
        game = clientGameReducer(game, {
          type: 'submit_player_turn',
          turn: ctrl.decide(game, defaultRules),
        });
        if (game.phase === 'character_selection' || !game.roomSettlement)
          throw Error('No settlement');
        trace.update(game.roomSettlement);
        ctrl.update(game.roomSettlement);
      } else game = clientGameReducer(game, { type: 'advance_room' });
    }
    expect(rows[3]!.traceHash).toBe(trace.digest());
    expect(rows[3]!.terminalHash).toBe(classicTierTerminalHash(game));
  });
});
