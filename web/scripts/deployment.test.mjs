import { mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import {
  normalizeWebBase,
  nginxConfiguration,
  runtimeDockerfile,
} from './deployment-config.mjs';
import {
  prepareDeployment,
  validatePublication,
  validateHostedHtml,
  writeWorkflowOutputs,
} from './prepare-deployment.mjs';
import { inside, verifyDeployment } from './verify-deployment.mjs';
import { verifyLiveDeployment } from './verify-live-deployment.mjs';
import { readSourceBuild } from './source-build.mjs';
import { createOfflineHtml, assertStandaloneHtml } from './offline-html.mjs';
import { writeOfflineArtifacts } from './release-artifacts.mjs';
import { recordWebArtifact } from './web-artifact.mjs';

const root = resolve('.');
const work = resolve(root, 'work');
const commit = 'a'.repeat(40);
const validation = {
  tests: { passed: 1, skipped: 0 },
  lint: 'passed',
  types: 'passed',
  webBuild: 'passed',
  offlineContract: 'passed',
  manualAcceptance: 'pending-user-feedback',
};
async function fixture(base = '/', dirty = false) {
  const path = resolve(work, `deployment-test-${randomUUID()}`);
  for (const name of [
    'app',
    'components',
    'lib',
    'assets',
    'scripts',
    'dist/assets',
  ])
    await mkdir(resolve(path, name), { recursive: true });
  const version = '0.2.5';
  const config = {
    engineVersion: '20-personality-client-1',
    saveFormatVersion: 2,
    replayFormatVersion: 2,
  };
  const notes = [
    {
      version,
      date: '2026-10-12',
      title: 'test',
      highlights: ['delivery'],
      compatibility: 'v1 unchanged',
    },
  ];
  for (const [name, data] of Object.entries({
    'package.json': { version },
    'package-lock.json': { version },
    'release-config.json': config,
    'release-notes.json': notes,
  }))
    await writeFile(resolve(path, name), JSON.stringify(data));
  for (const name of ['main.tsx', 'vite.config.ts'])
    await writeFile(resolve(path, name), '// fixture');
  const template =
    '<!doctype html><html><head><meta charset="UTF-8"><title>test</title><link rel="icon" type="image/svg+xml" href="/favicon.svg"><script type="module" src="/main.tsx"></script></head><body><div id="root"></div></body></html>';
  await writeFile(resolve(path, 'index.html'), template);
  const identity = readSourceBuild(path);
  await writeFile(
    resolve(path, 'dist/index.html'),
    `<html><head><meta name="bidding-web-build" content="${identity}"><link rel="stylesheet" href="${base}assets/test.css"><link rel="icon" href="${base}favicon.svg"></head><body><script src="${base}assets/test.js"></script></body></html>`,
  );
  await writeFile(resolve(path, 'dist/assets/test.js'), 'console.log("game")');
  await writeFile(resolve(path, 'dist/assets/test.css'), 'body{color:white}');
  await writeFile(resolve(path, 'dist/favicon.svg'), '<svg/>');
  const offline = createOfflineHtml({
    template,
    favicon: '<svg xmlns="http://www.w3.org/2000/svg"/>',
    version,
    javascript: '(()=>{})();',
    styles: 'body{color:white}',
  });
  const bundle = {
    ...offline,
    version,
    release: notes[0],
    compatibility: config,
  };
  const source = { commit, dirty };
  const result = await writeOfflineArtifacts(path, bundle, {
    validation,
    webArtifact: await recordWebArtifact(path, base),
    source,
    now: new Date('2026-10-12T00:00:00Z'),
  });
  return { path, source, result, base };
}
async function prepared(base = '/', dirty = false) {
  const f = await fixture(base, dirty);
  return {
    ...f,
    ...(await prepareDeployment({
      root: f.path,
      base,
      source: f.source,
      requireClean: !dirty,
      expectedCommit: commit,
    })),
  };
}
async function removeOwned(path) {
  const resolved = resolve(path);
  if (!resolved.startsWith(work + sep))
    throw new Error('Not an owned test directory');
  await rm(resolved, { recursive: true, force: true });
}

describe('deployment paths, provenance and delivery identity', () => {
  it.each([
    ['/', '/'],
    ['/repo', '/repo/'],
    ['/repo/', '/repo/'],
    ['/a/b-c_1/', '/a/b-c_1/'],
  ])('normalizes %s', (input, expected) =>
    expect(normalizeWebBase(input)).toBe(expected),
  );
  it.each([
    'https://example.test/',
    'repo',
    '//repo/',
    '/../',
    '/a/../',
    '/a//b/',
    '/a?x/',
    '/a#x/',
    '/a%2fb/',
    '/a\\b/',
    '/a;return 200/',
    '/a\n/',
  ])('rejects directive or URL base %s', (value) =>
    expect(() => normalizeWebBase(value)).toThrow(),
  );
  it('uses root/subdirectory runtime layouts, an explicit health endpoint and different cache policies', async () => {
    expect(await readFile(resolve(root, '../nginx.conf'), 'utf8')).toBe(
      nginxConfiguration('/'),
    );
    const sub = nginxConfiguration('/repo/');
    expect(sub).toContain('location /repo/assets/');
    expect(sub).toContain('try_files $uri $uri/ /repo/index.html;');
    expect(sub).toContain('location = /healthz');
    expect(sub).toContain('Cache-Control "no-cache"');
    expect(runtimeDockerfile('/repo/', '0.2.5', commit)).toContain(
      'FROM ${NGINX_IMAGE}',
    );
    expect(runtimeDockerfile('/repo/', '0.2.5', commit)).toContain(
      '/usr/share/nginx/html/repo/',
    );
    expect(await readFile(resolve(root, '../.dockerignore'), 'utf8')).toContain(
      'web/work',
    );
  });
  it('requires successful gates, matching commits and clean source only for publication', () => {
    const manifest = { validation, source: { commit, dirty: false } };
    expect(
      validatePublication(manifest, manifest.source, {
        requireClean: true,
        expectedCommit: commit,
      }),
    ).toBe(true);
    expect(() =>
      validatePublication({ ...manifest, validation: null }, manifest.source),
    ).toThrow('门禁');
    expect(() =>
      validatePublication(manifest, { commit: 'b'.repeat(40), dirty: false }),
    ).toThrow('不一致');
    expect(() =>
      validatePublication(manifest, manifest.source, {
        expectedCommit: 'b'.repeat(40),
      }),
    ).toThrow('不是');
    const dirty = { ...manifest, source: { commit, dirty: true } };
    expect(validatePublication(dirty, dirty.source)).toBe(false);
    expect(() =>
      validatePublication(dirty, dirty.source, { requireClean: true }),
    ).toThrow('已提交');
    expect(() =>
      validatePublication(
        { ...manifest, validation: { ...validation, types: 'failed' } },
        manifest.source,
      ),
    ).toThrow();
  });
  it.each(['/', '/repo/'])(
    'packages matching web, portable HTML and container bytes under %s',
    async (base) => {
      const f = await prepared(base);
      const m = await verifyDeployment(f.directory, {
        requirePublishable: true,
        expectedCommit: commit,
      });
      expect(m.base).toBe(base);
      expect(m.publishable).toBe(true);
      expect(
        await readFile(
          resolve(f.directory, `site/downloads/${m.offlineFilename}`),
        ),
      ).toEqual(await readFile(f.result.htmlPath));
      expect(
        await readFile(
          resolve(f.directory, 'site/downloads/index.html'),
          'utf8',
        ),
      ).toContain(encodeURIComponent(m.offlineFilename));
      expect(
        await readFile(resolve(f.directory, 'container/site/index.html')),
      ).toEqual(await readFile(resolve(f.directory, 'site/index.html')));
      const again = await prepareDeployment({
        root: f.path,
        base,
        source: f.source,
        requireClean: true,
      });
      expect(again.directory).toBe(f.directory);
      const outputs = resolve(f.path, 'outputs.txt');
      await writeWorkflowOutputs(f, outputs);
      expect(await readFile(outputs, 'utf8')).toContain(
        `deployment_id=${m.deploymentId}`,
      );
    },
  );
  it('keeps dirty developer packages usable while preventing remote publication', async () => {
    const f = await prepared('/', true);
    expect(f.manifest.publishable).toBe(false);
    await expect(
      verifyDeployment(f.directory, { requirePublishable: true }),
    ).rejects.toThrow('未提交');
    await expect(
      prepareDeployment({ root: f.path, source: f.source, requireClean: true }),
    ).rejects.toThrow('已提交');
  });
  it('detects changed source even if commit and dirty status remain identical', async () => {
    const f = await fixture('/', true);
    await writeFile(
      resolve(f.path, 'lib/changed.ts'),
      'export const changed=1;',
    );
    await expect(
      prepareDeployment({ root: f.path, source: f.source }),
    ).rejects.toThrow('构建输入');
  });
  it('rejects edited normal web assets even when their source-build meta is unchanged', async () => {
    const f = await fixture();
    await writeFile(
      resolve(f.path, 'dist/assets/test.js'),
      'not-the-gated-build',
    );
    await expect(
      prepareDeployment({ root: f.path, source: f.source }),
    ).rejects.toThrow('网页资源');
  });
  it('requires the original web file evidence, not only an offline success flag', async () => {
    const f = await fixture();
    const path = resolve(f.path, 'dist-offline/build-manifest.json');
    const manifest = JSON.parse(await readFile(path, 'utf8'));
    delete manifest.webArtifact;
    await writeFile(path, JSON.stringify(manifest));
    await expect(
      prepareDeployment({ root: f.path, source: f.source }),
    ).rejects.toThrow('文件清单');
  });
  it('rejects an incorrect hosted base and altered offline bytes', async () => {
    const f = await fixture('/repo/');
    await expect(
      prepareDeployment({ root: f.path, base: '/', source: f.source }),
    ).rejects.toThrow('base');
    await writeFile(f.result.htmlPath, 'changed');
    await expect(
      prepareDeployment({ root: f.path, base: '/repo/', source: f.source }),
    ).rejects.toThrow('离线文件');
    expect(() =>
      validateHostedHtml('<script src="/assets/x.js"></script>', '/', '0.2.5'),
    ).toThrow('标识');
  });
  it.each([
    'site/assets/test.js',
    'container/site/assets/test.js',
    'site/deployment.json',
  ])(
    'rejects tampered payload %s and does not silently repair historical packages',
    async (name) => {
      const f = await prepared();
      await writeFile(resolve(f.directory, name), 'changed');
      await expect(verifyDeployment(f.directory)).rejects.toThrow();
      await expect(
        prepareDeployment({ root: f.path, source: f.source }),
      ).rejects.toThrow();
    },
  );
  it('rejects additional files and traversal references', async () => {
    const f = await prepared();
    await writeFile(resolve(f.directory, 'extra-secret.txt'), 'extra');
    await expect(verifyDeployment(f.directory)).rejects.toThrow('额外');
    for (const name of [
      '../outside',
      '/outside',
      'C:/outside',
      'a\\b',
      'a/../b',
    ])
      expect(() => inside(f.directory, name)).toThrow();
  });
  it('verifies an actual short-lived loopback HTTP server and closes it after the check', async () => {
    const f = await prepared('/repo/');
    const server = createServer(async (request, response) => {
      try {
        const pathname = new URL(request.url, 'http://127.0.0.1').pathname;
        if (!pathname.startsWith('/repo/')) {
          response.writeHead(404);
          response.end();
          return;
        }
        const name =
          decodeURIComponent(pathname.slice('/repo/'.length)) || 'index.html';
        const body = await readFile(
          inside(
            resolve(f.directory, 'site'),
            name.endsWith('/') ? name + 'index.html' : name,
          ),
        );
        response.writeHead(200);
        response.end(body);
      } catch {
        response.writeHead(404);
        response.end();
      }
    });
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    try {
      const address = server.address();
      const checked = await verifyLiveDeployment(
        f.directory,
        `http://127.0.0.1:${address.port}/repo/`,
      );
      expect(checked.deploymentId).toBe(f.manifest.deploymentId);
    } finally {
      await new Promise((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });
  it('verifies served version, JS/CSS and download links, not just a 200 status', async () => {
    const f = await prepared('/repo/');
    const serve = async (address) => {
      const url = new URL(address);
      const path =
        decodeURIComponent(url.pathname.slice('/repo/'.length)) || 'index.html';
      const bytes = await readFile(
        resolve(
          f.directory,
          'site',
          path.endsWith('/') ? path + 'index.html' : path,
        ),
      );
      return new Response(bytes, { status: 200 });
    };
    expect(
      (
        await verifyLiveDeployment(
          f.directory,
          'https://example.test/repo/',
          serve,
        )
      ).deploymentId,
    ).toBe(f.manifest.deploymentId);
    await expect(
      verifyLiveDeployment(
        f.directory,
        'https://example.test/repo/',
        async (address) =>
          new URL(address).pathname.endsWith('deployment.json')
            ? new Response('{"version":"old"}')
            : serve(address),
      ),
    ).rejects.toThrow('旧版本');
    await expect(
      verifyLiveDeployment(
        f.directory,
        'https://example.test/repo/',
        async (address) =>
          new URL(address).pathname.endsWith('.js')
            ? new Response('wrong')
            : serve(address),
      ),
    ).rejects.toThrow('内容不一致');
  });
});

describe('manual-only publication workflows', () => {
  it('parses both YAML workflows with read-only CI and explicit manual publish targets', async () => {
    const ci = parse(
      await readFile(resolve(root, '../.github/workflows/ci.yml'), 'utf8'),
    );
    const publish = parse(
      await readFile(resolve(root, '../.github/workflows/publish.yml'), 'utf8'),
    );
    expect(ci.permissions).toEqual({ contents: 'read' });
    expect(ci.on).toHaveProperty('pull_request');
    expect(Object.keys(publish.on)).toEqual(['workflow_dispatch']);
    expect(publish.on.workflow_dispatch.inputs.target.default).toBe('package');
    expect(publish.on.workflow_dispatch.inputs.expected_version.default).toBe(
      '0.2.11',
    );
    expect(publish.jobs.pages.permissions).toEqual({
      contents: 'read',
      pages: 'write',
      'id-token': 'write',
    });
    expect(publish.jobs.image.permissions.packages).toBe('write');
    expect(publish.jobs.draft_release.steps.at(-1).run).toContain('--draft');
    for (const workflow of [ci, publish])
      for (const job of Object.values(workflow.jobs))
        for (const step of job.steps)
          if (step.uses) expect(step.uses).toMatch(/@[a-f0-9]{40}$/);
    const json = JSON.stringify(publish);
    expect(json).not.toContain('pull_request_target');
    expect(json).toContain('--require-publishable');
    expect(json).toContain('verify-live-deployment.mjs');
    expect(json).not.toContain(':latest');
  });
  it('uses the already-validated container context and records the resolved runtime/image digests', async () => {
    const workflow = parse(
      await readFile(resolve(root, '../.github/workflows/publish.yml'), 'utf8'),
    );
    const command = workflow.jobs.image.steps.find((s) =>
      s.name?.startsWith('Build exact'),
    ).run;
    expect(command).toContain('package/container');
    expect(command).toContain('--build-arg "NGINX_IMAGE=$runtime"');
    expect(command).toContain('verify-live-deployment.mjs');
    expect(command).toContain('image-build.json');
    expect(command).not.toContain('npm ci');
    expect(command).not.toContain('npm run build');
  });
});

it('builds the actual desktop entry in a hosted subdirectory while offline HTML stays portable', async () => {
  const path = resolve(work, `deployment-build-${randomUUID()}`);
  await mkdir(path, { recursive: true });
  const before = await readFile(resolve(root, 'dist/index.html')).catch(
    () => null,
  );
  const result = spawnSync(
    process.execPath,
    [
      resolve(root, 'node_modules/vite/bin/vite.js'),
      'build',
      '--outDir',
      resolve(path, 'dist'),
    ],
    {
      cwd: root,
      encoding: 'utf8',
      windowsHide: true,
      env: { ...process.env, BIDDING_WEB_BASE: '/desktop-preview/' },
      maxBuffer: 4 * 1024 * 1024,
    },
  );
  expect(result.status, result.stderr).toBe(0);
  const html = await readFile(resolve(path, 'dist/index.html'), 'utf8');
  expect(html).toContain('/desktop-preview/assets/');
  expect(html).toContain('/desktop-preview/favicon.svg');
  expect(html).toContain(`content="${readSourceBuild(root)}"`);
  expect(
    await readFile(resolve(root, 'dist/index.html')).catch(() => null),
  ).toEqual(before);
  const template = await readFile(resolve(root, 'index.html'), 'utf8');
  const fixtureHtml = createOfflineHtml({
    template,
    favicon: '<svg xmlns="http://www.w3.org/2000/svg"/>',
    version: '0.2.5',
    javascript: '(()=>{})();',
    styles: 'body{}',
  }).html;
  expect(() => assertStandaloneHtml(fixtureHtml)).not.toThrow();
  expect(fixtureHtml).not.toContain('/desktop-preview/');
  await removeOwned(path);
}, 30000);
