import { expect, it } from 'vitest';
import {
  readFileSync,
  writeFileSync,
  appendFileSync,
  realpathSync,
  lstatSync,
} from 'node:fs';
import { resolve, dirname, basename } from 'node:path';
import { mistakeTierPlan as plan } from '../../../scripts/classic-mistake-tier-plan.mjs';
import { corpusSourceProvenance } from '../../../scripts/ledger-corpus-output.mjs';
import { achievementCharacters } from './catalog';
import { studyPolicies } from './difficulty-study.test-helper';
import { runMistakeTierMatch } from './classic-mistake-tier.test-helper';

it.skipIf(process.env.CLASSIC_MISTAKE_TIER_STUDY !== '1')(
  'collects the user-specified 25/15/5/0 quote-lapse trial',
  () => {
    const root = process.cwd(),
      directory = resolve(process.env.CLASSIC_MISTAKE_TIER_DIR!);
    if (
      dirname(directory) !== resolve(root, 'work/0.8/classic-mistake-study') ||
      !/^tiers-[A-Za-z0-9]+$/.test(basename(directory)) ||
      lstatSync(directory).isSymbolicLink() ||
      realpathSync(directory) !== directory
    )
      throw Error('Invalid tier mistake directory');
    const marker = JSON.parse(
      readFileSync(resolve(directory, 'run.json'), 'utf8'),
    );
    expect(marker.kind).toBe('v080-classic-mistake-tiers-25-15-5-0');
    expect(marker.plan).toEqual(plan);
    expect(plan.roles).toEqual(achievementCharacters);
    expect(plan.policies).toEqual(studyPolicies);
    expect(corpusSourceProvenance(root).files).toEqual(marker.source.files);
    const output = resolve(directory, 'rows.jsonl'),
      witness = resolve(directory, 'mistakes.jsonl');
    writeFileSync(output, '', { flag: 'wx' });
    writeFileSync(witness, '', { flag: 'wx' });
    let count = 0;
    for (let block = 0; block < plan.blocks; block++) {
      for (const role of plan.roles)
        for (const policy of plan.policies) {
          const rows = plan.arms.map((arm) =>
            runMistakeTierMatch(block, role, policy, arm, (event) =>
              appendFileSync(
                witness,
                JSON.stringify({ block, role, policy, arm: arm.id, ...event }) +
                  '\n',
              ),
            ),
          );
          expect(new Set(rows.map((r) => r.world)).size).toBe(1);
          for (const row of rows) {
            appendFileSync(output, JSON.stringify(row) + '\n');
            count++;
          }
        }
      console.info(`25/15/5/0 block ${block + 1}/${plan.blocks} complete`);
    }
    expect(count).toBe(3600);
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
