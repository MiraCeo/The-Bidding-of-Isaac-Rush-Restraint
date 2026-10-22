import { canonicalJson } from '../../shared/json-facts';

/** Exactly canonicalJson(authority(value)), without cloning the entire prefix.
 * The only numeric normalization remains the existing eight-decimal knife
 * explanation amount. No cache of values, validation results or game objects. */
export function canonicalAuthorityJson(value: unknown): string {
  // Repeated record field names dominate a long prefix. Escape each distinct
  // string once in this synchronous call; bound it and discard it on return.
  const keys = new Map<string, string>();
  const keyJson = (key: string) => {
    let encoded = keys.get(key);
    if (encoded === undefined) {
      encoded = JSON.stringify(key);
      if (keys.size >= 256) keys.clear();
      keys.set(key, encoded);
    }
    return encoded;
  };
  function write(node: unknown): string {
    if (Array.isArray(node)) {
      let result = '[';
      for (let i = 0; i < node.length; i++) {
        if (i) result += ',';
        // Preserve Array.map/join's sparse-array behavior from the old path.
        if (i in node) {
          const part = write(node[i]);
          if (part !== undefined) result += part;
        }
      }
      return result + ']';
    }
    if (node && typeof node === 'object') {
      const record = node as Record<string, unknown>,
        names = Object.keys(record).sort(),
        knife =
          record.itemId === 'moms_knife' && record.kind === 'additive_score';
      let result = '{';
      for (let i = 0; i < names.length; i++) {
        const key = names[i]!,
          item = record[key];
        if (i) result += ',';
        const normalized =
          knife && key === 'amount' && typeof item === 'number'
            ? Number(item.toFixed(8))
            : item;
        result += keyJson(key) + ':' + write(normalized);
      }
      return result + '}';
    }
    return canonicalJson(node);
  }
  return write(value);
}
