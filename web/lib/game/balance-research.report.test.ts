import { describe, expect, it } from 'vitest';
import { runTwentyPersonalityStudy } from './balance-research';

const games = Number(process.env.SIM_BALANCE_GAMES ?? 0);
const seeds = (process.env.SIM_BALANCE_SEEDS ?? '20260908,20261010').split(',').map(Number);

describe.skipIf(games <= 0)('twenty-personality ecology research', () => {
  it('runs controlled sampling, ablation, noise and budget experiments without All-in', () => {
    const result = runTwentyPersonalityStudy({
      gamesPerSeed: games, seeds,
      onProgress: (name, seed) => console.log(`STUDY_PROGRESS=${name}:${seed}`),
    });
    console.log(`TWENTY_PERSONALITY_STUDY=${JSON.stringify(result)}`);
    expect(Object.keys(result.cases)).toHaveLength(14);
    expect(result.excluded).toEqual(['all_in']);
  }, 1_200_000);
});
