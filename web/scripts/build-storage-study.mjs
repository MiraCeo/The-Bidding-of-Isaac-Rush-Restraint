/** Build an opt-in isolated browser research page, not a game feature or release gate. */
import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
const root = fileURLToPath(new URL('..', import.meta.url)),
  work = resolve(root, 'work'),
  input = resolve(work, 'browser-storage-benchmark'),
  out = resolve(work, 'browser-storage-benchmark-dist');
if (!input.startsWith(work + sep) || !out.startsWith(work + sep))
  throw Error('Invalid study directory');
const fixtures = {
  classicActive: 'classic-20261013-isaac-resume.original.json',
  classicBackup: 'classic-20261013-isaac-backup.original.json',
  survivalActive: '3-isaac-resume.original.json',
  survivalBackup: '3-isaac-backup.original.json',
  survivalPreviousReplay: '42-lost-replay.original.json',
};
for (const file of Object.values(fixtures)) {
  const doc = JSON.parse(
    await readFile(resolve(work, 'protocol-v5-roundtrip', file), 'utf8'),
  );
  if (doc.version !== 5 || !['classic', 'survival'].includes(doc.mode))
    throw Error(
      'Generate current v5 simulation fixtures before building the study.',
    );
}
await mkdir(input, { recursive: true });
await writeFile(
  resolve(input, 'index.html'),
  `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>隔离浏览器容量与保存测量</title><style>body{background:#12100d;color:#ece4d7;font:16px/1.7 system-ui;margin:32px auto;max-width:1100px;padding:0 24px}h1{font-size:26px}button{padding:10px 20px;border:0;border-radius:8px;margin-right:12px;background:#edaf3d;color:#19130a;cursor:pointer}button:disabled{opacity:.4}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#211d17;padding:20px;border:1px solid #493e2b;border-radius:12px;font-size:13px}#progress{color:#edaf3d}</style><h1>隔离浏览器容量与保存测量</h1><p>仅用于本轮生成的测试数据。此来源必须无已有数据；测试只写新建的专属临时键，完成／停止后清理。不会接触其他端口或真实游戏档案。</p><button id="run">运行隔离容量与保存测试</button><button id="stop" disabled>停止测量</button><p id="progress">尚未开始</p><pre id="report">等待测试</pre><script type="module">
import {runBrowserStorageStudy} from '../../lib/ui/research/browser-storage-study.ts';
const run=document.querySelector('#run'),stop=document.querySelector('#stop'),progress=document.querySelector('#progress'),report=document.querySelector('#report');let controller;
run.onclick=async()=>{run.disabled=true;stop.disabled=false;controller=new AbortController();try{const names=['classicActive','classicBackup','survivalActive','survivalBackup','survivalPreviousReplay'],inputs={};for(const name of names){const response=await fetch('./fixtures/'+name+'.json');if(!response.ok)throw Error('测试数据读取失败');inputs[name]=await response.text();}const result=await runBrowserStorageStudy(localStorage,inputs,{signal:controller.signal,onProgress:text=>progress.textContent=text});report.textContent=JSON.stringify(result,null,2);progress.textContent='测量完成 · 临时键已清理：'+result.cleanupVerified;}catch(error){let remainingKeyCount=null;try{remainingKeyCount=localStorage.length;}catch{}report.textContent=JSON.stringify({error:error.message,name:error.name,remainingKeyCount},null,2);progress.textContent='测量未完成';}finally{run.disabled=false;stop.disabled=true;}};stop.onclick=()=>controller?.abort();
</script></html>`,
  'utf8',
);
await build({
  root: input,
  configFile: false,
  publicDir: false,
  logLevel: 'error',
  resolve: { alias: { '@': root } },
  define: {
    __BIDDING_BUILD__: JSON.stringify('isolated-browser-storage-study'),
  },
  build: { outDir: out, emptyOutDir: false, minify: true },
});
await mkdir(resolve(out, 'fixtures'), { recursive: true });
for (const [name, file] of Object.entries(fixtures))
  await copyFile(
    resolve(work, 'protocol-v5-roundtrip', file),
    resolve(out, 'fixtures', name + '.json'),
  );
console.log(
  `隔离测量构建：${out}\n仅在空白专用localhost来源运行；正常游戏进度诊断不会自动探测配额。`,
);
