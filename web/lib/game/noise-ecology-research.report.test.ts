import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runNoiseEcologyStudy } from './noise-ecology-research';
const games = Number(process.env.SIM_T7_T9_GAMES ?? 0);
const seeds = (
  process.env.SIM_T7_T9_SEEDS ??
  '20260908,20261010,20261011,20261012,20261013,20261014'
)
  .split(',')
  .map(Number);
describe.skipIf(games <= 0)('T07 and T09 joint study', () => {
  it('checks noise and ecology in research streams and the actual client reducer', () => {
    const result = runNoiseEcologyStudy({
      gamesPerSeed: games,
      seeds,
      onProgress: (mode, noise, seed) =>
        process.stdout.write(`T7_T9_PROGRESS=${mode}:${noise}:${seed}\n`),
    });
    mkdirSync(resolve('work'), { recursive: true });
    writeFileSync(
      resolve('work/t7-t9-noise-ecology-study.json'),
      `${JSON.stringify(result, null, 2)}\n`,
      'utf8',
    );
    console.log(
      `T7_T9_REPORT=${resolve('work/t7-t9-noise-ecology-study.json')}`,
    );
    expect(result.formalChanged).toBe(false);
    expect(result.excluded).toEqual(['all_in']);
  }, 1_800_000);
});
