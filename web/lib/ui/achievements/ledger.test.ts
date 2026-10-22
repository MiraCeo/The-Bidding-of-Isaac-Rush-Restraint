import { describe, expect, it, vi } from 'vitest';
import * as evaluation from './evaluation';
import {
  createPlayerProfile,
  readPlayerProfile,
  playerProfileKey,
  type PlayerProfile,
  type ProfileValue,
} from '../player-profile';
import {
  achievementReceiptKey,
  packAchievementRegistry,
  unpackAchievementRegistry,
  packedAchievementReceiptLimit,
  type PackedAchievementRegistry,
} from './ledger-codec';
import {
  activateAchievementRegistry,
  appendAchievementEvent,
  compactAchievementProfile,
  createAchievementBatch,
  projectAchievementRegistry,
  readAchievementRegistry,
  validateAchievementRegistry,
  withAchievementVerificationScope,
  type AchievementSubmission,
} from './registry';
import { decodeAchievementEvent } from './event-codec';
import { canonicalJson } from '../../shared/json-facts';
import { sha256Hex } from '../../shared/sha256';
import {
  capacityFixture,
  fixedCapacityTraces,
  padProfileTo,
  profileBytes,
} from './growth-capacity.test-helper';
import { applyGrowthContext, validateGrowthProfilePair } from './lifecycle';
import { saveClassicClient } from './client-persistence';
import { gameSaveKey } from '../game-save';
import {
  parsePlayerProfileBackup,
  serializePlayerProfileBackup,
} from '../player-profile-file';
import { packDataFile, unpackDataFile } from '../compressed-file';
const now = new Date('2026-10-15T00:00:00Z');
function submission(id = 'a', values = [0, 10]): AchievementSubmission {
  return {
    source: 'live',
    mode: 'classic',
    root: sha256Hex('shared-root'),
    parent: null,
    authorityHash: sha256Hex(id),
    event: decodeAchievementEvent({ stage: 'entry', position: 0, values }),
  };
}
function profile() {
  return appendAchievementEvent(createPlayerProfile(now), submission(), now);
}
function wire(p: PlayerProfile) {
  return p.progression.modules
    .achievementRegistryV1 as unknown as PackedAchievementRegistry;
}
function install(p: PlayerProfile, r: PackedAchievementRegistry) {
  const next = structuredClone(p);
  next.progression.modules.achievementRegistryV1 = r as unknown as ProfileValue;
  return next;
}
function changedBytes(
  r: PackedAchievementRegistry,
  change: (b: number[]) => void,
) {
  const next = structuredClone(r),
    bytes = [...Buffer.from(next.data.join(''), 'base64')];
  change(bytes);
  next.data = [Buffer.from(bytes).toString('base64')];
  return next;
}

describe('lossless compact ledger and bounded validation', () => {
  it('reads old data without migration and explicitly compacts without changing any profile or achievement timestamps', () => {
    const old = profile(),
      before = canonicalJson(old),
      view = readAchievementRegistry(old),
      projection = projectAchievementRegistry(old);
    readPlayerProfile(old);
    projectAchievementRegistry(old);
    expect(wire(old).version).toBe(1);
    const next = compactAchievementProfile(old);
    expect(wire(next).version).toBe(2);
    expect(readPlayerProfile(next)).toEqual(next);
    expect(readAchievementRegistry(next)).toEqual(view);
    expect(projectAchievementRegistry(next)).toEqual(projection);
    expect(next.createdAt).toBe(old.createdAt);
    expect(next.updatedAt).toBe(old.updatedAt);
    expect(compactAchievementProfile(next)).toBe(next);
    expect(canonicalJson(old)).toBe(before);
    expect(
      appendAchievementEvent(next, submission(), new Date('2026-10-16')),
    ).toBe(next);
    expect(appendAchievementEvent(old, submission(), now)).toBe(old);
    expect(
      appendAchievementEvent(
        next,
        { ...submission(), parent: sha256Hex('other-parent') },
        now,
      ),
    ).toBe(next);
  });
  it('preserves full hashes, parent/branch identities, exact safe numeric metrics and signed timestamp deltas', () => {
    const r = readAchievementRegistry(profile())!;
    r.receipts[0]!.at = '0000-01-01T00:00:00.000Z';
    const first = r.receipts[0]!;
    for (const [i, at] of [
      '9999-12-31T23:59:59.999Z',
      '2026-10-14T23:59:59.000Z',
    ].entries()) {
      const candidate = {
        ...first,
        stage: 'room' as const,
        position: i + 1,
        values: [1, 0, 2, 4, 0.0001],
        parent: first.key,
        authorityHash: sha256Hex('branch' + i),
        at,
      };
      r.receipts.push({ ...candidate, key: achievementReceiptKey(candidate) });
    }
    const packed = packAchievementRegistry(r);
    expect(validateAchievementRegistry(packed)).toEqual(r);
    expect(unpackAchievementRegistry(packed)).toEqual(r);
    const maximum = structuredClone(r);
    maximum.receipts = [
      { ...first, values: [Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER] },
    ];
    expect(unpackAchievementRegistry(packAchievementRegistry(maximum))).toEqual(
      maximum,
    );
    const maxScore = structuredClone(r);
    maxScore.receipts = [
      { ...r.receipts[1]!, parent: null, values: [0, 0, 0, 0, 123456789.4321] },
    ];
    maxScore.receipts[0]!.key = achievementReceiptKey(maxScore.receipts[0]!);
    expect(
      validateAchievementRegistry(packAchievementRegistry(maxScore)),
    ).toEqual(maxScore);
  });
  it.each([
    [
      'unsupported schema',
      (r: PackedAchievementRegistry) => ({ ...r, version: 3 }),
    ],
    [
      'extra field',
      (r: PackedAchievementRegistry) => ({ ...r, unknown: true }),
    ],
    [
      'over count',
      (r: PackedAchievementRegistry) => ({
        ...r,
        count: packedAchievementReceiptLimit + 1,
      }),
    ],
    [
      'fraction count',
      (r: PackedAchievementRegistry) => ({ ...r, count: 1.5 }),
    ],
    ['truncated count', (r: PackedAchievementRegistry) => ({ ...r, count: 2 })],
    [
      'trailing data',
      (r: PackedAchievementRegistry) =>
        changedBytes(r, (b) => {
          b.push(0);
        }),
    ],
    [
      'truncated data',
      (r: PackedAchievementRegistry) =>
        changedBytes(r, (b) => {
          b.pop();
        }),
    ],
    [
      'overlong integer',
      (r: PackedAchievementRegistry) =>
        changedBytes(r, (b) => {
          b.splice(0, 1, 128, 0);
        }),
    ],
    [
      'unsafe integer',
      (r: PackedAchievementRegistry) =>
        changedBytes(r, (b) => {
          b.splice(0, 1, ...Array<number>(8).fill(255), 0);
        }),
    ],
    [
      'future parent',
      (r: PackedAchievementRegistry) =>
        changedBytes(r, (b) => {
          b[1] = 1;
        }),
    ],
    [
      'unknown stage',
      (r: PackedAchievementRegistry) =>
        changedBytes(r, (b) => {
          b[2] = 4;
        }),
    ],
    [
      'bad position',
      (r: PackedAchievementRegistry) =>
        changedBytes(r, (b) => {
          b[3] = 35;
        }),
    ],
    [
      'unused root',
      (r: PackedAchievementRegistry) => ({
        ...r,
        count: 2,
        roots: [...r.roots, [1, r.roots[0]![1]]],
      }),
    ],
    [
      'duplicate root',
      (r: PackedAchievementRegistry) => ({
        ...r,
        count: 2,
        roots: [...r.roots, r.roots[0]],
      }),
    ],
    [
      'unknown mode',
      (r: PackedAchievementRegistry) => ({
        ...r,
        roots: [[2, r.roots[0]![1]]],
      }),
    ],
    [
      'short hash',
      (r: PackedAchievementRegistry) => ({ ...r, roots: [[0, 'AAAA']] }),
    ],
    [
      'noncanonical base64',
      (r: PackedAchievementRegistry) => ({ ...r, data: [r.data[0] + '\n'] }),
    ],
    [
      'chunk size',
      (r: PackedAchievementRegistry) => ({
        ...r,
        data: [r.data[0]!.slice(0, 4), r.data[0]!.slice(4)],
      }),
    ],
    [
      'module byte bound',
      (r: PackedAchievementRegistry) => ({
        ...r,
        data: Array<string>(113).fill('A'.repeat(8192)),
      }),
    ],
  ])('rejects %s without empty migration', (_name, mutate) => {
    const p = compactAchievementProfile(profile()),
      before = canonicalJson(p);
    expect(() =>
      readPlayerProfile(
        install(p, mutate(wire(p)) as PackedAchievementRegistry),
      ),
    ).toThrow();
    expect(canonicalJson(p)).toBe(before);
  });
  it('checks semantic duplicate units, values and parent order after decoding, not just valid binary', () => {
    const r = readAchievementRegistry(profile())!,
      first = r.receipts[0]!;
    expect(() =>
      validateAchievementRegistry(
        packAchievementRegistry({ ...r, receipts: [first, first] }),
      ),
    ).toThrow();
    expect(() =>
      validateAchievementRegistry(
        packAchievementRegistry({
          ...r,
          receipts: [{ ...first, position: 34 }],
        }),
      ),
    ).toThrow();
    const bad = { ...first, values: [1, 2, 3] };
    expect(() =>
      validateAchievementRegistry(
        packAchievementRegistry({ ...r, receipts: [bad] }),
      ),
    ).toThrow();
  });
  it('round-trips a deterministic mixed-stage corpus including every position and all room flags', () => {
    const p = profile(),
      r = readAchievementRegistry(p)!;
    let random = 42;
    const next = () => {
      random = (Math.imul(random, 1664525) + 1013904223) >>> 0;
      return random;
    };
    r.receipts = Array.from({ length: 512 }, (_, i) => {
      const stage = (['entry', 'room', 'floor', 'final'] as const)[i % 4]!;
      const candidate = {
        mode: 'survival' as const,
        root: sha256Hex('corpus-root-' + Math.floor(i / 16)),
        parent: null,
        authorityHash: sha256Hex('corpus-authority-' + i),
        stage,
        position:
          stage === 'entry' || stage === 'room' ? next() % 35 : next() % 7,
        values:
          stage === 'entry'
            ? [next() % 1000, next() % 100]
            : stage === 'room'
              ? [
                  next() % 7,
                  next() % 262144,
                  next() % 3,
                  next() % 5,
                  next() / 10000,
                ]
              : stage === 'floor'
                ? [3]
                : [1, 1, null],
        at: new Date(now.getTime() + (next() % 100000) - 50000).toISOString(),
      };
      return { ...candidate, key: achievementReceiptKey(candidate) };
    });
    p.progression.modules.achievementRegistryV1 = r as unknown as ProfileValue;
    const packed = compactAchievementProfile(p);
    expect(readAchievementRegistry(packed)).toEqual(r);
    expect(projectAchievementRegistry(packed)).toEqual(
      projectAchievementRegistry(p),
    );
  });
  it('round-trips compact archives through current JSON/gzip profile backup without granting or migrating on preview', async () => {
    const p = compactAchievementProfile(profile()),
      before = canonicalJson(p),
      json = serializePlayerProfileBackup(p);
    expect(parsePlayerProfileBackup(json).profile).toEqual(p);
    const packed = await packDataFile(json);
    const unpacked = await unpackDataFile(packed.source);
    expect(parsePlayerProfileBackup(unpacked.source).profile).toEqual(p);
    expect(canonicalJson(p)).toBe(before);
  });
});

describe('request-scoped full-content verification and atomic batches', () => {
  it('reuses only identical full ledger content in one synchronous scope, not mutable identity or a cross-request cache', () => {
    const p = profile(),
      saved = structuredClone(p),
      expected = projectAchievementRegistry(p);
    const spy = vi.spyOn(evaluation, 'evaluateAchievementRun');
    try {
      withAchievementVerificationScope(() => {
        readPlayerProfile(p);
        projectAchievementRegistry(p);
        createAchievementBatch(p).find(submissionIdentity());
        expect(spy).toHaveBeenCalledTimes(1);
        readAchievementRegistry(p)!.receipts[0]!.values[1] = -1;
        expect(() => readPlayerProfile(p)).toThrow();
        expect(projectAchievementRegistry(saved)).toEqual(expected);
        const exposed = projectAchievementRegistry(saved)!;
        exposed.counters.interestMoney = 999;
        expect(projectAchievementRegistry(saved)).toEqual(expected);
        withAchievementVerificationScope(() => {
          readPlayerProfile(saved);
        });
        expect(spy).toHaveBeenCalledTimes(2);
        projectAchievementRegistry(saved);
        expect(spy).toHaveBeenCalledTimes(2);
      });
      projectAchievementRegistry(saved);
      expect(spy).toHaveBeenCalledTimes(3);
    } finally {
      spy.mockRestore();
    }
  });
  it('rejects non-JSON array shapes before a canonical cache hit can collapse them to an empty array', () => {
    const empty = activateAchievementRegistry(createPlayerProfile(now), now);
    withAchievementVerificationScope(() => {
      readAchievementRegistry(empty);
      const sparse = structuredClone(empty);
      (
        sparse.progression.modules.achievementRegistryV1 as unknown as {
          receipts: unknown[];
        }
      ).receipts = Array(1);
      expect(() => readAchievementRegistry(sparse)).toThrow();
      const packed = compactAchievementProfile(empty);
      readAchievementRegistry(packed);
      const bad = structuredClone(packed);
      wire(bad).data = Array(1);
      expect(() => readAchievementRegistry(bad)).toThrow();
    });
  });
  it('bounds reuse to four distinct contents and evicts rather than skipping revalidation', () => {
    const profiles = Array.from({ length: 5 }, (_, i) =>
      appendAchievementEvent(
        createPlayerProfile(now),
        submission('cache-' + i),
        now,
      ),
    );
    const spy = vi.spyOn(evaluation, 'evaluateAchievementRun');
    try {
      withAchievementVerificationScope(() => {
        for (const p of profiles) projectAchievementRegistry(p);
        expect(spy).toHaveBeenCalledTimes(5);
        projectAchievementRegistry(profiles[0]!);
        expect(spy).toHaveBeenCalledTimes(6);
      });
    } finally {
      spy.mockRestore();
    }
  });
  it('never exposes mutable decoded/index cache state and clears the scope after errors', () => {
    const p = compactAchievementProfile(profile()),
      expected = projectAchievementRegistry(p);
    expect(() =>
      withAchievementVerificationScope(() => {
        const read = readAchievementRegistry(p)!;
        read.receipts[0]!.values[1] = 999;
        const found = createAchievementBatch(p).find(submissionIdentity())!;
        found.values[1] = 555;
        expect(projectAchievementRegistry(p)).toEqual(expected);
        throw Error('scope ends');
      }),
    ).toThrow('scope ends');
    expect(projectAchievementRegistry(p)).toEqual(expected);
  });
  it('does not share private cached receipt objects through a finished legacy-wire candidate', () => {
    const p = profile();
    withAchievementVerificationScope(() => {
      const batch = createAchievementBatch(p, now);
      batch.append(submission('new'));
      const result = batch.finish();
      readAchievementRegistry(result)!.receipts[0]!.values[1] = 777;
      expect(
        createAchievementBatch(p).find(submissionIdentity())!.values[1],
      ).toBe(10);
      expect(batch.finish()).toBe(result);
      expect(() => batch.append(submission('too-late'))).toThrow();
      expect(readAchievementRegistry(p)!.receipts).toHaveLength(1);
    });
  });
  it('uses the same rules as sequential writes, poisons failed batches and preserves original candidates', () => {
    const p = createPlayerProfile(now),
      before = canonicalJson(p),
      batch = createAchievementBatch(p, now);
    batch.append(submission('a'));
    batch.append(submission('b'));
    const next = batch.finish(),
      sequential = appendAchievementEvent(
        appendAchievementEvent(p, submission('a'), now),
        submission('b'),
        now,
      );
    expect(next).toEqual(sequential);
    expect(canonicalJson(p)).toBe(before);
    const failed = createAchievementBatch(p, now);
    failed.append(submission());
    expect(() => failed.append(submission('a', [0, 11]))).toThrow('冲突');
    expect(() => failed.finish()).toThrow();
    expect(readAchievementRegistry(p)).toBeNull();
    expect(activateAchievementRegistry(p, now).progression.modules).not.toEqual(
      {},
    );
  });
});
function submissionIdentity() {
  const s = submission();
  return {
    mode: s.mode,
    root: s.root,
    authorityHash: s.authorityHash,
    stage: 'entry' as const,
    position: 0,
  };
}

const traces = fixedCapacityTraces();
describe('compact capacity, restoration and coordinated save boundaries', () => {
  it('migrates exactly at the 256-receipt write threshold, never just by reading a large old snapshot', () => {
    const f = capacityFixture(traces, 255),
      before = canonicalJson(f.profile);
    expect(wire(readPlayerProfile(f.profile)).version).toBe(1);
    const next = appendAchievementEvent(
      f.profile,
      submission('threshold'),
      now,
    );
    expect(wire(next).version).toBe(2);
    expect(readAchievementRegistry(next)!.receipts.slice(0, 255)).toEqual(
      readAchievementRegistry(f.profile)!.receipts,
    );
    expect(readAchievementRegistry(next)!.receipts).toHaveLength(256);
    expect(canonicalJson(f.profile)).toBe(before);
  });
  it('migrates a full legacy prefix once, preserves all branch evidence and validates acknowledged backup prefixes', () => {
    const f = capacityFixture(traces, 2048, 'mixed', 200, 32768),
      before = canonicalJson(f.profile),
      old = projectAchievementRegistry(f.profile);
    const migrated = compactAchievementProfile(f.profile);
    expect(profileBytes(migrated)).toBeLessThan(profileBytes(f.profile) / 2);
    expect(readAchievementRegistry(migrated)).toEqual(
      readAchievementRegistry(f.profile),
    );
    expect(projectAchievementRegistry(migrated)).toEqual(old);
    validateGrowthProfilePair(migrated, f.probe.growth!);
    const result = applyGrowthContext(migrated, f.probe.growth!, now);
    expect(result.context.acknowledged).toBe(30);
    expect(readAchievementRegistry(result.profile)!.receipts).toHaveLength(
      2049,
    );
    expect(
      applyGrowthContext(result.profile, result.context, now).profile,
    ).toBe(result.profile);
    const corrupt = structuredClone(result.context);
    corrupt.units[0]!.values[0] = 1;
    expect(() => validateGrowthProfilePair(result.profile, corrupt)).toThrow();
    expect(canonicalJson(f.profile)).toBe(before);
  }, 20000);
  it('validates 16384 full-width branch receipts, rejects the next one without eviction, and enforces the shared 1MiB independently', () => {
    const p = compactAchievementProfile(profile()),
      base = readAchievementRegistry(p)!,
      first = base.receipts[0]!;
    const receipts = Array.from(
      { length: packedAchievementReceiptLimit },
      (_, i) => {
        const r = {
          ...first,
          values: [0, 0],
          authorityHash: sha256Hex('long-lived-branch-' + i),
        };
        return { ...r, key: achievementReceiptKey(r) };
      },
    );
    const full = install(p, packAchievementRegistry({ ...base, receipts })),
      before = canonicalJson(full);
    expect(
      readAchievementRegistry(readPlayerProfile(full))!.receipts,
    ).toHaveLength(packedAchievementReceiptLimit);
    expect(() => appendAchievementEvent(full, submission('extra'))).toThrow(
      '容量',
    );
    expect(canonicalJson(full)).toBe(before);
    const near = padProfileTo(p, 1024 * 1024);
    expect(readPlayerProfile(near)).toEqual(near);
    expect(() => appendAchievementEvent(near, submission('other'))).toThrow(
      '容量',
    );
    expect(() => readPlayerProfile(padProfileTo(p, 1024 * 1024 + 1))).toThrow();
  }, 20000);
  it('saves above the legacy cap once; on a failed migration commit keeps old bytes and pending cursor until retry', async () => {
    const f = capacityFixture(traces, 2048, 'mixed', 200, 32768),
      original = JSON.stringify(f.profile),
      values = new Map([[playerProfileKey, original]]);
    let fail = true,
      writes = 0;
    const storage = {
      getItem: (k: string) => values.get(k) ?? null,
      setItem: (k: string, v: string) => {
        if (k === playerProfileKey && fail) {
          fail = false;
          throw Error('quota');
        }
        values.set(k, v);
        if (k === playerProfileKey) writes++;
      },
      removeItem: (k: string) => {
        values.delete(k);
      },
    };
    const coordinator = {
      exclusive: async <T>(_name: string, work: () => T) => work(),
    };
    const pending = await saveClassicClient(storage, f.probe, {
      expectedSource: null,
      coordinator,
    });
    expect(pending.message).toBeTruthy();
    expect(pending.session.growth!.acknowledged).toBe(29);
    expect(values.get(playerProfileKey)).toBe(original);
    const saved = await saveClassicClient(storage, pending.session, {
      expectedSource: storage.getItem(gameSaveKey),
      coordinator,
    });
    expect(saved.message).toBeFalsy();
    expect(saved.session.growth!.acknowledged).toBe(30);
    const committed = values.get(playerProfileKey)!;
    expect(wire(JSON.parse(committed)).version).toBe(2);
    expect(
      readAchievementRegistry(JSON.parse(committed))!.receipts,
    ).toHaveLength(2049);
    const count = writes;
    await saveClassicClient(storage, saved.session, {
      expectedSource: storage.getItem(gameSaveKey),
      coordinator,
    });
    expect(values.get(playerProfileKey)).toBe(committed);
    expect(writes).toBe(count);
  }, 20000);
});
