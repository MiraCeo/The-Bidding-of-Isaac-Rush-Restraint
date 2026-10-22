/** Final approved 0.8 balance closeout. Stable storage IDs, not public numbers.
 * Only five cumulative targets change; historical catalogs remain untouched. */
export const balance081Targets: Readonly<Record<string, number>> = {
  E10: 10, // E12: completed classic matches
  F09: 10, // F13: completed survival matches
  B16: 5, // B09: watched actual vacancies, silver
  B17: 10, // B10: watched actual vacancies, gold
  E22: 10, // E20: positive-score Eternal D6 clears, gold
};
export function balance081Target(id: string, previous: number): number {
  return balance081Targets[id] ?? previous;
}
