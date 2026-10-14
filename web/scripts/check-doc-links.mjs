import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Local documentation only: no network, anchor checks, generated output or game execution. */
export function localLinkTargets(markdown) {
  const text = markdown
    .replace(/```[^\n]*\n[\s\S]*?```|~~~[^\n]*\n[\s\S]*?~~~/g, '')
    .replace(/`[^`\n]+`/g, '');
  const targets = [];
  const inline =
    /!?\[[^\]\n]*\]\(\s*(<[^>\n]+>|[^\s)\n]+)(?:\s+(?:"[^"]*"|'[^']*'))?\s*\)/g;
  for (const match of text.matchAll(inline))
    targets.push(match[1].replace(/^<|>$/g, ''));
  // Include reference definitions, whether reused or not; do not infer executable instructions.
  for (const match of text.matchAll(/^\s*\[[^\]\n]+\]:\s*(<[^>\n]+>|\S+)/gm))
    targets.push(match[1].replace(/^<|>$/g, ''));
  return targets.filter(
    (target) => !/^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(target),
  );
}

function markdownFiles(directory) {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) return [];
    if (entry.isDirectory()) return markdownFiles(file);
    return entry.isFile() && entry.name.endsWith('.md') ? [file] : [];
  });
}

export function checkDocumentation(rootDirectory) {
  const root = path.resolve(rootDirectory);
  const files = readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
    .map((entry) => path.join(root, entry.name));
  for (const directory of ['docs', 'web/assets', '.github', 'deploy'])
    files.push(...markdownFiles(path.join(root, directory)));
  const errors = [];
  const localArtifacts = [];
  let links = 0;
  const relative = (file) =>
    path.relative(root, file).split(path.sep).join('/');
  for (const file of files.sort()) {
    for (const target of localLinkTargets(readFileSync(file, 'utf8'))) {
      const source = target.split(/[?#]/, 1)[0];
      if (!source) continue;
      links++;
      let decoded;
      try {
        decoded = decodeURIComponent(source);
      } catch {
        errors.push({
          file: relative(file),
          target,
          reason: 'invalid URL encoding',
        });
        continue;
      }
      const resolved = decoded.startsWith('/')
        ? path.resolve(root, `.${decoded}`)
        : path.resolve(path.dirname(file), decoded);
      const within = path.relative(root, resolved);
      if (
        within === '..' ||
        within.startsWith(`..${path.sep}`) ||
        path.isAbsolute(within)
      )
        errors.push({
          file: relative(file),
          target,
          reason: 'outside repository',
        });
      else if (
        ['web/dist/', 'web/dist-offline/', 'web/releases/', 'web/work/'].some(
          (prefix) => relative(resolved).startsWith(prefix),
        )
      )
        localArtifacts.push({
          file: relative(file),
          target,
          present: existsSync(resolved),
        });
      else if (!existsSync(resolved))
        errors.push({ file: relative(file), target, reason: 'missing target' });
    }
  }

  const dataDirectory = path.join(root, 'docs/归档/早期研究/研究数据');
  const jsonFiles = existsSync(dataDirectory)
    ? readdirSync(dataDirectory).filter((file) => file.endsWith('.json'))
    : [];
  for (const name of jsonFiles) {
    const file = path.join(dataDirectory, name),
      source = readFileSync(file, 'utf8');
    if (source.includes('\r'))
      errors.push({
        file: relative(file),
        reason: 'research JSON must retain LF',
      });
    try {
      JSON.parse(source);
    } catch {
      errors.push({ file: relative(file), reason: 'invalid research JSON' });
    }
  }
  if (jsonFiles.length) {
    const attributes = path.join(root, '.gitattributes');
    const source = existsSync(attributes)
      ? readFileSync(attributes, 'utf8')
      : '';
    if (
      !source
        .split(/\r?\n/)
        .some((line) =>
          /^docs\/归档\/早期研究\/研究数据\/\*\.json\s+text\s+eol=lf\s*$/.test(
            line,
          ),
        )
    )
      errors.push({
        file: '.gitattributes',
        reason: 'missing relocated research JSON LF rule',
      });
  }
  return {
    scope:
      'source Markdown local targets and archived research JSON; local generated artifacts reported separately, no remote or anchor checks',
    files: files.length,
    links,
    researchJson: jsonFiles.length,
    localArtifacts,
    errors,
  };
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const report = checkDocumentation(root);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  process.exitCode = report.errors.length ? 1 : 0;
}
