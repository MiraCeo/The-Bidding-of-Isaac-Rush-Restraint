import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

export function validateReleaseInputs(packageInfo, notes, config) {
  if (!/^\d+\.\d+\.\d+(?:-[a-z0-9.-]+)?$/.test(packageInfo.version))
    throw new Error('发布版本必须是安全的语义版本号。');
  if (
    !Array.isArray(notes) ||
    notes[0]?.version !== packageInfo.version ||
    new Set(notes.map((entry) => entry.version)).size !== notes.length
  )
    throw new Error('package版本与最新更新记录不一致或记录重复。');
  for (const entry of notes) {
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(entry.date) ||
      !Number.isFinite(Date.parse(entry.date)) ||
      !entry.title ||
      !Array.isArray(entry.highlights) ||
      !entry.highlights.length ||
      entry.highlights.some(
        (text) => typeof text !== 'string' || !text.trim(),
      ) ||
      typeof entry.compatibility !== 'string' ||
      !entry.compatibility.trim()
    )
      throw new Error('更新记录的日期、内容或兼容说明缺失。');
  }
  if (
    typeof config.engineVersion !== 'string' ||
    !/^[a-z0-9-]+$/.test(config.engineVersion) ||
    config.saveFormatVersion !== 1 ||
    config.replayFormatVersion !== 1
  )
    throw new Error('发布兼容配置与当前v1文件协议不一致。');
  return {
    version: packageInfo.version,
    release: notes[0],
    compatibility: config,
  };
}
export async function readReleaseInputs(root) {
  const data = await Promise.all(
    ['package.json', 'release-notes.json', 'release-config.json'].map(
      async (name) => JSON.parse(await readFile(resolve(root, name), 'utf8')),
    ),
  );
  return validateReleaseInputs(...data);
}
export function versionedHtmlName(version, buildId) {
  if (
    !/^\d+\.\d+\.\d+(?:-[a-z0-9.-]+)?$/.test(version) ||
    !/^[a-f0-9]{12}$/.test(buildId)
  )
    throw new Error('版本或构建标识不能用于输出文件名。');
  return `以撒的竞合-${version}-${buildId}.html`;
}
export function sourceProvenance(root) {
  try {
    const commit = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: root,
      encoding: 'utf8',
      windowsHide: true,
    }).trim();
    const status = execFileSync('git', ['status', '--porcelain'], {
      cwd: root,
      encoding: 'utf8',
      windowsHide: true,
    });
    return { commit, dirty: Boolean(status.trim()) };
  } catch {
    return { commit: null, dirty: null };
  }
}
export function createArtifactManifest(
  bundle,
  { source, validation = null, now = new Date() },
) {
  const filename = versionedHtmlName(bundle.version, bundle.buildId);
  if (!bundle.html.includes(`content="${bundle.version}-${bundle.buildId}"`))
    throw new Error('HTML内的实际构建与交付标识不一致。');
  return {
    schemaVersion: 1,
    game: 'the-bidding-of-isaac',
    version: bundle.version,
    buildId: bundle.buildId,
    builtAt: now.toISOString(),
    artifact: {
      filename,
      bytes: Buffer.byteLength(bundle.html),
      sha256: createHash('sha256').update(bundle.html).digest('hex'),
    },
    compatibility: bundle.compatibility,
    releaseNotes: bundle.release,
    source,
    validation,
    entryAlias: '以撒的竞合.html',
  };
}
export function releaseReadme(manifest) {
  return `# 以撒的竞合 ${manifest.version}\n\n构建：${manifest.buildId}\n\n分发文件：${manifest.artifact.filename}\n\n${manifest.releaseNotes.highlights.map((text) => `- ${text}`).join('\n')}\n\n## 存档与回放\n\n${manifest.releaseNotes.compatibility}\n\n- 存档与回放是独立JSON文件，不写入HTML。\n- 更换HTML文件名或位置时，浏览器自动存档不保证迁移，原入口先导出JSON，再在新文件设置页读取。\n- 读取回放只做只读查看，不替换正在玩的对局。\n- ${manifest.validation ? '自动门禁已通过；真实界面与游玩效果由用户验收。' : '本次仅完成离线构建，不能把它记为全量发布门禁通过。'}\n- 源代码：${manifest.source.commit ?? '未取得Git提交'}${manifest.source.dirty === true ? '（包含未提交改动）' : manifest.source.dirty === false ? '（已提交状态）' : '（状态未知）'}。\n`;
}
/** Writes only validated basenames underneath the caller's output directory. */
export async function writeOfflineArtifacts(
  root,
  bundle,
  {
    validation = null,
    source = sourceProvenance(root),
    now = new Date(),
    release = false,
  } = {},
) {
  const manifest = createArtifactManifest(bundle, { validation, source, now });
  const directory = release
    ? resolve(root, 'releases', `v${bundle.version}`, bundle.buildId)
    : resolve(root, 'dist-offline');
  const htmlPath = resolve(directory, manifest.artifact.filename);
  if (release) {
    const previous = await readFile(htmlPath).catch((error) => {
      if (error.code === 'ENOENT') return null;
      throw error;
    });
    if (
      previous &&
      createHash('sha256').update(previous).digest('hex') !==
        manifest.artifact.sha256
    )
      throw new Error('同一发布构建已有不同内容，不能覆盖。');
  }
  await mkdir(directory, { recursive: true });
  await writeFile(htmlPath, bundle.html, 'utf8');
  await writeFile(
    resolve(directory, release ? 'manifest.json' : 'build-manifest.json'),
    JSON.stringify(manifest, null, 2) + '\n',
    'utf8',
  );
  await writeFile(
    resolve(directory, 'SHA256SUMS.txt'),
    `${manifest.artifact.sha256}  ${manifest.artifact.filename}\n`,
    'utf8',
  );
  await writeFile(
    resolve(directory, '更新与使用说明.md'),
    releaseReadme(manifest),
    'utf8',
  );
  if (release) {
    // Keep prior runs when the same content is rebuilt after its source is committed.
    const recordName = `build-record-${now.toISOString().replace(/[:.]/g, '-')}.json`;
    await writeFile(
      resolve(directory, recordName),
      JSON.stringify(manifest, null, 2) + '\n',
      'utf8',
    );
  } else
    await writeFile(resolve(directory, '以撒的竞合.html'), bundle.html, 'utf8');
  return { manifest, directory, htmlPath };
}
