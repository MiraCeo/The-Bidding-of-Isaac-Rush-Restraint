import {
  createRevision058Scan,
  cloneRevision058Scan,
  scanRevision058Receipt,
  revision058EvaluatedIds,
} from './revision058-evaluation';
import {
  achievementBaselineModule,
  currentAchievementBaseline,
  hasCurrentAchievementBaseline,
} from './baseline';
import { achievementCatalog as v056Catalog } from './v056-catalog';
import {
  createRevision057Scan,
  cloneRevision057Scan,
  scanRevision057Receipt,
} from './revision057-evaluation';
import {
  createMilestoneScan,
  cloneMilestoneScan,
  scanMilestoneReceipt,
} from './milestone-evaluation';
import type { PlayerProfile, ProfileValue } from '../player-profile';
import { canonicalJson } from '../../shared/json-facts';
import {
  achievementReceiptKey as receiptKey,
  packAchievementRegistry,
  isExpandedAchievementEvent,
  unpackAchievementRegistry,
  packedAchievementReceiptLimit,
  type PackedAchievementRegistry,
} from './ledger-codec';
import {
  achievementCatalog,
  achievementCatalogVersion,
  currentAchievementCatalogVersion,
  milestoneAchievementCatalogVersion,
  revisionAchievementCatalogVersion,
  cfAchievementCatalogVersion,
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
  sameAchievementEventFacts,
  isMilestoneEvent,
  isRevisionEvent,
  isCfEvent,
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
  milestones?: { from: number; at: string };
  revisions?: { from: number; at: string };
  cf?: { from: number; at: string };
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
    milestones: createMilestoneScan(),
    revisions: createRevision057Scan(),
    cf: createRevision058Scan(),
    legacyAchievements: {} as Partial<Record<'A02' | 'A04', string>>,
    legacyLostAt: null as string | null,
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
function scanReceipt(
  state: ScanState,
  r: AchievementReceipt,
  active = false,
  revisionActive = false,
  cfActive = false,
) {
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
  if (r.stage === 'complete' && r.position !== (r.mode === 'classic' ? 0 : 1))
    fail();
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
      parent.stage === 'complete' ||
      (parent.stage === 'final' && r.stage !== 'complete') ||
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
  for (const a of v056Catalog) {
    progress[a.id] = Math.max(progress[a.id] ?? 0, result.progress[a.id] ?? 0);
    if (result.achieved.includes(a.id) && achievedAt[a.id] === undefined)
      achievedAt[a.id] = r.at;
  }
  scanMilestoneReceipt(state.milestones, r, active);
  scanRevision057Receipt(state.revisions, r, revisionActive);
  scanRevision058Receipt(state.cf, r, cfActive);
  if (!revisionActive) {
    for (const id of ['A02', 'A04'] as const) {
      const at = achievedAt[id] ?? state.milestones.achievedAt[id];
      if (at !== undefined) state.legacyAchievements[id] = at;
    }
    if (achievedAt.E01 && achievedAt.A02)
      state.legacyLostAt ??= [achievedAt.E01, achievedAt.A02].sort().at(-1)!;
  }
  nodes.set(r.key, r);
  snapshots.set(r.key, result.runState);
}
function scan(registry: AchievementRegistry) {
  const state = newScan();
  if (registry.milestones) {
    exact(registry.milestones, ['from', 'at']);
    date(registry.milestones.at);
    const { from, at } = registry.milestones;
    if (
      !Number.isInteger(from) ||
      from < 0 ||
      from >= registry.receipts.length ||
      registry.receipts[from]!.at !== at ||
      !isMilestoneEvent(registry.receipts[from]!)
    )
      fail();
  }
  if (registry.revisions) {
    exact(registry.revisions, ['from', 'at']);
    date(registry.revisions.at);
    const { from, at } = registry.revisions;
    if (
      !Number.isInteger(from) ||
      from < 0 ||
      from >= registry.receipts.length ||
      !registry.milestones ||
      from < registry.milestones.from ||
      registry.receipts[from]!.at !== at ||
      !isRevisionEvent(registry.receipts[from]!)
    )
      fail();
  }
  if (registry.cf) {
    exact(registry.cf, ['from', 'at']);
    date(registry.cf.at);
    const { from, at } = registry.cf;
    if (
      !Number.isInteger(from) ||
      from < 0 ||
      from >= registry.receipts.length ||
      !registry.revisions ||
      from < registry.revisions.from ||
      registry.receipts[from]!.at !== at ||
      !isCfEvent(registry.receipts[from]!)
    )
      fail();
  }
  for (const [i, r] of registry.receipts.entries()) {
    if (isCfEvent(r) && (!registry.cf || i < registry.cf.from)) fail();
    if (
      isRevisionEvent(r) &&
      (!registry.revisions || i < registry.revisions.from)
    )
      fail();
    if (
      isMilestoneEvent(r) &&
      (!registry.milestones || i < registry.milestones.from)
    )
      fail();
    scanReceipt(
      state,
      r,
      !!registry.milestones && i >= registry.milestones.from,
      !!registry.revisions && i >= registry.revisions.from,
      !!registry.cf && i >= registry.cf.from,
    );
  }
  return state;
}
function projectScan(registry: AchievementRegistry, state: ScanState) {
  const { counters } = state;
  const allProgress = {
    ...state.progress,
    ...state.milestones.progress,
    ...state.revisions.progress,
    ...state.cf.progress,
  };
  const achievedAt = {
    ...state.revisions.achievedAt,
    ...state.milestones.achievedAt,
    ...state.achievedAt,
  };
  // Changed meanings use the current rule, not a prior first-event grant.
  // Unchanged thresholds keep ordinary earned-state inheritance (notably E05's
  // role prerequisite). No extra old-time conversion or cleanup is performed.
  delete achievedAt.C06;
  delete achievedAt.C08;
  for (const id of revision058EvaluatedIds)
    if (state.cf.achievedAt[id] !== undefined && achievedAt[id] === undefined)
      achievedAt[id] = state.cf.achievedAt[id];
  delete achievedAt.A02;
  delete achievedAt.A04;
  const progress = Object.fromEntries(
    achievementCatalog.map((a) => [a.id, allProgress[a.id] ?? 0]),
  ) as Record<Exclude<AchievementId, 'A02' | 'A04'>, number> &
    Partial<Record<'A02' | 'A04', number>>;
  const characterUnlocks = Object.fromEntries(
    Object.entries(characterAchievementRequirements).flatMap(
      ([id, required]) => {
        if (id === 'isaac')
          return [
            [id, { unlockedAt: registry.activatedAt, conditionId: 'default' }],
          ];
        let earned = required.every((key) => achievedAt[key] !== undefined)
          ? required
              .map((key) => achievedAt[key]!)
              .sort()
              .at(-1)!
          : null;
        if (
          id === 'lost' &&
          state.legacyLostAt !== null &&
          (earned === null || state.legacyLostAt < earned)
        )
          earned = state.legacyLostAt;
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
        return [
          [
            id,
            {
              unlockedAt: earned,
              conditionId:
                id === 'lost' && state.legacyLostAt === earned
                  ? 'legacy:E01+A02'
                  : required.join('+'),
            },
          ],
        ];
      },
    ),
  );
  return {
    counters,
    progress,
    achievedAt,
    legacyAchievements: state.legacyAchievements,
    characterUnlocks,
  };
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
    v.version === 2 ||
      v.version === 3 ||
      v.version === 4 ||
      v.version === 5 ||
      v.version === 6
      ? [
          'version',
          'catalogVersion',
          'activatedAt',
          'manualUnlockAllAt',
          'count',
          'roots',
          'data',
          ...((v.version as number) >= 4 ? ['milestones'] : []),
          ...((v.version as number) >= 5 ? ['revisions'] : []),
          ...(v.version === 6 ? ['cf'] : []),
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
    ![1, 2, 3, 4, 5, 6].includes(v.version as number) ||
    v.catalogVersion !==
      (v.version === 6
        ? cfAchievementCatalogVersion
        : v.version === 5
          ? revisionAchievementCatalogVersion
          : v.version === 4
            ? milestoneAchievementCatalogVersion
            : v.version === 3
              ? currentAchievementCatalogVersion
              : achievementCatalogVersion)
  )
    fail();
  if (v.version === 6) {
    exact(v.cf, ['from', 'at']);
    date(object(v.cf).at);
  }
  if ((v.version as number) >= 5) {
    exact(v.revisions, ['from', 'at']);
    date(object(v.revisions).at);
  }
  if ((v.version as number) >= 4) {
    exact(v.milestones, ['from', 'at']);
    date(object(v.milestones).at);
  }
  date(v.activatedAt);
  if (v.manualUnlockAllAt !== null) date(v.manualUnlockAllAt);
  if (new TextEncoder().encode(content).length > achievementRegistryByteLimit)
    fail();
  if (
    v.version === 2 ||
    v.version === 3 ||
    v.version === 4 ||
    v.version === 5 ||
    v.version === 6
  )
    return unpackAchievementRegistry(v as unknown as PackedAchievementRegistry);
  if (!Array.isArray(v.receipts) || v.receipts.length > achievementReceiptLimit)
    fail();
  if (
    v.receipts.some((r) => isExpandedAchievementEvent(r as AchievementReceipt))
  )
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
  const analysis = analyzeProfile(prepareAchievementBaseline(profile));
  return analysis
    ? structuredClone(projectScan(analysis.registry, analysis.state))
    : null;
}
/** Pure candidate only; callers commit under the original coordinated profile
 * transaction. Unknown/corrupt old ledgers fail BEFORE any data is removed. */
export function prepareAchievementBaseline(
  profile: PlayerProfile,
  now = new Date(),
): PlayerProfile {
  if (hasCurrentAchievementBaseline(profile)) return profile;
  const previous = analyzeProfile(profile);
  const manual = previous?.registry.manualUnlockAllAt ?? null;
  const modules = { ...profile.progression.modules };
  delete modules[achievementRegistryModule];
  modules[achievementBaselineModule] = { version: currentAchievementBaseline };
  if (previous)
    modules[achievementRegistryModule] = {
      version: 1,
      catalogVersion: 1,
      activatedAt: now.toISOString(),
      manualUnlockAllAt: manual,
      receipts: [],
    };
  const characterUnlocks = Object.fromEntries(
    Object.entries(profile.progression.characterUnlocks).filter(
      ([, grant]) =>
        !/^(?:legacy:)?[A-F]\d{2}(?:\+[A-F]\d{2})*$/.test(grant.conditionId),
    ),
  );
  return {
    ...profile,
    updatedAt: now.toISOString(),
    progression: {
      ...profile.progression,
      achievements: {},
      characterUnlocks,
      modules,
    },
  };
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
    registry.milestones ||
    old?.version === 2 ||
    old?.version === 3 ||
    registry.receipts.some(isExpandedAchievementEvent) ||
    registry.receipts.length >= 256
      ? packAchievementRegistry(registry, old?.version === 3)
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
    ).version !== 1
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
  profile = prepareAchievementBaseline(profile, now);
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
        milestones: cloneMilestoneScan(previous.state.milestones),
        revisions: cloneRevision057Scan(previous.state.revisions),
        cf: cloneRevision058Scan(previous.state.cf),
        legacyAchievements: { ...previous.state.legacyAchievements },
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
          if (!sameAchievementEventFacts(prior, r))
            throw Error('同一权威结算的成长证据发生冲突，未重复记账。');
          return;
        }
        if (registry.receipts.length >= packedAchievementReceiptLimit) fail();
        if (isMilestoneEvent(r) && !registry.milestones)
          registry.milestones = { from: registry.receipts.length, at: r.at };
        if (isRevisionEvent(r) && !registry.revisions)
          registry.revisions = { from: registry.receipts.length, at: r.at };
        if (isCfEvent(r) && !registry.cf)
          registry.cf = { from: registry.receipts.length, at: r.at };
        scanReceipt(
          state,
          r,
          !!registry.milestones,
          !!registry.revisions,
          !!registry.cf,
        );
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
  profile = prepareAchievementBaseline(profile, now);
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
  if (registry.manualUnlockAllAt !== null) return active;
  return install(
    active,
    { ...registry, manualUnlockAllAt: now.toISOString() },
    now,
  );
}
