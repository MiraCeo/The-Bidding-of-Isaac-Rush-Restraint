import { expect, it } from 'vitest';
import { resolve } from 'node:path';
import { readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import {
  tempoPlan as plan,
  tempoSeed,
  assertTempoRun,
} from '../../../scripts/achievement-tempo-plan.mjs';
import { corpusSourceProvenance } from '../../../scripts/ledger-corpus-output.mjs';
import { canonicalJson } from '../../shared/json-facts';
import { sha256Hex } from '../../shared/sha256';
import { freshStudyProfile } from './current-study.test-helper';
import { advanceTempoStep } from './tempo-study.test-helper';
import { readPlayerProfile } from '../player-profile';
import { projectAchievementRegistry } from './registry';
import { achievementSeries } from './series';
import { achievementCatalog } from './catalog';
import { achievementNumber } from './numbering';

it.skipIf(process.env.ACHIEVEMENT_TEMPO !== '1')(
  'runs one preregistered targeted tempo block',
  () => {
    const root = process.cwd(),
      directory = process.env.ACHIEVEMENT_TEMPO_DIR!,
      run = assertTempoRun(root, directory),
      block = Number(process.env.ACHIEVEMENT_TEMPO_BLOCK);
    if (
      !Number.isInteger(block) ||
      block < 0 ||
      block >= (run.purpose === 'pilot' ? 1 : plan.blocks)
    )
      throw Error('Invalid tempo block');
    expect(corpusSourceProvenance(root)).toEqual(run.source);
    const steps = run.purpose === 'pilot' ? 1 : plan.steps;
    const rows: unknown[] = [],
      profiles: Record<string, ReturnType<typeof freshStudyProfile>> = {},
      last: Record<string, { allIn: number; boss: number }> = {};
    const witness = resolve(directory, `witness-${block}.jsonl`);
    writeFileSync(witness, '', { flag: 'wx' });
    for (let step = 0; step < steps; step++) {
      const worlds = new Map<string, string>();
      for (const scenario of plan.scenarios)
        for (const policy of plan.policies) {
          const cell = scenario.id + '/' + policy,
            profile = profiles[cell] ?? freshStudyProfile(),
            seed = tempoSeed(block, step, run.purpose);
          const { role, available, result, advanced } = advanceTempoStep(
            profile,
            seed,
            step + 1,
            policy,
            scenario,
          );
          const key = scenario.mode + '/' + role;
          if (worlds.has(key)) expect(result.firstWorld).toBe(worlds.get(key));
          else worlds.set(key, result.firstWorld);
          const cumulative = {
            allIn: advanced.progress.D09 ?? 0,
            boss: advanced.progress.E03 ?? 0,
          };
          expect(cumulative.allIn).toBe(
            (last[cell]?.allIn ?? 0) + result.counts.allIn,
          );
          expect(cumulative.boss).toBe(
            (last[cell]?.boss ?? 0) + result.counts.boss,
          );
          expect(result.match.traceFingerprint).toBe(
            sha256Hex(canonicalJson(result.context)),
          );
          const identity = `${block}/${cell}/${step + 1}`;
          appendFileSync(
            witness,
            JSON.stringify({
              identity,
              context: result.context,
              traceFingerprint: result.match.traceFingerprint,
              evidence: result.evidence,
            }) + '\n',
          );
          rows.push({
            identity,
            block,
            cell,
            index: step + 1,
            seed,
            role,
            policy,
            scenario,
            availableRolesBefore: available,
            counts: result.counts,
            cumulative,
            achieved: advanced.achieved,
            unlocks: advanced.unlocks,
            match: result.match,
            firstWorld: result.firstWorld,
            traceFingerprint: result.match.traceFingerprint,
            opportunities: {
              humanRooms: result.match.humanRooms,
              allInAttempts: result.evidence.filter((e) => e.allInAttempt)
                .length,
              allInAwards: result.counts.allIn,
              lowCapitalAllInAwards: result.evidence.filter(
                (e) =>
                  e.allInAward &&
                  e.allInCapital[0] < Math.ceil(e.allInCapital[1] / 2),
              ).length,
              bossRooms: result.evidence.filter((e) => e.bossRoom).length,
              bossQualified: result.evidence.filter((e) => e.bossQualified)
                .length,
              bossAwards: result.counts.boss,
            },
          });
          profiles[cell] = advanced.profile;
          last[cell] = cumulative;
        }
      process.stdout.write(
        `block ${block + 1}: step ${step + 1}/${steps}; ${rows.length} matches\n`,
      );
    }
    const profileHashes: Record<string, string> = {};
    for (const [cell, profile] of Object.entries(profiles)) {
      expect(readPlayerProfile(JSON.parse(JSON.stringify(profile)))).toEqual(
        profile,
      );
      const view = projectAchievementRegistry(profile)!;
      expect(view.progress.D09).toBe(last[cell]!.allIn);
      expect(view.progress.E03).toBe(last[cell]!.boss);
      profileHashes[cell] = sha256Hex(JSON.stringify(profile));
    }
    const write = (name: string, value: unknown) =>
      writeFileSync(resolve(directory, name), JSON.stringify(value) + '\n', {
        flag: 'wx',
      });
    write(`rows-${block}.json`, rows);
    write(`profiles-${block}.json`, profiles);
    const targets = achievementSeries
      .filter((s) => ['S-ALL-IN-AWARDS', 'S-BOSS-AWARDS'].includes(s.id))
      .map((s) => ({
        ...s,
        targets: s.ids.map(
          (id) => achievementCatalog.find((a) => a.id === id)!.target,
        ),
      }));
    expect(targets.map((s) => [...s.targets])).toEqual([
      plan.current.allIn,
      plan.current.boss,
    ]);
    write(`block-${block}.json`, {
      block,
      matches: rows.length,
      profileHashes,
      witnessSha256: sha256Hex(readFileSync(witness, 'utf8')),
      rowsSha256: sha256Hex(
        readFileSync(resolve(directory, `rows-${block}.json`), 'utf8'),
      ),
      targets: targets.map((s) => ({
        ...s,
        numbers: s.ids.map((id) => achievementNumber(id)),
      })),
    });
    expect(corpusSourceProvenance(root)).toEqual(run.source);
  },
  1800000,
);
