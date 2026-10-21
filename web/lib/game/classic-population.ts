import { createSeededRandom } from './random';
import type { ClassicDifficulty } from './classic-difficulty';

export type ClassicAiGrade = 'low' | 'mid' | 'high';
/** Exact 19-AI largest-remainder quotas, part of classic-population-1 identity. */
export const classicPopulationCounts = Object.freeze({
  easy: Object.freeze([15, 4, 0] as const),
  standard: Object.freeze([4, 13, 2] as const),
  hard: Object.freeze([2, 6, 11] as const),
  highest: Object.freeze([0, 0, 19] as const),
});
export const classicGradeProfiles = Object.freeze({
  low: Object.freeze({ rate: 0.25, mediumShare: 0.4 }),
  mid: Object.freeze({ rate: 0.15, mediumShare: 0.2 }),
  high: Object.freeze({ rate: 0, mediumShare: 0 }),
});
/** Reconstructed from policy + seed, never re-rolled on room advance or restore.
 * Independent shuffle leaves world/role/doctrine/personality streams untouched. */
export function assignClassicPopulation(
  seed: number,
  difficulty: ClassicDifficulty,
) {
  const counts = classicPopulationCounts[difficulty];
  const order = Array.from({ length: 19 }, (_, i) => `ai-${i + 1}`);
  const random = createSeededRandom((seed ^ 0x18b4c913) >>> 0);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(random.next() * (i + 1));
    [order[i], order[j]] = [order[j]!, order[i]!];
  }
  const assignment: Record<string, ClassicAiGrade> = {};
  for (const [i, id] of order.entries())
    assignment[id] =
      i < counts[0] ? 'low' : i < counts[0] + counts[1] ? 'mid' : 'high';
  return { order, assignment };
}
