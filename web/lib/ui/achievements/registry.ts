import type { PlayerProfile, ProfileValue } from '../player-profile';
import { canonicalJson } from '../../shared/json-facts';
import {
  achievementReceiptKey as receiptKey,
  packAchievementRegistry,
  unpackAchievementRegistry,
  packedAchievementReceiptLimit,
  type PackedAchievementRegistry,
} from './ledger-codec';
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
/** Compact factual ledger: counters and achievement times are derived from bounded
 * receipts, so persisted totals cannot silently contradict them. Parent snapshots
 * are rebuilt once per read; branches reuse the same already-recorded prefix. */
function newScan() {
  return {
    counters: emptyAchievementCounters(),
    snapshots: new Map<string, AchievementRunState>(),
    nodes: new Map<string, AchievementReceipt>(),
    authorityUnits: new Map<string, AchievementReceipt>(),
    progress: Object.fromEntries(
      achievementCatalog.map((a) => [a.id, 0]),
    ) as Record<AchievementId, number>,
    achievedAt: {} as Partial<Record<AchievementId, string>>,
  };
}
type ScanState = ReturnType<typeof newScan>;
function scanReceipt(state: ScanState, r: AchievementReceipt) {
  const { snapshots, nodes, authorityUnits, progress, achievedAt } = state;

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
  const identity = authorityUnitIdentity(r);
  if (authorityUnits.has(identity)) fail();
  authorityUnits.set(identity, r);
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
    state.counters,
    parent ? snapshots.get(parent.key)! : emptyAchievementRunState(),
  );
  if (result.unresolvedEvidence.length) fail();
  state.counters = result.counters;
  for (const a of achievementCatalog) {
    progress[a.id] = Math.max(progress[a.id], result.progress[a.id]);
    if (result.achieved.includes(a.id) && achievedAt[a.id] === undefined)
      achievedAt[a.id] = r.at;
  }
  nodes.set(r.key, r);
  snapshots.set(r.key, result.runState);
}
function scan(registry: AchievementRegistry) {
  const state = newScan();
  for (const r of registry.receipts) scanReceipt(state, r);
  return state;
}
function projectScan(registry: AchievementRegistry, state: ScanState) {
  const { counters, progress, achievedAt } = state;
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
  return { counters, progress, achievedAt, characterUnlocks };
}
function authorityUnitIdentity(
  r: Pick<
    AchievementReceipt,
    'mode' | 'root' | 'authorityHash' | 'stage' | 'position'
  >,
) {
  return canonicalJson([r.mode, r.root, r.authorityHash, r.stage, r.position]);
}
/** Cache is bounded to one synchronous write/verification operation and keyed by
 * the entire serialized ledger, never mutable profile identity or a short hash. */
let verificationScope: Map<
  string,
  { registry: AchievementRegistry; state: ScanState }
> | null = null;
export function withAchievementVerificationScope<T>(work: () => T): T {
  const previous = verificationScope;
  verificationScope = new Map();
  try {
    return work();
  } finally {
    verificationScope = previous;
  }
}
/** Canonical content identity must not collapse sparse/non-JSON arrays into a
 * previously valid snapshot. Parsed JSON is dense; direct API inputs must be too. */
function ledgerContent(value: unknown): string {
  let nodes = 0;
  function encode(v: unknown, depth: number): string {
    if (depth > 16 || ++nodes > 500000) fail();
    if (v === null || typeof v === 'string' || typeof v === 'boolean')
      return JSON.stringify(v);
    if (typeof v === 'number') {
      if (!Number.isFinite(v)) fail();
      return JSON.stringify(v);
    }
    if (!v || typeof v !== 'object') fail();
    if (Array.isArray(v)) {
      const keys = Object.keys(v);
      if (keys.length !== v.length || keys.some((key, i) => key !== String(i)))
        fail();
      return `[${v.map((item) => encode(item, depth + 1)).join(',')}]`;
    }
    if (
      Object.getPrototypeOf(v) !== Object.prototype &&
      Object.getPrototypeOf(v) !== null
    )
      fail();
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${encode(o[key], depth + 1)}`)
      .join(',')}}`;
  }
  return encode(value, 0);
}
function analyze(value: unknown) {
  const fingerprint = ledgerContent(value);
  const cached = verificationScope?.get(fingerprint);
  if (cached) return cached;
  const decoded = validateHeader(value, fingerprint),
    registry = object(value).version === 2 ? decoded : structuredClone(decoded),
    state = scan(registry);
  // Both the index and decoded view are private; caller mutations cannot poison them.
  const result = { registry, state };
  if (verificationScope) {
    if (verificationScope.size >= 4)
      verificationScope.delete(verificationScope.keys().next().value!);
    verificationScope.set(fingerprint, result);
  }
  return result;
}
function validateHeader(value: unknown, content: string): AchievementRegistry {
  const v = object(value);
  exact(
    value,
    v.version === 2
      ? [
          'version',
          'catalogVersion',
          'activatedAt',
          'manualUnlockAllAt',
          'count',
          'roots',
          'data',
        ]
      : [
          'version',
          'catalogVersion',
          'activatedAt',
          'manualUnlockAllAt',
          'receipts',
        ],
  );
  if (
    (v.version !== 1 && v.version !== 2) ||
    v.catalogVersion !== achievementCatalogVersion
  )
    fail();
  date(v.activatedAt);
  if (v.manualUnlockAllAt !== null) date(v.manualUnlockAllAt);
  if (new TextEncoder().encode(content).length > achievementRegistryByteLimit)
    fail();
  if (v.version === 2)
    return unpackAchievementRegistry(v as unknown as PackedAchievementRegistry);
  if (!Array.isArray(v.receipts) || v.receipts.length > achievementReceiptLimit)
    fail();
  return v as unknown as AchievementRegistry;
}
export function validateAchievementRegistry(
  value: unknown,
): AchievementRegistry {
  const analysis = analyze(value);
  return object(value).version === 1
    ? (value as AchievementRegistry)
    : structuredClone(analysis.registry);
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
function analyzeProfile(profile: PlayerProfile) {
  return Object.hasOwn(profile.progression.modules, achievementRegistryModule)
    ? analyze(profile.progression.modules[achievementRegistryModule])
    : null;
}
/** Validation-only consumers avoid allocating an exposed decoded receipt clone. */
export function validateProfileAchievementRegistry(
  profile: PlayerProfile,
): void {
  analyzeProfile(profile);
}
export function projectAchievementRegistry(profile: PlayerProfile) {
  const analysis = analyzeProfile(profile);
  return analysis
    ? structuredClone(projectScan(analysis.registry, analysis.state))
    : null;
}
function install(
  profile: PlayerProfile,
  registry: AchievementRegistry,
  now: Date,
): PlayerProfile {
  // Only writes migrate; read/preview/duplicate-only operations never alter storage.
  const old = profile.progression.modules[achievementRegistryModule] as
    | { version?: number }
    | undefined;
  const wire =
    old?.version === 2 || registry.receipts.length >= 256
      ? packAchievementRegistry(registry)
      : structuredClone(registry);
  validateAchievementRegistry(wire);
  const next = {
    ...profile,
    updatedAt: now.toISOString(),
    progression: {
      ...profile.progression,
      modules: {
        ...profile.progression.modules,
        [achievementRegistryModule]: wire as unknown as ProfileValue,
      },
    },
  };
  if (new TextEncoder().encode(canonicalJson(next)).length > 1024 * 1024)
    fail();
  return next;
}
/** Lossless explicit maintenance operation: preserve achievement and profile times.
 * Persistence callers must use the existing coordinated transaction boundary. */
export function compactAchievementProfile(
  profile: PlayerProfile,
): PlayerProfile {
  const analysis = analyzeProfile(profile);
  if (
    !analysis ||
    (
      profile.progression.modules[achievementRegistryModule] as {
        version?: number;
      }
    ).version === 2
  )
    return profile;
  const wire = packAchievementRegistry(analysis.registry);
  validateAchievementRegistry(wire);
  const next = {
    ...profile,
    progression: {
      ...profile.progression,
      modules: {
        ...profile.progression.modules,
        [achievementRegistryModule]: wire as unknown as ProfileValue,
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
/** One validated snapshot, indexed prefix lookups, incremental local evaluation,
 * and one candidate installation. No storage or partial batch publication. */
export function createAchievementBatch(
  profile: PlayerProfile,
  now = new Date(),
) {
  const previous = analyzeProfile(profile);
  const registry: AchievementRegistry = previous
    ? { ...previous.registry, receipts: [...previous.registry.receipts] }
    : {
        version: 1,
        catalogVersion: 1,
        activatedAt: now.toISOString(),
        manualUnlockAllAt: null,
        receipts: [],
      };
  const state: ScanState = previous
    ? {
        ...previous.state,
        counters: { ...previous.state.counters },
        progress: { ...previous.state.progress },
        achievedAt: { ...previous.state.achievedAt },
        nodes: new Map(previous.state.nodes),
        snapshots: new Map(previous.state.snapshots),
        authorityUnits: new Map(previous.state.authorityUnits),
      }
    : newScan();
  let changed = false,
    failed = false,
    finished: PlayerProfile | undefined;
  return {
    find(
      identity: Pick<
        AchievementReceipt,
        'mode' | 'root' | 'authorityHash' | 'stage' | 'position'
      >,
    ) {
      const receipt = state.authorityUnits.get(authorityUnitIdentity(identity));
      return receipt ? structuredClone(receipt) : undefined;
    },
    append(submission: AchievementSubmission) {
      if (failed || finished) fail();
      try {
        if (
          !['live', 'historical', 'read-only', 'tutorial'].includes(
            submission.source,
          )
        )
          fail();
        if (submission.source !== 'live') return;
        const encoded = encodeAchievementEvent(submission.event);
        const candidate = {
          ...encoded,
          root: submission.root,
          parent: submission.parent,
          authorityHash: submission.authorityHash,
          mode: submission.mode,
          at: now.toISOString(),
        };
        const r: AchievementReceipt = {
          ...candidate,
          key: receiptKey(candidate),
        };
        const prior = state.authorityUnits.get(authorityUnitIdentity(r));
        if (prior) {
          if (
            canonicalJson([prior.stage, prior.position, prior.values]) !==
            canonicalJson([r.stage, r.position, r.values])
          )
            throw Error('同一权威结算的成长证据发生冲突，未重复记账。');
          return;
        }
        if (registry.receipts.length >= packedAchievementReceiptLimit) fail();
        scanReceipt(state, r);
        registry.receipts.push(r);
        changed = true;
      } catch (error) {
        failed = true;
        throw error;
      }
    },
    finish() {
      if (failed) fail();
      if (finished) return finished;
      try {
        finished = changed ? install(profile, registry, now) : profile;
        return finished;
      } catch (error) {
        failed = true;
        throw error;
      }
    },
  };
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
  const batch = createAchievementBatch(profile, now);
  batch.append(submission);
  return batch.finish();
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
