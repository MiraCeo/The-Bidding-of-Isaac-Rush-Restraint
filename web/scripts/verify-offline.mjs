import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { lstat, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  readReleaseInputs,
  releaseReadme,
  versionedHtmlName,
} from './release-artifacts.mjs';
import { assertStandaloneHtml } from './offline-html.mjs';

const defaultRoot = fileURLToPath(new URL('..', import.meta.url));
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
function requireValue(condition, message) {
  if (!condition) throw Error(`离线交付自检失败：${message}`);
}
/** Check just the current normative declarations, not historical releases references. */
export function verifyDeliveryDocumentation(markdown, label = '说明文档') {
  for (const [key, expected] of [
    ['当前交付目录', 'web/dist-offline/'],
    ['固定入口', 'web/dist-offline/以撒的竞合.html'],
  ]) {
    const values = [
      ...markdown.matchAll(
        new RegExp(`^${key}：\\s*\x60([^\x60]+)\x60[。\\s]*$`, 'gm'),
      ),
    ].map((m) => m[1]);
    requireValue(
      values.length === 1 && values[0] === expected,
      `${label}的“${key}”必须唯一指向${expected}。`,
    );
  }
}
/** Read-only local artifact/document inspection. No build, browser, network,
 * game execution, output writing, or deletion. Does not certify past gate claims. */
export async function verifyOffline(root = defaultRoot) {
  root = resolve(root);
  const directory = resolve(root, 'dist-offline');
  const info = await lstat(directory).catch(() => null);
  requireValue(
    info?.isDirectory() && !info.isSymbolicLink(),
    '仅检查dist-offline实体目录，不读取releases或链接替代目录。',
  );
  const captures = new Map();
  async function capture(path) {
    const state = await lstat(path).catch(() => null);
    requireValue(
      state?.isFile() && !state.isSymbolicLink(),
      `缺少普通文件：${path}`,
    );
    const bytes = await readFile(path);
    captures.set(path, bytes);
    return bytes;
  }
  const inputs = await readReleaseInputs(root);
  const rawManifest = await capture(resolve(directory, 'build-manifest.json'));
  let m;
  try {
    m = JSON.parse(rawManifest.toString('utf8'));
  } catch {
    throw Error('离线交付自检失败：build-manifest.json不是有效JSON。');
  }
  requireValue(
    m.schemaVersion === 1 && m.game === 'the-bidding-of-isaac',
    '构建清单类型不匹配。',
  );
  requireValue(
    m.version === inputs.version,
    '清单版本与当前package／更新记录不一致。',
  );
  const filename = versionedHtmlName(m.version, m.buildId);
  requireValue(
    m.artifact?.filename === filename && m.entryAlias === '以撒的竞合.html',
    '归档名称或固定入口不匹配，不能使用路径／旧文件替代。',
  );
  requireValue(
    Number.isSafeInteger(m.artifact.bytes) &&
      m.artifact.bytes > 0 &&
      /^[a-f0-9]{64}$/.test(m.artifact.sha256),
    '清单大小或SHA256无效。',
  );
  requireValue(
    m.source &&
      (m.source.commit === null || /^[a-f0-9]{40}$/.test(m.source.commit)) &&
      [true, false, null].includes(m.source.dirty),
    '来源记录缺失或无效。',
  );
  assert.deepEqual(
    m.compatibility,
    inputs.compatibility,
    '离线清单兼容字段不匹配',
  );
  assert.deepEqual(
    m.releaseNotes,
    inputs.release,
    '离线清单更新说明不是当前输入',
  );
  const versioned = await capture(resolve(directory, filename));
  const alias = await capture(resolve(directory, '以撒的竞合.html'));
  requireValue(alias.equals(versioned), '固定HTML与带版本HTML不是同一内容。');
  requireValue(
    versioned.length === m.artifact.bytes &&
      sha256(versioned) === m.artifact.sha256,
    'HTML实际大小／SHA256与清单不一致。',
  );
  const html = versioned.toString('utf8');
  assertStandaloneHtml(html);
  const shell = html.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '');
  const identities = [
    ...shell.matchAll(
      /<meta\b[^>]*\bname=["']bidding-offline-build["'][^>]*\bcontent=["']([^"']+)["'][^>]*>/gi,
    ),
  ].map((v) => v[1]);
  requireValue(
    identities.length === 1 && identities[0] === `${m.version}-${m.buildId}`,
    'HTML头部实际版本／构建标识不匹配或重复。',
  );
  const sums = (await capture(resolve(directory, 'SHA256SUMS.txt')))
    .toString('utf8')
    .replaceAll('\r\n', '\n')
    .trimEnd();
  requireValue(
    sums === `${m.artifact.sha256}  ${filename}`,
    'SHA256SUMS不是当前归档的唯一正确校验行。',
  );
  const guide = (
    await capture(resolve(directory, '更新与使用说明.md'))
  ).toString('utf8');
  requireValue(
    guide === releaseReadme(m),
    '生成的更新与使用说明和当前清单不匹配。',
  );
  for (const name of ['README.md', 'docs/开发/0.5.0使用与交付说明.md']) {
    const bytes = await capture(resolve(root, '..', name));
    verifyDeliveryDocumentation(bytes.toString('utf8'), name);
  }
  for (const [path, bytes] of captures)
    requireValue(
      (await readFile(path)).equals(bytes),
      '检查期间文件发生变化，请在构建完成后重试。',
    );
  return {
    directory,
    version: m.version,
    buildId: m.buildId,
    filename,
    bytes: versioned.length,
    sha256: m.artifact.sha256,
    aliasMatches: true,
    documents: 'passed',
    recordedSource: m.source,
    validationRecordPresent: m.validation !== null,
    scope: '只读文件／文档一致性；不执行或证明自动门禁与真实环境验收',
  };
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    requireValue(
      process.argv.length === 2,
      '不接受其他输出目录参数；当前交付固定为dist-offline。',
    );
    console.log(JSON.stringify(await verifyOffline(), null, 2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
