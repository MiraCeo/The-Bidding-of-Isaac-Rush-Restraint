/** Opt-in only: immutable 60-block current-policy classic study. */
import { readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, it } from 'vitest';
import { classicDifficulties } from '../../game/classic-difficulty';
import { achievementCharacters } from './catalog';
import { studyPolicies } from './difficulty-study.test-helper';
import { runClassicTierMatch } from './classic-tier-study.test-helper';
import { corpusSourceProvenance } from '../../../scripts/ledger-corpus-output.mjs';

it.skipIf(process.env.CLASSIC_TIER_STUDY !== '1')(
  'collects classic-only paired current-policy evidence',
  () => {
    const directory = resolve(process.env.CLASSIC_TIER_STUDY_DIR!);
    const marker = JSON.parse(
      readFileSync(resolve(directory, 'run.json'), 'utf8'),
    );
    expect(marker.kind).toBe('v080-classic-tier-diagnosis');
    expect(marker.blocks).toBe(60);
    expect(marker.roles).toEqual(achievementCharacters);
    expect(marker.policies).toEqual(studyPolicies);
    expect(marker.tiers).toEqual(classicDifficulties);
    expect(corpusSourceProvenance(process.cwd()).files).toEqual(
      marker.source.files,
    );
    const output = resolve(directory, 'rows.jsonl');
    writeFileSync(output, '', { flag: 'wx' });
    for (let block = 0; block < 60; block++) {
      for (const role of achievementCharacters)
        for (const policy of studyPolicies) {
          const rows = classicDifficulties.map((d) =>
            runClassicTierMatch(block, role, policy, d),
          );
          expect(new Set(rows.map((r) => r.initialWorld)).size).toBe(1);
          for (const row of rows)
            appendFileSync(output, JSON.stringify(row) + '\n');
        }
      console.info(`classic tier block ${block + 1}/60 complete`);
    }
    expect(corpusSourceProvenance(process.cwd()).files).toEqual(
      marker.source.files,
    );
    writeFileSync(
      resolve(directory, 'complete.json'),
      JSON.stringify({
        matches: 3600,
        blocks: 60,
        completedAt: new Date().toISOString(),
      }) + '\n',
      { flag: 'wx' },
    );
  },
  60 * 60 * 1000,
);
