import { createContext, useContext } from 'react';
import type { GameSession } from '@/lib/ui/game-session';
import type { GamePreferences } from '@/lib/ui/game-preferences';
import type { PreferenceSaveStatus } from './game-settings';
import type { ReplayDocument } from '@/lib/ui/game-replay';
import type { PlayerProfile } from '@/lib/ui/player-profile';

export interface SessionTools {
  session: GameSession;
  autoSaveStatus: 'saved' | 'session' | 'idle';
  restoreMessage: string;
  onRestore: (session: GameSession, profile?: PlayerProfile) => void;
  profile: PlayerProfile;
  profileMessage: string;
  onNewGame: () => void;
  importedReplay: ReplayDocument | null;
  onReplayImport: (replay: ReplayDocument) => void;
  replaySource: 'current' | 'file';
  onReplaySourceChange: (source: 'current' | 'file') => void;
  preferences: GamePreferences;
  preferenceSaveStatus: PreferenceSaveStatus;
  onPreferencesChange: (preferences: GamePreferences) => void;
}
export const SessionContext = createContext<SessionTools | null>(null);
export function useSessionTools() {
  return useContext(SessionContext);
}
