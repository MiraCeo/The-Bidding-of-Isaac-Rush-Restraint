import { describe, expect, it } from 'vitest';

import {
  defaultGamePreferences,
  gamePreferencesKey,
  loadGamePreferences,
  normalizeGamePreferences,
  saveGamePreferences,
} from './game-preferences';

describe('interface preferences', () => {
  it('defaults to the current interface and rejects rule or invalid display inputs', () => {
    expect(
      normalizeGamePreferences({
        scoreDecimals: 99,
        rankingInitiallyOpen: 'true',
        playerCount: 2,
      }),
    ).toEqual(defaultGamePreferences);
    expect(normalizeGamePreferences(null)).toEqual(defaultGamePreferences);
  });

  it('keeps only explicitly supported display settings', () => {
    expect(
      normalizeGamePreferences({
        rankingInitiallyOpen: true,
        marketInitiallyOpen: true,
        scoreDecimals: 4,
        reduceMotion: true,
        seed: 99,
        playerCount: 1,
      }),
    ).toEqual({
      ...defaultGamePreferences,
      rankingInitiallyOpen: true,
      marketInitiallyOpen: true,
      scoreDecimals: 4,
      reduceMotion: true,
    });
  });

  it('round-trips a versioned preference envelope without storing game data', () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => {
        values.set(key, value);
      },
    };
    const preferences = {
      ...defaultGamePreferences,
      scoreDecimals: 4 as const,
    };
    expect(saveGamePreferences(storage, preferences)).toBe(true);
    expect(values.size).toBe(1);
    expect(JSON.parse(values.get(gamePreferencesKey)!)).toEqual({
      version: 1,
      preferences,
    });
    expect(loadGamePreferences(storage)).toEqual(preferences);
  });

  it.each([
    'broken',
    'null',
    '{}',
    '{"version":2,"preferences":{"scoreDecimals":4}}',
  ])('falls back for malformed or incompatible stored values', (raw) => {
    expect(
      loadGamePreferences({ getItem: () => raw, setItem: () => {} }),
    ).toEqual(defaultGamePreferences);
  });

  it('tolerates unavailable or blocked browser storage', () => {
    const blocked = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };
    expect(loadGamePreferences(blocked)).toEqual(defaultGamePreferences);
    expect(saveGamePreferences(blocked, { ...defaultGamePreferences })).toBe(
      false,
    );
    expect(loadGamePreferences(null)).toEqual(defaultGamePreferences);
    expect(saveGamePreferences(null, { ...defaultGamePreferences })).toBe(
      false,
    );
  });
});

it('validates and persists each settlement disclosure independently, with old preferences kept closed', () => {
  expect(
    normalizeGamePreferences({ scoreDecimals: 4 })
      .settlementMarketInitiallyOpen,
  ).toBe(false);
  const preferences = normalizeGamePreferences({
    settlementRewardsInitiallyOpen: true,
    settlementScoreInitiallyOpen: 'true',
    settlementMarketInitiallyOpen: true,
  });
  expect(preferences.settlementRewardsInitiallyOpen).toBe(true);
  expect(preferences.settlementScoreInitiallyOpen).toBe(false);
  expect(preferences.settlementMarketInitiallyOpen).toBe(true);
  let stored = '';
  const storage = {
    getItem: () => stored,
    setItem: (_: string, value: string) => {
      stored = value;
    },
  };
  expect(saveGamePreferences(storage, preferences)).toBe(true);
  expect(loadGamePreferences(storage)).toEqual(preferences);
});
