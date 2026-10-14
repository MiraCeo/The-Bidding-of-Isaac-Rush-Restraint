import type { PlayerProfile, ProfileValue } from '../player-profile';
import { canonicalJson } from '../../shared/json-facts';
import { sha256Hex } from '../../shared/sha256';
import {
  achievementCatalog,
  achievementCatalogVersion,
  characterAchievementRequirements,
  type AchievementId,
} from './catalog';
import {
  emptyAchievementCounters,
  emptyAchievementRunState,
  evaluateAchievementRun,
  type AchievementRunState,
} from './evaluation';
import {
  achievementEventOrder,
  encodeAchievementEvent,
  decodeAchievementEvent,
  eventRunAnalysis,
  type AchievementEvent,
  type EncodedAchievementEvent,
} from './event-codec';

export const achievementRegistryModule = 'achievementRegistryV1';
export const achievementReceiptLimit = 2048;
export const achievementRegistryByteLimit = 896 * 1024;
export interface AchievementReceipt extends EncodedAchievementEvent {
  key: string;
  root: string;
  parent: string | null;
  authorityHash: string;
  mode: 'classic' | 'survival';
  at: string;
}
export interface AchievementRegistry {
  version: 1;
  catalogVersion: 1;
  activatedAt: string;
  manualUnlockAllAt: string | null;
  receipts: AchievementReceipt[];
}
function fail(): never {
  throw Error('成就成长模块损坏、版本不支持或容量超限，原档案保留。');
}
function object(v: unknown): Record<string, unknown> {
  if (!v || typeof v !== 'object' || Array.isArray(v)) fail();
  return v as Record<string, unknown>;
}
function exact(v: unknown, names: string[]) {
  const o = object(v);
  if (
    Object.keys(o).length !== names.length ||
    names.some((n) => !Object.hasOwn(o, n))
  )
    fail();
}
function date(v: unknown): asserts v is string {
  if (
    typeof v !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(v) ||
    !Number.isFinite(Date.parse(v)) ||
    new Date(v).toISOString() !== v
  )
    fail();
}
function hash(v: unknown): asserts v is string {
  if (typeof v !== 'string' || !/^[a-f0-9]{64}$/.test(v)) fail();
}
function receiptKey(r: Omit<AchievementReceipt, 'key' | 'at'>) {
  return sha256Hex(
    canonicalJson([
      r.mode,
      r.root,
      r.parent,
      r.authorityHash,
      r.stage,
      r.position,
    ]),
  );
}
/** Compact factual ledger: counters and achievement times are derived from bounded
 * receipts, so persisted totals cannot silently contradict them. Parent snapshots
 * are rebuilt once per read; branches reuse the same already-recorded prefix. */
function scan(registry: AchievementRegistry) {
  let counters = emptyAchievementCounters();
  const snapshots = new Map<string, AchievementRunState>(),
    nodes = new Map<string, AchievementReceipt>();
  const progress = Object.fromEntries(
    achievementCatalog.map((a) => [a.id, 0]),
  ) as Record<AchievementId, number>;
  const achievedAt: Partial<Record<AchievementId, string>> = {};
  for (const r of registry.receipts) {
    exact(r, [
      'key',
      'root',
      'parent',
      'authorityHash',
      'mode',
      'at',
      'stage',
      'position',
      'values',
    ]);
    hash(r.key);
    hash(r.root);
    hash(r.authorityHash);
    date(r.at);
    if (r.parent !== null) hash(r.parent);
    if (
      !['classic', 'survival'].includes(r.mode) ||
      r.key !== receiptKey(r) ||
      nodes.has(r.key)
    )
      fail();
    decodeAchievementEvent(r);
    if (
      r.mode === 'classic' &&
      (r.stage === 'floor' || r.stage === 'final' || r.position >= 15)
    )
      fail();
    const parent = r.parent === null ? null : nodes.get(r.parent);
    if (
      r.parent !== null &&
      (!parent ||
        parent.root !== r.root ||
        parent.mode !== r.mode ||
        parent.stage === 'final' ||
        achievementEventOrder(parent) >= achievementEventOrder(r))
    )
      fail();
    const input = eventRunAnalysis(r.mode, r);
    const result = evaluateAchievementRun(
      input,
      counters,
      parent ? snapshots.get(parent.key)! : emptyAchievementRunState(),
    );
    if (result.unresolvedEvidence.length) fail();
    counters = result.counters;
    for (const a of achievementCatalog) {
      progress[a.id] = Math.max(progress[a.id], result.progress[a.id]);
      if (result.achieved.includes(a.id) && achievedAt[a.id] === undefined)
        achievedAt[a.id] = r.at;
    }
    nodes.set(r.key, r);
    snapshots.set(r.key, result.runState);
  }
  const characterUnlocks = Object.fromEntries(
    Object.entries(characterAchievementRequirements).flatMap(
      ([id, required]) => {
        if (id === 'isaac')
          return [
            [id, { unlockedAt: registry.activatedAt, conditionId: 'default' }],
          ];
        const earned = required.every((key) => achievedAt[key] !== undefined)
          ? required
              .map((key) => achievedAt[key]!)
              .sort()
              .at(-1)!
          : null;
        if (
          registry.manualUnlockAllAt !== null &&
          (earned === null || registry.manualUnlockAllAt < earned)
        )
          return [
            [
              id,
              {
                unlockedAt: registry.manualUnlockAllAt,
                conditionId: 'manual-all',
              },
            ],
          ];
        if (earned === null) return [];
        return [[id, { unlockedAt: earned, conditionId: required.join('+') }]];
      },
    ),
  );
  return { counters, progress, achievedAt, characterUnlocks, snapshots, nodes };
}
export function validateAchievementRegistry(
  value: unknown,
): AchievementRegistry {
  exact(value, [
    'version',
    'catalogVersion',
    'activatedAt',
    'manualUnlockAllAt',
    'receipts',
  ]);
  const v = object(value);
  if (v.version !== 1 || v.catalogVersion !== achievementCatalogVersion) fail();
  date(v.activatedAt);
  if (v.manualUnlockAllAt !== null) date(v.manualUnlockAllAt);
  if (!Array.isArray(v.receipts) || v.receipts.length > achievementReceiptLimit)
    fail();
  if (
    new TextEncoder().encode(canonicalJson(v)).length >
    achievementRegistryByteLimit
  )
    fail();
  const registry = v as unknown as AchievementRegistry;
  scan(registry);
  return registry;
}
export function readAchievementRegistry(
  profile: PlayerProfile,
): AchievementRegistry | null {
  return Object.hasOwn(profile.progression.modules, achievementRegistryModule)
    ? validateAchievementRegistry(
        profile.progression.modules[achievementRegistryModule],
      )
    : null;
}
export function projectAchievementRegistry(profile: PlayerProfile) {
  const registry = readAchievementRegistry(profile);
  if (!registry) return null;
  const { snapshots: _snapshots, nodes: _nodes, ...view } = scan(registry);
  return view;
}
function install(
  profile: PlayerProfile,
  registry: AchievementRegistry,
  now: Date,
): PlayerProfile {
  validateAchievementRegistry(registry);
  const next = {
    ...profile,
    updatedAt: now.toISOString(),
    progression: {
      ...profile.progression,
      modules: {
        ...profile.progression.modules,
        [achievementRegistryModule]: registry as unknown as ProfileValue,
      },
    },
  };
  if (new TextEncoder().encode(canonicalJson(next)).length > 1024 * 1024)
    fail();
  return next;
}
/** Explicit activation only. Reading old profiles never creates a module or awards
 * achievements. Existing reserved/unknown extension fields are retained but do not
 * confer 0.5 permissions; the versioned module is the authority. */
export function activateAchievementRegistry(
  profile: PlayerProfile,
  now = new Date(),
): PlayerProfile {
  if (readAchievementRegistry(profile)) return profile;
  return install(
    profile,
    {
      version: 1,
      catalogVersion: 1,
      activatedAt: now.toISOString(),
      manualUnlockAllAt: null,
      receipts: [],
    },
    now,
  );
}
export interface AchievementSubmission {
  source: 'live' | 'historical' | 'read-only' | 'tutorial';
  mode: 'classic' | 'survival';
  /** Verified match/migration-root and full authority digest, NOT metric-only IDs
   * or a new random ID per import. Lifecycle construction remains a separate step. */
  root: string;
  parent: string | null;
  authorityHash: string;
  event: AchievementEvent;
}
export function appendAchievementEvent(
  profile: PlayerProfile,
  submission: AchievementSubmission,
  now = new Date(),
) {
  if (
    !['live', 'historical', 'read-only', 'tutorial'].includes(submission.source)
  )
    fail();
  if (submission.source !== 'live') return profile;
  // Activation and receipt are one candidate; neither reaches storage on failure.
  const active = activateAchievementRegistry(profile, now),
    registry = readAchievementRegistry(active)!;
  const encoded = encodeAchievementEvent(submission.event);
  const candidate = {
    ...encoded,
    root: submission.root,
    parent: submission.parent,
    authorityHash: submission.authorityHash,
    mode: submission.mode,
    at: now.toISOString(),
  };
  const r: AchievementReceipt = { ...candidate, key: receiptKey(candidate) };
  const prior = registry.receipts.find((row) => row.key === r.key);
  if (prior) {
    if (
      canonicalJson([prior.stage, prior.position, prior.values]) !==
      canonicalJson([r.stage, r.position, r.values])
    )
      throw Error('同一权威结算的成长证据发生冲突，未重复记账。');
    return profile;
  }
  if (registry.receipts.length >= achievementReceiptLimit) fail();
  return install(
    active,
    { ...registry, receipts: [...registry.receipts, r] },
    now,
  );
}
export function manuallyUnlockAchievementCharacters(
  profile: PlayerProfile,
  now = new Date(),
) {
  const active = activateAchievementRegistry(profile, now),
    registry = readAchievementRegistry(active)!;
  if (registry.manualUnlockAllAt !== null) return profile;
  return install(
    active,
    { ...registry, manualUnlockAllAt: now.toISOString() },
    now,
  );
}
