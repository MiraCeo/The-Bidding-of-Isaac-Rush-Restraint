import { characterCatalog } from '../game/characters';
import { defaultRules } from '../game/config';
import { itemCatalog } from '../game/item-catalog';
import releaseConfig from '../../release-config.json';
import packageInfo from '../../package.json';
import releaseNotes from '../../release-notes.json';
import { persistedItemNames } from './item-labels';

export function shortHash(value: string): string {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++)
    hash = Math.imul(hash ^ value.charCodeAt(i), 16777619);
  return (hash >>> 0).toString(16).padStart(8, '0');
}
// Bump when runtime/RNG/AI behavior changes. UI-only releases remain compatible.
const engineVersion = releaseConfig.engineVersion;
export const appVersion = packageInfo.version;
export const saveFormatVersion = releaseConfig.saveFormatVersion;
export const replayFormatVersion = releaseConfig.replayFormatVersion;
export const appReleaseNotes = releaseNotes;
export { engineVersion };
const compatibilityItems = itemCatalog.map((item) => ({
  ...item,
  name: persistedItemNames[item.id] ?? item.name,
}));
export const saveCompatibility = `${engineVersion}-${shortHash(JSON.stringify({ engineVersion, rules: defaultRules, items: compatibilityItems, characters: characterCatalog })).replace(/^0+(?=.)/, '')}`;

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
export function versionFeedbackText(): string {
  return `游戏版本：${appVersion}\n实际构建：${readBuildVersion()}\n规则兼容：${saveCompatibility}\n存档格式：v${saveFormatVersion} · 回放格式：v${replayFormatVersion}`;
}
