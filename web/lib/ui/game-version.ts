import { characterCatalog } from '../game/characters';
import { defaultRules } from '../game/config';
import { itemCatalog } from '../game/item-catalog';

export function shortHash(value: string): string {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++)
    hash = Math.imul(hash ^ value.charCodeAt(i), 16777619);
  return (hash >>> 0).toString(16).padStart(8, '0');
}
// Bump when runtime/RNG/AI behavior changes. UI-only releases remain compatible.
const engineVersion = '20-personality-client-1';
export const saveCompatibility = `${engineVersion}-${shortHash(JSON.stringify({ engineVersion, rules: defaultRules, items: itemCatalog, characters: characterCatalog })).replace(/^0+(?=.)/, '')}`;

declare const __BIDDING_BUILD__: string;
export function readBuildVersion(): string {
  const offline =
    typeof document === 'undefined'
      ? null
      : document.querySelector<HTMLMetaElement>(
          'meta[name="bidding-offline-build"]',
        )?.content;
  return (
    offline ||
    (typeof __BIDDING_BUILD__ === 'string'
      ? __BIDDING_BUILD__
      : 'test-or-unbundled')
  );
}
