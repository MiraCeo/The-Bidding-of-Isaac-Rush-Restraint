import { expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve, relative } from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { writeOfflineArtifacts } from './release-artifacts.mjs';
import {
  verifyOffline,
  verifyDeliveryDocumentation,
} from './verify-offline.mjs';
const doc =
  '当前交付目录：`web/dist-offline/`。\n固定入口：`web/dist-offline/以撒的竞合.html`。\n历史releases资料可以保留。';
async function fixture() {
  await mkdir(resolve('work'), { recursive: true });
  const project = await mkdtemp(resolve('work/offline-verify-')),
    root = resolve(project, 'web');
  await mkdir(root);
  await mkdir(resolve(project, 'docs/开发'), { recursive: true });
  const version = '0.5.0',
    buildId = 'abcdef123456',
    release = {
      version,
      date: '2026-10-15',
      title: '交付',
      highlights: ['目录'],
      compatibility: 'v5',
    };
  const compatibility = {
    engineVersion: '20-personality-client-1',
    saveFormatVersion: 5,
    replayFormatVersion: 5,
  };
  for (const [name, value] of [
    ['package.json', { version }],
    ['release-notes.json', [release]],
    ['release-config.json', compatibility],
  ])
    await writeFile(resolve(root, name), JSON.stringify(value));
  await writeFile(resolve(project, 'README.md'), doc);
  await writeFile(resolve(project, 'docs/开发/0.5.0使用与交付说明.md'), doc);
  const html = `<html><head><meta name="bidding-offline-build" content="${version}-${buildId}"></head><body><div id="root">fixture</div></body></html>`;
  const output = await writeOfflineArtifacts(
    root,
    { version, buildId, html, compatibility, release },
    {
      source: { commit: 'a'.repeat(40), dirty: false },
      now: new Date('2026-10-15T00:00:00Z'),
    },
  );
  await writeFile(resolve(output.directory, 'old-version.html'), 'historical');
  return { root, project, ...output };
}
async function rewriteManifest(f, update) {
  const path = resolve(f.directory, 'build-manifest.json'),
    m = JSON.parse(await readFile(path, 'utf8'));
  update(m);
  await writeFile(path, JSON.stringify(m));
}
async function snapshot(root) {
  const files = {};
  async function walk(dir) {
    for (const e of await readdir(dir, { withFileTypes: true })) {
      const p = resolve(dir, e.name);
      if (e.isDirectory()) await walk(p);
      else
        files[relative(root, p)] = createHash('sha256')
          .update(await readFile(p))
          .digest('hex');
    }
  }
  await walk(root);
  return files;
}
it('checks the current delivery without writes, touching history, or treating historical mentions as a current route', async () => {
  const f = await fixture(),
    before = await snapshot(f.project);
  expect(await verifyOffline(f.root)).toMatchObject({
    version: '0.5.0',
    buildId: 'abcdef123456',
    aliasMatches: true,
    documents: 'passed',
    validationRecordPresent: false,
  });
  expect(await snapshot(f.project)).toEqual(before);
});
it.each(['README.md', 'docs/开发/0.5.0使用与交付说明.md'])(
  'rejects wrong current directory in %s but does not repair it',
  async (name) => {
    const f = await fixture(),
      p = resolve(f.project, name);
    await writeFile(p, doc.replace('web/dist-offline/`', 'web/releases/`'));
    const before = await snapshot(f.project);
    await expect(verifyOffline(f.root)).rejects.toThrow('当前交付目录');
    expect(await snapshot(f.project)).toEqual(before);
  },
);
it.each(['missing', 'duplicate', 'wrong-alias'])(
  'requires unique normative documentation fields: %s',
  (kind) => {
    const changed =
      kind === 'missing'
        ? doc.replace('固定入口：', '其他入口：')
        : kind === 'duplicate'
          ? doc + '\n' + doc
          : doc.replace(
              'web/dist-offline/以撒的竞合.html',
              'web/dist/index.html',
            );
    expect(() => verifyDeliveryDocumentation(changed)).toThrow();
  },
);
it('will not fall back to releases when current alias or manifest is absent', async () => {
  const f = await fixture();
  await mkdir(resolve(f.root, 'releases'), { recursive: true });
  await writeFile(resolve(f.directory, 'build-manifest.json'), '');
  await expect(verifyOffline(f.root)).rejects.toThrow('有效JSON');
});
it.each(['version', 'filename', 'entry', 'hash', 'size', 'compatibility'])(
  'refuses inconsistent manifest field %s',
  async (kind) => {
    const f = await fixture();
    await rewriteManifest(f, (m) => {
      if (kind === 'version') m.version = '0.4.11';
      if (kind === 'filename') m.artifact.filename = '../outside.html';
      if (kind === 'entry') m.entryAlias = 'other.html';
      if (kind === 'hash') m.artifact.sha256 = '0'.repeat(64);
      if (kind === 'size') m.artifact.bytes++;
      if (kind === 'compatibility') m.compatibility.saveFormatVersion = 4;
    });
    await expect(verifyOffline(f.root)).rejects.toThrow();
  },
);
it('refuses an old alias even when the current versioned file and checksum are valid', async () => {
  const f = await fixture();
  await writeFile(resolve(f.directory, '以撒的竞合.html'), 'old');
  await expect(verifyOffline(f.root)).rejects.toThrow('不是同一内容');
});
it.each(['checksum', 'guide', 'head'])(
  'detects stale or tampered %s',
  async (kind) => {
    const f = await fixture();
    if (kind === 'checksum')
      await writeFile(resolve(f.directory, 'SHA256SUMS.txt'), 'bad');
    if (kind === 'guide')
      await writeFile(resolve(f.directory, '更新与使用说明.md'), 'old guide');
    if (kind === 'head') {
      const body = (await readFile(f.htmlPath, 'utf8')).replace(
        '0.5.0-abcdef123456',
        '0.4.11-abcdef123456',
      );
      await writeFile(f.htmlPath, body);
      await writeFile(resolve(f.directory, '以撒的竞合.html'), body);
      await rewriteManifest(f, (m) => {
        m.artifact.bytes = Buffer.byteLength(body);
        m.artifact.sha256 = createHash('sha256').update(body).digest('hex');
      });
    }
    await expect(verifyOffline(f.root)).rejects.toThrow();
  },
);
it('CLI refuses an alternate output directory rather than checking an old release as current', () => {
  expect(() =>
    execFileSync(
      process.execPath,
      [
        fileURLToPath(new URL('./verify-offline.mjs', import.meta.url)),
        '--directory',
        'releases',
      ],
      { encoding: 'utf8', windowsHide: true, stdio: 'pipe' },
    ),
  ).toThrow();
});
