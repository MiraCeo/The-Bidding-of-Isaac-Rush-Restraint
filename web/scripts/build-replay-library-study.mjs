/** Opt-in cross-runtime fact comparison. No user storage or native download is touched. */
import { mkdir, writeFile, copyFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
const root = fileURLToPath(new URL('..', import.meta.url));
const input = resolve(root, 'work/replay-library-study'),
  out = resolve(root, 'work/replay-library-study-dist');
await mkdir(input, { recursive: true });
await writeFile(
  resolve(input, 'index.html'),
  `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>回放跨运行时事实比较</title><style>body{background:#12100d;color:#eee;font:16px/1.6 system-ui;margin:30px}pre{white-space:pre-wrap}</style><h1>回放跨运行时事实比较</h1><p>只读取项目生成的测试文件；不读取或删除用户浏览器存储，不下载文件。</p><button id="run">比较测试事实</button><pre id="report">尚未开始</pre><script type="module">
import {parseSurvivalReplay,parseSurvivalCheckpoint} from '../../lib/ui/survival-persistence.ts';
import {createSurvivalReplay} from '../../lib/ui/survival-record.ts';
import {survivalReplayFactIdentity} from '../../lib/ui/survival-view-model.ts';
import {replayLibraryKey,newLibraryDocument} from '../../lib/ui/replay-library.ts';
const button=document.querySelector('#run'),report=document.querySelector('#report');
button.onclick=async()=>{button.disabled=true;try{
 const original=parseSurvivalReplay(await (await fetch('./fixtures/replay.json')).text());
 const restored=newLibraryDocument({mode:'survival',replay:createSurvivalReplay(parseSurvivalCheckpoint(await (await fetch('./fixtures/checkpoint.json')).text()).game)});
 const a=JSON.parse(survivalReplayFactIdentity(original.replay)),b=JSON.parse(survivalReplayFactIdentity(restored.replay)),diffs=[];
 function compare(a,b,path){if(JSON.stringify(a)===JSON.stringify(b))return;if(a&&b&&typeof a==='object'&&typeof b==='object'){for(const k of new Set([...Object.keys(a),...Object.keys(b)]))compare(a[k],b[k],path+'.'+k);}else if(diffs.length<40)diffs.push({path,a,b});}
 compare(a,b,'log');report.textContent=JSON.stringify({originalKey:await replayLibraryKey(original),restoredKey:await replayLibraryKey(restored),differences:diffs},null,2);
 }catch(error){report.textContent=JSON.stringify({error:error.message});}finally{button.disabled=false;}};
</script></html>`,
);
await build({
  root: input,
  configFile: false,
  publicDir: false,
  logLevel: 'error',
  resolve: { alias: { '@': root } },
  define: { __BIDDING_BUILD__: JSON.stringify('replay-library-fact-study') },
  build: { outDir: out, emptyOutDir: false, minify: true },
});
await mkdir(resolve(out, 'fixtures'), { recursive: true });
for (const [to, from] of [
  ['replay', '3-isaac-replay.original.json'],
  ['checkpoint', '3-isaac-checkpoint.original.json'],
])
  await copyFile(
    resolve(root, 'work/protocol-v5-roundtrip', from),
    resolve(out, 'fixtures', to + '.json'),
  );
console.log(`只读事实比较：${out}`);
