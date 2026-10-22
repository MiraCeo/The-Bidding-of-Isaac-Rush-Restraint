/** Post-run read-only projections. Does not resimulate or overwrite frozen inventory. */
import { expect, it } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  assertAudit117,
  audit117Plan as plan,
} from '../../../scripts/audit117-plan.mjs';
import { corpusSourceProvenance } from '../../../scripts/ledger-corpus-output.mjs';
import { sha256Hex } from '../../shared/sha256';
import { readPlayerProfile, type PlayerProfile } from '../player-profile';
import {
  projectAchievementRegistry,
  withAchievementVerificationScope,
} from './registry';
it.skipIf(process.env.AUDIT117_WINDOWS !== '1')(
  'projects equal-window endpoints without replaying archived games',
  () => {
    const root = process.cwd(),
      directory = process.env.AUDIT117_DIR!,
      marker = assertAudit117(root, directory);
    const original = marker.source as {
      files: { path: string; sha256: string }[];
    };
    for (const f of original.files)
      expect(sha256Hex(readFileSync(resolve(root, f.path), 'utf8'))).toBe(
        f.sha256,
      );
    const results = [];
    for (const [window, folder] of [
      [20, plan.baseline],
      [30, plan.confirmation],
    ] as const)
      for (let block = 0; block < 6; block++) {
        const metadata = JSON.parse(
          readFileSync(resolve(root, folder, `block-${block}.json`), 'utf8'),
        );
        const profiles: Record<string, PlayerProfile> = JSON.parse(
          readFileSync(resolve(root, folder, `profiles-${block}.json`), 'utf8'),
        );
        for (const [cell, raw] of Object.entries(profiles)) {
          expect(sha256Hex(JSON.stringify(raw))).toBe(
            metadata.profileHashes[cell],
          );
          const view = withAchievementVerificationScope(() =>
            projectAchievementRegistry(readPlayerProfile(raw)),
          )!;
          results.push({
            window,
            block,
            cell,
            progress: view.progress,
            achieved: Object.keys(view.achievedAt),
          });
        }
      }
    expect(results).toHaveLength(162);
    writeFileSync(
      resolve(directory, 'windows.json'),
      JSON.stringify(results) + '\n',
      { flag: 'wx' },
    );
    writeFileSync(
      resolve(directory, 'windows-source.json'),
      JSON.stringify(
        {
          kind: 'post-run-authority-projection',
          profileSnapshots: 162,
          source: corpusSourceProvenance(root),
          windowsSha256: sha256Hex(
            readFileSync(resolve(directory, 'windows.json'), 'utf8'),
          ),
        },
        null,
        2,
      ) + '\n',
      { flag: 'wx' },
    );
  },
  1800000,
);
