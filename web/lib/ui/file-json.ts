import { canonicalJson, shortHash } from '../shared/json-facts';
export const maxFileBytes = 8 * 1024 * 1024;
export function fail(message = '对局文件损坏或结算事实不一致。'): never {
  throw new Error(message);
}
export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail();
  return value as Record<string, unknown>;
}
export function keys(
  value: unknown,
  required: readonly string[],
  optional: readonly string[] = [],
): void {
  const record = object(value);
  if (
    required.some((key) => !Object.hasOwn(record, key)) ||
    Object.keys(record).some(
      (key) => !required.includes(key) && !optional.includes(key),
    )
  )
    fail();
}
export function text(value: unknown, maximum = 160): asserts value is string {
  if (typeof value !== 'string' || !value.trim() || value.length > maximum)
    fail();
}
export function number(value: unknown, minimum = 0): asserts value is number {
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value < minimum ||
    Math.abs(value) > Number.MAX_SAFE_INTEGER
  )
    fail();
}
export function integer(value: unknown, minimum = 0): asserts value is number {
  number(value, minimum);
  if (!Number.isSafeInteger(value)) fail();
}
export function equal(a: unknown, b: unknown): void {
  if (canonicalJson(a) !== canonicalJson(b)) fail();
}
export function near(a: number, b: number): void {
  if (Math.abs(a - b) > 1e-7) fail();
}
export function date(value: unknown): void {
  text(value);
  if (!Number.isFinite(Date.parse(value))) fail();
}
export function array(
  value: unknown,
  maximum: number,
): asserts value is unknown[] {
  if (!Array.isArray(value) || value.length > maximum) fail();
}
export function checkedJson(source: string): Record<string, unknown> {
  if (new TextEncoder().encode(source).length > maxFileBytes)
    fail('对局文件超过8 MiB。');
  let value: unknown;
  try {
    value = JSON.parse(source.replace(/^\uFEFF/, ''));
  } catch {
    fail('不是有效的JSON文件。');
  }
  let nodes = 0;
  function inspect(node: unknown, depth = 0): void {
    if (depth > 32 || ++nodes > 1_000_000) fail('对局文件结构过大或嵌套过深。');
    if (typeof node === 'number' && !Number.isFinite(node))
      fail('对局文件包含非法数值。');
    if (node && typeof node === 'object') {
      for (const key of Object.keys(node)) {
        if (['__proto__', 'constructor', 'prototype'].includes(key)) fail();
        inspect((node as Record<string, unknown>)[key], depth + 1);
      }
    }
  }
  inspect(value);
  return object(value);
}
export function withChecksum<T extends object>(
  payload: T,
): T & { checksum: string } {
  // Re-signing a parsed document must not hash its previous checksum as data.
  const clean = { ...payload };
  delete (clean as { checksum?: unknown }).checksum;
  return { ...clean, checksum: shortHash(canonicalJson(clean)) };
}
export function checkChecksum(document: Record<string, unknown>): void {
  const { checksum, ...payload } = document;
  if (
    typeof checksum !== 'string' ||
    checksum !== shortHash(canonicalJson(payload))
  )
    fail('对局文件摘要不一致。');
}
export function stringifyChecked(payload: object): string {
  const source = JSON.stringify(withChecksum(payload));
  if (new TextEncoder().encode(source).length > maxFileBytes)
    fail('对局文件超过8 MiB。');
  return source;
}
