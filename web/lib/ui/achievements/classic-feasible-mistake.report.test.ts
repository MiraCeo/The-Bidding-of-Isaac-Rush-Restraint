import { expect, it } from 'vitest';
import {
  readFileSync,
  writeFileSync,
  appendFileSync,
  realpathSync,
  lstatSync,
} from 'node:fs';
import { resolve, dirname, basename } from 'node:path';
import { feasibleMistakePlan as plan } from '../../../scripts/classic-feasible-mistake-plan.mjs';
import { corpusSourceProvenance } from '../../../scripts/ledger-corpus-output.mjs';
import { achievementCharacters } from './catalog';
import { studyPolicies } from './difficulty-study.test-helper';
import { runFeasibleMistakeMatch } from './classic-feasible-mistake.test-helper';

it.skipIf(process.env.CLASSIC_FEASIBLE_MISTAKE_STUDY !== '1')(
  'tests feasibility-first type selection without changing probabilities or candidate rules',
  () => {
    const root = process.cwd(),
      directory = resolve(process.env.CLASSIC_FEASIBLE_MISTAKE_DIR!);
    if (
      dirname(directory) !== resolve(root, 'work/0.8/classic-mistake-study') ||
      !/^selection-[A-Za-z0-9]+$/.test(basename(directory)) ||
      lstatSync(directory).isSymbolicLink() ||
      realpathSync(directory) !== directory
    )
      throw Error('Invalid selection output');
    const marker = JSON.parse(
      readFileSync(resolve(directory, 'run.json'), 'utf8'),
    );
    expect(marker.kind).toBe('v080-classic-feasible-first-selection');
    expect(marker.plan).toEqual(plan);
    expect(plan.roles).toEqual(achievementCharacters);
    expect(plan.policies).toEqual(studyPolicies);
    expect(corpusSourceProvenance(root).files).toEqual(marker.source.files);
    const rowsFile = resolve(directory, 'rows.jsonl'),
      witness = resolve(directory, 'mistakes.jsonl');
    writeFileSync(rowsFile, '', { flag: 'wx' });
    writeFileSync(witness, '', { flag: 'wx' });
    let count = 0;
    for (let block = 0; block < plan.blocks; block++) {
      for (const role of plan.roles)
        for (const policy of plan.policies) {
          const rows = plan.arms.map((arm) =>
            runFeasibleMistakeMatch(block, role, policy, arm, (e) =>
              appendFileSync(
                witness,
                JSON.stringify({ block, role, policy, arm: arm.id, ...e }) +
                  '\n',
              ),
            ),
          );
          expect(new Set(rows.map((r) => r.world)).size).toBe(1);
          for (const row of rows) {
            appendFileSync(rowsFile, JSON.stringify(row) + '\n');
            count++;
          }
        }
      console.info(
        `selection trial block ${block + 1}/${plan.blocks} complete`,
      );
    }
    expect(count).toBe(5400);
    expect(corpusSourceProvenance(root).files).toEqual(marker.source.files);
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
