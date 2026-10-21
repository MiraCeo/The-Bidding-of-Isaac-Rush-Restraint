// New opt-in continuation, copied into source only AFTER the 20-game run completes.
import { expect, it } from 'vitest';
import { resolve, dirname, basename } from 'node:path';
import {
  readFileSync,
  writeFileSync,
  appendFileSync,
  realpathSync,
  lstatSync,
} from 'node:fs';
import {
  tempoPlan,
  assertTempoRun,
} from '../../../scripts/achievement-tempo-plan.mjs';
import { corpusSourceProvenance } from '../../../scripts/ledger-corpus-output.mjs';
import { sha256Hex } from '../../shared/sha256';
import { canonicalJson } from '../../shared/json-facts';
import { runTempoMatch } from './tempo-study.test-helper';
import {
  availableStudyRoles,
  advanceStudyProfile,
} from './current-study.test-helper';
import { readPlayerProfile } from '../player-profile';
import { projectAchievementRegistry } from './registry';

it.skipIf(process.env.ACHIEVEMENT_TEMPO_CONFIRM_RECOVERY !== '1')(
  'continues the predeclared standard/default paths from 20 through 30 games',
  () => {
    const root = process.cwd(),
      directory = resolve(process.env.ACHIEVEMENT_TEMPO_CONFIRM_DIR!);
    if (
      dirname(directory) !== resolve(root, 'work/0.8/achievement-tempo') ||
      !/^confirm-[A-Za-z0-9]+$/.test(basename(directory)) ||
      lstatSync(directory).isSymbolicLink() ||
      realpathSync(directory) !== directory
    )
      throw Error('Invalid confirmation output');
    const marker = JSON.parse(
      readFileSync(resolve(directory, 'run.json'), 'utf8'),
    );
    if (
      marker.kind !== 'v081-tempo-confirm-30' ||
      marker.plan.baseSteps !== 20 ||
      marker.plan.additionalSteps !== 10 ||
      marker.plan.seedStart !== 20000
    )
      throw Error('Unknown confirmation plan');
    const recovery = JSON.parse(
      readFileSync(resolve(directory, 'recovery.json'), 'utf8'),
    );
    expect(
      sha256Hex(readFileSync(resolve(directory, 'run.json'), 'utf8')),
    ).toBe(recovery.originalMarkerSha256);
    expect(corpusSourceProvenance(root)).toEqual(recovery.source);
    for (const input of marker.source.files) {
      expect(sha256Hex(readFileSync(resolve(root, input.path), 'utf8'))).toBe(
        input.sha256,
      );
    }

    const parent = marker.parent.directory,
      prior = assertTempoRun(root, parent);
    expect(prior.purpose).toBe('main');
    expect(
      sha256Hex(readFileSync(resolve(parent, 'analysis.json'), 'utf8')),
    ).toBe(marker.parent.analysisSha256);
    const complete = JSON.parse(
      readFileSync(resolve(directory, 'block-0.json'), 'utf8'),
    );
    expect(
      sha256Hex(readFileSync(resolve(directory, 'rows-0.json'), 'utf8')),
    ).toBe(complete.rowsSha256);
    expect(
      sha256Hex(readFileSync(resolve(directory, 'witness-0.jsonl'), 'utf8')),
    ).toBe(complete.witnessSha256);
    const allRows: unknown[] = JSON.parse(
      readFileSync(resolve(directory, 'rows-0.json'), 'utf8'),
    );
    expect(allRows.length).toBe(90);

    for (let block = 1; block < tempoPlan.blocks; block++) {
      const original = JSON.parse(
        readFileSync(resolve(parent, `profiles-${block}.json`), 'utf8'),
      );
      const metadata = JSON.parse(
        readFileSync(resolve(parent, `block-${block}.json`), 'utf8'),
      );
      const priorRows = JSON.parse(
        readFileSync(resolve(parent, `rows-${block}.json`), 'utf8'),
      ) as {
        cell: string;
        index: number;
        cumulative: { allIn: number; boss: number };
      }[];
      const profiles: Record<string, ReturnType<typeof readPlayerProfile>> = {},
        last: Record<string, { allIn: number; boss: number }> = {};
      const witness = resolve(directory, `witness-${block}.jsonl`);
      writeFileSync(witness, '', { flag: 'wx' });
      const scenarios = tempoPlan.scenarios.filter((s) =>
        marker.plan.scenarios.includes(s.id),
      );
      expect(scenarios.map((s) => s.id)).toEqual([
        'population-standard',
        'population-highest',
        'survival-standard',
      ]);
      for (const scenario of scenarios)
        for (const policy of tempoPlan.policies) {
          const cell = scenario.id + '/' + policy;
          expect(sha256Hex(JSON.stringify(original[cell]))).toBe(
            metadata.profileHashes[cell],
          );
          profiles[cell] = readPlayerProfile(original[cell]);
          const before = projectAchievementRegistry(profiles[cell]!)!;
          last[cell] = {
            allIn: before.progress.D09 ?? 0,
            boss: before.progress.E03 ?? 0,
          };
          expect(last[cell]).toEqual(
            priorRows.find((r) => r.cell === cell && r.index === 20)!
              .cumulative,
          );
        }
      const rows: unknown[] = [];
      for (let step = 0; step < 10; step++) {
        const index = 21 + step,
          seed =
            (0x08010000 + Math.imul(20001 + block * 10 + step, 104729)) >>> 0;
        for (const scenario of scenarios)
          for (const policy of tempoPlan.policies) {
            const cell = scenario.id + '/' + policy,
              profile = profiles[cell]!,
              available = availableStudyRoles(profile),
              role = available[(index - 1) % available.length]!;
            const result = runTempoMatch(seed, role, policy, scenario),
              before = JSON.stringify(profile);
            const advanced = advanceStudyProfile(
              profile,
              result.context,
              index,
              step === 0 || step === 9,
            );
            expect(JSON.stringify(profile)).toBe(before);
            const cumulative = {
              allIn: advanced.progress.D09 ?? 0,
              boss: advanced.progress.E03 ?? 0,
            };
            expect(cumulative.allIn).toBe(
              last[cell]!.allIn + result.counts.allIn,
            );
            expect(cumulative.boss).toBe(last[cell]!.boss + result.counts.boss);
            expect(result.match.traceFingerprint).toBe(
              sha256Hex(canonicalJson(result.context)),
            );
            const identity = `${block}/${cell}/${index}`;
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
              index,
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
          `confirmation block ${block + 1}/6: game ${index}/30\n`,
        );
      }
      const profileHashes: Record<string, string> = {};
      for (const [cell, profile] of Object.entries(profiles)) {
        expect(readPlayerProfile(JSON.parse(JSON.stringify(profile)))).toEqual(
          profile,
        );
        const view = projectAchievementRegistry(profile)!;
        expect({
          allIn: view.progress.D09 ?? 0,
          boss: view.progress.E03 ?? 0,
        }).toEqual(last[cell]);
        profileHashes[cell] = sha256Hex(JSON.stringify(profile));
      }
      const write = (name: string, value: unknown) =>
        writeFileSync(resolve(directory, name), JSON.stringify(value) + '\n', {
          flag: 'wx',
        });
      write(`rows-${block}.json`, rows);
      write(`profiles-${block}.json`, profiles);
      write(`block-${block}.json`, {
        block,
        matches: rows.length,
        profileHashes,
        rowsSha256: sha256Hex(
          readFileSync(resolve(directory, `rows-${block}.json`), 'utf8'),
        ),
        witnessSha256: sha256Hex(readFileSync(witness, 'utf8')),
      });
      allRows.push(...rows);
    }
    expect(allRows.length).toBe(540);
    expect(corpusSourceProvenance(root)).toEqual(recovery.source);
    writeFileSync(
      resolve(directory, 'status.json'),
      JSON.stringify({
        status: 'completed',
        matches: allRows.length,
        blocks: 6,
      }) + '\n',
      { flag: 'wx' },
    );
  },
  3600000,
);
