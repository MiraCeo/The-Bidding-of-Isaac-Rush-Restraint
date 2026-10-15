import { expect, it } from 'vitest';
import { createPlayerProfile } from '../player-profile';
import {
  readCharacterAccess,
  requireCharacterAccess,
  characterRequirementText,
} from './character-access';
import {
  appendAchievementEvent,
  manuallyUnlockAchievementCharacters,
  projectAchievementRegistry,
  activateAchievementRegistry,
} from './registry';
import { decodeAchievementEvent } from './event-codec';
import { sha256Hex } from '../../shared/sha256';
import { persistAchievementProfile } from './persistence';
const now = new Date('2026-10-15T00:00:00.000Z');
const store = (p: unknown) => ({ getItem: () => JSON.stringify(p) });
function event(flags: number, bid = 0, hidden = 0, score: number | null = 0) {
  return decodeAchievementEvent({
    stage: 'room',
    position: 0,
    values: [bid, flags, 0, hidden, score],
  });
}
function earned(flags: number, bid = 0, hidden = 0, score: number | null = 0) {
  return appendAchievementEvent(
    createPlayerProfile(now),
    {
      source: 'live',
      mode: 'classic',
      root: sha256Hex('root'),
      parent: null,
      authorityHash: sha256Hex('authority'),
      event: event(flags, bid, hidden, score),
    },
    now,
  );
}
it('new and legacy profiles allow only Isaac, ignoring old reserved unlocks without rewriting them', () => {
  const p = createPlayerProfile(now);
  p.progression.characterUnlocks.lost = {
    unlockedAt: now.toISOString(),
    conditionId: 'legacy',
  };
  const before = JSON.stringify(p);
  expect(readCharacterAccess(store(p)).available).toEqual(['isaac']);
  expect(JSON.stringify(p)).toBe(before);
  expect(readCharacterAccess({ getItem: () => null }).available).toEqual([
    'isaac',
  ]);
});
it.each([
  ['eden', 1 << 0, 3],
  ['jacob_esau', 1 << 15, 0],
] as const)(
  'derives %s only from the required earned achievement',
  (id, flag, copies) => {
    const p = earned(flag, 0, copies);
    expect(readCharacterAccess(store(p)).available).toContain(id);
  },
);
it('Azazel requires both boss acquisition and actual brimstone acquisition', () => {
  expect(readCharacterAccess(store(earned(1 << 16))).available).not.toContain(
    'azazel',
  );
  expect(readCharacterAccess(store(earned(1 << 17))).available).not.toContain(
    'azazel',
  );
  expect(
    readCharacterAccess(store(earned((1 << 16) | (1 << 17)))).available,
  ).toContain('azazel');
});
it('Lost still requires ten failures in addition to the real positive E01 clear', () => {
  let p = earned(1 << 9, 1, 0, 10);
  expect(readCharacterAccess(store(p)).available).not.toContain('lost');
  for (let i = 1; i < 10; i++)
    p = appendAchievementEvent(
      p,
      {
        source: 'live',
        mode: 'classic',
        root: sha256Hex('root' + i),
        parent: null,
        authorityHash: sha256Hex('authority' + i),
        event: event(0, 1),
      },
      now,
    );
  expect(readCharacterAccess(store(p)).available).toContain('lost');
});
it('manual grant changes no receipts, achievement counters or completion timestamps and survives reload', () => {
  const p = earned(0, 1),
    before = projectAchievementRegistry(p)!,
    next = manuallyUnlockAchievementCharacters(p, now),
    after = projectAchievementRegistry(next)!;
  expect(after.achievedAt).toEqual(before.achievedAt);
  expect(after.progress).toEqual(before.progress);
  expect(after.counters).toEqual(before.counters);
  expect(readCharacterAccess(store(next)).available).toHaveLength(5);
  expect(activateAchievementRegistry(next)).toBe(next);
  expect(manuallyUnlockAchievementCharacters(next)).toBe(next);
});
it('explicit old snapshot rollback removes granted access, ordinary load never remigrates existing grants', () => {
  const p = createPlayerProfile(now),
    granted = manuallyUnlockAchievementCharacters(p, now);
  let source = JSON.stringify(granted);
  const storage = { getItem: () => source };
  requireCharacterAccess(storage, 'lost');
  source = JSON.stringify(p);
  expect(() => requireCharacterAccess(storage, 'lost')).toThrow('尚未解锁');
});
it('damaged or unknown achievement module blocks new selection without resetting or granting defaults', () => {
  const p = createPlayerProfile(now);
  p.progression.modules.achievementRegistryV1 = { version: 99 };
  const storage = store(p);
  expect(readCharacterAccess(storage).invalid).toBe(true);
  expect(readCharacterAccess(storage).available).toEqual([]);
  expect(() => requireCharacterAccess(storage, 'isaac')).toThrow('未核验');
});
it('storage unavailable allows only the default local character and never grants restricted roles', () => {
  expect(() => requireCharacterAccess(null, 'isaac')).not.toThrow();
  expect(() => requireCharacterAccess(null, 'lost')).toThrow();
  expect(characterRequirementText('lost')).toBe('非将军之过 + 屡败屡战');
});
it('failed or unavailable coordinated grant leaves profile byte exact', async () => {
  const p = createPlayerProfile(now),
    source = JSON.stringify(p);
  let written = false;
  const storage = {
    getItem: () => source,
    setItem: () => {
      written = true;
      throw Error('quota');
    },
  };
  await expect(
    persistAchievementProfile(
      storage,
      manuallyUnlockAchievementCharacters,
      null,
    ),
  ).rejects.toThrow('协调');
  expect(written).toBe(false);
  await expect(
    persistAchievementProfile(storage, manuallyUnlockAchievementCharacters, {
      exclusive: async (_n, work) => work(),
    }),
  ).rejects.toThrow('quota');
  expect(storage.getItem()).toBe(source);
});
