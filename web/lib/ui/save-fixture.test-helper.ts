import type { GameSession } from './game-session';
import { serializeGameBackup } from './game-save';
import { createPlayerProfile } from './player-profile';

/** Test-only complete-session fixture using the current backup encoder. */
export function serializeSessionFixture(
  session: GameSession,
  now = new Date(),
): string {
  return serializeGameBackup(session, createPlayerProfile(now), now);
}
