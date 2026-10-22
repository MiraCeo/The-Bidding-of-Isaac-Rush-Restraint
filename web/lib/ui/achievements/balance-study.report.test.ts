import { expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import {
  balanceScenarios,
  balanceSeed,
  runBalanceMatch,
  type BalanceScenario,
} from './balance-study.test-helper';
import {
  studyPolicies,
  type StudyPolicy,
} from './difficulty-study.test-helper';
import { achievementCharacters, achievementCatalog } from './catalog';
import { achievementNumber } from './numbering';
import { achievementCollectionMetadata } from './collection-metadata';
import {
  advanceStudyProfile,
  freshStudyProfile,
  availableStudyRoles,
} from './current-study.test-helper';
import { readPlayerProfile, type PlayerProfile } from '../player-profile';
import { canonicalJson } from '../../shared/json-facts';
import {
  assertBalanceRun,
  writeBalanceJson,
  balanceStudyPlan,
  corpusSourceProvenance,
} from '../../../scripts/balance-study-output.mjs';
import packageInfo from '../../../package.json';

// Explicit opt-in. Ordinary npm test must never start this matrix.
it.skipIf(process.env.BALANCE_STUDY !== '1')(
  'runs one preregistered current-policy balance batch',
  () => {
    const root = fileURLToPath(new URL('../../../', import.meta.url)),
      directory = process.env.BALANCE_STUDY_DIR!,
      batch = Number(process.env.BALANCE_STUDY_BATCH),
      marker = assertBalanceRun(root, directory);
    if (marker.purpose === 'analysis')
      throw Error('Analysis is not a simulation');
    const purpose = marker.purpose,
      plan = balanceStudyPlan[purpose];
    if (!Number.isInteger(batch) || batch < 0 || batch >= plan.batches)
      throw Error('Invalid balance batch');
    expect(corpusSourceProvenance(root)).toEqual(marker.source);
    const campaignScenarios: BalanceScenario[] = [
      { mode: 'classic', difficulty: 'highest' },
      { mode: 'survival', difficulty: 'standard' },
    ];
    const specifications: {
      cell: string;
      role: (typeof achievementCharacters)[number];
      policy: StudyPolicy;
      scenario: BalanceScenario;
      rep: number;
    }[] =
      purpose === 'campaign'
        ? Array.from({ length: plan.repetitions! }, (_, rep) =>
            campaignScenarios.flatMap((scenario) =>
              studyPolicies.map((policy) => ({
                cell: `${scenario.mode}/${scenario.difficulty}/${policy}/new-${rep}`,
                role: 'isaac' as const,
                policy,
                scenario,
                rep,
              })),
            ),
          ).flat()
        : achievementCharacters.flatMap((role) =>
            balanceScenarios.flatMap((scenario) =>
              studyPolicies.map((policy) => ({
                cell: `${scenario.mode}/${scenario.difficulty}/${policy}/${role}`,
                role,
                policy,
                scenario,
                rep: 0,
              })),
            ),
          );
    const profiles: Record<string, PlayerProfile> = batch
      ? JSON.parse(
          readFileSync(
            resolve(directory, `profiles-${batch - 1}.json`),
            'utf8',
          ),
        )
      : {};
    for (const key of Object.keys(profiles))
      profiles[key] = readPlayerProfile(profiles[key]);
    const rows: Record<string, unknown>[] = [],
      start = performance.now(),
      offset = batch * plan.stepsPerBatch;
    for (let step = offset; step < offset + plan.stepsPerBatch; step++) {
      const worlds = new Map<string, string>();
      for (const [specIndex, spec] of specifications.entries()) {
        const profile = profiles[spec.cell] ?? freshStudyProfile(),
          available = availableStudyRoles(profile);
        const role =
          purpose === 'campaign'
            ? available[step % available.length]!
            : spec.role;
        const seedIndex =
            plan.seedStart +
            step +
            (purpose === 'campaign' ? spec.rep * plan.steps : 0),
          seed = balanceSeed(seedIndex);
        const result = runBalanceMatch(seed, role, spec.policy, spec.scenario);
        const worldKey = `${spec.scenario.mode}/${role}/${spec.policy}`;
        if (purpose !== 'campaign' && worlds.has(worldKey))
          expect(result.diagnostics.firstWorld).toBe(worlds.get(worldKey));
        else worlds.set(worldKey, result.diagnostics.firstWorld);
        const raw = JSON.stringify(profile),
          advanced = advanceStudyProfile(
            profile,
            result.context,
            step + 1,
            step === offset || step === offset + plan.stepsPerBatch - 1,
          );
        expect(JSON.stringify(profile)).toBe(raw);
        expect(result.context.units.at(-1)!.stage).toBe('complete');
        expect(result.exposure.eternalMissingEvidenceRooms).toBe(0);
        expect(
          createHash('sha256')
            .update(canonicalJson(result.context))
            .digest('hex'),
        ).toBe(result.match.traceFingerprint);
        profiles[spec.cell] = advanced.profile;
        const identity = `${spec.cell}/${seedIndex}`;
        rows.push({
          identity,
          cell: spec.cell,
          index: step + 1,
          seedIndex,
          seed,
          role,
          policy: spec.policy,
          scenario: spec.scenario,
          match: result.match,
          exposure: result.exposure,
          causes: result.causes,
          progress: result.progress,
          achieved: result.match.achieved,
          diagnostics: result.diagnostics,
          campaignProgress: advanced.progress,
          campaignAchieved: advanced.achieved,
          unlocks: advanced.unlocks,
          availableRolesBefore: available,
        });
        writeBalanceJson(root, directory, `witness-${step}-${specIndex}.json`, {
          identity,
          seed,
          role,
          scenario: spec.scenario,
          policy: spec.policy,
          context: result.context,
          traceFingerprint: result.match.traceFingerprint,
          opportunities: result.exposure,
          causeWitnesses: result.witnesses,
        });
      }
      process.stdout.write(
        `${purpose} step ${step + 1}: ${rows.length} matches in this batch\n`,
      );
    }
    writeBalanceJson(root, directory, `rows-${batch}.json`, rows);
    writeBalanceJson(root, directory, `profiles-${batch}.json`, profiles);
    writeBalanceJson(root, directory, `batch-${batch}.json`, {
      matches: rows.length,
      elapsedMs: performance.now() - start,
    });
    if (batch === plan.batches - 1) {
      const all = Array.from({ length: plan.batches }, (_, i) =>
        i === batch
          ? rows
          : JSON.parse(
              readFileSync(resolve(directory, `rows-${i}.json`), 'utf8'),
            ),
      ).flat();
      expect(all).toHaveLength(specifications.length * plan.steps);
      expect(corpusSourceProvenance(root)).toEqual(marker.source);
      writeBalanceJson(root, directory, 'summary.json', {
        kind: 'v080-ai-achievement-balance',
        version: packageInfo.version,
        ledgerSchema: 8,
        catalogVersion: 7,
        purpose,
        matches: all.length,
        steps: plan.steps,
        source: marker.source,
        scenarioCount: purpose === 'campaign' ? 2 : 8,
        cells: specifications.length,
        seedFormula: '(0x08010000 + Math.imul(index + 1, 104729)) >>> 0',
        scope:
          'paired scripted policies, not human telemetry; fixed-role research may use locked roles; campaigns rotate only actually unlocked roles',
        profileHashes: Object.fromEntries(
          Object.entries(profiles).map(([cell, p]) => [
            cell,
            createHash('sha256').update(JSON.stringify(p)).digest('hex'),
          ]),
        ),
        catalog: achievementCatalog.map((a) => ({
          ...a,
          number: achievementNumber(a.id),
          metadata: achievementCollectionMetadata[a.id],
        })),
      });
    }
  },
  3_600_000,
);
