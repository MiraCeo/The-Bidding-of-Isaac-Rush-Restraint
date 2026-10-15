import {
  packAchievementRegistry,
  packedAchievementReceiptLimit,
} from './ledger-codec';
/** Measurement fixtures only. Never imported by the client. Copied metrics from
 * fixed real classic/survival traces; identities at scale are synthetic and are
 * NOT played matches, player receipts, or importable authority proofs. */
import {
  createPlayerProfile,
  type PlayerProfile,
  type ProfileValue,
} from '../player-profile';
import {
  createGameSession,
  reduceGameSession,
  type GameSession,
} from '../game-session';
import { startSurvivalClient, reduceSurvivalClient } from '../survival-client';
import { longRunAction } from '../survival-long-run';
import { completionRecordFixture } from '../completion-registry.test-helper';
import { registerCompletion } from '../completion-registry';
import {
  beginClassicGrowth,
  beginSurvivalGrowth,
  type GrowthContext,
  type GrowthUnit,
} from './lifecycle';
import {
  activateAchievementRegistry,
  readAchievementRegistry,
  achievementRegistryModule,
  type AchievementReceipt,
  type AchievementRegistry,
} from './registry';
import { canonicalJson } from '../../shared/json-facts';
import { sha256Hex } from '../../shared/sha256';
export const measurementTime = new Date('2026-10-15T00:00:00Z');
export function fixedCapacityTraces() {
  let classic = beginClassicGrowth(
    reduceGameSession(createGameSession(42), {
      type: 'start_game',
      characterId: 'lost',
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
    classic = reduceGameSession(classic, { type: 'advance_room' });
  }
  let survival = beginSurvivalGrowth(startSurvivalClient('lost', 3, 'highest'));
  while (survival.game.phase !== 'competition_complete')
    survival = reduceSurvivalClient(survival, longRunAction(survival.game));
  const structural: GrowthUnit[] = [];
  for (let f = 0; f < 7; f++) {
    for (let r = 0; r < 5; r++)
      for (const stage of ['entry', 'room'] as const)
        structural.push({
          stage,
          position: f * 5 + r,
          values: stage === 'entry' ? [0, 0] : [0, 0, 0, 0, 0],
          authorityHash: sha256Hex(`structural-${f}-${r}-${stage}`),
        });
    structural.push({
      stage: 'floor',
      position: f,
      values: [3],
      authorityHash: sha256Hex(`structural-floor-${f}`),
    });
  }
  structural.push({
    stage: 'final',
    position: 6,
    values: [1, 1, null],
    authorityHash: sha256Hex('structural-final'),
  });
  return {
    classic,
    templates: {
      classic: classic.growth!.units,
      mixed: [...classic.growth!.units],
      survival: survival.growth!.units,
      structural,
    },
    survival,
  };
}
export type CapacityTraces = ReturnType<typeof fixedCapacityTraces>;
export type CapacityShape = 'classic' | 'mixed' | 'structural';
function makeReceipt(
  unit: GrowthUnit,
  mode: 'classic' | 'survival',
  root: string,
  parent: string | null,
  original = false,
): AchievementReceipt {
  const authorityHash = original
    ? unit.authorityHash
    : sha256Hex(`${root}:${unit.authorityHash}`);
  return {
    stage: unit.stage,
    position: unit.position,
    values: [...unit.values],
    mode,
    root,
    parent,
    authorityHash,
    at: measurementTime.toISOString(),
    key: sha256Hex(
      canonicalJson([
        mode,
        root,
        parent,
        authorityHash,
        unit.stage,
        unit.position,
      ]),
    ),
  };
}
export function capacityFixture(
  traces: CapacityTraces,
  count: number,
  shape: CapacityShape = 'classic',
  historyRows = 200,
  paddingChars = 0,
  packed = false,
) {
  if (count < 29 || count > (packed ? packedAchievementReceiptLimit : 2048))
    throw Error('Measurement count outside planned range');
  const receipts: AchievementReceipt[] = [];
  let completedTemplates = 0,
    index = 0;
  while (receipts.length < count - 29) {
    const survival =
        shape === 'structural' || (shape === 'mixed' && index % 2 === 1),
      units =
        shape === 'structural'
          ? traces.templates.structural
          : survival
            ? traces.templates.survival
            : traces.templates.classic;
    const root = sha256Hex(`synthetic-capacity-${shape}-${index++}`);
    let parent: string | null = null,
      taken = 0;
    for (const unit of units) {
      if (receipts.length >= count - 29) break;
      const receipt = makeReceipt(
        unit,
        survival ? 'survival' : 'classic',
        root,
        parent,
      );
      receipts.push(receipt);
      parent = receipt.key;
      taken++;
    }
    if (taken === units.length) completedTemplates++;
  }
  let parent: string | null = null;
  for (const unit of traces.classic.growth!.units.slice(0, 29)) {
    const receipt = makeReceipt(
      unit,
      'classic',
      traces.classic.growth!.root,
      parent,
      true,
    );
    receipts.push(receipt);
    parent = receipt.key;
  }
  let p = createPlayerProfile(measurementTime);
  p.history = Array.from({ length: historyRows }, (_, i) =>
    completionRecordFixture(10000 + i),
  );
  for (let i = 0; i < completedTemplates; i++)
    p = registerCompletion(
      p,
      completionRecordFixture(i),
      [],
      false,
      'live',
      measurementTime,
    );
  const initialized = activateAchievementRegistry(p, measurementTime),
    registry = {
      ...readAchievementRegistry(initialized)!,
      receipts,
    } satisfies AchievementRegistry;
  const profile: PlayerProfile = {
    ...initialized,
    progression: {
      ...initialized.progression,
      modules: {
        ...initialized.progression.modules,
        [achievementRegistryModule]: (packed
          ? packAchievementRegistry(registry)
          : registry) as unknown as ProfileValue,
      },
    },
  };
  if (paddingChars)
    profile.progression.modules.capacityPadding = {
      chunks: chunks(paddingChars),
    };
  const context: GrowthContext = {
    ...traces.classic.growth!,
    acknowledged: 29,
  };
  const probe: GameSession = { ...traces.classic, growth: context };
  return {
    profile,
    probe,
    registry,
    completedTemplates,
    shape,
    scope:
      shape === 'structural'
        ? 'Synthetic 78-unit seven-layer shape, not a playable result'
        : 'Scaled copied metrics from fixed traces, not played matches',
  };
}
function chunks(n: number) {
  const result: string[] = [];
  while (n > 0) {
    const take = Math.min(8192, n);
    result.push('x'.repeat(take));
    n -= take;
  }
  return result;
}
export const profileBytes = (p: PlayerProfile) =>
  new TextEncoder().encode(canonicalJson(p)).length;
export function padProfileTo(p: PlayerProfile, targetBytes: number) {
  const next = structuredClone(p),
    values: string[] = [];
  next.progression.modules.capacityPadding = { chunks: values };
  let left = targetBytes - profileBytes(next);
  if (left < 0) throw Error('Target is below base');
  while (left > 3) {
    const length = Math.min(8192, left - 2 - Number(values.length > 0));
    values.push('x'.repeat(length));
    left -= length + 2 + Number(values.length > 1);
  }
  if (left && values.length) values[values.length - 1] += 'x'.repeat(left);
  if (profileBytes(next) !== targetBytes) throw Error('Padding not exact');
  return next;
}
