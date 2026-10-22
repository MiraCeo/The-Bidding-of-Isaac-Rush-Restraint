import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  createArtifactManifest,
  validateReleaseInputs,
  versionedHtmlName,
  writeOfflineArtifacts,
  releaseReadme,
} from './release-artifacts.mjs';
import { runReleaseGates } from './build-release.mjs';

const version = '0.2.0',
  buildId = 'abcdef123456';
const config = {
  engineVersion: '20-personality-client-1',
  saveFormatVersion: 5,
  replayFormatVersion: 5,
};
const notes = [
  {
    version,
    date: '2026-10-11',
    title: '教程',
    highlights: ['独立教学'],
    compatibility: 'v1兼容',
  },
];
const bundle = {
  ...validateReleaseInputs({ version }, notes, config),
  buildId,
  html: `<meta name="bidding-offline-build" content="${version}-${buildId}"><p>离线</p>`,
};
const source = { commit: 'a'.repeat(40), dirty: true };
const now = new Date('2026-10-11T00:00:00Z');

describe('release identity and offline deliverables', () => {
  it('uses safe versioned filenames and rejects path-bearing identity', () => {
    expect(versionedHtmlName(version, buildId)).toBe(
      '以撒的竞合-0.2.0-abcdef123456.html',
    );
    expect(() => versionedHtmlName('../outside', buildId)).toThrow();
    expect(() => versionedHtmlName(version, '../outside')).toThrow();
  });
  it('requires matching package/update versions and valid compatibility', () => {
    expect(validateReleaseInputs({ version }, notes, config).release).toEqual(
      notes[0],
    );
    expect(() =>
      validateReleaseInputs({ version: '0.3.0' }, notes, config),
    ).toThrow('不一致');
    expect(() =>
      validateReleaseInputs({ version }, [...notes, ...notes], config),
    ).toThrow('重复');
    expect(() =>
      validateReleaseInputs({ version }, notes, {
        ...config,
        saveFormatVersion: 999,
      }),
    ).toThrow('协议');
    expect(
      validateReleaseInputs({ version }, notes, config).compatibility
        .saveFormatVersion,
    ).toBe(5);
    for (const old of [1, 2, 3, 4])
      expect(() =>
        validateReleaseInputs({ version }, notes, {
          ...config,
          saveFormatVersion: old,
          replayFormatVersion: old,
        }),
      ).toThrow('协议');
    expect(() =>
      validateReleaseInputs({ version }, notes, {
        ...config,
        saveFormatVersion: 1,
      }),
    ).toThrow('协议');
    expect(() =>
      validateReleaseInputs(
        { version },
        [{ ...notes[0], compatibility: '' }],
        config,
      ),
    ).toThrow();
  });
  it('records actual bytes, full SHA256, compatibility and dirty source without claiming manual acceptance', () => {
    const manifest = createArtifactManifest(bundle, { source, now });
    expect(manifest.artifact.bytes).toBe(Buffer.byteLength(bundle.html));
    expect(manifest.artifact.sha256).toBe(
      createHash('sha256').update(bundle.html).digest('hex'),
    );
    expect(manifest.source).toEqual(source);
    expect(manifest.validation).toBeNull();
    expect(releaseReadme(manifest)).toContain('不能把它记为全量发布门禁通过');
    expect(releaseReadme(manifest)).toContain('未提交');
    expect(releaseReadme(manifest)).toContain('进度 → 存档与备份');
    expect(() =>
      createArtifactManifest(
        { ...bundle, buildId: '000000000000' },
        { source },
      ),
    ).toThrow('不一致');
  });
  it('writes stable alias and exact versioned bytes without modifying normal dist or game saves', async () => {
    const root = resolve('work', 'release-test-alias');
    await mkdir(resolve(root, 'dist'), { recursive: true });
    await writeFile(
      resolve(root, 'dist', 'index.html'),
      'normal dist untouched',
    );
    const output = await writeOfflineArtifacts(root, bundle, { source, now });
    expect(await readFile(output.htmlPath, 'utf8')).toBe(bundle.html);
    expect(
      await readFile(resolve(output.directory, '以撒的竞合.html'), 'utf8'),
    ).toBe(bundle.html);
    expect(
      JSON.parse(
        await readFile(
          resolve(output.directory, 'build-manifest.json'),
          'utf8',
        ),
      ).version,
    ).toBe(version);
    expect(await readFile(resolve(root, 'dist', 'index.html'), 'utf8')).toBe(
      'normal dist untouched',
    );
  });
  it('keeps versioned releases, checksums and rebuild records, and refuses a different payload under the same identity', async () => {
    const root = resolve('work', 'release-test-records');
    const validation = {
      tests: { passed: 330, skipped: 5 },
      manualAcceptance: 'pending-user-feedback',
    };
    const first = await writeOfflineArtifacts(root, bundle, {
      source,
      now,
      release: true,
      validation,
    });
    await writeOfflineArtifacts(root, bundle, {
      source: { ...source, dirty: false },
      now: new Date('2026-10-11T01:00:00Z'),
      release: true,
      validation,
    });
    expect(
      (await readdir(first.directory)).filter((name) =>
        name.startsWith('build-record-'),
      ),
    ).toHaveLength(2);
    expect(
      await readFile(resolve(first.directory, 'SHA256SUMS.txt'), 'utf8'),
    ).toContain(first.manifest.artifact.sha256);
    expect(releaseReadme(first.manifest)).toContain('真实界面');
    await expect(
      writeOfflineArtifacts(
        root,
        { ...bundle, html: bundle.html + 'tampered' },
        { source, now, release: true },
      ),
    ).rejects.toThrow('不能覆盖');
    expect(await readFile(first.htmlPath, 'utf8')).toBe(bundle.html);
  });
});
describe('release quality gates', () => {
  it('uses an isolated Vite CLI for the normal build before the later library build', async () => {
    const run = vi
      .fn()
      .mockImplementation(async (_package, bin) =>
        bin === 'vitest' ? 'Tests 1 passed' : '',
      );
    await runReleaseGates({ run });
    expect(run.mock.calls.map((call) => call[1])).toEqual([
      'vitest',
      'oxlint',
      'tsc',
      'vite',
    ]);
    expect(run).toHaveBeenLastCalledWith('vite', 'vite', ['build']);
  });
  it('does not return a successful gate record when normal web compilation fails', async () => {
    const run = vi.fn().mockResolvedValue('Tests 1 passed');
    const buildWeb = vi.fn().mockRejectedValue(new Error('web failed'));
    await expect(runReleaseGates({ run, buildWeb })).rejects.toThrow(
      'web failed',
    );
  });
  it('runs tests, scoped lint, types and web build with explicit status', async () => {
    const run = vi
      .fn()
      .mockImplementation(async (_package, bin) =>
        bin === 'vitest'
          ? '\u001b[32m Tests 330 passed | 5 skipped (335)\u001b[0m'
          : '',
      );
    const buildWeb = vi.fn().mockResolvedValue({});
    const validation = await runReleaseGates({ run, buildWeb });
    expect(run.mock.calls.map((call) => call[1])).toEqual([
      'vitest',
      'oxlint',
      'tsc',
    ]);
    expect(buildWeb).toHaveBeenCalledOnce();
    expect(validation.tests).toEqual({ passed: 330, skipped: 5 });
    expect(validation.manualAcceptance).toBe('pending-user-feedback');
    expect(validation).not.toHaveProperty('offlineContract');
  });
  it.each(['vitest', 'oxlint', 'tsc'])(
    'stops after a %s failure before web build or publication',
    async (failed) => {
      const run = vi.fn().mockImplementation(async (_package, bin) => {
        if (bin === failed) throw new Error('failed');
        return bin === 'vitest' ? 'Tests 1 passed' : '';
      });
      const buildWeb = vi.fn();
      await expect(runReleaseGates({ run, buildWeb })).rejects.toThrow(
        'failed',
      );
      expect(buildWeb).not.toHaveBeenCalled();
    },
  );
  it('does not label an unrecognized test result as passed', async () => {
    const run = vi.fn().mockResolvedValue('unknown output');
    const buildWeb = vi.fn();
    await expect(runReleaseGates({ run, buildWeb })).rejects.toThrow(
      '没有取得',
    );
    expect(run).toHaveBeenCalledOnce();
    expect(buildWeb).not.toHaveBeenCalled();
  });
});
