import {
  createPlayerProfile,
  playerProfileKey,
  type PlayerProfile,
} from '../player-profile';
import { createGameSession, reduceGameSession } from '../game-session';
import { beginClassicGrowth } from './lifecycle';
import { saveClassicClient } from './client-persistence';
import { gameSaveKey } from '../game-save';
import { decodeAchievementEvent } from './event-codec';
import { sha256Hex } from '../../shared/sha256';
import { canonicalJson } from '../../shared/json-facts';
import { currentCorpusBytes } from './closeout-corpus.test-helper';

export const capacityClock = new Date('2026-10-16T12:00:00.000Z');
export const capacitySubmission = {
  source: 'live' as const,
  mode: 'classic' as const,
  root: sha256Hex('schema6-capacity-next-root'),
  parent: null,
  authorityHash: sha256Hex('schema6-capacity-next-authority'),
  event: decodeAchievementEvent({
    stage: 'entry',
    position: 0,
    values: [0, 0, 1, 1, 1],
  }),
};
/** Exact ASCII padding only; no fact, budget or validator changes. */
export function padCurrentProfileTo(profile: PlayerProfile, target: number) {
  const next = structuredClone(profile),
    chunks: string[] = [];
  next.progression.modules.exactBudgetPadding = { chunks };
  let remaining = target - currentCorpusBytes(next);
  if (!Number.isSafeInteger(target) || remaining < 0)
    throw Error('Invalid exact profile target');
  while (remaining > 3) {
    const length = Math.min(8192, remaining - 2 - Number(chunks.length > 0));
    chunks.push('x'.repeat(length));
    remaining -= length + 2 + Number(chunks.length > 1);
  }
  if (remaining && chunks.length)
    chunks[chunks.length - 1] += 'x'.repeat(remaining);
  if (currentCorpusBytes(next) !== target)
    throw Error('Profile padding did not reach exact target');
  return next;
}
export function currentPendingProbe() {
  return reduceGameSession(
    beginClassicGrowth(
      reduceGameSession(createGameSession(31415), {
        type: 'start_game',
        characterId: 'isaac',
      }),
    ),
    {
      type: 'submit_player_turn',
      turn: { playerId: 'human', actions: [{ type: 'withdraw' }] },
    },
  );
}
/** In-memory adapter and injected coordination, never browser/physical storage. */
export async function probeCurrentSave(
  profile = createPlayerProfile(capacityClock),
  failProfileWrite = false,
) {
  const raw = canonicalJson(profile),
    data = new Map([
      [playerProfileKey, raw],
      ['sentinel', 'keep'],
    ]);
  let profileWrites = 0,
    quotaBlocked = failProfileWrite;
  const storage = {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      if (key === playerProfileKey && quotaBlocked)
        throw Error('synthetic profile quota');
      if (key === playerProfileKey) profileWrites++;
      data.set(key, value);
    },
    removeItem: (key: string) => {
      data.delete(key);
    },
  };
  const coordinator = {
    exclusive: async <T>(_key: string, work: () => T) => work(),
  };
  const session = currentPendingProbe(),
    start = performance.now();
  const result = await saveClassicClient(storage, session, {
    coordinator,
    expectedSource: null,
  });
  const firstMs = performance.now() - start;
  const committed = data.get(playerProfileKey)!;
  const secondStart = performance.now();
  const repeated = await saveClassicClient(storage, result.session, {
    coordinator,
    expectedSource: storage.getItem(gameSaveKey),
  });
  const repeatedMs = performance.now() - secondStart;
  if (data.get('sentinel') !== 'keep') throw Error('Unrelated key changed');
  if (result.message) {
    if (
      committed !== raw ||
      data.get(playerProfileKey) !== raw ||
      result.session.growth!.acknowledged !== 0 ||
      repeated.session.growth!.acknowledged !== 0
    )
      throw Error(
        'Rejected profile write changed source or acknowledged pending facts',
      );
  } else if (
    data.get(playerProfileKey) !== committed ||
    profileWrites !== 1 ||
    result.session.growth!.acknowledged !== 2 ||
    repeated.message
  )
    throw Error('Successful/repeated save violated exactly-once contract');
  const firstPhaseProfileWrites = profileWrites;
  let quotaRetry = null;
  if (failProfileWrite) {
    quotaBlocked = false;
    const retry = await saveClassicClient(storage, repeated.session, {
      coordinator,
      expectedSource: storage.getItem(gameSaveKey),
    });
    if (
      retry.message ||
      retry.session.growth!.acknowledged !== 2 ||
      profileWrites !== 1
    )
      throw Error('Quota recovery did not confirm pending exactly once');
    const retryRaw = data.get(playerProfileKey);
    const again = await saveClassicClient(storage, retry.session, {
      coordinator,
      expectedSource: storage.getItem(gameSaveKey),
    });
    if (
      again.message ||
      data.get(playerProfileKey) !== retryRaw ||
      profileWrites !== 1
    )
      throw Error('Quota retry duplicated a profile write');
    quotaRetry = {
      acknowledged: retry.session.growth!.acknowledged,
      profileWrites,
      repeatedProfileUnchanged: true,
    };
  }
  return {
    firstMs,
    repeatedMs,
    profileWrites: firstPhaseProfileWrites,
    result: result.message ? 'pending' : 'committed',
    profileUnchanged: committed === raw,
    acknowledged: result.session.growth!.acknowledged,
    pendingUnits:
      result.session.growth!.units.length - result.session.growth!.acknowledged,
    checkpointBytes: Buffer.byteLength(data.get(gameSaveKey) ?? ''),
    message: result.message,
    quotaRetry,
  };
}
