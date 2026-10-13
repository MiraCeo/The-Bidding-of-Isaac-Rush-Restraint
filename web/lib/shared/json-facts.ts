/** Stable factual JSON helpers, with no gameplay, browser storage or random dependencies. */
export function canonicalJson(value: unknown): string {
  if (typeof value === 'number' && !Number.isFinite(value))
    throw new Error('记录包含非法数值。');
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}
export function copySnapshot<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
export function shortHash(value: string): string {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++)
    hash = Math.imul(hash ^ value.charCodeAt(i), 16777619);
  return (hash >>> 0).toString(16).padStart(8, '0');
}
