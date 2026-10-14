import { createHash } from 'node:crypto';
import { Script } from 'node:vm';

const entryScript =
  /<script\b[^>]*\bsrc=["']\/?main\.tsx["'][^>]*>\s*<\/script\s*>/gi;
const offlinePolicy = [
  "default-src 'none'",
  "script-src 'unsafe-inline'",
  "style-src 'unsafe-inline'",
  'img-src data: blob:',
  'font-src data:',
  "connect-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

function invariant(condition, message) {
  if (!condition) throw new Error(`离线构建失败：${message}`);
}

function escapeAttribute(value) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

/** Only an entry IIFE and inlineable CSS may enter the standalone document. */
export function readOfflineBundle(result) {
  const bundles = Array.isArray(result) ? result : [result];
  invariant(
    bundles.every((bundle) => Array.isArray(bundle.output)),
    '构建未返回静态产物。',
  );
  const output = bundles.flatMap((bundle) => bundle.output);
  const chunks = output.filter((file) => file.type === 'chunk');
  const assets = output.filter((file) => file.type === 'asset');

  invariant(
    chunks.length === 1 && chunks[0].isEntry,
    '必须生成单一入口脚本，不能引用其他 JS 文件。',
  );
  invariant(
    chunks[0].imports.length === 0 && chunks[0].dynamicImports.length === 0,
    '脚本仍依赖外部模块或动态加载。',
  );
  invariant(
    assets.every((file) => file.fileName.endsWith('.css')),
    '存在未内嵌资源；请将图片、字体等作为源码资源导入。',
  );

  return {
    javascript: chunks[0].code,
    styles: assets
      .map((file) =>
        typeof file.source === 'string'
          ? file.source
          : Buffer.from(file.source).toString('utf8'),
      )
      .join('\n'),
  };
}

export function assertInlineStyles(styles) {
  const withoutComments = styles.replace(/\/\*[\s\S]*?\*\//g, '');
  invariant(!/@import\b/i.test(withoutComments), 'CSS 仍包含 @import。');
  for (const match of withoutComments.matchAll(
    /url\(\s*(["']?)(.*?)\1\s*\)/gi,
  )) {
    const url = match[2].trim();
    invariant(/^(?:data:|#)/i.test(url), `CSS 仍依赖外部资源：${url}`);
  }
}

/** Validate the shell, not URL strings inside the bundled game or SVG data. */
export function assertStandaloneHtml(html) {
  const shell = html.replace(
    /<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,
    (tag) => tag.slice(0, tag.indexOf('>') + 1),
  );
  invariant(
    !/<script\b[^>]*\btype=["']module["']/i.test(shell),
    'HTML 仍含模块脚本。',
  );
  invariant(
    !/<(?:base|iframe|object|embed)\b/i.test(shell),
    'HTML 含离线包不支持的嵌入或基址。',
  );
  invariant(
    !/<meta\b[^>]*http-equiv=["']refresh["']/i.test(shell),
    'HTML 不能自动跳转。',
  );
  invariant(
    !/<meta\b[^>]*(?:property=["']og:|name=["']twitter:)/i.test(shell),
    '离线包不能保留联网分享元数据。',
  );
  for (const tag of shell.matchAll(
    /<(?:script|link|img|source|audio|video|input)\b[^>]*>/gi,
  )) {
    invariant(!/\bsrcset\s*=/i.test(tag[0]), 'HTML 仍含 srcset 资源。');
    for (const match of tag[0].matchAll(
      /\b(?:src|href|poster)\s*=\s*(?:["']([^"']*)["']|([^\s>]+))/gi,
    )) {
      const url = match[1] ?? match[2];
      invariant(/^data:/i.test(url), `HTML 仍依赖外部资源：${url}`);
    }
  }
}

export function createOfflineHtml({
  template,
  javascript,
  styles,
  favicon,
  version,
}) {
  invariant(
    [...template.matchAll(entryScript)].length === 1,
    '找不到唯一的 main.tsx 页面入口。',
  );
  invariant(
    /<div\b[^>]*id=["']root["']/i.test(template),
    '页面缺少 root 节点。',
  );
  invariant(
    (template.match(/<\/head\s*>/gi) ?? []).length === 1,
    '页面必须有唯一的 head。',
  );
  invariant(
    (template.match(/<link\b[^>]*href=["']\/favicon\.svg["'][^>]*>/gi) ?? [])
      .length === 1,
    '找不到唯一的 favicon.svg 图标入口。',
  );
  assertInlineStyles(styles);
  new Script(javascript, { filename: 'offline-game.js' });

  // HTML raw-text elements do not understand JS/CSS string escaping. Prevent
  // accidental closing tags and script double-escaped parsing states.
  const script = javascript.replace(/<(\/?script\b|!--)/gi, '\\x3C$1');
  const css = styles.replace(/<\/style/gi, '<\\/style');
  new Script(script, { filename: 'offline-game.js' });
  const buildId = createHash('sha256')
    .update(
      JSON.stringify({
        template,
        javascript,
        styles,
        favicon,
        version,
      }),
    )
    .digest('hex')
    .slice(0, 12);
  const iconUrl = `data:image/svg+xml;base64,${Buffer.from(favicon).toString('base64')}`;
  let html = template
    .replace(
      /\s*<meta\b[^>]*(?:property=["']og:[^"']*["']|name=["']twitter:[^"']*["'])[^>]*>/gi,
      '',
    )
    .replace(
      /<link\b[^>]*href=["']\/favicon\.svg["'][^>]*>/gi,
      () => `<link rel="icon" type="image/svg+xml" href="${iconUrl}" />`,
    )
    .replace(
      entryScript,
      () => `<script id="offline-game">\n${script}\n</script>`,
    )
    .replace(
      /<\/head\s*>/i,
      () => `    <style id="offline-styles">\n${css}\n    </style>\n  </head>`,
    );
  // Place the policy before any resource declaration. No server or service
  // worker is involved; this policy also prevents future accidental HTTP calls.
  html = html.replace(
    /<meta\b[^>]*charset=["'][^"']+["'][^>]*>/i,
    (charset) =>
      `${charset}\n    <meta http-equiv="Content-Security-Policy" content="${escapeAttribute(offlinePolicy)}" />\n    <meta name="bidding-offline-build" content="${escapeAttribute(version)}-${buildId}" />`,
  );
  invariant(
    html.includes('http-equiv="Content-Security-Policy"'),
    '页面缺少 charset，无法插入离线策略。',
  );
  assertStandaloneHtml(html);
  return { html, buildId };
}
