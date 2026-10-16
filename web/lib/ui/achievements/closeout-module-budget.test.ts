import { expect, it } from 'vitest';
import {
  captureCurrentCorpus,
  buildCurrentLedgerFixture,
  currentCorpusBytes,
} from './closeout-corpus.test-helper';
import {
  achievementRegistryByteLimit,
  readAchievementRegistry,
} from './registry';
import { unpackAchievementRegistry } from './ledger-codec';
import { readPlayerProfile } from '../player-profile';
import { canonicalJson } from '../../shared/json-facts';

it('isolates the 896KiB schema6 module budget below the independent 1MiB profile limit', () => {
  const f = buildCurrentLedgerFixture(captureCurrentCorpus(), 12800, 'classic');
  const before = canonicalJson(f.profile);
  expect(Buffer.byteLength(canonicalJson(f.wire))).toBeGreaterThan(
    achievementRegistryByteLimit,
  );
  expect(currentCorpusBytes(f.profile)).toBeLessThan(1024 * 1024);
  // Valid compact facts, not an unknown version or damaged data used to fake a
  // budget failure. The low-level codec has no module byte admission budget.
  expect(unpackAchievementRegistry(f.wire!)).toEqual(f.registry);
  expect(() => readAchievementRegistry(f.profile)).toThrow('成就成长模块');
  expect(() => readPlayerProfile(f.profile)).toThrow('成就成长模块');
  expect(canonicalJson(f.profile)).toBe(before);
}, 20000);
