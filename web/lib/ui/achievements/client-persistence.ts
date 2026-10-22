import {
  coordinateProfileWrite,
  readProfileReplacementEpoch,
  profileReplacementEpochKey,
  type ProfileWriteCoordinator,
} from '../profile-write-coordinator';
import { restoreBackupWrites } from '../backup-restore';
import { checkedJson } from '../file-json';
import {
  playerProfileKey,
  createPlayerProfile,
  readPlayerProfile,
  recordCompletedMatch,
  type PlayerProfile,
} from '../player-profile';
import { recordSurvivalCompletedMatch } from '../survival-profile';
import { createSurvivalReplay } from '../survival-record';
import { serializeReplay } from '../game-replay';
import { readBuildVersion, shortHash } from '../game-version';
import { replayRoomLocator } from '../replay-record';
import {
  gameSaveKey,
  activeReplayKey,
  lastCompletedKey,
  draftSaveKey,
  persistGameSession,
  serializeGameCheckpoint,
  type SaveStorage,
} from '../game-save';
import {
  survivalSaveKey,
  survivalLastCompletedKey,
  saveSurvivalProgress,
  serializeSurvivalCheckpoint,
  serializeSurvivalReplay,
} from '../survival-persistence';
import type { GameSession } from '../game-session';
import type { SurvivalClientSession } from '../survival-client';
import type { CompletionOrigin } from '../completion-registry';
import type { SurvivalReplayLog } from '../survival-record';
import {
  applyGrowthContext,
  bindGrowthEpoch,
  type GrowthContext,
} from './lifecycle';
import { projectAchievementRegistry } from './registry';
import { canonicalJson } from '../../shared/json-facts';
import { measurePersistence } from '../persistence-metrics';

export interface ClientSaveOptions {
  expectedSource: string | null;
  origin?: CompletionOrigin;
  coordinator: ProfileWriteCoordinator | null;
  signal?: AbortSignal;
  onCommitted?: (source: string | null) => void;
  survivalLog?: SurvivalReplayLog | null;
}
export interface ClientSaveResult<
  T extends GameSession | SurvivalClientSession,
> {
  session: T;
  source: string | null;
  profile?: PlayerProfile;
  newlyAchieved: string[];
  message: string;
}
const classicCache = new WeakMap<
  SaveStorage,
  {
    game: GameSession['game'];
    replay: GameSession['replay'];
    context: string;
    core: string;
    replaySource: string;
  }
>();
const survivalCache = new WeakMap<
  SaveStorage,
  {
    game: SurvivalClientSession['game'];
    draft: SurvivalClientSession['draft'];
    context: string;
    core: string;
  }
>();
class StaleProfileWriteError extends Error {
  constructor(
    message = '档案已明确替换，旧保存任务已取消；当前内存对局保留。',
  ) {
    super(message);
  }
}
function scheduledProfileEpoch(
  storage: SaveStorage | null,
): string | null | undefined {
  try {
    return storage?.getItem(profileReplacementEpochKey) ?? null;
  } catch {
    return undefined;
  } // A temporary read failure must not stop gameplay.
}
function assertScheduledProfileEpoch(
  storage: SaveStorage,
  expected: string | null | undefined,
) {
  if (expected === undefined)
    throw new StaleProfileWriteError(
      '保存请求的档案代次未读取，本次未写入；当前内存对局保留，请重试。',
    );
  if (storage.getItem(profileReplacementEpochKey) !== expected)
    throw new StaleProfileWriteError();
}
function committed(options: ClientSaveOptions, source: string | null) {
  try {
    options.onCommitted?.(source);
  } catch {
    /* observers never revoke a write */
  }
}
function assertSource(
  storage: SaveStorage,
  key: string,
  expected: string | null,
) {
  if (storage.getItem(key) !== expected)
    throw Error(
      '其他页面或恢复操作已更改本模式检查点，未覆盖；当前内存对局保留。',
    );
}
function load(storage: SaveStorage) {
  const source = storage.getItem(playerProfileKey);
  return {
    source,
    profile:
      source === null
        ? createPlayerProfile()
        : readPlayerProfile(checkedJson(source)),
  };
}
function changedAchievements(
  before: PlayerProfile,
  after: PlayerProfile,
): string[] {
  const old = projectAchievementRegistry(before)?.achievedAt ?? {},
    next = projectAchievementRegistry(after)?.achievedAt ?? {};
  return Object.keys(next).filter((key) => !Object.hasOwn(old, key));
}
function transaction(
  storage: SaveStorage,
  key: string,
  options: ClientSaveOptions,
  profileSource: string | null,
  before: PlayerProfile,
  after: PlayerProfile,
  writes: (readonly [string, string])[],
) {
  assertSource(storage, key, options.expectedSource);
  if (storage.getItem(playerProfileKey) !== profileSource)
    throw Error('保存期间玩家档案已变化，未覆盖旧资料。');
  const changed = after !== before;
  const candidate = readPlayerProfile(after);
  if (changed) writes.push([playerProfileKey, JSON.stringify(candidate)]);
  const pending = writes.filter(
    ([key, value]) => storage.getItem(key) !== value,
  );
  restoreBackupWrites(
    storage,
    pending,
    pending.some(([key]) => key === playerProfileKey)
      ? profileSource
      : undefined,
    { replaceProfile: false },
  );
  return candidate;
}
export function mergeAcknowledgedGrowth(
  current: GrowthContext,
  saved: GrowthContext,
): GrowthContext {
  if (
    current.root !== saved.root ||
    current.excludedThrough !== saved.excludedThrough ||
    current.expansionFrom !== saved.expansionFrom ||
    current.milestonesFrom !== saved.milestonesFrom ||
    current.revisionsFrom !== saved.revisionsFrom ||
    current.cfFrom !== saved.cfFrom ||
    current.baseline !== saved.baseline ||
    current.profileEpoch !== saved.profileEpoch ||
    (current.ignoredThrough ?? 0) !== (saved.ignoredThrough ?? 0) ||
    current.units.length < saved.units.length ||
    saved.units.some(
      (u, i) => u.authorityHash !== current.units[i]?.authorityHash,
    )
  )
    return current;
  return current.acknowledged >= saved.acknowledged
    ? current
    : { ...current, acknowledged: saved.acknowledged };
}
/** Current UI calls these adapters; synchronous legacy helpers remain primitive
 * test/transaction APIs, not an additional uncoordinated browser writer. */
export function saveClassicClient(
  storage: SaveStorage | null,
  session: GameSession,
  options: ClientSaveOptions,
): Promise<ClientSaveResult<GameSession>> {
  const scheduledEpoch = scheduledProfileEpoch(storage);
  return coordinateProfileWrite<ClientSaveResult<GameSession>>(
    () => {
      if (!storage) throw Error('对局存储不可用，当前内存对局保留。');
      assertScheduledProfileEpoch(storage, scheduledEpoch);
      assertSource(storage, gameSaveKey, options.expectedSource);
      if (
        !session.growth ||
        session.growthIssue ||
        session.game.phase === 'character_selection' ||
        !options.coordinator
      ) {
        if (!persistGameSession(storage, session, options.origin))
          throw Error('经典自动保存未完成，原数据保留。');
        committed(options, storage.getItem(gameSaveKey));
        return {
          session,
          source: storage.getItem(gameSaveKey),
          newlyAchieved: [] as string[],
          message:
            session.growth && !session.growthIssue && !options.coordinator
              ? '对局已保存；成长待重试，同源写入协调能力不可用。'
              : '',
        };
      }
      return measurePersistence(
        { mode: 'classic', operation: 'save', phase: session.game.phase },
        () => {
          const epoch = readProfileReplacementEpoch(storage),
            ctx = bindGrowthEpoch(session.growth!, epoch);
          const loaded = load(storage),
            applied = applyGrowthContext(loaded.profile, ctx);
          let profile = applied.profile;
          if (session.game.phase === 'game_result') {
            const log = session.replay!;
            profile = recordCompletedMatch(
              profile,
              log,
              replayRoomLocator(log, log.rooms.at(-1)!),
              new Date(),
              options.origin,
            );
          }
          const next = { ...session, growth: applied.context };
          const cached = classicCache.get(storage),
            context = canonicalJson(next.growth);
          const core =
            cached?.game === next.game && cached.context === context
              ? cached.core
              : serializeGameCheckpoint(next);
          const replay =
            cached?.replay === next.replay
              ? cached.replaySource
              : serializeReplay(next.replay!, readBuildVersion());
          const writes: (readonly [string, string])[] = [
            [gameSaveKey, core],
            [activeReplayKey, replay],
            [
              draftSaveKey,
              JSON.stringify({ token: shortHash(core), draft: next.draft }),
            ],
          ];
          if (next.game.phase === 'game_result')
            writes.push([lastCompletedKey, replay]);
          const candidate = transaction(
            storage,
            gameSaveKey,
            options,
            loaded.source,
            loaded.profile,
            profile,
            writes,
          );
          classicCache.set(storage, {
            game: next.game,
            replay: next.replay,
            context,
            core,
            replaySource: replay,
          });
          committed(options, core);
          return {
            session: next,
            source: core,
            profile: candidate,
            newlyAchieved: changedAchievements(loaded.profile, candidate),
            message: '',
          };
        },
        () => true,
      );
    },
    { coordinator: options.coordinator, signal: options.signal },
  ).catch((error) =>
    checkpointFallback(
      storage,
      session,
      gameSaveKey,
      options,
      error,
      scheduledEpoch,
    ),
  );
}
export function saveSurvivalClient(
  storage: SaveStorage | null,
  session: SurvivalClientSession,
  options: ClientSaveOptions,
): Promise<ClientSaveResult<SurvivalClientSession>> {
  const scheduledEpoch = scheduledProfileEpoch(storage);
  return coordinateProfileWrite<ClientSaveResult<SurvivalClientSession>>(
    () => {
      if (!storage) throw Error('对局存储不可用，当前内存对局保留。');
      assertScheduledProfileEpoch(storage, scheduledEpoch);
      assertSource(storage, survivalSaveKey, options.expectedSource);
      const loaded = load(storage);
      const growthAllowed =
        session.growth && !session.growthIssue && options.coordinator;
      const ctx = growthAllowed
        ? bindGrowthEpoch(session.growth!, readProfileReplacementEpoch(storage))
        : undefined;
      const applied = ctx
        ? applyGrowthContext(loaded.profile, ctx)
        : { profile: loaded.profile, context: session.growth };
      let profile = applied.profile;
      const log =
        session.game.phase === 'competition_complete'
          ? (options.survivalLog ?? createSurvivalReplay(session.game))
          : null;
      if (
        log &&
        (log.seed !== session.game.seed ||
          log.characterId !== session.game.selectedCharacter ||
          !log.final ||
          log.rooms.length !== session.game.roomRecords.length)
      )
        throw Error('生存终局快照与当前对局不匹配。');
      if (log)
        profile = recordSurvivalCompletedMatch(
          profile,
          log,
          log.id,
          new Date(),
          options.origin,
        );
      if (!growthAllowed) {
        const saved = saveSurvivalProgress(
          storage,
          session.game,
          session.draft,
          session.growthIssue ? undefined : session.growth,
        );
        if (!saved.checkpointSaved || saved.archiveSaved === false)
          throw Error('生存自动保存未完成，原数据保留。');
        if (profile !== loaded.profile)
          transaction(
            storage,
            survivalSaveKey,
            { ...options, expectedSource: storage.getItem(survivalSaveKey) },
            loaded.source,
            loaded.profile,
            profile,
            [],
          );
        committed(options, storage.getItem(survivalSaveKey));
        return {
          session,
          source: storage.getItem(survivalSaveKey),
          profile,
          newlyAchieved: [] as string[],
          message:
            session.growth && !session.growthIssue && !options.coordinator
              ? '对局已保存；成长待重试，同源写入协调能力不可用。'
              : '',
        };
      }
      return measurePersistence(
        { mode: 'survival', operation: 'save', phase: session.game.phase },
        () => {
          const next = { ...session, growth: applied.context };
          const cached = survivalCache.get(storage),
            context = canonicalJson(next.growth);
          const core =
            cached?.game === next.game &&
            cached.draft === next.draft &&
            cached.context === context
              ? cached.core
              : serializeSurvivalCheckpoint(
                  next.game,
                  next.draft,
                  new Date(),
                  next.growth,
                );
          const writes: (readonly [string, string])[] = [
            [survivalSaveKey, core],
          ];
          if (log)
            writes.push([
              survivalLastCompletedKey,
              serializeSurvivalReplay(log),
            ]);
          const candidate = transaction(
            storage,
            survivalSaveKey,
            options,
            loaded.source,
            loaded.profile,
            profile,
            writes,
          );
          survivalCache.set(storage, {
            game: next.game,
            draft: next.draft,
            context,
            core,
          });
          committed(options, core);
          return {
            session: next,
            source: core,
            profile: candidate,
            newlyAchieved: changedAchievements(loaded.profile, candidate),
            message: '',
          };
        },
        () => true,
      );
    },
    { coordinator: options.coordinator, signal: options.signal },
  ).catch((error) =>
    checkpointFallback(
      storage,
      session,
      survivalSaveKey,
      options,
      error,
      scheduledEpoch,
    ),
  );
}
function checkpointFallback<T extends GameSession | SurvivalClientSession>(
  storage: SaveStorage | null,
  session: T,
  key: string,
  options: ClientSaveOptions,
  error: unknown,
  scheduledEpoch: string | null | undefined,
): Promise<ClientSaveResult<T>> {
  if (
    !storage ||
    error instanceof StaleProfileWriteError ||
    options.signal?.aborted ||
    (error instanceof DOMException && error.name === 'AbortError') ||
    (error instanceof Error && error.message.includes('浏览器未能恢复旧存储'))
  )
    return Promise.reject(error);
  return coordinateProfileWrite(
    () => {
      assertScheduledProfileEpoch(storage, scheduledEpoch);
      assertSource(storage, key, options.expectedSource);
      if (session.game.phase === 'character_selection') throw error;
      const source =
        key === gameSaveKey
          ? serializeGameCheckpoint(session as GameSession)
          : serializeSurvivalCheckpoint(
              (session as SurvivalClientSession).game,
              session.draft,
              new Date(),
              session.growthIssue ? undefined : session.growth,
            );
      storage.setItem(key, source);
      committed(options, source);
      return {
        session,
        source,
        newlyAchieved: [] as string[],
        message: `对局检查点已保存；成长、统计或配套回放未保存，待重试：${error instanceof Error ? error.message : '保存失败。'}`,
      };
    },
    { coordinator: options.coordinator, signal: options.signal },
  );
}
export function mergeSavedGrowth(
  current: GrowthContext,
  snapshot: GrowthContext,
  saved: GrowthContext,
): GrowthContext {
  if (
    !snapshot.baseline &&
    !current.baseline &&
    saved.baseline === 1 &&
    canonicalJson(current) === canonicalJson(snapshot)
  )
    return saved;
  if (
    current.root !== saved.root ||
    current.excludedThrough !== saved.excludedThrough ||
    current.expansionFrom !== saved.expansionFrom ||
    current.milestonesFrom !== saved.milestonesFrom ||
    current.revisionsFrom !== saved.revisionsFrom ||
    current.cfFrom !== saved.cfFrom ||
    current.baseline !== saved.baseline ||
    current.units.length < saved.units.length ||
    saved.units.some(
      (u, i) => u.authorityHash !== current.units[i]?.authorityHash,
    )
  )
    return current;
  if (
    current.profileEpoch !== snapshot.profileEpoch ||
    (current.ignoredThrough ?? 0) !== (snapshot.ignoredThrough ?? 0)
  )
    return current;
  if (
    current.profileEpoch === saved.profileEpoch &&
    (current.ignoredThrough ?? 0) === (saved.ignoredThrough ?? 0)
  )
    return mergeAcknowledgedGrowth(current, saved);
  return mergeAcknowledgedGrowth(
    {
      ...current,
      profileEpoch: saved.profileEpoch,
      ignoredThrough: saved.ignoredThrough,
    },
    saved,
  );
}
