import { expect, it } from 'vitest';
import {
  fixedCapacityTraces,
  capacityFixture,
  padProfileTo,
  profileBytes,
} from './growth-capacity.test-helper';
import { readPlayerProfile } from '../player-profile';
import {
  appendAchievementEvent,
  readAchievementRegistry,
  manuallyUnlockAchievementCharacters,
} from './registry';
import { decodeAchievementEvent } from './event-codec';
import { sha256Hex } from '../../shared/sha256';
import { canonicalJson } from '../../shared/json-facts';
const traces = fixedCapacityTraces();
const submission = {
  source: 'live' as const,
  mode: 'classic' as const,
  root: sha256Hex('new-after-cap'),
  parent: null,
  authorityHash: sha256Hex('new-evidence'),
  event: decodeAchievementEvent({
    stage: 'entry',
    position: 0,
    values: [0, 10],
  }),
};
it('bounded scale fixture with chained receipts, completion data and 200 rows remains valid; 2049th migrates losslessly instead of evicting history', () => {
  const f = capacityFixture(traces, 2048, 'mixed', 200, 32768),
    p = readPlayerProfile(f.profile),
    before = canonicalJson(p);
  expect(readAchievementRegistry(p)!.receipts).toHaveLength(2048);
  expect(p.history).toHaveLength(200);
  expect(profileBytes(p)).toBeLessThanOrEqual(1024 * 1024);
  const next = appendAchievementEvent(p, submission);
  expect(readAchievementRegistry(next)!.receipts).toHaveLength(2049);
  expect(readAchievementRegistry(next)!.receipts.slice(0, 2048)).toEqual(
    readAchievementRegistry(p)!.receipts,
  );
  expect(profileBytes(next)).toBeLessThan(profileBytes(p) / 2);
  expect(canonicalJson(p)).toBe(before);
  const corrupt = structuredClone(p);
  (
    corrupt.progression.modules.achievementRegistryV1 as unknown as {
      receipts: unknown[];
    }
  ).receipts.push({});
  expect(() => readPlayerProfile(corrupt)).toThrow();
  expect(canonicalJson(p)).toBe(before);
});
it('whole-profile byte limit is independent of the receipt cap, preserving unknown extensions on rejected growth and grants', () => {
  const f = capacityFixture(traces, 64),
    p = padProfileTo(f.profile, 1024 * 1024),
    before = canonicalJson(p);
  expect(profileBytes(p)).toBe(1024 * 1024);
  expect(readPlayerProfile(p)).toEqual(p);
  expect(() =>
    readPlayerProfile(padProfileTo(f.profile, 1024 * 1024 + 1)),
  ).toThrow();
  expect(() => appendAchievementEvent(p, submission)).toThrow('容量');
  expect(() => manuallyUnlockAchievementCharacters(p)).toThrow('容量');
  expect(canonicalJson(p)).toBe(before);
});
