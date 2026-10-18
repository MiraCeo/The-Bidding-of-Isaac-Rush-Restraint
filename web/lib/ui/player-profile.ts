import type { CharacterId } from '../game/item-types';
import {
  isSurvivalDifficulty,
  type SurvivalDifficulty,
} from '../game/survival-difficulty';
import { canonicalJson, type ReplayLog } from './replay-record';
import { classicCompletionKey } from './completion-identity';
import {
  readCompletionRegistry,
  registerCompletion,
  type CompletionOrigin,
} from './completion-registry';
import { validateProfileAchievementRegistry } from './achievements/registry';
import {
  achievementBaselineModule,
  currentAchievementBaseline,
  hasCurrentAchievementBaseline,
} from './achievements/baseline';

export const playerProfileKey = 'bidding-player-profile-v1';
export type ProfileValue =
  | null
  | boolean
  | number
  | string
  | ProfileValue[]
  | { [key: string]: ProfileValue };
/** Persistent progression is independent of match rules and save/replay format versions. */
export interface PlayerProfile {
  format: 'the-bidding-of-isaac-profile';
  version: 1;
  createdAt: string;
  updatedAt: string;
  progression: {
    characterUnlocks: Record<
      string,
      { unlockedAt: string; conditionId: string }
    >;
    achievements: Record<
      string,
      { achievedAt: string | null; progress: number }
    >;
    statistics: Record<string, number>;
    modules: Record<string, ProfileValue>;
  };
  history: Array<{
    key: string;
    replayId: string;
    characterId: CharacterId;
    completedAt: string;
    finalScore: number;
    rank: number;
    mode?: 'classic' | 'survival';
    aiDifficulty?: SurvivalDifficulty;
    status?: 'survived' | 'eliminated';
    eliminationFloorIndex?: number | null;
  }>;
}
export function createPlayerProfile(now = new Date()): PlayerProfile {
  return {
    format: 'the-bidding-of-isaac-profile',
    version: 1,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    progression: {
      characterUnlocks: {},
      achievements: {},
      statistics: {},
      modules: {
        [achievementBaselineModule]: { version: currentAchievementBaseline },
      },
    },
    history: [],
  };
}
function fail(): never {
  throw new Error('玩家档案格式损坏或版本不支持。');
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail();
  return value as Record<string, unknown>;
}
function date(value: unknown) {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) fail();
}
function tree(value: unknown, depth = 0): void {
  if (depth > 16) fail();
  if (value === null || typeof value === 'boolean') return;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) fail();
    return;
  }
  if (typeof value === 'string') {
    if (value.length > 10000) fail();
    return;
  }
  if (!value || typeof value !== 'object') fail();
  for (const entry of Object.values(value)) tree(entry, depth + 1);
}
export function readPlayerProfile(value: unknown): PlayerProfile {
  const p = object(value);
  if (p.format !== 'the-bidding-of-isaac-profile' || p.version !== 1) fail();
  date(p.createdAt);
  date(p.updatedAt);
  const progress = object(p.progression);
  for (const v of Object.values(object(progress.characterUnlocks))) {
    const entry = object(v);
    date(entry.unlockedAt);
    if (typeof entry.conditionId !== 'string' || entry.conditionId.length > 160)
      fail();
  }
  for (const v of Object.values(object(progress.achievements))) {
    const entry = object(v);
    if (entry.achievedAt !== null) date(entry.achievedAt);
    if (
      typeof entry.progress !== 'number' ||
      !Number.isFinite(entry.progress) ||
      entry.progress < 0
    )
      fail();
  }
  for (const v of Object.values(object(progress.statistics)))
    if (typeof v !== 'number' || !Number.isFinite(v)) fail();
  tree(object(progress.modules));
  if (!Array.isArray(p.history) || p.history.length > 200) fail();
  const keys = new Set<string>();
  for (const v of p.history) {
    const h = object(v);
    date(h.completedAt);
    if (
      h.aiDifficulty !== undefined &&
      ((h.mode !== 'survival' && h.mode !== 'classic') || !isSurvivalDifficulty(h.aiDifficulty))
    )
      fail();
    if (h.mode !== undefined && h.mode !== 'classic' && h.mode !== 'survival')
      fail();
    if (
      h.mode === 'survival' &&
      h.status !== 'survived' &&
      h.status !== 'eliminated'
    )
      fail();
    if (
      h.mode === 'survival' &&
      (h.status === 'survived'
        ? h.eliminationFloorIndex !== null
        : typeof h.eliminationFloorIndex !== 'number' ||
          !Number.isInteger(h.eliminationFloorIndex) ||
          h.eliminationFloorIndex < 0 ||
          h.eliminationFloorIndex > 6)
    )
      fail();
    if (
      typeof h.key !== 'string' ||
      h.key.length > 240 ||
      keys.has(h.key) ||
      typeof h.replayId !== 'string' ||
      !['isaac', 'lost', 'azazel', 'eden', 'jacob_esau'].includes(
        String(h.characterId),
      ) ||
      typeof h.finalScore !== 'number' ||
      !Number.isFinite(h.finalScore) ||
      typeof h.rank !== 'number' ||
      !Number.isInteger(h.rank) ||
      h.rank < 1 ||
      h.rank > 20
    )
      fail();
    keys.add(h.key);
  }
  if (new TextEncoder().encode(canonicalJson(p)).length > 1024 * 1024) fail();
  readCompletionRegistry(p as unknown as PlayerProfile);
  validateProfileAchievementRegistry(p as unknown as PlayerProfile);
  hasCurrentAchievementBaseline(p as unknown as PlayerProfile);
  return structuredClone(p) as unknown as PlayerProfile;
}
export function recordCompletedMatch(
  profile: PlayerProfile,
  log: ReplayLog,
  key: string,
  now = new Date(),
  origin: CompletionOrigin = 'live',
): PlayerProfile {
  if (!log.final) return profile;
  const human = log.final.ranking.find((e) => e.playerId === 'human');
  if (!human) return profile;
  // Competition ranking: tied scores share a rank. Do not award future achievements here.
  const rank =
    1 + log.final.ranking.filter((e) => e.finalScore > human.finalScore).length;
  const next = registerCompletion(
    profile,
    {
      key: classicCompletionKey(log),
      replayId: log.id,
      characterId: log.characterId,
      completedAt: now.toISOString(),
      finalScore: human.finalScore,
      rank,
      mode: 'classic',
      ...(log.classicAi ? { aiDifficulty: log.classicAi.difficulty } : {}),
    },
    [key],
    rank === 1,
    origin,
    now,
  );
  return next === profile ? profile : readPlayerProfile(next);
}
