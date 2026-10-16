import { it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { achievementCharacters, achievementCatalog } from './catalog';
import { achievementCollectionMetadata } from './collection-metadata';
import { achievementNumber } from './numbering';
import { achievementSeries } from './series';
import { studyPolicies } from './difficulty-study.test-helper';
import {
  currentStudyDifficulties,
  pairedStudySeed,
  runCurrentStudyMatch,
  advanceStudyProfile,
  freshStudyProfile,
  availableStudyRoles,
  summarizeCurrentRows,
  type CurrentStudyRow,
  type CurrentStudyDifficulty,
} from './current-study.test-helper';
import { projectAchievementRegistry } from './registry';
import { readPlayerProfile, type PlayerProfile } from '../player-profile';
import {
  assertStudyRun,
  writeStudyJson,
  corpusSourceProvenance,
} from '../../../scripts/current-study-output.mjs';
import packageInfo from '../../../package.json';
import { canonicalJson } from '../../shared/json-facts';
const enabled = process.env.CURRENT_ACHIEVEMENT_STUDY === '1';
it.skipIf(!enabled)(
  'runs a frozen current-catalog batch and genuine persistent-profile campaigns',
  () => {
    const root = fileURLToPath(new URL('../../../', import.meta.url)),
      directory = process.env.CURRENT_STUDY_DIR!,
      batch = Number(process.env.CURRENT_STUDY_BATCH);
    const marker = assertStudyRun(root, directory),
      purpose = marker.purpose;
    if (purpose === 'analysis')
      throw Error('Analysis is not a simulation batch');
    const batches = purpose === 'pilot' ? 1 : 4;
    if (!Number.isInteger(batch) || batch < 0 || batch >= batches)
      throw Error('Invalid research batch');
    expect(corpusSourceProvenance(root)).toEqual(marker.source);
    const profiles: Record<string, PlayerProfile> = batch
      ? JSON.parse(
          readFileSync(
            resolve(directory, `profiles-${batch - 1}.json`),
            'utf8',
          ),
        )
      : {};
    for (const [key, p] of Object.entries(profiles))
      profiles[key] = readPlayerProfile(p);
    const rows: CurrentStudyRow[] = [];
    const start = performance.now(),
      count = purpose === 'pilot' ? 2 : 5,
      offset = batch * count;
    const specifications =
      purpose === 'campaign'
        ? Array.from({ length: 5 }, (_, rep) =>
            ['classic', 'standard'].flatMap((difficulty) =>
              studyPolicies.map((policy) => ({
                cell: `new-profile-${rep}/${policy}/${difficulty}`,
                role: 'isaac' as const,
                difficulty: difficulty as CurrentStudyDifficulty,
                policy,
                rep,
              })),
            ),
          ).flat()
        : achievementCharacters.flatMap((role) =>
            currentStudyDifficulties.flatMap((difficulty) =>
              studyPolicies.map((policy) => ({
                cell: `${role}/${policy}/${difficulty}`,
                role,
                difficulty,
                policy,
                rep: 0,
              })),
            ),
          );
    for (let i = offset; i < offset + count; i++) {
      for (const spec of specifications) {
        const profile = profiles[spec.cell] ?? freshStudyProfile();
        const available =
          purpose === 'campaign' ? availableStudyRoles(profile) : [];
        const role =
          purpose === 'campaign' ? available[i % available.length]! : spec.role;
        const seedIndex =
          purpose === 'campaign'
            ? 1000 + spec.rep * 20 + i
            : purpose === 'main'
              ? 2 + i
              : i;
        const seed = pairedStudySeed(seedIndex),
          identity = `${spec.cell}/${seedIndex}`;
        const result = runCurrentStudyMatch(
          seed,
          role,
          spec.policy,
          spec.difficulty,
        );
        const before = JSON.stringify(profile);
        const campaign = advanceStudyProfile(
          profile,
          result.context,
          i + 1,
          i === offset || i === offset + count - 1,
        );
        expect(JSON.stringify(profile)).toBe(before);
        expect(result.context.units.at(-1)!.stage).toBe('complete');
        expect(
          createHash('sha256')
            .update(canonicalJson(JSON.parse(JSON.stringify(result.context))))
            .digest('hex'),
        ).toBe(result.match.traceFingerprint);
        expect(Object.keys(result.progress)).toHaveLength(117);
        expect(result.exposure.eternalMissingEvidenceRooms).toBe(0);
        profiles[spec.cell] = campaign.profile;
        const row: CurrentStudyRow = {
          identity,
          cell: spec.cell,
          index: i + 1,
          seedIndex,
          role,
          match: result.match,
          exposure: result.exposure,
          causes: result.causes,
          progress: result.progress,
          achieved: result.match.achieved,
          campaignProgress: campaign.progress,
          campaignAchieved: campaign.achieved,
          unlocks: campaign.unlocks,
        };
        rows.push(row);
        writeStudyJson(
          root,
          directory,
          `witness-${seedIndex}-${specifications.indexOf(spec)}.json`,
          {
            identity,
            seed,
            role,
            difficulty: spec.difficulty,
            policy: spec.policy,
            context: result.context,
            causeWitnesses: result.witnesses,
            opportunities: result.exposure,
          },
        );
      }
      process.stdout.write(
        `seed step ${i + 1}: ${rows.length} matches in this batch\n`,
      );
    }
    expect(rows).toHaveLength(specifications.length * count);
    writeStudyJson(root, directory, `rows-${batch}.json`, rows);
    writeStudyJson(root, directory, `profiles-${batch}.json`, profiles);
    writeStudyJson(root, directory, `batch-${batch}.json`, {
      matches: rows.length,
      elapsedMs: performance.now() - start,
      seedOffset: offset,
      steps: count,
    });
    if (batch === batches - 1) {
      const all = Array.from({ length: batches }, (_, n) =>
        n === batch
          ? rows
          : (JSON.parse(
              readFileSync(resolve(directory, `rows-${n}.json`), 'utf8'),
            ) as CurrentStudyRow[]),
      ).flat();
      const summary = summarizeCurrentRows(all, purpose !== 'campaign');
      const source = corpusSourceProvenance(root);
      expect(source).toEqual(marker.source);
      writeStudyJson(root, directory, 'summary.json', {
        kind: 'current117-achievement-difficulty',
        version: packageInfo.version,
        ledgerSchema: 7,
        catalogVersion: 6,
        purpose,
        matches: all.length,
        source,
        policies: studyPolicies,
        scope:
          'scripted policies, not human telemetry; per-cell seeds are paired across conditions; campaign paths are observed/censored, not independent-player timing estimates',
        seedFormula:
          '(0x65100000 + (index+1)*7919) >>> 0; pilot 0..1, main 2..21, new-profile campaigns 1000..1099',
        roleAssignment:
          purpose === 'campaign'
            ? 'fresh-profile actual unlocked roles only, deterministic rotation, no manual grants'
            : 'controlled role scenarios regardless of initial UI locks; not new-player unlock paths',
        statistics:
          'Wilson intervals are per-cell single-match model diagnostics, not human probabilities; room opportunities are descriptive and correlated',
        catalog: achievementCatalog.map((a) => ({
          ...a,
          number: achievementNumber(a.id),
          ...achievementCollectionMetadata[a.id],
        })),
        series: achievementSeries,
        cells: summary,
        finalProfiles: Object.fromEntries(
          Object.entries(profiles).map(([cell, p]) => [
            cell,
            {
              sha256: createHash('sha256')
                .update(JSON.stringify(p))
                .digest('hex'),
              achieved: projectAchievementRegistry(p)!.achievedAt,
            },
          ]),
        ),
      });
    }
  },
  1800000,
);
