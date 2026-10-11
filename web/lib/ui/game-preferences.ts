import { defaultRules } from '../game/config';

export type ScoreDisplayDecimals = 2 | 4;

export interface GamePreferences {
  rankingInitiallyOpen: boolean;
  marketInitiallyOpen: boolean;
  scoreDecimals: ScoreDisplayDecimals;
  reduceMotion: boolean;
}

export const defaultGamePreferences: Readonly<GamePreferences> = {
  rankingInitiallyOpen: false,
  marketInitiallyOpen: false,
  scoreDecimals: defaultRules.scoreDisplayDecimals === 4 ? 4 : 2,
  reduceMotion: false,
};

export const gamePreferencesKey = 'bidding-ui-preferences-v1';
type PreferenceStorage = Pick<Storage, 'getItem' | 'setItem'>;

export function getPreferenceStorage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function normalizeGamePreferences(value: unknown): GamePreferences {
  const input =
    value && typeof value === 'object'
      ? (value as Record<string, unknown>)
      : {};
  return {
    rankingInitiallyOpen:
      typeof input.rankingInitiallyOpen === 'boolean'
        ? input.rankingInitiallyOpen
        : defaultGamePreferences.rankingInitiallyOpen,
    marketInitiallyOpen:
      typeof input.marketInitiallyOpen === 'boolean'
        ? input.marketInitiallyOpen
        : defaultGamePreferences.marketInitiallyOpen,
    scoreDecimals:
      input.scoreDecimals === 2 || input.scoreDecimals === 4
        ? input.scoreDecimals
        : defaultGamePreferences.scoreDecimals,
    reduceMotion:
      typeof input.reduceMotion === 'boolean'
        ? input.reduceMotion
        : defaultGamePreferences.reduceMotion,
  };
}

export function loadGamePreferences(
  storage: PreferenceStorage | null,
): GamePreferences {
  try {
    const raw = storage?.getItem(gamePreferencesKey);
    if (!raw) return { ...defaultGamePreferences };
    const envelope: unknown = JSON.parse(raw);
    if (
      !envelope ||
      typeof envelope !== 'object' ||
      !('version' in envelope) ||
      envelope.version !== 1 ||
      !('preferences' in envelope)
    ) {
      return { ...defaultGamePreferences };
    }
    return normalizeGamePreferences(envelope.preferences);
  } catch {
    return { ...defaultGamePreferences };
  }
}

export function saveGamePreferences(
  storage: PreferenceStorage | null,
  preferences: GamePreferences,
): boolean {
  if (!storage) return false;
  try {
    storage.setItem(
      gamePreferencesKey,
      JSON.stringify({
        version: 1,
        preferences: normalizeGamePreferences(preferences),
      }),
    );
    return true;
  } catch {
    return false;
  }
}
