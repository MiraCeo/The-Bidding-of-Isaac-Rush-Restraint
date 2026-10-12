import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runCharacterBudgetStudy } from './character-budget-research';

const games = Number(process.env.SIM_T8_GAMES ?? 0);
const seeds = (
  process.env.SIM_T8_SEEDS ?? '20260908,20261010,20261011,20261012'
)
  .split(',')
  .map(Number);
describe.skipIf(games <= 0)('T08 role budget report', () => {
  it('runs fixed-input public, character and no-double comparisons', () => {
    const result = runCharacterBudgetStudy({
      gamesPerSeed: games,
      seeds,
      onProgress: (name, seed) => console.log(`T8_PROGRESS=${name}:${seed}`),
    });
    const directory = resolve('work');
    mkdirSync(directory, { recursive: true });
    writeFileSync(
      resolve(directory, 't8-character-budget-study.json'),
      `${JSON.stringify(result, null, 2)}\n`,
      'utf8',
    );
    console.log(
      `T8_REPORT=${resolve(directory, 't8-character-budget-study.json')}`,
    );
    expect(Object.keys(result.cases)).toHaveLength(3);
    expect(result.excluded).toEqual(['all_in']);
  }, 1_800_000);
});
