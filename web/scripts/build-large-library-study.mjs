/** Build a fresh-origin opt-in study. Does not touch an existing browser database or download files. */
import { readFile, mkdir, writeFile, copyFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { build } from 'vite';
import react from '@vitejs/plugin-react';
import tailwind from '@tailwindcss/postcss';
const root = fileURLToPath(new URL('..', import.meta.url)),
  work = resolve(root, 'work'),
  phase = process.env.LIBRARY_STUDY_PHASE ?? 'baseline';
if (!['baseline', 'optimized', 'repeat'].includes(phase))
  throw Error('Invalid study phase');
const input = resolve(work, `large-library-study-${phase}`),
  out = resolve(work, `large-library-study-${phase}-dist`);
if (!input.startsWith(work + sep) || !out.startsWith(work + sep))
  throw Error('Invalid study directory');
const corpusSource = await readFile(
    resolve(work, 'large-library-performance/corpus.json'),
    'utf8',
  ),
  corpus = JSON.parse(corpusSource);
if (
  corpus.kind !== 'large-library-study-corpus-1' ||
  corpus.prepared.length !== 100 ||
  corpus.anchor.rooms !== 35
)
  throw Error('Generate the 100 played fixtures first.');
const hash = (source) => createHash('sha256').update(source).digest('hex'),
  files = [
    'lib/ui/replay-library.ts',
    'lib/ui/replay-library-backup-format.ts',
    'lib/ui/game-replay.ts',
    'lib/ui/survival-persistence.ts',
    'lib/ui/compressed-file.ts',
    'lib/ui/classic-library-equivalence.ts',
    'components/game/replay-library-panel.tsx',
    'lib/ui/research/large-library-study.ts',
    'lib/ui/research/large-library-study-ui.tsx',
    'app/globals.css',
  ],
  hashes = {};
for (const file of files)
  hashes[file] = hash(await readFile(resolve(root, file)));
const metadata = {
  schema: 1,
  phase,
  corpusSha256: hash(corpusSource),
  codeHashes: hashes,
  commit: execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: root,
    encoding: 'utf8',
  }).trim(),
  sourceDirty: !!execFileSync('git', ['status', '--porcelain'], {
    cwd: root,
    encoding: 'utf8',
  }).trim(),
  packageVersion: JSON.parse(
    await readFile(resolve(root, 'package.json'), 'utf8'),
  ).version,
};
await mkdir(input, { recursive: true });
await writeFile(
  resolve(input, 'index.html'),
  `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>大库原生性能测量 · ${phase}</title><style>body{margin:0 auto;max-width:1140px;padding:24px}#study-controls{padding:20px;border:1px solid #59462c;border-radius:12px;margin-bottom:16px}#study-controls h1{font-size:24px}#study-controls button{background:#edaf3d;color:#16120b;padding:10px 18px;border-radius:8px;margin:10px 12px 10px 0}#study-controls button:disabled{opacity:.4}#progress{color:#edaf3d}pre{white-space:pre-wrap;overflow-wrap:anywhere;padding:16px;background:#19150f;border:1px solid #403629;border-radius:10px;font-size:12px}#ui{margin:16px 0}</style><section id="study-controls"><h1>大库原生性能测量 · ${phase}</h1><p>仅空白专属localhost来源。100个实际模拟局，不是改名副本；本页只创建本轮研究库，不删除数据库，不操作其他来源或玩家档案。不运行AI，不下载文件；结束后保留数据供核对。10／50／100份和0／1000／8192条合成删除标记，重操作可能持续数分钟。</p><button id="run">运行大库测量</button><button id="stop" disabled>停止测量</button><p id="progress">尚未开始</p></section><div id="ui"></div><pre id="report">等待测试</pre><script type="module">
import '../../app/globals.css';
import {runLargeLibraryStudy} from '../../lib/ui/research/large-library-study.ts';
import {measureLibraryUi} from '../../lib/ui/research/large-library-study-ui.tsx';
const run=document.querySelector('#run'),stop=document.querySelector('#stop'),progress=document.querySelector('#progress'),report=document.querySelector('#report'),host=document.querySelector('#ui');let controller;
const metadata=${JSON.stringify(metadata)};
run.onclick=async()=>{run.disabled=true;stop.disabled=false;controller=new AbortController();try{const response=await fetch('./corpus.json');if(!response.ok)throw Error('研究语料读取失败');const corpus=await response.json();const result=await runLargeLibraryStudy(corpus,{phase:metadata.phase,signal:controller.signal,onProgress:text=>progress.textContent=text,onReport:value=>report.textContent=JSON.stringify({metadata,result:value},null,2),measureUi:rows=>measureLibraryUi(host,rows)});progress.textContent=result.status==='complete'?'测量完成 · 研究库已保留，未改写其他资料':'测量未完成：'+result.error;}catch(error){report.textContent=JSON.stringify({metadata,error:error.message},null,2);progress.textContent='测量未完成';}finally{run.disabled=false;stop.disabled=true;}};stop.onclick=()=>controller?.abort();
</script></html>`,
);
await build({
  root: input,
  configFile: false,
  publicDir: false,
  logLevel: 'error',
  plugins: [react()],
  resolve: { alias: { '@': root } },
  css: { postcss: { plugins: [tailwind()] } },
  define: {
    __BIDDING_BUILD__: JSON.stringify('large-library-performance-study-v1'),
    'process.env.NODE_ENV': JSON.stringify('production'),
  },
  build: { outDir: out, emptyOutDir: false, minify: true },
});
await copyFile(
  resolve(work, 'large-library-performance/corpus.json'),
  resolve(out, 'corpus.json'),
);
await writeFile(
  resolve(out, 'study-source.json'),
  JSON.stringify(metadata, null, 2),
);
console.log(
  `研究页：${out}\nphase=${phase}; corpus=${metadata.corpusSha256}; requires fresh origin`,
);
