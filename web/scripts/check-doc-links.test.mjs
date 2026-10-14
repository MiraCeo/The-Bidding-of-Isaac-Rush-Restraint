import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, expect, it } from 'vitest';
import { checkDocumentation, localLinkTargets } from './check-doc-links.mjs';

const fixtures = [];
it('validates the actual source documentation tree and the relocated research data', () => {
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const report = checkDocumentation(root);
  expect(report.errors).toEqual([]);
  expect(report.researchJson).toBe(2);
  expect(report.files).toBeGreaterThan(100);
});
function fixture() {
  const root = mkdtempSync(path.join(tmpdir(), 'isaac-doc-check-'));
  fixtures.push(root);
  return root;
}
function put(root, file, content = '') {
  const target = path.join(root, file);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, content);
}
afterEach(() => {
  for (const root of fixtures.splice(0)) {
    const absolute = path.resolve(root),
      base = path.resolve(tmpdir());
    if (
      !absolute.startsWith(base + path.sep) ||
      !path.basename(absolute).startsWith('isaac-doc-check-')
    )
      throw new Error('Invalid temporary fixture cleanup target');
    rmSync(absolute, { recursive: true, force: true });
  }
});

it('ignores remote, anchor and code examples while reading images and reference targets', () => {
  const source =
    '[remote](https://example.test/) [anchor](#part)\n`[code](missing.md)`\n```md\n[example](missing.md)\n```\n![image](./art.png)\n[guide][id]\n[id]: <./guide.md> "Title"';
  expect(localLinkTargets(source)).toEqual(['./art.png', './guide.md']);
});
it('resolves relocated relative paths, encoded percent names and optional titles', () => {
  const root = fixture();
  put(root, 'README.md', '[index](./docs/index.md)');
  put(
    root,
    'docs/index.md',
    '[root](../README.md)\n[report](./archive/20%25.md "Original")',
  );
  put(root, 'docs/archive/20%.md', '# Fixed report');
  expect(checkDocumentation(root)).toMatchObject({
    files: 3,
    links: 3,
    errors: [],
  });
});
it('reports missing and out-of-repository targets instead of scanning another directory', () => {
  const root = fixture();
  put(
    root,
    'README.md',
    '[missing](./lost.md)\n[outside](../private.md)\n[bad](./bad%xx.md)',
  );
  expect(checkDocumentation(root).errors.map((error) => error.reason)).toEqual([
    'missing target',
    'outside repository',
    'invalid URL encoding',
  ]);
});
it('includes asset documentation but excludes dependencies, generated output and work evidence', () => {
  const root = fixture();
  put(root, 'README.md', '# Root');
  put(root, 'web/assets/items/README.md', '[root](../../../README.md)');
  for (const directory of ['web/work', 'web/dist', 'web/node_modules', '.git'])
    put(root, `${directory}/README.md`, '[not-source](missing.md)');
  expect(checkDocumentation(root)).toMatchObject({
    files: 2,
    links: 1,
    errors: [],
  });
});
it('preserves the archived research JSON and checks its relocated LF attribute rule', () => {
  const root = fixture();
  put(root, 'README.md', '# Root');
  put(root, 'docs/归档/早期研究/研究数据/study.json', '{\n"seed":42\n}\n');
  put(
    root,
    '.gitattributes',
    'docs/归档/早期研究/研究数据/*.json text eol=lf\n',
  );
  expect(checkDocumentation(root)).toMatchObject({
    researchJson: 1,
    errors: [],
  });
  put(root, '.gitattributes', '历史文档/研究数据/*.json text eol=lf\n');
  expect(checkDocumentation(root).errors).toContainEqual({
    file: '.gitattributes',
    reason: 'missing relocated research JSON LF rule',
  });
});
it('rejects CRLF or invalid JSON without changing archived bytes', () => {
  const root = fixture();
  put(root, 'README.md', '# Root');
  put(
    root,
    '.gitattributes',
    'docs/归档/早期研究/研究数据/*.json text eol=lf\n',
  );
  put(root, 'docs/归档/早期研究/研究数据/study.json', '{\r\ninvalid\r\n}');
  expect(checkDocumentation(root).errors.map((error) => error.reason)).toEqual([
    'research JSON must retain LF',
    'invalid research JSON',
  ]);
});
it('reports local generated artifacts separately so clean clones do not require untracked build or evidence files', () => {
  const root = fixture();
  put(
    root,
    'README.md',
    '[output](./web/dist-offline/game.html)\n[evidence](./web/work/report.json)\n[source](./docs/missing.md)',
  );
  const report = checkDocumentation(root);
  expect(report.localArtifacts).toHaveLength(2);
  expect(report.localArtifacts.every((row) => !row.present)).toBe(true);
  expect(report.errors).toEqual([
    {
      file: 'README.md',
      target: './docs/missing.md',
      reason: 'missing target',
    },
  ]);
});
