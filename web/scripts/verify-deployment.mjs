import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { resolve, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const hashBytes = (bytes) =>
  createHash('sha256').update(bytes).digest('hex');
export function inside(root, name) {
  if (
    typeof name !== 'string' ||
    !name ||
    name.startsWith('/') ||
    name.includes(':') ||
    name.includes('\\') ||
    name.split('/').some((part) => !part || part === '.' || part === '..')
  )
    throw new Error('交付路径无效。');
  const path = resolve(root, name);
  const prefix = resolve(root) + sep;
  if (!path.startsWith(prefix)) throw new Error('交付文件越界。');
  return path;
}
export async function filesIn(directory) {
  const result = [];
  async function visit(path) {
    for (const entry of (await readdir(path, { withFileTypes: true })).sort(
      (a, b) => a.name.localeCompare(b.name),
    )) {
      if (entry.isSymbolicLink()) throw new Error('交付不能包含符号链接。');
      const next = resolve(path, entry.name);
      if (entry.isDirectory()) await visit(next);
      else if (entry.isFile())
        result.push(relative(directory, next).split(sep).join('/'));
      else throw new Error('交付包含非普通文件。');
    }
  }
  await visit(resolve(directory));
  return result.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}
export async function fileRecord(directory, name) {
  const bytes = await readFile(inside(directory, name));
  return { path: name, bytes: bytes.length, sha256: hashBytes(bytes) };
}
export async function verifyDeployment(
  directory,
  { requirePublishable = false, expectedCommit, expectedDeployment } = {},
) {
  const manifest = JSON.parse(
    await readFile(resolve(directory, 'deployment.json'), 'utf8'),
  );
  if (
    manifest.schemaVersion !== 1 ||
    !/^\d+\.\d+\.\d+(?:-[a-z0-9.-]+)?$/.test(manifest.version) ||
    !/^[a-f0-9]{12}$/.test(manifest.deploymentId) ||
    !Array.isArray(manifest.files)
  )
    throw new Error('交付清单格式无效。');
  if (
    requirePublishable &&
    (!manifest.publishable ||
      manifest.source?.dirty !== false ||
      !/^[a-f0-9]{40}$/.test(manifest.source?.commit ?? ''))
  )
    throw new Error('不能发布未提交或来源不明的交付。');
  if (expectedCommit && manifest.source?.commit !== expectedCommit)
    throw new Error('交付来源不是要求的提交。');
  if (expectedDeployment && manifest.deploymentId !== expectedDeployment)
    throw new Error('交付标识不是生产步骤选择的构建。');
  const gate = manifest.validation;
  if (
    !gate ||
    !Number.isInteger(gate.tests?.passed) ||
    gate.tests.passed < 1 ||
    ['lint', 'types', 'webBuild', 'offlineContract'].some(
      (key) => gate[key] !== 'passed',
    )
  )
    throw new Error('交付清单门禁未通过。');
  const id = hashBytes(
    Buffer.from(
      JSON.stringify({
        base: manifest.base,
        source: manifest.source,
        files: manifest.files,
      }),
    ),
  ).slice(0, 12);
  if (id !== manifest.deploymentId)
    throw new Error('交付身份与文件／来源清单不一致。');
  const names = manifest.files.map((r) => r.path);
  if (
    new Set(names).size !== names.length ||
    names.some(
      (name) =>
        name === 'deployment.json' ||
        name === 'site/deployment.json' ||
        name.startsWith('container/site/'),
    )
  )
    throw new Error('交付清单文件集合无效。');
  const actual = (await filesIn(directory)).filter(
    (name) =>
      name !== 'deployment.json' &&
      name !== 'site/deployment.json' &&
      !name.startsWith('container/site/'),
  );
  if (
    JSON.stringify([...names].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))) !==
    JSON.stringify(actual)
  )
    throw new Error('交付存在缺失或额外文件。');
  for (const record of manifest.files) {
    const current = await fileRecord(directory, record.path);
    if (current.bytes !== record.bytes || current.sha256 !== record.sha256)
      throw new Error(`交付文件校验失败：${record.path}`);
  }
  const canonical = await readFile(resolve(directory, 'deployment.json'));
  if (
    !(await readFile(resolve(directory, 'site/deployment.json'))).equals(
      canonical,
    )
  )
    throw new Error('网站版本清单不一致。');
  const site = await filesIn(resolve(directory, 'site'));
  const mirror = await filesIn(resolve(directory, 'container/site'));
  if (JSON.stringify(site) !== JSON.stringify(mirror))
    throw new Error('镜像与网站的文件集合不一致。');
  for (const name of site) {
    if (
      !(await readFile(inside(resolve(directory, 'site'), name))).equals(
        await readFile(inside(resolve(directory, 'container/site'), name)),
      )
    )
      throw new Error(`镜像内容与已验证网站不一致：${name}`);
  }
  return manifest;
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    const path = process.argv[2];
    if (!path) throw new Error('需要交付目录。');
    const result = await verifyDeployment(resolve(path), {
      requirePublishable: process.argv.includes('--require-publishable'),
      expectedCommit: process.env.BIDDING_EXPECTED_SHA,
      expectedDeployment: process.env.BIDDING_EXPECTED_DEPLOYMENT,
    });
    console.log(
      `交付验证通过：${result.version} / ${result.deploymentId} / ${result.publishable ? '已提交来源' : '本地开发预览'}`,
    );
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
}
