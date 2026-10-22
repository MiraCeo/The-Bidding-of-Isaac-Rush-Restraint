import { expect, it } from 'vitest';
import {
  readFileSync,
  writeFileSync,
  appendFileSync,
  realpathSync,
  lstatSync,
} from 'node:fs';
import { resolve, dirname, basename } from 'node:path';
import { populationRevisionPlan as plan } from '../../../scripts/classic-population-revision-plan.mjs';
import { corpusSourceProvenance } from '../../../scripts/ledger-corpus-output.mjs';
import { achievementCharacters } from './catalog';
import { studyPolicies } from './difficulty-study.test-helper';
import { runPopulationMatch } from './classic-population.test-helper';

it.skipIf(process.env.CLASSIC_POPULATION_REVISION !== '1')(
  'compares user-revised populations against previous populations',
  () => {
    const root = process.cwd(),
      directory = resolve(process.env.CLASSIC_POPULATION_REVISION_DIR!);
    if (
      dirname(directory) !== resolve(root, 'work/0.8/classic-mistake-study') ||
      !/^composition-[A-Za-z0-9]+$/.test(basename(directory)) ||
      lstatSync(directory).isSymbolicLink() ||
      realpathSync(directory) !== directory
    )
      throw Error('Invalid composition directory');
    const run = JSON.parse(
      readFileSync(resolve(directory, 'run.json'), 'utf8'),
    );
    expect(run.kind).toBe('v080-classic-population-user-revision');
    expect(run.plan).toEqual(plan);
    expect(plan.roles).toEqual(achievementCharacters);
    expect(plan.policies).toEqual(studyPolicies);
    expect(corpusSourceProvenance(root).files).toEqual(run.source.files);
    const rowsFile = resolve(directory, 'rows.jsonl'),
      witness = resolve(directory, 'mistakes.jsonl');
    writeFileSync(rowsFile, '', { flag: 'wx' });
    writeFileSync(witness, '', { flag: 'wx' });
    let count = 0;
    for (let block = 0; block < plan.blocks; block++) {
      for (const role of plan.roles)
        for (const policy of plan.policies) {
          const rows = plan.arms.map((arm) =>
            runPopulationMatch(
              block,
              role,
              policy,
              arm,
              (e) =>
                appendFileSync(
                  witness,
                  JSON.stringify({ block, role, policy, arm: arm.id, ...e }) +
                    '\n',
                ),
              plan,
            ),
          );
          expect(new Set(rows.map((r) => r.world)).size).toBe(1);
          expect(
            new Set(rows.map((r) => JSON.stringify(r.assignmentOrder))).size,
          ).toBe(1);
          for (const row of rows) {
            appendFileSync(rowsFile, JSON.stringify(row) + '\n');
            count++;
          }
        }
      console.info(
        `revised population block ${block + 1}/${plan.blocks} complete`,
      );
    }
    expect(count).toBe(6300);
    expect(corpusSourceProvenance(root).files).toEqual(run.source.files);
    writeFileSync(
      resolve(directory, 'complete.json'),
      JSON.stringify({
        matches: count,
        blocks: plan.blocks,
        completedAt: new Date().toISOString(),
      }) + '\n',
      { flag: 'wx' },
    );
  },
  60 * 60 * 1000,
);
