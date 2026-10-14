import {
  mkdir,
  readFile,
  writeFile,
  copyFile,
  appendFile,
  lstat,
} from 'node:fs/promises';
import { resolve, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  normalizeWebBase,
  nginxConfiguration,
  runtimeDockerfile,
} from './deployment-config.mjs';
import {
  filesIn,
  fileRecord,
  hashBytes,
  inside,
  verifyDeployment,
} from './verify-deployment.mjs';
import {
  readReleaseInputs,
  sourceProvenance,
  versionedHtmlName,
} from './release-artifacts.mjs';
import { assertStandaloneHtml } from './offline-html.mjs';
import { readSourceBuild } from './source-build.mjs';

const defaultRoot = fileURLToPath(new URL('..', import.meta.url));
async function checkOutputParents(root, directory) {
  let current = resolve(root);
  const path = relative(current, directory);
  if (path.startsWith('..') || path.startsWith(sep))
    throw new Error('交付目录越界。');
  for (const part of ['', ...path.split(sep)]) {
    if (part) current = resolve(current, part);
    const info = await lstat(current).catch((error) => {
      if (error.code === 'ENOENT') return null;
      throw error;
    });
    if (info && (info.isSymbolicLink() || !info.isDirectory()))
      throw new Error('交付目录不能经过符号链接或文件。');
  }
}
const escape = (value) =>
  String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
export function validatePublication(
  manifest,
  source,
  { requireClean = false, expectedCommit } = {},
) {
  const gate = manifest.validation;
  if (
    !gate ||
    !Number.isInteger(gate.tests?.passed) ||
    gate.tests.passed < 1 ||
    ['lint', 'types', 'webBuild', 'offlineContract'].some(
      (field) => gate[field] !== 'passed',
    )
  )
    throw new Error('交付需要完整且成功的发布门禁。');
  if (
    source.commit !== manifest.source?.commit ||
    source.dirty !== manifest.source?.dirty
  )
    throw new Error('源码状态与已验证产物不一致，请重新构建。');
  if (source.commit !== null && !/^[a-f0-9]{40}$/.test(source.commit))
    throw new Error('提交标识无效。');
  if (expectedCommit && source.commit !== expectedCommit)
    throw new Error('当前提交不是要求发布的提交。');
  const publishable =
    source.dirty === false && /^[a-f0-9]{40}$/.test(source.commit ?? '');
  if (requireClean && !publishable)
    throw new Error('远端发布需要已提交且来源明确的源码；本地预览不自动发布。');
  return publishable;
}
export function validateHostedHtml(html, base, version) {
  const identity = html.match(
    /name="bidding-web-build"\s+content="([^"]+)"/,
  )?.[1];
  if (
    !identity?.startsWith(`${version}-web-`) ||
    !/^[a-z0-9.-]+-web-[a-f0-9]{12}$/.test(identity)
  )
    throw new Error('网页缺少正确的构建标识。');
  const refs = [
    ...html.matchAll(/<(?:script|link)\b[^>]*(?:src|href)="([^"]+)"/g),
  ].map((m) => m[1]);
  if (
    !refs.some(
      (path) => path.startsWith(`${base}assets/`) && path.endsWith('.js'),
    ) ||
    refs.some((path) => !path.startsWith(base) || /^https?:/.test(path))
  )
    throw new Error('网页资源路径与部署base不一致。');
  return { identity, refs };
}
export function downloadsPage(manifest) {
  return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>以撒的竞合 ${escape(manifest.version)} 下载</title><style>body{max-width:880px;margin:48px auto;padding:0 24px;background:#100e0c;color:#f6ead8;font-family:system-ui;line-height:1.8}a{color:#edaf3d}code{overflow-wrap:anywhere}h1{font-size:28px}li{margin:14px 0}</style><h1>以撒的竞合 ${escape(manifest.version)}</h1><p>离线构建：<code>${escape(manifest.buildId)}</code> · ${manifest.source.dirty === false ? '已提交源码' : '开发预览，含未提交内容'}</p><ul><li><a href="${encodeURIComponent(manifest.artifact.filename)}" download>下载单文件离线HTML</a></li><li><a href="SHA256SUMS.txt">SHA256校验值</a></li><li><a href="offline-manifest.json">原始离线交付清单</a></li><li><a href="更新与使用说明.md">更新与存档说明</a></li><li><a href="../">返回在线游戏</a></li></ul><p>网页与离线版使用同一版本。存档／回放是独立JSON文件；更换入口或设备时先导出，再从设置读取，不提供云端自动同步。</p></html>`;
}
export async function prepareDeployment({
  root = defaultRoot,
  base = process.env.BIDDING_WEB_BASE ?? '/',
  requireClean = false,
  expectedCommit = process.env.BIDDING_EXPECTED_SHA,
  source,
} = {}) {
  base = normalizeWebBase(base);
  const metadata = await readReleaseInputs(root);
  const manifest = JSON.parse(
    await readFile(resolve(root, 'dist-offline/build-manifest.json'), 'utf8'),
  );
  if (
    manifest.version !== metadata.version ||
    manifest.artifact.filename !==
      versionedHtmlName(manifest.version, manifest.buildId)
  )
    throw new Error('离线产物与源码版本不一致。');
  const publishable = validatePublication(
    manifest,
    source ?? sourceProvenance(root),
    { requireClean, expectedCommit },
  );
  const offline = await readFile(
    inside(resolve(root, 'dist-offline'), manifest.artifact.filename),
  );
  if (
    offline.length !== manifest.artifact.bytes ||
    hashBytes(offline) !== manifest.artifact.sha256
  )
    throw new Error('离线文件与交付清单不一致。');
  assertStandaloneHtml(offline.toString('utf8'));
  const webHtml = await readFile(resolve(root, 'dist/index.html'), 'utf8');
  const hosted = validateHostedHtml(webHtml, base, metadata.version);
  if (hosted.identity !== readSourceBuild(root))
    throw new Error('网页产物与当前构建输入不一致，请重新构建。');
  const webFiles = await filesIn(resolve(root, 'dist'));
  const proof = manifest.webArtifact;
  if (
    !proof ||
    proof.base !== base ||
    proof.sourceBuild !== hosted.identity ||
    !Array.isArray(proof.files)
  )
    throw new Error('缺少对应网页的门禁文件清单，请运行完整交付构建。');
  const actualWebFiles = await Promise.all(
    webFiles.map((name) => fileRecord(resolve(root, 'dist'), name)),
  );
  if (JSON.stringify(actualWebFiles) !== JSON.stringify(proof.files))
    throw new Error('网页资源与通过门禁的产物不一致。');
  for (const ref of hosted.refs)
    if (!webFiles.includes(ref.slice(base.length)))
      throw new Error(`网页引用资源缺失：${ref}`);
  const bytes = new Map();
  for (const name of webFiles)
    bytes.set(
      `site/${name}`,
      await readFile(inside(resolve(root, 'dist'), name)),
    );
  bytes.set(`site/downloads/${manifest.artifact.filename}`, offline);
  bytes.set('site/downloads/index.html', Buffer.from(downloadsPage(manifest)));
  bytes.set(
    'site/downloads/offline-manifest.json',
    Buffer.from(JSON.stringify(manifest, null, 2) + '\n'),
  );
  bytes.set(
    'site/downloads/SHA256SUMS.txt',
    Buffer.from(`${manifest.artifact.sha256}  ${manifest.artifact.filename}\n`),
  );
  bytes.set(
    'site/downloads/更新与使用说明.md',
    await readFile(resolve(root, 'dist-offline/更新与使用说明.md')),
  );
  bytes.set('container/nginx.conf', Buffer.from(nginxConfiguration(base)));
  bytes.set(
    'container/Dockerfile',
    Buffer.from(
      runtimeDockerfile(base, manifest.version, manifest.source.commit),
    ),
  );
  bytes.set(
    'verify-deployment.mjs',
    await readFile(new URL('./verify-deployment.mjs', import.meta.url)),
  );
  bytes.set(
    'verify-live-deployment.mjs',
    await readFile(new URL('./verify-live-deployment.mjs', import.meta.url)),
  );
  const files = [...bytes]
    .map(([path, body]) => ({
      path,
      bytes: body.length,
      sha256: hashBytes(body),
    }))
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const deploymentId = hashBytes(
    Buffer.from(JSON.stringify({ base, source: manifest.source, files })),
  ).slice(0, 12);
  const directory = resolve(
    root,
    'work/deployment',
    manifest.version,
    deploymentId,
  );
  await checkOutputParents(root, directory);
  const deployment = {
    schemaVersion: 1,
    version: manifest.version,
    deploymentId,
    base,
    webBuild: hosted.identity,
    offlineBuild: manifest.buildId,
    builtAt: manifest.builtAt,
    source: manifest.source,
    validation: manifest.validation,
    publishable,
    offlineFilename: manifest.artifact.filename,
    imageTag: `v${manifest.version}-${deploymentId}`,
    files,
  };
  const previous = await readFile(
    resolve(directory, 'deployment.json'),
    'utf8',
  ).catch((error) => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
  if (previous) {
    await verifyDeployment(directory);
    if (previous !== JSON.stringify(deployment, null, 2) + '\n')
      throw new Error('已有交付清单不同，不覆盖历史包。');
  }
  for (const [name, body] of bytes) {
    const path = inside(directory, name);
    await mkdir(resolve(path, '..'), { recursive: true });
    await writeFile(path, body);
  }
  const json = JSON.stringify(deployment, null, 2) + '\n';
  await writeFile(resolve(directory, 'deployment.json'), json);
  await writeFile(resolve(directory, 'site/deployment.json'), json);
  for (const name of await filesIn(resolve(directory, 'site'))) {
    const target = inside(resolve(directory, 'container/site'), name);
    await mkdir(resolve(target, '..'), { recursive: true });
    await copyFile(inside(resolve(directory, 'site'), name), target);
  }
  await verifyDeployment(directory, {
    requirePublishable: requireClean,
    expectedCommit,
  });
  await writeFile(
    resolve(root, 'work/deployment/latest.json'),
    JSON.stringify(
      {
        directory: relative(root, directory).split(sep).join('/'),
        version: deployment.version,
        deploymentId,
        publishable,
      },
      null,
      2,
    ) + '\n',
  );
  console.log(
    `交付目录：${directory}\n在线路径：${base}\n离线下载：${base}downloads/\n镜像上下文：${resolve(directory, 'container')}\n发布资格：${publishable ? '已提交来源，通过门禁' : '本地开发预览；不可作为远端正式发布'}`,
  );
  return { directory, manifest: deployment };
}
export async function writeWorkflowOutputs(result, file) {
  if (!file) return;
  const repo = resolve(defaultRoot, '..');
  const path = (name) =>
    relative(repo, resolve(result.directory, name)).split(sep).join('/');
  await appendFile(
    file,
    `directory=${path('')}\nsite=${path('site')}\ncontainer=${path('container')}\nversion=${result.manifest.version}\ndeployment_id=${result.manifest.deploymentId}\nsource_sha=${result.manifest.source.commit}\nimage_tag=${result.manifest.imageTag}\n`,
    'utf8',
  );
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    const result = await prepareDeployment({
      requireClean: process.argv.includes('--require-clean'),
    });
    await writeWorkflowOutputs(result, process.env.GITHUB_OUTPUT);
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
}
