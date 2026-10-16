import { it, expect } from 'vitest';
import {
  createPlayerProfile,
  readPlayerProfile,
  playerProfileKey,
} from '../player-profile';
import {
  prepareAchievementBaseline,
  readAchievementRegistry,
  projectAchievementRegistry,
  activateAchievementRegistry,
  manuallyUnlockAchievementCharacters,
} from './registry';
import {
  achievementBaselineModule,
  hasCurrentAchievementBaseline,
} from './baseline';
import {
  oldAchievementProfile,
  baselineNow as now,
} from './baseline.test-helper';
import { appendCf, cfRoom } from './revision058.test-helper';
import { persistAchievementProfile } from './persistence';
import { replacePlayerProfileCoordinated } from '../profile-operations';
import {
  serializePlayerProfileBackup,
  parsePlayerProfileBackup,
} from '../player-profile-file';
import { stringifyChecked } from '../file-json';
import { readCharacterAccess } from './character-access';
import { profileReplacementEpochKey } from '../profile-write-coordinator';
const coordinator = {
  exclusive: async <T>(_name: string, work: () => T) => work(),
};
function store(p: ReturnType<typeof createPlayerProfile>) {
  const data = new Map<string, string>([
    [playerProfileKey, JSON.stringify(p)],
    ['other', 'keep'],
  ]);
  return {
    data,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => {
      data.set(k, v);
    },
    removeItem: (k: string) => {
      data.delete(k);
    },
  };
}
it('clears every old achievement receipt/counter/time/memo and earned permission, preserving non-achievement data', () => {
  const old = oldAchievementProfile(),
    before = JSON.stringify(old),
    clean = prepareAchievementBaseline(readPlayerProfile(old), now);
  expect(hasCurrentAchievementBaseline(clean)).toBe(true);
  expect(readAchievementRegistry(clean)!.receipts).toEqual([]);
  const view = projectAchievementRegistry(clean)!;
  expect(view.achievedAt).toEqual({});
  expect(view.legacyAchievements).toEqual({});
  expect(Object.values(view.progress).every((n) => n === 0)).toBe(true);
  expect(Object.keys(view.characterUnlocks)).toEqual(['isaac']);
  expect(clean.progression.achievements).toEqual({});
  expect(clean.progression.characterUnlocks.lost).toBeUndefined();
  expect(clean.progression.characterUnlocks.external).toEqual(
    old.progression.characterUnlocks.external,
  );
  expect(clean.history).toEqual(old.history);
  expect(clean.createdAt).toBe(old.createdAt);
  expect(clean.progression.statistics).toEqual(old.progression.statistics);
  expect(clean.progression.modules.completionRegistryV1).toEqual(
    old.progression.modules.completionRegistryV1,
  );
  expect(clean.progression.modules.external).toEqual(
    old.progression.modules.external,
  );
  expect(JSON.stringify(old)).toBe(before);
});
it('preserves actual manual authorization and its original time, but never preserves old earned role grants', () => {
  const old = oldAchievementProfile(true),
    at = readAchievementRegistry(old)!.manualUnlockAllAt;
  const clean = prepareAchievementBaseline(old, now),
    view = projectAchievementRegistry(clean)!;
  expect(readAchievementRegistry(clean)!.manualUnlockAllAt).toBe(at);
  expect(view.achievedAt).toEqual({});
  expect(
    Object.values(view.characterUnlocks).filter(
      (v) => v.conditionId === 'manual-all',
    ),
  ).toHaveLength(4);
  expect(manuallyUnlockAchievementCharacters(old, now)).toEqual(clean);
});
it('uses a fixed marker instead of dates/build labels and never clears the new baseline on later updates or backups', () => {
  let p = prepareAchievementBaseline(oldAchievementProfile(), now);
  p = appendCf(p, cfRoom(0, { code: 1 }));
  const before = JSON.stringify(p);
  expect(prepareAchievementBaseline(p, new Date('2030-01-01'))).toBe(p);
  expect(activateAchievementRegistry(p)).toBe(p);
  const imported = parsePlayerProfileBackup(
    serializePlayerProfileBackup(p, '0.1.0-old-label'),
  ).profile;
  expect(imported).toEqual(p);
  p = appendCf(imported, cfRoom(0, { code: 1 }));
  expect(projectAchievementRegistry(p)!.progress.A01).toBe(2);
  expect(JSON.stringify(imported)).toBe(before);
});
it('stops displaying old achievements read-only without pretending the cleanup was saved or mutating the original', () => {
  const p = oldAchievementProfile(),
    raw = JSON.stringify(p);
  expect(projectAchievementRegistry(p)!.achievedAt).toEqual({});
  expect(readCharacterAccess({ getItem: () => raw }).available).toEqual([
    'isaac',
  ]);
  expect(hasCurrentAchievementBaseline(p)).toBe(false);
  expect(JSON.stringify(p)).toBe(raw);
});
it('fails closed on unknown markers or corrupt old ledgers instead of deleting their data', () => {
  for (const bad of [null, 2, {}, { version: 2 }, { version: 1, extra: 1 }]) {
    const p = oldAchievementProfile();
    p.progression.modules[achievementBaselineModule] =
      bad as import('../player-profile').ProfileValue;
    const raw = JSON.stringify(p);
    expect(() => prepareAchievementBaseline(p, now)).toThrow();
    expect(() => readPlayerProfile(p)).toThrow();
    expect(JSON.stringify(p)).toBe(raw);
  }
  const p = oldAchievementProfile();
  p.progression.modules.achievementRegistryV1 = { version: 99 };
  const raw = JSON.stringify(p);
  expect(() => prepareAchievementBaseline(p, now)).toThrow();
  expect(JSON.stringify(p)).toBe(raw);
});
it('commits cleanup once under the shared coordinator and retains original bytes on unavailable coordination or quota', async () => {
  const old = oldAchievementProfile(),
    s = store(old),
    raw = s.getItem(playerProfileKey);
  await expect(
    persistAchievementProfile(s, prepareAchievementBaseline, null),
  ).rejects.toThrow('协调');
  expect(s.getItem(playerProfileKey)).toBe(raw);
  const throwing = {
    ...s,
    setItem: () => {
      throw Error('quota');
    },
  };
  await expect(
    persistAchievementProfile(
      throwing,
      prepareAchievementBaseline,
      coordinator,
    ),
  ).rejects.toThrow('quota');
  expect(s.getItem(playerProfileKey)).toBe(raw);
  const cleaned = await persistAchievementProfile(
    s,
    prepareAchievementBaseline,
    coordinator,
  );
  expect(cleaned.changed).toBe(true);
  const source = s.getItem(playerProfileKey);
  expect(
    (
      await persistAchievementProfile(
        s,
        prepareAchievementBaseline,
        coordinator,
      )
    ).changed,
  ).toBe(false);
  expect(s.getItem(playerProfileKey)).toBe(source);
  expect(s.getItem('other')).toBe('keep');
});
it('cleans an old independent backup on preview and replacement, preserves current post-cleanup progress on ordinary roundtrip', async () => {
  const old = oldAchievementProfile(true),
    doc = stringifyChecked({
      format: 'the-bidding-of-isaac-profile-backup',
      version: 1,
      kind: 'profile-backup',
      exportedAt: now.toISOString(),
      exportedBuild: '0.5.10',
      profile: old,
    });
  const parsed = parsePlayerProfileBackup(doc);
  expect(hasCurrentAchievementBaseline(parsed.profile)).toBe(true);
  expect(projectAchievementRegistry(parsed.profile)!.achievedAt).toEqual({});
  const s = store(createPlayerProfile(now)),
    source = s.getItem(playerProfileKey);
  const restored = await replacePlayerProfileCoordinated(s, old, source, {
    coordinator,
  });
  expect(hasCurrentAchievementBaseline(restored.profile)).toBe(true);
  expect(readAchievementRegistry(restored.profile)!.receipts).toEqual([]);
  expect(s.getItem(profileReplacementEpochKey)).toMatch(/^[a-f0-9]{64}$/);
  const next = appendCf(restored.profile, cfRoom(0, { code: 1 }));
  const reloaded = parsePlayerProfileBackup(
    serializePlayerProfileBackup(next),
  ).profile;
  expect(reloaded).toEqual(next);
  expect(
    (
      await replacePlayerProfileCoordinated(s, next, restored.source, {
        coordinator,
      })
    ).profile,
  ).toEqual(next);
});
