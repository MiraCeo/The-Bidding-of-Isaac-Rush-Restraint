import { expect, it } from 'vitest';
import {
  readFileSync,
  writeFileSync,
  appendFileSync,
  realpathSync,
  lstatSync,
} from 'node:fs';
import { resolve, dirname, basename } from 'node:path';
import { mistakePlan } from '../../../scripts/classic-mistake-plan.mjs';
import { corpusSourceProvenance } from '../../../scripts/ledger-corpus-output.mjs';
import { achievementCharacters } from './catalog';
import { studyPolicies } from './difficulty-study.test-helper';
import { runMistakeMatch } from './classic-mistake.test-helper';

it.skipIf(process.env.CLASSIC_MISTAKE_STUDY !== '1')(
  'collects the preregistered isolated quote-mistake trial',
  () => {
    const root = process.cwd(),
      directory = resolve(process.env.CLASSIC_MISTAKE_STUDY_DIR!);
    if (
      dirname(directory) !== resolve(root, 'work/0.8/classic-mistake-study') ||
      !/^trial-[A-Za-z0-9]+$/.test(basename(directory)) ||
      lstatSync(directory).isSymbolicLink() ||
      realpathSync(directory) !== directory
    )
      throw Error('Invalid mistake output directory');
    const marker = JSON.parse(
      readFileSync(resolve(directory, 'run.json'), 'utf8'),
    );
    expect(marker.kind).toBe('v080-isolated-classic-quote-mistakes');
    expect(marker.plan).toEqual(mistakePlan);
    expect(mistakePlan.roles).toEqual(achievementCharacters);
    expect(mistakePlan.policies).toEqual(studyPolicies);
    expect(corpusSourceProvenance(root).files).toEqual(marker.source.files);
    const rowsFile = resolve(directory, 'rows.jsonl'),
      witnessFile = resolve(directory, 'mistakes.jsonl');
    writeFileSync(rowsFile, '', { flag: 'wx' });
    writeFileSync(witnessFile, '', { flag: 'wx' });
    let matches = 0;
    for (let block = 0; block < mistakePlan.blocks; block++) {
      for (const role of mistakePlan.roles)
        for (const policy of mistakePlan.policies) {
          const rows = mistakePlan.arms.map((arm) =>
            runMistakeMatch(block, role, policy, arm, (event) =>
              appendFileSync(
                witnessFile,
                JSON.stringify({ block, role, policy, arm: arm.id, ...event }) +
                  '\n',
              ),
            ),
          );
          expect(new Set(rows.map((r) => r.world)).size).toBe(1);
          for (const row of rows) {
            appendFileSync(rowsFile, JSON.stringify(row) + '\n');
            matches++;
          }
        }
      console.info(
        `mistake trial block ${block + 1}/${mistakePlan.blocks} complete`,
      );
    }
    expect(matches).toBe(5400);
    expect(corpusSourceProvenance(root).files).toEqual(marker.source.files);
    writeFileSync(
      resolve(directory, 'complete.json'),
      JSON.stringify({
        matches,
        blocks: mistakePlan.blocks,
        completedAt: new Date().toISOString(),
      }) + '\n',
      { flag: 'wx' },
    );
  },
  60 * 60 * 1000,
);
