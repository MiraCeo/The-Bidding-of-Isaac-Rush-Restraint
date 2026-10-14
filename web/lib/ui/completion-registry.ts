import type { PlayerProfile, ProfileValue } from './player-profile';
import { canonicalJson } from '../shared/json-facts';
import { sha256Hex } from '../shared/sha256';
import type { CharacterId } from '../game/item-types';
import type { SurvivalDifficulty } from '../game/survival-difficulty';

export const completionRegistryModule = 'completionRegistryV1';
export const completionReceiptLimit = 8192;
export const statisticCharacters: CharacterId[] = [
  'isaac',
  'lost',
  'azazel',
  'eden',
  'jacob_esau',
];
export const statisticDifficulties = [
  'easy',
  'standard',
  'hard',
  'highest',
  'ungraded',
] as const;
export interface CompletionCounters {
  completed: number;
  champions: number;
  survived: number;
  eliminated: number;
  rankSum: number;
  scoreSumUnits: number;
  bestScoreUnits: number | null;
  bestRank: number | null;
  eliminationFloors: number[];
}
export interface CompletionRegistry {
  version: 1;
  startedAt: string;
  baselineHistoryCount: number;
  legacyKeys: string[];
  legacyResults: string[];
  /** True = counted after activation; false = observed old completion, not backfilled. */
  receipts: Record<string, boolean>;
  groups: Record<string, CompletionCounters>;
}
export type CompletionOrigin = 'live' | 'restored';
export interface CompletionRecord {
  key: string;
  replayId: string;
  characterId: CharacterId;
  completedAt: string;
  finalScore: number;
  rank: number;
  mode: 'classic' | 'survival';
  aiDifficulty?: SurvivalDifficulty;
  status?: 'survived' | 'eliminated';
  eliminationFloorIndex?: number | null;
}
export function emptyCounters(): CompletionCounters {
  return {
    completed: 0,
    champions: 0,
    survived: 0,
    eliminated: 0,
    rankSum: 0,
    scoreSumUnits: 0,
    bestScoreUnits: null,
    bestRank: null,
    eliminationFloors: Array(7).fill(0),
  };
}
function fail(): never {
  throw Error('统一完成登记／统计模块损坏或版本不支持，原档案保留。');
}
function object(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail();
  return value as Record<string, unknown>;
}
function keys(value: Record<string, unknown>, expected: string[]) {
  if (
    Object.keys(value).length !== expected.length ||
    expected.some((key) => !Object.hasOwn(value, key))
  )
    fail();
}
function integer(
  value: unknown,
  minimum = 0,
  maximum = Number.MAX_SAFE_INTEGER,
): value is number {
  return (
    typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    value >= minimum &&
    value <= maximum
  );
}
function hashList(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length <= 200 &&
    value.every(
      (key) => typeof key === 'string' && /^[a-f0-9]{64}$/.test(key),
    ) &&
    new Set(value).size === value.length
  );
}
export function groupKey(
  row: Pick<CompletionRecord, 'mode' | 'characterId' | 'aiDifficulty'>,
) {
  return row.mode === 'classic'
    ? `classic/${row.characterId}`
    : `survival/${row.characterId}/${row.aiDifficulty ?? 'ungraded'}`;
}
function validGroup(key: string) {
  const [mode, role, difficulty, extra] = key.split('/');
  return (
    extra === undefined &&
    statisticCharacters.includes(role as CharacterId) &&
    (mode === 'classic'
      ? difficulty === undefined
      : mode === 'survival' &&
        statisticDifficulties.includes(
          difficulty as (typeof statisticDifficulties)[number],
        ))
  );
}
export function validateCompletionRegistry(value: unknown): CompletionRegistry {
  const registry = object(value);
  keys(registry, [
    'version',
    'startedAt',
    'baselineHistoryCount',
    'legacyKeys',
    'legacyResults',
    'receipts',
    'groups',
  ]);
  if (
    registry.version !== 1 ||
    typeof registry.startedAt !== 'string' ||
    !Number.isFinite(Date.parse(registry.startedAt)) ||
    !integer(registry.baselineHistoryCount, 0, 200) ||
    !hashList(registry.legacyKeys) ||
    !hashList(registry.legacyResults) ||
    registry.legacyKeys.length > registry.baselineHistoryCount ||
    registry.legacyResults.length > registry.baselineHistoryCount
  )
    fail();
  const receipts = object(registry.receipts),
    receiptKeys = Object.keys(receipts);
  if (
    receiptKeys.length > completionReceiptLimit ||
    receiptKeys.some(
      (key) =>
        !/^(classic|survival)\/[a-f0-9]{64}$/.test(key) ||
        typeof receipts[key] !== 'boolean',
    )
  )
    fail();
  const groups = object(registry.groups),
    modeCounts = { classic: 0, survival: 0 };
  let absoluteScoreSum = 0;
  for (const [key, value] of Object.entries(groups)) {
    if (!validGroup(key)) fail();
    const c = object(value);
    keys(c, [
      'completed',
      'champions',
      'survived',
      'eliminated',
      'rankSum',
      'scoreSumUnits',
      'bestScoreUnits',
      'bestRank',
      'eliminationFloors',
    ]);
    if (
      !integer(c.completed, 1, completionReceiptLimit) ||
      !integer(c.champions, 0, c.completed) ||
      !integer(c.survived, 0, c.completed) ||
      !integer(c.eliminated, 0, c.completed) ||
      !integer(c.rankSum, c.completed, c.completed * 20) ||
      !integer(c.scoreSumUnits, -Number.MAX_SAFE_INTEGER) ||
      !integer(c.bestScoreUnits, -Number.MAX_SAFE_INTEGER) ||
      !integer(c.bestRank, 1, 20) ||
      !Array.isArray(c.eliminationFloors) ||
      c.eliminationFloors.length !== 7 ||
      !c.eliminationFloors.every((n) => integer(n, 0, Number(c.completed)))
    )
      fail();
    if (
      c.bestRank * c.completed > c.rankSum ||
      c.bestScoreUnits < c.scoreSumUnits / c.completed ||
      (c.champions > 0 && c.bestRank !== 1)
    )
      fail();
    absoluteScoreSum += Math.abs(c.scoreSumUnits);
    if (!Number.isSafeInteger(absoluteScoreSum)) fail();
    const floorCount = c.eliminationFloors.reduce(
      (sum: number, n: number) => sum + n,
      0,
    );
    if (key.startsWith('classic/')) {
      if (c.survived || c.eliminated || floorCount) fail();
      modeCounts.classic += c.completed;
    } else {
      if (
        c.survived + c.eliminated !== c.completed ||
        c.champions > c.survived ||
        floorCount !== c.eliminated
      )
        fail();
      modeCounts.survival += c.completed;
    }
  }
  for (const mode of ['classic', 'survival'] as const)
    if (
      modeCounts[mode] !==
      receiptKeys.filter((key) => key.startsWith(mode + '/') && receipts[key])
        .length
    )
      fail();
  return registry as unknown as CompletionRegistry;
}
export function readCompletionRegistry(
  profile: PlayerProfile,
): CompletionRegistry | null {
  return Object.hasOwn(profile.progression.modules, completionRegistryModule)
    ? validateCompletionRegistry(
        profile.progression.modules[completionRegistryModule],
      )
    : null;
}
export function legacyCompletionAlias(
  mode: 'classic' | 'survival',
  key: string,
) {
  return sha256Hex(canonicalJson([mode, key]));
}
function resultSignature(row: PlayerProfile['history'][number]) {
  return sha256Hex(
    canonicalJson({
      mode: row.mode ?? 'classic',
      id: row.replayId,
      character: row.characterId,
      difficulty: row.aiDifficulty ?? null,
      score: row.finalScore,
      rank: row.rank,
      status: row.status ?? null,
      eliminatedAt: row.eliminationFloorIndex ?? null,
    }),
  );
}
function initializeRegistry(
  profile: PlayerProfile,
  now: Date,
): CompletionRegistry {
  return {
    version: 1,
    startedAt: now.toISOString(),
    baselineHistoryCount: profile.history.length,
    legacyKeys: [
      ...new Set(
        profile.history.map((row) =>
          legacyCompletionAlias(row.mode ?? 'classic', row.key),
        ),
      ),
    ],
    legacyResults: [...new Set(profile.history.map(resultSignature))],
    receipts: {},
    groups: {},
  };
}
function addResult(
  c: CompletionCounters,
  row: CompletionRecord,
  champion: boolean,
): CompletionCounters {
  const units = Math.round(row.finalScore * 10000),
    sum = c.scoreSumUnits + units;
  if (!Number.isSafeInteger(units) || !Number.isSafeInteger(sum))
    throw Error('完成积分超出累计统计安全范围，未更改原档案。');
  const floors = [...c.eliminationFloors];
  if (row.status === 'eliminated') floors[row.eliminationFloorIndex!]!++;
  return {
    completed: c.completed + 1,
    champions: c.champions + Number(champion),
    survived: c.survived + Number(row.status === 'survived'),
    eliminated: c.eliminated + Number(row.status === 'eliminated'),
    rankSum: c.rankSum + row.rank,
    scoreSumUnits: sum,
    bestScoreUnits:
      c.bestScoreUnits === null ? units : Math.max(c.bestScoreUnits, units),
    bestRank: c.bestRank === null ? row.rank : Math.min(c.bestRank, row.rank),
    eliminationFloors: floors,
  };
}
/** Pure transaction candidate: history, receipts and aggregates are written together as profile1. */
export function registerCompletion(
  profile: PlayerProfile,
  row: CompletionRecord,
  legacyKeys: string[],
  champion: boolean,
  origin: CompletionOrigin = 'live',
  now = new Date(),
): PlayerProfile {
  const existing = readCompletionRegistry(profile);
  if (existing && Object.hasOwn(existing.receipts, row.key)) return profile;
  const registry = existing ?? initializeRegistry(profile, now);
  if (Object.keys(registry.receipts).length >= completionReceiptLimit)
    throw Error('完成去重凭据已达到8192条上限，未新增登记；旧累计与资料保留。');
  const known =
    profile.history.some((h) => h.key === row.key) ||
    legacyKeys.some((key) =>
      registry.legacyKeys.includes(legacyCompletionAlias(row.mode, key)),
    );
  // Old summaries cannot reconstruct missing full facts. Ambiguous restored old
  // results are retained as baseline, not silently backfilled or merged as new play.
  const uncertainLegacyRestore =
    origin === 'restored' &&
    registry.legacyResults.includes(resultSignature(row));
  const counted = !known && !uncertainLegacyRestore;
  const nextRegistry: CompletionRegistry = {
    ...registry,
    receipts: { ...registry.receipts, [row.key]: counted },
    groups: { ...registry.groups },
  };
  if (counted) {
    const group = groupKey(row);
    nextRegistry.groups[group] = addResult(
      registry.groups[group] ?? emptyCounters(),
      row,
      champion,
    );
  }
  return {
    ...profile,
    updatedAt: now.toISOString(),
    progression: {
      ...profile.progression,
      modules: {
        ...profile.progression.modules,
        [completionRegistryModule]: nextRegistry as unknown as ProfileValue,
      },
    },
    history: counted ? [...profile.history, row].slice(-200) : profile.history,
  };
}
export function sumCounters(values: CompletionCounters[]): CompletionCounters {
  const result = emptyCounters();
  for (const c of values) {
    result.completed += c.completed;
    result.champions += c.champions;
    result.survived += c.survived;
    result.eliminated += c.eliminated;
    result.rankSum += c.rankSum;
    result.scoreSumUnits += c.scoreSumUnits;
    if (!Number.isSafeInteger(result.scoreSumUnits))
      throw Error('积分统计超出安全范围，原档案保留。');
    if (c.bestScoreUnits !== null)
      result.bestScoreUnits =
        result.bestScoreUnits === null
          ? c.bestScoreUnits
          : Math.max(result.bestScoreUnits, c.bestScoreUnits);
    if (c.bestRank !== null)
      result.bestRank =
        result.bestRank === null
          ? c.bestRank
          : Math.min(result.bestRank, c.bestRank);
    result.eliminationFloors = result.eliminationFloors.map(
      (n, i) => n + c.eliminationFloors[i]!,
    );
  }
  return result;
}
export function historyCounters(profile: PlayerProfile) {
  const groups: Record<string, CompletionCounters> = {};
  for (const h of profile.history) {
    const row = { ...h, mode: h.mode ?? 'classic' } as CompletionRecord,
      group = groupKey(row);
    groups[group] = addResult(
      groups[group] ?? emptyCounters(),
      row,
      row.rank === 1 && (row.mode === 'classic' || row.status === 'survived'),
    );
  }
  return groups;
}
