import { expect, it, vi } from 'vitest';
import {
  createGameSession,
  reduceGameSession,
  type GameSession,
} from '../game-session';
import {
  startSurvivalClient,
  reduceSurvivalClient,
  type SurvivalClientSession,
} from '../survival-client';
import { beginClassicGrowth, beginSurvivalGrowth } from './lifecycle';
import { saveClassicClient, saveSurvivalClient } from './client-persistence';
import {
  gameSaveKey,
  activeReplayKey,
  draftSaveKey,
  type SaveStorage,
} from '../game-save';
import {
  survivalSaveKey,
  parseSurvivalCheckpoint,
  serializeSurvivalCheckpoint,
} from '../survival-persistence';
import { playerProfileKey, createPlayerProfile } from '../player-profile';
import {
  restoreClassicCoordinated,
  restoreSurvivalCoordinated,
} from '../profile-operations';
import {
  profileWriteLockName,
  type ProfileWriteCoordinator,
} from '../profile-write-coordinator';
import { persistAchievementProfile } from './persistence';
import {
  manuallyUnlockAchievementCharacters,
  readAchievementRegistry,
  projectAchievementRegistry,
} from './registry';
function memory() {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => {
      data.set(k, v);
    },
    removeItem: (k: string) => {
      data.delete(k);
    },
  };
}
function locks(): ProfileWriteCoordinator {
  let tail = Promise.resolve<unknown>(undefined);
  return {
    exclusive: (name, work) => {
      expect(name).toBe(profileWriteLockName);
      const next = tail.then(work);
      tail = next.catch(() => {});
      return next;
    },
  };
}
const startClassic = (tracked = true) => {
  const plain = reduceGameSession(createGameSession(42), {
    type: 'start_game',
    characterId: 'lost',
  });
  return tracked ? beginClassicGrowth(plain) : plain;
};
const startSurvival = (tracked = true) => {
  const plain = startSurvivalClient('lost', 42);
  return tracked ? beginSurvivalGrowth(plain) : plain;
};
function classicTurn(s: GameSession) {
  return reduceGameSession(s, {
    type: 'submit_player_turn',
    turn: {
      playerId: 'human',
      actions: [{ type: 'bid', group: 'A', amount: 1 }],
    },
  });
}
function survivalTurn(s: SurvivalClientSession) {
  return reduceSurvivalClient(s, {
    type: 'submit_player_turn',
    turn: {
      playerId: 'human',
      actions: [{ type: 'bid', group: 'A', amount: 1 }],
    },
  });
}
function save(
  mode: 'classic' | 'survival',
  storage: SaveStorage,
  s: GameSession | SurvivalClientSession,
  coordinator: ProfileWriteCoordinator,
) {
  const options = {
    expectedSource: storage.getItem(
      mode === 'classic' ? gameSaveKey : survivalSaveKey,
    ),
    coordinator,
  };
  return mode === 'classic'
    ? saveClassicClient(storage, s as GameSession, options)
    : saveSurvivalClient(storage, s as SurvivalClientSession, options);
}
it.each([
  ['classic', true],
  ['classic', false],
  ['survival', true],
  ['survival', false],
] as const)(
  'rejects a stale queued %s save after paired restore even with byte-identical checkpoint: growth=%s',
  async (mode, tracked) => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-15T00:00:00Z'));
    try {
      const store = memory(),
        coordinator = locks(),
        key = mode === 'classic' ? gameSaveKey : survivalSaveKey;
      const first = await save(
        mode,
        store,
        mode === 'classic' ? startClassic(tracked) : startSurvival(tracked),
        coordinator,
      );
      const current = first.session,
        before = store.getItem(key),
        p = JSON.parse(
          store.getItem(playerProfileKey) ??
            JSON.stringify(createPlayerProfile()),
        );
      const pending =
        mode === 'classic'
          ? classicTurn(current as GameSession)
          : survivalTurn(current as SurvivalClientSession);
      const restored =
        mode === 'classic'
          ? restoreClassicCoordinated(
              store,
              current as GameSession,
              p,
              store.getItem(playerProfileKey),
              { coordinator },
            )
          : restoreSurvivalCoordinated(
              store,
              parseSurvivalCheckpoint(
                serializeSurvivalCheckpoint(
                  (current as SurvivalClientSession).game,
                  current.draft,
                  new Date(),
                  current.growth,
                ),
              ),
              p,
              store.getItem(playerProfileKey),
              { coordinator },
            );
      const stale = save(mode, store, pending, coordinator);
      const rejected = expect(stale).rejects.toThrow('档案已明确替换');
      const result = await restored;
      expect(result.source).toBe(before);
      await rejected;
      expect(store.getItem(key)).toBe(result.source);
      expect(store.getItem(playerProfileKey)).toBe(JSON.stringify(p));
    } finally {
      vi.useRealTimers();
    }
  },
);
it.each([
  ['classic', gameSaveKey],
  ['classic', activeReplayKey],
  ['classic', draftSaveKey],
  ['classic', playerProfileKey],
  ['survival', survivalSaveKey],
  ['survival', playerProfileKey],
] as const)(
  'rolls back one-shot quota failure at %s/%s and retry grants the pending unit once',
  async (mode, failingKey) => {
    const store = memory(),
      coordinator = locks(),
      first = await save(
        mode,
        store,
        mode === 'classic' ? startClassic() : startSurvival(),
        coordinator,
      ),
      beforeProfile = store.getItem(playerProfileKey),
      beforeActive = store.getItem(activeReplayKey),
      beforeDraft = store.getItem(draftSaveKey);
    const pending =
        mode === 'classic'
          ? classicTurn(first.session as GameSession)
          : survivalTurn(first.session as SurvivalClientSession),
      base = store.setItem;
    let once = true;
    store.setItem = (k, v) => {
      if (once && k === failingKey) {
        once = false;
        throw Error('one-shot quota');
      }
      base(k, v);
    };
    const failed = await save(mode, store, pending, coordinator);
    expect(failed.message).toContain('待重试');
    expect(failed.session.growth!.acknowledged).toBe(1);
    expect(store.getItem(playerProfileKey)).toBe(beforeProfile);
    expect(store.getItem(activeReplayKey)).toBe(beforeActive);
    expect(store.getItem(draftSaveKey)).toBe(beforeDraft);
    const success = await save(mode, store, pending, coordinator);
    expect(success.message).toBe('');
    expect(success.session.growth!.acknowledged).toBe(2);
    const committed = store.getItem(playerProfileKey);
    expect(
      readAchievementRegistry(JSON.parse(committed!))!.receipts,
    ).toHaveLength(2);
    await save(mode, store, success.session, coordinator);
    expect(store.getItem(playerProfileKey)).toBe(committed);
  },
);
it('serializes independent manual grant and both formal modes without losing achievements or satisfying unearned prerequisites', async () => {
  const store = memory(),
    coordinator = locks();
  await Promise.all([
    save('classic', store, classicTurn(startClassic()), coordinator),
    persistAchievementProfile(
      store,
      manuallyUnlockAchievementCharacters,
      coordinator,
    ),
    save('survival', store, survivalTurn(startSurvival()), coordinator),
  ]);
  const p = JSON.parse(store.getItem(playerProfileKey)!),
    registry = readAchievementRegistry(p)!,
    view = projectAchievementRegistry(p)!;
  expect(registry.receipts).toHaveLength(4);
  expect(registry.manualUnlockAllAt).not.toBeNull();
  expect(Object.keys(view.characterUnlocks)).toHaveLength(5);
  expect(view.achievedAt.E02).toBeUndefined();
  const before = store.getItem(playerProfileKey);
  await persistAchievementProfile(
    store,
    manuallyUnlockAchievementCharacters,
    coordinator,
  );
  expect(store.getItem(playerProfileKey)).toBe(before);
});
