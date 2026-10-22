import { expect, it } from 'vitest';
import { readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  targeted25Plan as plan,
  targeted25Seed as mixed25Seed,
  assertTargeted25 as assertMixed25,
} from '../../../scripts/targeted25-plan.mjs';
import { corpusSourceProvenance } from '../../../scripts/ledger-corpus-output.mjs';
import {
  assertMixed25Targets,
  mixed25Readout,
  mixed25Catalog,
} from './mixed25.test-helper';
import { chooseTarget25, runTarget25Match } from './targeted25.test-helper';
import { achievementNumber } from './numbering';
import {
  freshStudyProfile,
  advanceStudyProfile,
  availableStudyRoles,
} from './current-study.test-helper';
import { readPlayerProfile } from '../player-profile';
import { projectAchievementRegistry } from './registry';
import { sha256Hex } from '../../shared/sha256';
import type { AchievementId } from './catalog';
import type { CharacterId } from '../../game/item-types';
import { achievementCatalog } from './catalog';
it.skipIf(process.env.TARGETED25 !== '1')(
  'runs a single-profile targeted public-information candidate block',
  () => {
    const root = process.cwd(),
      directory = process.env.TARGETED25_DIR!,
      marker = assertMixed25(root, directory),
      block = Number(process.env.TARGETED25_BLOCK);
    if (
      !Number.isInteger(block) ||
      block < 0 ||
      block >= (marker.purpose === 'pilot' ? 1 : 6)
    )
      throw Error('Invalid mixed25 block');
    expect(corpusSourceProvenance(root)).toEqual(marker.source);
    assertMixed25Targets();
    const games = marker.purpose === 'pilot' ? 4 : 30,
      rows: unknown[] = [],
      profiles: Record<string, ReturnType<typeof freshStudyProfile>> = {};
    const witness = resolve(directory, `witness-${block}.jsonl`);
    writeFileSync(witness, '', { flag: 'wx' });
    for (const route of plan.routes) {
      let profile = freshStudyProfile(),
        earned: AchievementId[] = [],
        survivalPlayed = 0;
      const roleUses: Partial<Record<CharacterId, number>> = {};
      for (let index = 1; index <= games; index++) {
        const choice = chooseTarget25(
            index,
            profile,
            earned,
            roleUses,
            survivalPlayed,
          ),
          seed = mixed25Seed(block, index - 1, marker.purpose === 'pilot');
        expect(availableStudyRoles(profile)).toContain(choice.role);
        const before = JSON.stringify(profile),
          result = runTarget25Match(
            seed,
            choice,
            achievementCatalog
              .filter((a) => !earned.includes(a.id))
              .map((a) => achievementNumber(a.id)),
          ),
          advanced = advanceStudyProfile(
            profile,
            result.context,
            index,
            index === 1 || index === games,
          );
        expect(JSON.stringify(profile)).toBe(before);
        const readout = mixed25Readout(advanced.progress, advanced.achieved);
        expect(readout.candidate).toEqual(
          expect.arrayContaining(advanced.achieved),
        );
        expect(readout.candidate).toEqual(expect.arrayContaining(earned));
        const identity = `${block}/${route}/${index}`;
        appendFileSync(
          witness,
          JSON.stringify({
            identity,
            context: result.context,
            traceFingerprint: result.traceFingerprint,
          }) + '\n',
        );
        rows.push({
          identity,
          block,
          route,
          index,
          seed,
          choice,
          root: result.context.root,
          traceFingerprint: result.traceFingerprint,
          actualEarned: advanced.achieved,
          candidateEarned: readout.candidate,
          candidateMissing: readout.missing,
          progress: advanced.progress,
          unlocks: advanced.unlocks,
          availableBefore: choice.available,
          held: result.held,
          offered: result.offered,
          humanRooms: result.humanRooms,
          aiOnlyRooms: result.aiOnlyRooms,
          floors: result.floors,
          champion: result.champion,
          attempts: result.attempts,
          floorConfirmations: result.floorConfirmations,
        });
        profile = advanced.profile;
        earned = readout.candidate;
        roleUses[choice.role] = (roleUses[choice.role] ?? 0) + 1;
        survivalPlayed += Number(choice.mode === 'survival');
        if (index === 20) {
          expect(survivalPlayed).toBe(10);
        }
        if (index % 5 === 0)
          process.stdout.write(
            `block ${block + 1} ${route}: ${index}/${games}, current ${advanced.achieved.length}, candidate ${earned.length}/117\n`,
          );
      }
      expect(readPlayerProfile(JSON.parse(JSON.stringify(profile)))).toEqual(
        profile,
      );
      const projection = projectAchievementRegistry(profile)!;
      expect(
        mixed25Readout(projection.progress, Object.keys(projection.achievedAt))
          .candidate,
      ).toEqual(earned);
      profiles[route] = profile;
    }
    const write = (name: string, data: unknown) =>
      writeFileSync(resolve(directory, name), JSON.stringify(data) + '\n', {
        flag: 'wx',
      });
    write(`rows-${block}.json`, rows);
    write(`profiles-${block}.json`, profiles);
    write(`block-${block}.json`, {
      block,
      matches: rows.length,
      profileHashes: Object.fromEntries(
        Object.entries(profiles).map(([route, p]) => [
          route,
          sha256Hex(JSON.stringify(p)),
        ]),
      ),
      rowsSha256: sha256Hex(
        readFileSync(resolve(directory, `rows-${block}.json`), 'utf8'),
      ),
      witnessSha256: sha256Hex(readFileSync(witness, 'utf8')),
      catalog: mixed25Catalog(),
      currentCatalog: achievementCatalog,
    });
    expect(corpusSourceProvenance(root)).toEqual(marker.source);
  },
  1800000,
);
