import { beforeAll, afterEach, expect, it, vi } from 'vitest';
import {
  captureCurrentCorpus,
  buildCurrentLedgerFixture,
  corpusTime,
  type CurrentCorpusTrace,
} from './achievements/closeout-corpus.test-helper';
import * as evaluation from './achievements/evaluation';
import {
  readPlayerProfile,
  playerProfileKey,
  type PlayerProfile,
} from './player-profile';
import { checkedJson, stringifyChecked } from './file-json';
import {
  prepareAchievementBaseline,
  projectAchievementRegistry,
  readAchievementRegistry,
  withAchievementVerificationScope,
} from './achievements/registry';
import {
  serializePlayerProfileBackup,
  parsePlayerProfileBackup,
  restorePlayerProfileBackup,
} from './player-profile-file';
import { canonicalJson } from '../shared/json-facts';
import {
  oldAchievementProfile,
  baselineNow,
} from './achievements/baseline.test-helper';
import { padCurrentProfileTo } from './achievements/closeout-capacity.test-helper';

let traces: CurrentCorpusTrace[];
beforeAll(() => {
  traces = captureCurrentCorpus();
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});
const fixture = () =>
  buildCurrentLedgerFixture(traces, 64, 'mixed-branches', {
    historyRows: 200,
    paddingChars: 32768,
  }).profile;
/** Frozen pre-0.6 validation sequence for equivalence, not a new production path. */
function priorValidated(value: unknown) {
  const validated = readPlayerProfile(value);
  return readPlayerProfile(
    prepareAchievementBaseline(
      readPlayerProfile(checkedJson(JSON.stringify(validated))),
    ),
  );
}
function priorSerialized(p: PlayerProfile) {
  return stringifyChecked({
    format: 'the-bidding-of-isaac-profile-backup',
    version: 1,
    kind: 'profile-backup',
    exportedAt: corpusTime.toISOString(),
    exportedBuild: 'fixed-performance-test',
    profile: priorValidated(p),
  });
}
it('reduces repeated semantic scans from three to one per file operation while preserving backup bytes', () => {
  const p = fixture(),
    raw = canonicalJson(p),
    spy = vi.spyOn(evaluation, 'evaluateAchievementRun');
  const expected = priorSerialized(p);
  expect(spy).toHaveBeenCalledTimes(64 * 3);
  spy.mockClear();
  const source = serializePlayerProfileBackup(
    p,
    'fixed-performance-test',
    corpusTime,
  );
  expect(source).toBe(expected);
  expect(spy).toHaveBeenCalledTimes(64);
  spy.mockClear();
  expect(parsePlayerProfileBackup(source).profile).toEqual(p);
  expect(spy).toHaveBeenCalledTimes(64);
  spy.mockClear();
  const data = new Map<string, string>();
  restorePlayerProfileBackup(
    {
      getItem: (k) => data.get(k) ?? null,
      setItem: (k, v) => {
        data.set(k, v);
      },
    },
    p,
    null,
  );
  expect(spy).toHaveBeenCalledTimes(64);
  expect(JSON.parse(data.get(playerProfileKey)!)).toEqual(p);
  expect(canonicalJson(p)).toBe(raw);
});
it('does not retain scans across operations, returned object mutations, errors or storage callbacks', () => {
  const p = fixture(),
    source = serializePlayerProfileBackup(
      p,
      'fixed-performance-test',
      corpusTime,
    );
  const spy = vi.spyOn(evaluation, 'evaluateAchievementRun');
  const parsed = parsePlayerProfileBackup(source);
  expect(spy).toHaveBeenCalledTimes(64);
  spy.mockClear();
  (
    parsed.profile.progression.modules.achievementRegistryV1 as {
      count: number;
    }
  ).count = -1;
  expect(() => serializePlayerProfileBackup(parsed.profile)).toThrow();
  expect(parsePlayerProfileBackup(source).profile).toEqual(p);
  expect(spy).toHaveBeenCalledTimes(64);
  spy.mockClear();
  restorePlayerProfileBackup(
    {
      getItem: () => {
        projectAchievementRegistry(p);
        return null;
      },
      setItem: () => {},
    },
    p,
    null,
  );
  expect(spy).toHaveBeenCalledTimes(128); // file validation ended before getItem
  spy.mockClear();
  serializePlayerProfileBackup(p);
  serializePlayerProfileBackup(p);
  expect(spy).toHaveBeenCalledTimes(128);
});
it('retains raw admission, guarded JSON unsafe-key checks, byte caps and baseline checks even with identical cached ledgers', () => {
  const p = fixture();
  withAchievementVerificationScope(() => {
    readPlayerProfile(p);
    const invalid = structuredClone(p);
    invalid.progression.modules.extra = { constructor: 'unsafe' };
    expect(() => serializePlayerProfileBackup(invalid)).toThrow();
    const bad = structuredClone(p);
    bad.progression.statistics.total = Infinity;
    expect(() => serializePlayerProfileBackup(bad)).toThrow();
    const future = structuredClone(p);
    future.progression.modules.achievementBaselineV1 = { version: 2 };
    expect(() => serializePlayerProfileBackup(future)).toThrow();
    expect(() =>
      serializePlayerProfileBackup(padCurrentProfileTo(p, 1024 * 1024 + 1)),
    ).toThrow();
  });
});
it('revalidates modified receipt contents rather than trusting mutable profile identity or a short hash', () => {
  const p = fixture(),
    source = serializePlayerProfileBackup(p);
  const invalid = structuredClone(p);
  const wire = invalid.progression.modules.achievementRegistryV1 as {
    data: string[];
  };
  wire.data[0] = wire.data[0]!.slice(0, -1) + '!';
  expect(() => serializePlayerProfileBackup(invalid)).toThrow();
  expect(parsePlayerProfileBackup(source).profile).toEqual(p);
  const exposed = readAchievementRegistry(p)!;
  exposed.receipts[0]!.values[0] = -1;
  expect(parsePlayerProfileBackup(source).profile).toEqual(p);
});
it.each([false, true])(
  'preserves old baseline cleanup and manual grant semantics (manual=%s), including exact output',
  (manual) => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(baselineNow);
    const p = oldAchievementProfile(manual),
      raw = canonicalJson(p),
      expected = priorSerialized(p);
    const source = serializePlayerProfileBackup(
      p,
      'fixed-performance-test',
      corpusTime,
    );
    expect(source).toBe(expected);
    const loaded = parsePlayerProfileBackup(source).profile;
    expect(readAchievementRegistry(loaded)!.receipts).toHaveLength(0);
    expect(!!readAchievementRegistry(loaded)!.manualUnlockAllAt).toBe(manual);
    expect(canonicalJson(p)).toBe(raw);
  },
);
it('rechecks non-ledger state on each call even when the ledger is byte-identical', () => {
  const p = fixture();
  serializePlayerProfileBackup(p);
  p.history[0]!.rank = 21;
  expect(() => serializePlayerProfileBackup(p)).toThrow();
  p.history[0]!.rank = 2;
  const parsed = parsePlayerProfileBackup(serializePlayerProfileBackup(p));
  expect(parsed.profile.history[0]!.rank).toBe(2);
});
