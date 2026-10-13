/** Explicit opt-in matched-seed calibration; never changes game or player storage. */
import { it, expect } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { characterOrder } from '../characters';
import { survivalDifficulties } from '../survival-difficulty';
import { survivalOfficialCutLines } from '../survival-rules';
import { runSurvivalEliminationProbe } from './survival-elimination-probe';

it.skipIf(process.env.SURVIVAL_DIFFICULTY_STUDY !== '1')(
  'calibrates four tiers with matched seeds and unchanged official rules',
  () => {
    const n = Number(process.env.SURVIVAL_DIFFICULTY_WORLDS ?? 200),
      baseSeed = 20261214;
    if (!Number.isInteger(n) || n < 20)
      throw new Error('At least 20 independent worlds required');
  const worlds: {seed:number;characterId:string;policy:string;difficulty:string;floors:number;survivors:number;wipeout:boolean;probeSurvived:boolean;probeRank:number;firstFloorScore:number}[] = [];
    for (let i = 0; i < n; i++) {
      const seed = (baseSeed + Math.imul(i, 0x9e3779b1)) >>> 0,
        characterId = characterOrder[i % 5]!;
      for (const policy of ['all_ai', 'pace_bid'] as const)
        for (const difficulty of survivalDifficulties) {
          let firstFloorScore = 0;
          const game = runSurvivalEliminationProbe(
            {
              seed,
              characterId,
              policy,
              cutLines: survivalOfficialCutLines,
              aiVersion: 'survival',
              aiDifficulty: difficulty,
            },
            {
              onFloor: (_before, after) => {
                if (after.floorRecords.length === 1)
                  firstFloorScore =
                    Object.values(after.currentFloorRoomScores).reduce(
                      (sum, scores) => sum + scores.reduce((a, b) => a + b, 0),
                      0,
                    ) / 20;
              },
            },
          );
          const probe = game.finalRanking.find(
            (row) => row.playerId === 'human',
          )!;
          worlds.push({
            seed,
            characterId,
            policy,
            difficulty,
            floors: game.floorRecords.length,
            survivors: game.activePlayerIds.length,
            wipeout: game.completionReason === 'all_eliminated',
            probeSurvived: probe.status === 'survived',
            probeRank: probe.rank,
            firstFloorScore,
          });
          expect(game.cutLines).toEqual(survivalOfficialCutLines);
        }
      if ((i + 1) % 50 === 0)
        console.log(`DIFFICULTY_STUDY ${i + 1}/${n} matched worlds`);
    }
    const summaries = ['all_ai', 'pace_bid'].flatMap((policy) =>
      survivalDifficulties.map((difficulty) => {
        const rows = worlds.filter(
            (w) => w.policy === policy && w.difficulty === difficulty,
          ),
          mean = (
            key: 'floors' | 'survivors' | 'probeRank' | 'firstFloorScore',
          ) => rows.reduce((sum, w) => sum + w[key], 0) / rows.length;
        return {
          policy,
          difficulty,
          n: rows.length,
          meanFloors: mean('floors'),
          meanSurvivors: mean('survivors'),
          wipeouts: rows.filter((w) => w.wipeout).length,
          probeSurvived: rows.filter((w) => w.probeSurvived).length,
          probeMeanRank: mean('probeRank'),
          firstFloorR: mean('firstFloorScore'),
        };
      }),
    );
    const dir = resolve('work', `survival-difficulty-${baseSeed}-${n}`);
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      resolve(dir, 'report.json'),
      JSON.stringify(
        {
          kind: 'survival-difficulty-calibration-1',
          createdAt: new Date().toISOString(),
          baseSeed,
          n,
          cutLines: survivalOfficialCutLines,
          summaries,
          worlds,
        },
        null,
        2,
      ),
    );
    console.log(JSON.stringify(summaries, null, 2));
    expect(worlds).toHaveLength(n * 8);
  },
  240000,
);
