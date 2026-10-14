import { createGameSession, reduceGameSession } from './game-session';
import { createSurvivalReplay } from './survival-record';
import { playLongRun } from './survival-long-run';
import { sha256Hex } from '../shared/sha256';
import type { CompletionRecord } from './completion-registry';
export function completionRecordFixture(
  index: number,
  mode: 'classic' | 'survival' = 'classic',
): CompletionRecord {
  return {
    key: `${mode}/${sha256Hex(`fixture-${mode}-${index}`)}`,
    replayId: `fixture-${mode}-${index}`,
    mode,
    characterId: 'isaac',
    completedAt: '2026-10-14T03:00:00.000Z',
    finalScore: 10.1234 + index,
    rank: 2,
    ...(mode === 'survival'
      ? {
          aiDifficulty: 'standard' as const,
          status: 'survived' as const,
          eliminationFloorIndex: null,
        }
      : {}),
  };
}
export function classicCompletionFixture(seed = 42, bid = false) {
  let session = reduceGameSession(createGameSession(seed), {
    type: 'start_game',
    characterId: 'isaac',
  });
  for (let i = 0; i < 15; i++) {
    session = reduceGameSession(session, {
      type: 'submit_player_turn',
      turn: {
        playerId: 'human',
        actions:
          bid && i === 0
            ? [{ type: 'bid', group: 'A', amount: 20 }]
            : [{ type: 'withdraw' }],
      },
    });
    session = reduceGameSession(session, { type: 'advance_room' });
  }
  return session;
}
export function survivalCompletionFixture() {
  return createSurvivalReplay(playLongRun(3, 'isaac', 'highest').game);
}
