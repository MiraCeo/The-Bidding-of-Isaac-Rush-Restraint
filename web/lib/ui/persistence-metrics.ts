/** Bounded in-memory timings only. Never writes storage, includes no game/profile values. */
export interface PersistenceMetric {
  mode: 'classic' | 'survival';
  operation: 'save' | 'load';
  phase: string;
  durationMs: number | null;
  success: boolean;
}
const samples: PersistenceMetric[] = [];
export const maximumPersistenceSamples = 60;
function time(): number | null {
  try {
    const value = performance.now();
    return Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}
export function measurePersistence<T>(
  context: Pick<PersistenceMetric, 'mode' | 'operation' | 'phase'>,
  action: () => T,
  successful: (result: T) => boolean,
): T {
  const started = time();
  let success = false;
  try {
    const result = action();
    try {
      success = successful(result);
    } catch {
      /* Diagnostics must not affect results. */
    }
    return result;
  } finally {
    const ended = time();
    samples.push({
      ...context,
      success,
      durationMs:
        started === null || ended === null
          ? null
          : Math.max(0, ended - started),
    });
    if (samples.length > maximumPersistenceSamples) samples.shift();
  }
}
export function persistenceMetrics(): PersistenceMetric[] {
  return samples.map((sample) => ({ ...sample }));
}
/** Research/test reset; does not touch any browser/user data. */
export function resetPersistenceMetrics(): void {
  samples.length = 0;
}
