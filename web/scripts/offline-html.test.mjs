import { Script } from 'node:vm';

import { describe, expect, it } from 'vitest';

import {
  assertInlineStyles,
  assertStandaloneHtml,
  createOfflineHtml,
  readOfflineBundle,
} from './offline-html.mjs';

const template = `<!doctype html><html lang="zh-CN"><head>
<meta charset="UTF-8" /><meta name="viewport" content="width=device-width" />
<meta property="og:image" content="https://example.com/preview.png" />
<meta name="twitter:image" content="https://example.com/preview.png" />
<link rel="icon" type="image/svg+xml" href="/favicon.svg" />
<title>以撒的竞合</title></head><body><div id="root"></div>
<script type="module" src="/main.tsx"></script></body></html>`;
const input = {
  template,
  javascript: '(() => { globalThis.testValue = "中文 $& $1"; })();',
  styles: 'body{color:#fff;background:#12100d}',
  favicon: '<svg xmlns="http://www.w3.org/2000/svg"></svg>',
  version: '0.1.0',
};

function scriptFrom(html) {
  return html.match(/<script id="offline-game">([\s\S]*?)<\/script>/)[1];
}

describe('standalone offline HTML', () => {
  it('embeds all resources and removes module and online share references', () => {
    const { html } = createOfflineHtml(input);
    expect(html).toContain('<style id="offline-styles">');
    expect(html).toContain('data:image/svg+xml;base64,');
    expect(html).toContain("connect-src 'none'");
    expect(html).toContain('<title>以撒的竞合</title>');
    expect(html).not.toMatch(
      /type="module"|src=|og:image|twitter:image|example\.com/,
    );
    const context = {};
    new Script(scriptFrom(html)).runInNewContext(context);
    expect(context.testValue).toBe('中文 $& $1');
    expect(() => assertStandaloneHtml(html)).not.toThrow();
  });

  it('escapes raw HTML script boundaries without changing runtime strings', () => {
    const value = '</ScRiPt><script><!--';
    const { html } = createOfflineHtml({
      ...input,
      javascript: `globalThis.testValue = ${JSON.stringify(value)};`,
    });
    const context = {};
    new Script(scriptFrom(html)).runInNewContext(context);
    expect(context.testValue).toBe(value);
    expect(html.match(/<\/script>/g)).toHaveLength(1);
  });

  it('escapes CSS closing tags and preserves data and fragment URLs', () => {
    const styles =
      'body::after{content:"</style>"} .icon{background:url(data:image/png;base64,AA==);filter:url(#blur)}';
    const { html } = createOfflineHtml({ ...input, styles });
    expect(html.match(/<\/style>/g)).toHaveLength(1);
    expect(html).toContain('<\\/style>');
  });

  it('uses a deterministic build ID that changes with content', () => {
    const result = createOfflineHtml(input);
    expect(createOfflineHtml(input)).toEqual(result);
    expect(result.buildId).toMatch(/^[a-f\d]{12}$/);
    expect(
      createOfflineHtml({ ...input, styles: 'body{color:red}' }).buildId,
    ).not.toBe(result.buildId);
  });

  it('escapes metadata attribute values', () => {
    expect(createOfflineHtml({ ...input, version: '"<&>' }).html).toContain(
      '&quot;&lt;&amp;&gt;',
    );
  });

  it.each([
    [template.replace('<div id="root"></div>', ''), 'root'],
    [template.replace('src="/main.tsx"', 'src="/other.tsx"'), '入口'],
    [
      template.replace('</body>', '<script src="/main.tsx"></script></body>'),
      '入口',
    ],
    [template.replace('</head>', ''), 'head'],
    [template.replace('href="/favicon.svg"', 'href="/other.svg"'), '图标'],
    [template.replace('<meta charset="UTF-8" />', ''), 'charset'],
  ])('rejects unsupported source templates', (source, message) => {
    expect(() => createOfflineHtml({ ...input, template: source })).toThrow(
      message,
    );
  });

  it('rejects ESM and invalid JS instead of producing an unusable file', () => {
    expect(() =>
      createOfflineHtml({ ...input, javascript: 'import x from "./x.js";' }),
    ).toThrow();
  });

  it.each([
    '@import "https://example.com/x.css";',
    'body{background:url(/image.png)}',
    'body{background:url("./image.png")}',
    'body{background:url(https://example.com/image.png)}',
  ])('rejects non-inline CSS resources', (styles) => {
    expect(() => assertInlineStyles(styles)).toThrow('离线构建失败');
  });

  it.each([
    '<script src="./game.js"></script>',
    '<script type="module">export {};</script>',
    '<link rel="stylesheet" href="/app.css">',
    '<img src=./image.png>',
    '<source srcset="x.png 1x">',
    '<video poster="https://example.com/x.png"></video>',
    '<iframe src="about:blank"></iframe>',
    '<meta http-equiv="refresh" content="0;url=https://example.com">',
    '<base href="https://example.com">',
  ])('rejects external or unsupported HTML resources', (extra) => {
    expect(() =>
      createOfflineHtml({
        ...input,
        template: template.replace('</body>', `${extra}</body>`),
      }),
    ).toThrow('离线构建失败');
  });
});

describe('offline bundle contract', () => {
  const chunk = {
    type: 'chunk',
    isEntry: true,
    code: '(()=>{})();',
    imports: [],
    dynamicImports: [],
  };
  it('accepts an IIFE and joins text or byte CSS assets', () => {
    expect(
      readOfflineBundle({
        output: [
          chunk,
          { type: 'asset', fileName: 'a.css', source: 'body{}' },
          { type: 'asset', fileName: 'b.css', source: Buffer.from('html{}') },
        ],
      }),
    ).toEqual({ javascript: chunk.code, styles: 'body{}\nhtml{}' });
  });

  it.each([
    {},
    { output: [] },
    { output: [chunk, chunk] },
    { output: [{ ...chunk, isEntry: false }] },
    { output: [{ ...chunk, imports: ['react'] }] },
    { output: [{ ...chunk, dynamicImports: ['room.js'] }] },
    { output: [chunk, { type: 'asset', fileName: 'image.png', source: 'x' }] },
  ])('rejects output that cannot be a single self-contained HTML', (result) => {
    expect(() => readOfflineBundle(result)).toThrow('离线构建失败');
  });
});
