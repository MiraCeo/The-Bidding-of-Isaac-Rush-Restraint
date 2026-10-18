import { it, expect } from 'vitest';
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import {
  captureCurrentCorpus,
  buildCurrentLedgerFixture,
  currentCorpusShapes,
  currentCorpusBytes,
} from './closeout-corpus.test-helper';
import { readPlayerProfile } from '../player-profile';
import {
  readAchievementRegistry,
  projectAchievementRegistry,
} from './registry';
import { canonicalJson } from '../../shared/json-facts';
import { achievementCatalog } from './catalog';
import { achievementSeries } from './series';
import {
  assertCorpusRun,
  writeCorpusJson,
  corpusSourceProvenance,
} from '../../../scripts/ledger-corpus-output.mjs';

const reportSchema = process.env.LEDGER_REPORT_SCHEMA === '8' ? 8 : 6;

const enabled = process.env.LEDGER_CORPUS_REPORT === '1';
it.runIf(enabled)(
  `exports current lifecycle templates and independently verified schema${reportSchema} scale fixtures without overwriting old reports`,
  () => {
    const webRoot = fileURLToPath(new URL('../../../', import.meta.url));
    const directory = process.env.LEDGER_CORPUS_RUN_DIR;
    if (!directory)
      throw Error(
        'Use npm run report:ledger:corpus to allocate a unique output',
      );
    assertCorpusRun(webRoot, directory);
    const traces = captureCurrentCorpus();
    const sha = (value: unknown) =>
      createHash('sha256').update(canonicalJson(value)).digest('hex');
    const templates = traces.map((t) => ({
      ...t,
      contextSha256: sha(t.context),
      units: t.context.units.length,
      stages: Object.fromEntries(
        ['entry', 'room', 'floor', 'final', 'complete'].map((stage) => [
          stage,
          t.context.units.filter((u) => u.stage === stage).length,
        ]),
      ),
    }));
    const fixtures = [],
      rows = [];
    for (const shape of currentCorpusShapes)
      for (const count of [0, 64, 256]) {
        const f = buildCurrentLedgerFixture(traces, count, shape, {
          schema: reportSchema,
          historyRows: 200,
          paddingChars: 32768,
          completionReceipts: 128,
        });
        const loaded = readPlayerProfile(JSON.parse(canonicalJson(f.profile)));
        expect(readAchievementRegistry(loaded)).toEqual(f.registry);
        if (count)
          expect(f.wire).toMatchObject({
            version: reportSchema,
            catalogVersion: reportSchema === 8 ? 7 : 5,
          });
        else expect(f.wire).toBeNull();
        rows.push({
          ...f.provenance,
          status: count
            ? `schema${reportSchema}-validated`
            : 'current-empty-ledger',
          wireVersion: f.wire?.version ?? null,
          catalogVersion: f.wire?.catalogVersion ?? null,
          moduleBytes: f.wire ? Buffer.byteLength(canonicalJson(f.wire)) : 0,
          profileBytes: currentCorpusBytes(loaded),
          profileSha256: sha(loaded),
          projectionSha256: sha(projectAchievementRegistry(loaded)),
        });
        if (count === 64) fixtures.push({ ...f.provenance, profile: loaded });
      }
    writeCorpusJson(webRoot, directory, 'corpus.json', {
      kind: `synthetic-schema${reportSchema}-ledger-corpus-not-player-backup`,
      version: 1,
      templates,
      fixtures,
    });
    writeCorpusJson(webRoot, directory, 'manifest.json', {
      kind: `schema${reportSchema}-corpus-readiness`,
      version: 1,
      generatedAt: new Date().toISOString(),
      applicationVersion: JSON.parse(
        readFileSync(resolve(webRoot, 'package.json'), 'utf8'),
      ).version,
      runtime: {
        node: process.version,
        v8: process.versions.v8,
        platform: process.platform,
        arch: process.arch,
      },
      source: corpusSourceProvenance(webRoot),
      catalog: {
        medals: achievementCatalog.length,
        cards:
          achievementCatalog.length -
          achievementSeries.reduce((n, s) => n + s.ids.length - 1, 0),
        series: achievementSeries.length,
        schema: reportSchema,
        catalogVersion: reportSchema === 8 ? 7 : 5,
        baseline: 1,
      },
      scope:
        'Official-rule Node lifecycle templates; scaled identities and branch topology synthetic. Validity/size samples only, NOT complete achievement cause coverage, worst-case capacity, performance timings, browser or release acceptance.',
      plannedCapacityCounts: [0, 64, 256, 2048, 4096, 8192, 12288, 16384],
      measuredCapacityOrPerformance: false,
      templates: templates.map(({ context: _context, ...t }) => t),
      rows,
    });
  },
  30000,
);
