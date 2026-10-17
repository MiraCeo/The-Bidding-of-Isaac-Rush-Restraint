/** Current schema6 measurement fixtures ONLY. No client imports, storage access
 * or rule overrides. Scale identities/topology are synthetic, not played games
 * or importable authority proofs. The old schema1/2 corpus stays frozen. */
import { createGameSession, reduceGameSession } from '../game-session';
import { startSurvivalClient, reduceSurvivalClient } from '../survival-client';
import { longRunAction } from '../survival-long-run';
import {
  createPlayerProfile,
  type PlayerProfile,
  type ProfileValue,
} from '../player-profile';
import { completionRecordFixture } from '../completion-registry.test-helper';
import {
  registerCompletion,
  completionRegistryModule,
  completionReceiptLimit,
  type CompletionRegistry,
} from '../completion-registry';
import {
  beginClassicGrowth,
  beginSurvivalGrowth,
  applyGrowthContext,
  validateGrowthContext,
  type GrowthContext,
  type GrowthUnit,
} from './lifecycle';
import {
  achievementReceiptKey,
  packAchievementRegistry,
  packedAchievementReceiptLimit,
} from './ledger-codec';
import {
  achievementRegistryModule,
  type AchievementReceipt,
  type AchievementRegistry,
} from './registry';
import { canonicalJson } from '../../shared/json-facts';
import { sha256Hex } from '../../shared/sha256';

export const corpusTime = new Date('2026-10-16T00:00:00.000Z');
export const currentCorpusShapes = [
  'classic',
  'survival',
  'mixed-branches',
] as const;
export type CurrentCorpusShape = (typeof currentCorpusShapes)[number];
export interface CurrentCorpusTrace {
  id: string;
  mode: 'classic' | 'survival';
  seed: number;
  character: 'isaac';
  policy: 'bid' | 'withdraw' | 'pace' | 'fixed-300';
  difficulty?: 'highest' | 'easy';
  context: GrowthContext;
  humanEliminatedAt?: number | null;
}

function checkedTrace(trace: CurrentCorpusTrace) {
  validateGrowthContext(trace.context, trace.mode);
  if (
    trace.context.baseline !== 1 ||
    trace.context.cfFrom !== -1 ||
    trace.context.units.at(-1)?.stage !== 'complete'
  )
    throw Error('Current corpus trace is not complete/current');
  // Real lifecycle -> production batch -> current wire, not a relabelled legacy ledger.
  const committed = applyGrowthContext(
    createPlayerProfile(corpusTime),
    trace.context,
    corpusTime,
  );
  const wire = committed.profile.progression.modules[
    achievementRegistryModule
  ] as { version: number; catalogVersion: number };
  // Capture uses the current client; scale fixtures below deliberately remain
  // schema6 byte-for-byte baselines, without the new grant-activation header.
  if (wire.version !== 8 || wire.catalogVersion !== 7)
    throw Error('Current lifecycle did not activate schema8');
  return trace;
}
/** Optional scope is test-only: independently recapture one full scenario.
 * The default report/corpus path still captures all five in their fixed order. */
export function captureCurrentCorpus(onlyTrace?: string): CurrentCorpusTrace[] {
  const traces: CurrentCorpusTrace[] = [];
  if (!onlyTrace || onlyTrace === 'classic-42-bid') {
    let classic = beginClassicGrowth(
      reduceGameSession(createGameSession(42), {
        type: 'start_game',
        characterId: 'isaac',
      }),
    );
    for (let i = 0; i < 15; i++) {
      classic = reduceGameSession(classic, {
        type: 'submit_player_turn',
        turn: {
          playerId: 'human',
          actions: [{ type: 'bid', group: 'A', amount: 1 }],
        },
      });
      if (classic.growthIssue) throw Error(classic.growthIssue);
      classic = reduceGameSession(classic, { type: 'advance_room' });
    }
    if (classic.game.phase !== 'game_result' || classic.growthIssue)
      throw Error('Classic corpus did not finish');
    traces.push(
      checkedTrace({
        id: 'classic-42-bid',
        mode: 'classic',
        seed: 42,
        character: 'isaac',
        policy: 'bid',
        context: classic.growth!,
      }),
    );
  }
  for (const { policy, difficulty } of [
    { policy: 'withdraw', difficulty: 'highest' },
    { policy: 'pace', difficulty: 'highest' },
    { policy: 'pace', difficulty: 'easy' },
    { policy: 'fixed-300', difficulty: 'easy' },
  ] as const) {
    const id = `survival-${difficulty === 'easy' ? 'easy-' : ''}3-${policy}`;
    if (onlyTrace && onlyTrace !== id) continue;
    let survival = beginSurvivalGrowth(
      startSurvivalClient('isaac', 3, difficulty),
    );
    let steps = 0;
    while (survival.game.phase !== 'competition_complete') {
      if (++steps > 160) throw Error('Survival corpus exceeded command bound');
      const game = survival.game;
      const action = longRunAction(
        game,
        policy === 'withdraw' ? 'withdraw' : 'pace',
      );
      if (
        policy === 'fixed-300' &&
        game.phase === 'room_action' &&
        game.activePlayerIds.includes('human')
      ) {
        const money = game.players.find((p) => p.isHuman)!.money;
        survival = reduceSurvivalClient(survival, {
          type: 'submit_player_turn',
          turn: {
            playerId: 'human',
            actions:
              money > 0
                ? [{ type: 'bid', group: 'A', amount: Math.min(300, money) }]
                : [{ type: 'withdraw' }],
          },
        });
      } else survival = reduceSurvivalClient(survival, action);
      if (survival.growthIssue) throw Error(survival.growthIssue);
    }
    traces.push(
      checkedTrace({
        id,
        mode: 'survival',
        seed: 3,
        character: 'isaac',
        policy,
        difficulty,
        context: survival.growth!,
        humanEliminatedAt: survival.game.humanEliminatedAt,
      }),
    );
  }
  if (!onlyTrace) return traces;
  const selected = traces.filter((trace) => trace.id === onlyTrace);
  if (!selected.length) throw Error('Unknown current corpus trace');
  return selected;
}

export interface CurrentCorpusOptions {
  historyRows?: number;
  paddingChars?: number;
  /** Synthetic observed keys exercise shared byte budgets, not completed games.
   * One counted seed plus (n-1) observed/unbackfilled keys, explicitly reported. */
  completionReceipts?: number;
}
function bound(value: number, max: number) {
  if (!Number.isSafeInteger(value) || value < 0 || value > max)
    throw Error('Corpus option outside planned range');
}
export function buildCurrentLedgerFixture(
  traces: readonly CurrentCorpusTrace[],
  count: number,
  shape: CurrentCorpusShape,
  options: CurrentCorpusOptions = {},
) {
  bound(count, packedAchievementReceiptLimit);
  if (!currentCorpusShapes.includes(shape)) throw Error('Unknown corpus shape');
  const historyRows = options.historyRows ?? 0,
    paddingChars = options.paddingChars ?? 0,
    completionReceipts = options.completionReceipts ?? 0;
  bound(historyRows, 200);
  bound(paddingChars, 1024 * 1024);
  bound(completionReceipts, completionReceiptLimit);
  const classic = traces.find((t) => t.mode === 'classic');
  const survivals = traces.filter((t) => t.mode === 'survival');
  if (!classic || !survivals.length)
    throw Error('Missing current corpus trace');
  const receipts: AchievementReceipt[] = [];
  let roots = 0,
    forks = 0,
    completeTemplates = 0;
  const add = (
    unit: GrowthUnit,
    trace: CurrentCorpusTrace,
    root: string,
    parent: string | null,
    branch: number,
  ) => {
    const candidate = {
      stage: unit.stage,
      position: unit.position,
      // Preserve the frozen schema6 scale corpus; new proof is measured separately.
      values: unit.values.slice(
        0,
        unit.stage === 'room'
          ? 17
          : unit.stage === 'floor'
            ? 4
            : unit.values.length,
      ),
      root,
      parent,
      mode: trace.mode,
      authorityHash: sha256Hex(
        `schema6-scale:${root}:${branch}:${unit.authorityHash}`,
      ),
    };
    const receipt = {
      ...candidate,
      key: achievementReceiptKey(candidate),
      at: new Date(
        corpusTime.getTime() + (receipts.length + 1) * 1000,
      ).toISOString(),
    };
    receipts.push(receipt);
    if (unit.stage === 'complete') completeTemplates++;
    return receipt.key;
  };
  while (receipts.length < count) {
    const index = roots++;
    const trace =
      shape === 'classic'
        ? classic
        : shape === 'survival'
          ? survivals[index % survivals.length]!
          : index % 2
            ? survivals[index % survivals.length]!
            : classic;
    const units = trace.context.units;
    const root = sha256Hex(`schema6-scale:${shape}:${index}`);
    const first = units[0];
    if (first?.stage !== 'entry' || first.values.length !== 5)
      throw Error('Missing current entry');
    const shared = add(first, trace, root, null, 0);
    for (
      let branch = 0;
      branch < (shape === 'mixed-branches' ? 2 : 1);
      branch++
    ) {
      let parent = shared;
      if (branch && receipts.length < count) forks++;
      for (const unit of units.slice(1)) {
        if (receipts.length >= count) break;
        parent = add(unit, trace, root, parent, branch);
      }
    }
  }
  let profile = createPlayerProfile(corpusTime);
  if (completionReceipts) {
    profile = registerCompletion(
      profile,
      completionRecordFixture(0),
      [],
      false,
      'live',
      corpusTime,
    );
    const completion = profile.progression.modules[
      completionRegistryModule
    ] as unknown as CompletionRegistry;
    for (let i = 1; i < completionReceipts; i++)
      completion.receipts[
        `${i % 2 ? 'survival' : 'classic'}/${sha256Hex('schema6-observed-' + i)}`
      ] = false;
  }
  profile.history = Array.from({ length: historyRows }, (_, i) =>
    completionRecordFixture(10000 + i),
  );
  profile.updatedAt = new Date(
    corpusTime.getTime() + (count + 1) * 1000,
  ).toISOString();
  if (paddingChars) {
    const chunks = [];
    for (let left = paddingChars; left > 0; left -= 8192)
      chunks.push('x'.repeat(Math.min(left, 8192)));
    profile.progression.modules.closeoutFixturePadding = { chunks };
  }
  // An empty current profile has no activated ledger. Do not forge cf.from=0
  // for zero receipts, or claim its nonexistent wire is schema6.
  const registry: AchievementRegistry | null = count
    ? {
        version: 1,
        catalogVersion: 1,
        activatedAt: corpusTime.toISOString(),
        manualUnlockAllAt: null,
        milestones: { from: 0, at: receipts[0]!.at },
        revisions: { from: 0, at: receipts[0]!.at },
        cf: { from: 0, at: receipts[0]!.at },
        receipts,
      }
    : null;
  const wire = registry ? packAchievementRegistry(registry) : null;
  if (wire)
    profile.progression.modules[achievementRegistryModule] =
      wire as unknown as ProfileValue;
  return {
    profile,
    registry,
    wire,
    provenance: {
      shape,
      count,
      roots,
      forks,
      completeTemplateEvents: completeTemplates,
      historyRows,
      paddingChars,
      completionReceipts,
      countedCompletionKeys: Number(completionReceipts > 0),
      observedCompletionKeys: Math.max(0, completionReceipts - 1),
      syntheticIdentities: true,
      syntheticTopology: shape === 'mixed-branches',
      metrics:
        'Copied unchanged from current official-rule Node lifecycle traces; not real player progress, imported authority proofs or worst-case capacity.',
    },
  };
}
export const currentCorpusBytes = (profile: PlayerProfile) =>
  Buffer.byteLength(canonicalJson(profile));
