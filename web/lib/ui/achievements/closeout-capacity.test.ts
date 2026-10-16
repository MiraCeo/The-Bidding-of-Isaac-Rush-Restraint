import { beforeAll, afterEach, expect, it, vi } from 'vitest';
import {
  captureCurrentCorpus,
  buildCurrentLedgerFixture,
  currentCorpusBytes,
  type CurrentCorpusTrace,
} from './closeout-corpus.test-helper';
import {
  capacityClock,
  capacitySubmission,
  padCurrentProfileTo,
  probeCurrentSave,
} from './closeout-capacity.test-helper';
import { readPlayerProfile } from '../player-profile';
import {
  appendAchievementEvent,
  readAchievementRegistry,
  projectAchievementRegistry,
} from './registry';
import { packAchievementRegistry } from './ledger-codec';
import { canonicalJson } from '../../shared/json-facts';
import {
  serializePlayerProfileBackup,
  parsePlayerProfileBackup,
} from '../player-profile-file';
import { packDataFile, unpackDataFile } from '../compressed-file';
let traces: CurrentCorpusTrace[];
beforeAll(() => {
  traces = captureCurrentCorpus();
});
afterEach(() => vi.useRealTimers());
it('round-trips the production compressed-file result structure and exact profile backup bytes', async () => {
  const p = buildCurrentLedgerFixture(traces, 64, 'mixed-branches', {
    paddingChars: 32768,
  }).profile;
  const text = serializePlayerProfileBackup(
    p,
    'capacity-round-trip',
    capacityClock,
  );
  const packed = await packDataFile(text),
    unpacked = await unpackDataFile(packed.source);
  expect(packed.compressed).toBe(true);
  expect(unpacked.source).toBe(text);
  expect(parsePlayerProfileBackup(unpacked.source).profile).toEqual(p);
});
it('keeps schema6 exact 1MiB valid, rejects the next byte and preserves the source on denied append', () => {
  const base = buildCurrentLedgerFixture(traces, 64, 'mixed-branches').profile;
  const near = padCurrentProfileTo(base, 1024 * 1024),
    raw = canonicalJson(near);
  expect(currentCorpusBytes(near)).toBe(1024 * 1024);
  expect(readPlayerProfile(near)).toEqual(near);
  expect(() =>
    readPlayerProfile(padCurrentProfileTo(base, 1024 * 1024 + 1)),
  ).toThrow();
  expect(() =>
    appendAchievementEvent(near, capacitySubmission, capacityClock),
  ).toThrow();
  expect(canonicalJson(near)).toBe(raw);
});
it('leaves a profile and both pending units unchanged at the shared byte limit', async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(capacityClock);
  const p = padCurrentProfileTo(
    buildCurrentLedgerFixture(traces, 64, 'classic').profile,
    1024 * 1024,
  );
  expect(await probeCurrentSave(p)).toMatchObject({
    result: 'pending',
    profileUnchanged: true,
    profileWrites: 0,
    acknowledged: 0,
    pendingUnits: 2,
    quotaRetry: null,
  });
});
it('commits exactly two current units once and keeps repeat saves read-only', async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(capacityClock);
  const p = buildCurrentLedgerFixture(traces, 256, 'survival').profile;
  const raw = canonicalJson(p);
  expect(await probeCurrentSave(p)).toMatchObject({
    result: 'committed',
    profileWrites: 1,
    acknowledged: 2,
    pendingUnits: 0,
  });
  expect(canonicalJson(p)).toBe(raw);
});
it('preserves profile and pending when the injected storage rejects a profile write', async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(capacityClock);
  expect(
    await probeCurrentSave(
      buildCurrentLedgerFixture(traces, 64, 'classic').profile,
      true,
    ),
  ).toMatchObject({
    result: 'pending',
    profileUnchanged: true,
    profileWrites: 0,
    acknowledged: 0,
    pendingUnits: 2,
    quotaRetry: {
      acknowledged: 2,
      profileWrites: 1,
      repeatedProfileUnchanged: true,
    },
  });
});
it('never mutates input on authority conflict and retains every independent achievement time', () => {
  const p = readPlayerProfile(
    buildCurrentLedgerFixture(traces, 64, 'mixed-branches').profile,
  );
  const before = canonicalJson(p),
    view = projectAchievementRegistry(p),
    r = readAchievementRegistry(p)!.receipts[0]!;
  expect(() =>
    appendAchievementEvent(
      p,
      {
        source: 'live',
        mode: r.mode,
        root: r.root,
        parent: r.parent,
        authorityHash: r.authorityHash,
        event: {
          stage: 'entry',
          facts: {
            stolenMoney: 1,
            interestMoney: 0,
            floorIndex: 0,
            roomIndex: 0,
            milestones: true,
            revisions: true,
            cf: true,
          },
        },
      },
      capacityClock,
    ),
  ).toThrow();
  expect(canonicalJson(p)).toBe(before);
  expect(projectAchievementRegistry(p)).toEqual(view);
});
it('tests the codec receipt ceiling independently, without claiming its largest construct fits byte caps', () => {
  const f = buildCurrentLedgerFixture(traces, 16384, 'survival');
  expect(f.wire!.count).toBe(16384);
  const overflow = {
    ...f.registry!,
    receipts: [...f.registry!.receipts, f.registry!.receipts[0]!],
  };
  expect(() => packAchievementRegistry(overflow)).toThrow();
  expect(f.registry!.receipts).toHaveLength(16384);
}, 20000);
