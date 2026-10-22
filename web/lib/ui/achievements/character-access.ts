import type { CharacterId } from '../../game/item-types';
import type { SaveStorage } from '../game-save';
import {
  playerProfileKey,
  readPlayerProfile,
  createPlayerProfile,
} from '../player-profile';
import { checkedJson } from '../file-json';
import { hasCurrentAchievementBaseline } from './baseline';
import { projectAchievementRegistry } from './registry';
import {
  characterAchievementRequirements,
  achievementCatalog,
} from './catalog';

export interface CharacterAccess {
  available: CharacterId[];
  message: string;
  invalid: boolean;
}
/** Read-only projection. Reserved 0.4 unlock fields never confer 0.5 permissions. */
export function readCharacterAccess(
  storage: Pick<SaveStorage, 'getItem'> | null,
): CharacterAccess {
  if (!storage)
    return {
      available: ['isaac'],
      invalid: false,
      message: '档案存储不可用：仅可用默认以撒，本页游戏仍可进行。',
    };
  try {
    const source = storage.getItem(playerProfileKey);
    const profile =
      source === null
        ? createPlayerProfile()
        : readPlayerProfile(checkedJson(source));
    const view = projectAchievementRegistry(profile);
    return {
      available: view
        ? (Object.keys(view.characterUnlocks) as CharacterId[])
        : ['isaac'],
      invalid: false,
      message: hasCurrentAchievementBaseline(profile)
        ? ''
        : '旧版本成就已停用，等待清理保存；手动角色授权保留。',
    };
  } catch (error) {
    return {
      available: [],
      invalid: true,
      message: `角色权限未核验，原档案保留：${error instanceof Error ? error.message : '档案读取失败。'}`,
    };
  }
}
export function characterRequirementText(id: CharacterId): string {
  const ids = characterAchievementRequirements[id];
  return ids.length
    ? ids
        .map((key) => achievementCatalog.find((a) => a.id === key)!.name)
        .join(' + ')
    : '默认开放';
}
/** Formal new-game boundary only; existing games, tutorials and AI do not call it. */
export function requireCharacterAccess(
  storage: Pick<SaveStorage, 'getItem'> | null,
  id: CharacterId,
): void {
  const access = readCharacterAccess(storage);
  if (!access.available.includes(id))
    throw Error(
      access.message || `角色尚未解锁：需要${characterRequirementText(id)}。`,
    );
}
