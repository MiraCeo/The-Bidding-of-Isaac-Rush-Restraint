import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export async function verifyLiveDeployment(
  directory,
  address,
  fetcher = globalThis.fetch,
) {
  const local = JSON.parse(
    await readFile(resolve(directory, 'deployment.json'), 'utf8'),
  );
  const url = new URL(address.endsWith('/') ? address : address + '/');
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.search ||
    url.hash ||
    url.username ||
    url.password
  )
    throw new Error('验收地址必须是HTTP(S)目录。');
  const get = async (address) => {
    const response = await fetcher(address, {
      signal: AbortSignal.timeout(15000),
      cache: 'no-store',
    });
    if (!response.ok)
      throw new Error(`线上资源不可用：${response.status} ${address}`);
    return Buffer.from(await response.arrayBuffer());
  };
  const remote = JSON.parse(
    (await get(new URL('deployment.json', url))).toString('utf8'),
  );
  if (
    remote.deploymentId !== local.deploymentId ||
    remote.version !== local.version ||
    remote.source?.commit !== local.source?.commit
  )
    throw new Error('线上入口仍是旧版本或不同来源。');
  const html = (await get(url)).toString('utf8');
  if (!html.includes(`content="${local.webBuild}"`))
    throw new Error('线上页面构建标识不一致。');
  for (const record of local.files.filter((r) =>
    /^site\/assets\/.*\.(js|css)$/.test(r.path),
  )) {
    const bytes = await get(new URL(record.path.slice('site/'.length), url));
    if (createHash('sha256').update(bytes).digest('hex') !== record.sha256)
      throw new Error(`线上脚本／样式内容不一致：${record.path}`);
  }
  const download = (await get(new URL('downloads/', url))).toString('utf8');
  if (!download.includes(encodeURIComponent(local.offlineFilename)))
    throw new Error('离线下载入口不是同一版本。');
  return {
    version: local.version,
    deploymentId: local.deploymentId,
    address: url.href,
  };
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    if (!process.argv[2] || !process.argv[3])
      throw new Error('需要交付目录和网站地址。');
    console.log(
      JSON.stringify(
        await verifyLiveDeployment(resolve(process.argv[2]), process.argv[3]),
      ),
    );
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
}
