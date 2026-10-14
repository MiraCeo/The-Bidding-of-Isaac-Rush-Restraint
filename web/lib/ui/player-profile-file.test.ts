import { describe, expect, it, vi } from 'vitest';
import { mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { profileFileFixture } from './player-profile-file.test-helper';
import { createPlayerProfile, playerProfileKey } from './player-profile';
import {
  serializePlayerProfileBackup,
  parsePlayerProfileBackup,
  readPlayerProfileBackup,
  readPlayerProfileSnapshot,
  restorePlayerProfileBackup,
  PlayerProfileChangedError,
} from './player-profile-file';
import { packDataFile, unpackDataFile } from './compressed-file';
import { stringifyChecked, maxFileBytes } from './file-json';
import { parseModeDataFile, readModeDataFile } from './mode-data';
import * as classic from './game-session';
import * as survival from '../game/survival-session';

function memory(initial: string | null = null) {
  const data = new Map<string, string>();
  if (initial !== null) data.set(playerProfileKey, initial);
  return {
    data,
    getItem: vi.fn((key: string) => data.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      data.set(key, value);
    }),
  };
}
const fixtureSource = () =>
  serializePlayerProfileBackup(
    profileFileFixture(),
    'profile-file-test',
    new Date('2026-10-14T02:00:00.000Z'),
  );
describe('independent player profile backup contract and single-key restore', () => {
  it('roundtrips profile data and provenance without a game, preferences or a replay', () => {
    const doc = parsePlayerProfileBackup(fixtureSource());
    expect(doc.version).toBe(1);
    expect(doc.kind).toBe('profile-backup');
    expect(doc.profile).toEqual(profileFileFixture());
    expect(doc.exportedBuild).toBe('profile-file-test');
    expect(doc.exportedAt).toBe('2026-10-14T02:00:00.000Z');
    expect(Object.keys(JSON.parse(fixtureSource())).sort()).toEqual([
      'checksum',
      'exportedAt',
      'exportedBuild',
      'format',
      'kind',
      'profile',
      'version',
    ]);
    doc.profile.history[0]!.finalScore = 999;
    expect(
      parsePlayerProfileBackup(fixtureSource()).profile.history[0]!.finalScore,
    ).toBe(123.4567);
  });
  it('reads current raw and compressed files with BOM and preserves the original inner text', async () => {
    const source = '\uFEFF' + fixtureSource(),
      packed = await packDataFile(source);
    expect((await readPlayerProfileBackup(source)).profile).toEqual(
      profileFileFixture(),
    );
    expect((await readPlayerProfileBackup(packed.source)).profile).toEqual(
      profileFileFixture(),
    );
    expect((await unpackDataFile(packed.source)).source).toBe(source);
  });
  it('rejects missing or altered checksums', () => {
    const doc = JSON.parse(fixtureSource());
    doc.profile.history[0].finalScore = 456;
    expect(() => parsePlayerProfileBackup(JSON.stringify(doc))).toThrow('摘要');
    delete doc.checksum;
    expect(() => parsePlayerProfileBackup(JSON.stringify(doc))).toThrow();
  });
  it('rejects unsupported versions, wrong kinds and raw internal profiles rather than guessing a migration', () => {
    const doc = JSON.parse(fixtureSource());
    for (const changes of [
      { version: 2 },
      { kind: 'checkpoint' },
      { format: 'the-bidding-of-isaac-save' },
    ])
      expect(() =>
        parsePlayerProfileBackup(stringifyChecked({ ...doc, ...changes })),
      ).toThrow('独立玩家档案备份v1');
    expect(() =>
      parsePlayerProfileBackup(JSON.stringify(profileFileFixture())),
    ).toThrow('独立玩家档案备份v1');
  });
  it('rejects unexpected envelope fields and invalid provenance even when re-signed', () => {
    const doc = JSON.parse(fixtureSource());
    for (const changes of [
      { mode: 'classic' },
      { exportedAt: 'invalid' },
      { exportedBuild: '' },
    ])
      expect(() =>
        parsePlayerProfileBackup(stringifyChecked({ ...doc, ...changes })),
      ).toThrow();
  });
  it('retains the existing profile1 validation for duplicate histories, roles, difficulty, ranks and limits', () => {
    const invalid = [
      (p: ReturnType<typeof profileFileFixture>) => {
        p.history.push(p.history[0]!);
      },
      (p: ReturnType<typeof profileFileFixture>) => {
        p.history[0]!.rank = 21;
      },
      (p: ReturnType<typeof profileFileFixture>) => {
        p.history[1]!.eliminationFloorIndex = 7;
      },
      (p: ReturnType<typeof profileFileFixture>) => {
        p.history = Array.from({ length: 201 }, (_, i) => ({
          ...p.history[0]!,
          key: String(i),
        }));
      },
      (p: ReturnType<typeof profileFileFixture>) => {
        p.progression.modules.large = Array(110).fill('x'.repeat(10000));
      },
    ];
    for (const mutate of invalid) {
      const profile = profileFileFixture();
      mutate(profile);
      expect(() => serializePlayerProfileBackup(profile)).toThrow();
    }
    const future = JSON.parse(fixtureSource());
    future.profile.version = 2;
    expect(() => parsePlayerProfileBackup(stringifyChecked(future))).toThrow(
      '玩家档案格式',
    );
  });
  it('rejects invalid JSON, unsafe keys and oversized transport before any restore', async () => {
    expect(() => parsePlayerProfileBackup('not-json')).toThrow('JSON');
    expect(() =>
      parsePlayerProfileBackup('{"__proto__":{"polluted":true}}'),
    ).toThrow();
    const doc = JSON.parse(fixtureSource());
    doc.profile.progression.modules.constructor = 'unsafe';
    expect(() => parsePlayerProfileBackup(stringifyChecked(doc))).toThrow();
    await expect(
      readPlayerProfileBackup(' '.repeat(maxFileBytes + 1)),
    ).rejects.toThrow('8 MiB');
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
  it('rejects non-finite values before JSON conversion can turn them into null', () => {
    const p = profileFileFixture();
    p.progression.modules.bad = Infinity;
    const storage = memory('original');
    expect(() => serializePlayerProfileBackup(p)).toThrow();
    expect(() => restorePlayerProfileBackup(storage, p, 'original')).toThrow();
    expect(storage.setItem).not.toHaveBeenCalled();
  });
  it('honors cancellation and missing compression/decompression support', async () => {
    const source = fixtureSource(),
      packed = await packDataFile(source),
      controller = new AbortController();
    controller.abort();
    await expect(
      readPlayerProfileBackup(packed.source, { signal: controller.signal }),
    ).rejects.toMatchObject({ name: 'AbortError' });
    vi.stubGlobal('CompressionStream', undefined);
    try {
      expect((await packDataFile(source)).source).toBe(source);
    } finally {
      vi.unstubAllGlobals();
    }
    vi.stubGlobal('DecompressionStream', undefined);
    try {
      await expect(readPlayerProfileBackup(packed.source)).rejects.toThrow(
        '不支持解压',
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });
  it('exports an explicitly empty profile when no saved profile exists, without writing a placeholder', () => {
    const storage = memory(),
      state = readPlayerProfileSnapshot(storage);
    expect(state.available).toBe(true);
    expect(state.source).toBeNull();
    expect(state.profile!.history).toHaveLength(0);
    expect(
      parsePlayerProfileBackup(serializePlayerProfileBackup(state.profile!))
        .profile,
    ).toEqual(state.profile);
    expect(storage.data.size).toBe(0);
    expect(storage.setItem).not.toHaveBeenCalled();
  });
  it('reports unreadable or corrupt local data as unknown, preserving the original source', () => {
    const storage = memory('broken-original'),
      snapshot = readPlayerProfileSnapshot(storage);
    expect(snapshot.profile).toBeNull();
    expect(snapshot.source).toBe('broken-original');
    expect(snapshot.message).toContain('原文保留');
    expect(readPlayerProfileSnapshot(null).available).toBe(false);
    storage.getItem.mockImplementation(() => {
      throw Error('blocked');
    });
    expect(readPlayerProfileSnapshot(storage).available).toBe(false);
    expect(storage.data.get(playerProfileKey)).toBe('broken-original');
  });
  it('replaces exactly one profile key and never merges histories or changes other storage', () => {
    const old = JSON.stringify(createPlayerProfile()),
      storage = memory(old);
    for (const key of [
      'bidding-classic-checkpoint-v5',
      'bidding-survival-checkpoint-v5',
      'bidding-classic-draft-v5',
      'bidding-ui-preferences-v1',
      'old-development-cache',
    ])
      storage.data.set(key, key + '-original');
    const others = new Map(
      [...storage.data].filter(([key]) => key !== playerProfileKey),
    );
    const result = restorePlayerProfileBackup(
      storage,
      profileFileFixture(),
      old,
    );
    expect(result.changed).toBe(true);
    expect(JSON.parse(storage.data.get(playerProfileKey)!)).toEqual(
      profileFileFixture(),
    );
    expect(
      new Map([...storage.data].filter(([key]) => key !== playerProfileKey)),
    ).toEqual(others);
    expect(storage.setItem.mock.calls).toEqual([
      [playerProfileKey, result.source],
    ]);
  });
  it('refuses a stale preview without overwriting a newly completed result', () => {
    const old = JSON.stringify(createPlayerProfile()),
      storage = memory(old),
      newer = JSON.stringify(profileFileFixture());
    storage.data.set(playerProfileKey, newer);
    expect(() =>
      restorePlayerProfileBackup(storage, createPlayerProfile(), old),
    ).toThrow(PlayerProfileChangedError);
    expect(storage.data.get(playerProfileKey)).toBe(newer);
    expect(storage.setItem).not.toHaveBeenCalled();
  });
  it('keeps the original on unavailable storage, blocked reads and quota failures', () => {
    expect(() =>
      restorePlayerProfileBackup(null, profileFileFixture(), null),
    ).toThrow('不可用');
    const storage = memory('old');
    storage.getItem.mockImplementation(() => {
      throw Error('denied');
    });
    expect(() =>
      restorePlayerProfileBackup(storage, profileFileFixture(), 'old'),
    ).toThrow('无法读取');
    storage.getItem.mockImplementation((key) => storage.data.get(key) ?? null);
    storage.setItem.mockImplementation(() => {
      throw new DOMException('full', 'QuotaExceededError');
    });
    expect(() =>
      restorePlayerProfileBackup(storage, profileFileFixture(), 'old'),
    ).toThrow('保存失败');
    expect(storage.data.get(playerProfileKey)).toBe('old');
  });
  it('does not rewrite an identical profile or mutate the candidate', () => {
    const profile = profileFileFixture(),
      source = JSON.stringify(profile),
      storage = memory(source);
    const result = restorePlayerProfileBackup(storage, profile, source);
    result.profile.history[0]!.rank = 10;
    expect(result.changed).toBe(false);
    expect(storage.setItem).not.toHaveBeenCalled();
    expect(profile.history[0]!.rank).toBe(1);
  });
  it('rejects profile files at raw and compressed game entrances without starting either engine', async () => {
    const c = vi.spyOn(classic, 'createGameSession'),
      cr = vi.spyOn(classic, 'reduceGameSession');
    const s = vi.spyOn(survival, 'startSurvivalGame'),
      sr = vi.spyOn(survival, 'survivalGameReducer');
    const source = fixtureSource();
    expect(() => parseModeDataFile(source, 'profile.json')).toThrow(
      '读取玩家档案文件',
    );
    await expect(
      readModeDataFile((await packDataFile(source)).source, 'profile.json'),
    ).rejects.toThrow('读取玩家档案文件');
    await readPlayerProfileBackup(source);
    expect(c).not.toHaveBeenCalled();
    expect(cr).not.toHaveBeenCalled();
    expect(s).not.toHaveBeenCalled();
    expect(sr).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });
  it('preserves three raw/packed/restored profile fixtures and verifies single-key restoration', async () => {
    const root = resolve('work/profile-backup-roundtrip');
    await mkdir(root, { recursive: true });
    const full = profileFileFixture();
    full.history = Array.from({ length: 200 }, (_, i) => ({
      ...full.history[i % 3]!,
      key: `retained-${i}`,
      replayId: `retained-${i}`,
    }));
    const profiles = {
      empty: createPlayerProfile(new Date('2026-10-14T00:00:00Z')),
      mixed: profileFileFixture(),
      retained200: full,
    };
    const report = [];
    for (const [name, profile] of Object.entries(profiles)) {
      const original = serializePlayerProfileBackup(
        profile,
        'profile-backup-roundtrip',
        new Date('2026-10-14T02:00:00Z'),
      );
      const packed = await packDataFile(original),
        restored = (await unpackDataFile(packed.source)).source;
      expect(restored).toBe(original);
      expect((await readPlayerProfileBackup(packed.source)).profile).toEqual(
        profile,
      );
      const storage = memory(),
        result = restorePlayerProfileBackup(
          storage,
          parsePlayerProfileBackup(restored).profile,
          null,
        );
      expect(JSON.parse(result.source)).toEqual(profile);
      expect(storage.setItem.mock.calls.map(([key]) => key)).toEqual([
        playerProfileKey,
      ]);
      for (const [kind, source] of Object.entries({
        original,
        compressed: packed.source,
        restored,
      }))
        await writeFile(resolve(root, `${name}.${kind}.json`), source);
      const digest = (source: string) =>
        createHash('sha256').update(source, 'utf8').digest('hex');
      report.push({
        name,
        records: profile.history.length,
        rawBytes: packed.originalBytes,
        fileBytes: packed.fileBytes,
        compressed: packed.compressed,
        originalSha256: digest(original),
        restoredSha256: digest(restored),
        sourceExact: true,
        profileExact: true,
        writeKeys: [playerProfileKey],
      });
    }
    await writeFile(
      resolve(root, 'report.json'),
      JSON.stringify(
        {
          fixtures: 'synthetic project test data, not newly played games',
          cases: report,
        },
        null,
        2,
      ),
    );
  });
});
