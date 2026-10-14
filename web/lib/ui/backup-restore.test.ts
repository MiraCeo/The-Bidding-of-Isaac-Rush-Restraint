import { expect, it, vi } from 'vitest';
import { restoreClassicBackupProgress } from './backup-restore';
import { restoreSurvivalBackupProgress } from './survival-restore';
import { createGameSession, reduceGameSession } from './game-session';
import { startSurvivalClient } from './survival-client';
import { createPlayerProfile, playerProfileKey } from './player-profile';
import {
  gameSaveKey,
  activeReplayKey,
  draftSaveKey,
  lastCompletedKey,
  loadAutoSave,
} from './game-save';
import {
  survivalSaveKey,
  survivalLastCompletedKey,
  loadSurvivalCheckpoint,
} from './survival-persistence';
import { PlayerProfileChangedError } from './player-profile-file';

const c = reduceGameSession(createGameSession(71), {
  type: 'start_game',
  characterId: 'isaac',
});
c.draft!.amounts.A.bid = 17;
const s = startSurvivalClient('lost', 99, 'easy');
s.draft!.amounts.B.bid = 23;
const keys = [activeReplayKey, gameSaveKey, draftSaveKey, playerProfileKey];
const modes = ['classic', 'survival'] as const;
function memory(existing = true) {
  const data = new Map<string, string>([
    [playerProfileKey, JSON.stringify(createPlayerProfile())],
    [lastCompletedKey, 'keep-classic-recent'],
    [survivalLastCompletedKey, 'keep-survival-recent'],
    ['bidding-ui-preferences-v1', 'keep-preferences'],
    ['unrelated', 'keep'],
  ]);
  if (existing)
    for (const key of [...keys.slice(0, 3), survivalSaveKey])
      data.set(key, 'original:' + key);
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: vi.fn((key: string, value: string) => {
      data.set(key, value);
    }),
    removeItem: vi.fn((key: string) => {
      data.delete(key);
    }),
  };
}
const profile = createPlayerProfile();
profile.progression.modules.example = { preserved: true };
function restore(
  mode: (typeof modes)[number],
  storage: ReturnType<typeof memory> | null,
  baseline?: string | null,
) {
  if (mode === 'classic')
    restoreClassicBackupProgress(storage, c, profile, baseline);
  else
    restoreSurvivalBackupProgress(storage, s.game, s.draft, profile, baseline);
}
it.each(modes)(
  'restores %s facts, drafts and profile but leaves recent replays and other keys untouched',
  (mode) => {
    const storage = memory(),
      before = new Map(storage.data);
    restore(mode, storage, storage.getItem(playerProfileKey));
    expect(JSON.parse(storage.getItem(playerProfileKey)!)).toEqual(profile);
    if (mode === 'classic') expect(loadAutoSave(storage).session).toEqual(c);
    else {
      expect(loadSurvivalCheckpoint(storage).document?.game).toEqual(s.game);
      expect(loadSurvivalCheckpoint(storage).document?.draft).toEqual(s.draft);
    }
    for (const key of [
      lastCompletedKey,
      survivalLastCompletedKey,
      'unrelated',
      'bidding-ui-preferences-v1',
      mode === 'classic' ? survivalSaveKey : gameSaveKey,
    ])
      expect(storage.getItem(key)).toBe(before.get(key));
  },
);
it.each(modes)(
  'checks the %s preview baseline at persistence even if the UI receives no event',
  (mode) => {
    const storage = memory(),
      old = storage.getItem(playerProfileKey);
    storage.data.set(playerProfileKey, 'changed-by-another-page');
    const before = new Map(storage.data);
    expect(() => restore(mode, storage, old)).toThrow(
      PlayerProfileChangedError,
    );
    expect(storage.setItem).not.toHaveBeenCalled();
    expect(storage.data).toEqual(before);
  },
);
it.each(modes)(
  'never treats absent preview profile as permission to overwrite a new %s profile',
  (mode) => {
    const storage = memory();
    expect(() => restore(mode, storage, null)).toThrow(
      PlayerProfileChangedError,
    );
    expect(storage.setItem).not.toHaveBeenCalled();
  },
);
it.each(
  keys.flatMap((key) => [true, false].map((existing) => ({ key, existing }))),
)(
  'rolls back classic pair at $key (prior checkpoint $existing)',
  ({ key, existing }) => {
    const storage = memory(existing),
      before = new Map(storage.data),
      write = storage.setItem.getMockImplementation()!;
    let rejected = false;
    storage.setItem.mockImplementation((k, value) => {
      if (k === key && !rejected) {
        rejected = true;
        throw new DOMException('quota', 'QuotaExceededError');
      }
      write(k, value);
    });
    expect(() =>
      restore('classic', storage, storage.getItem(playerProfileKey)),
    ).toThrow('已恢复原存储');
    expect(storage.data).toEqual(before);
  },
);
it('reports a failed rollback instead of claiming the old storage is preserved', () => {
  const storage = memory();
  let writes = 0;
  storage.setItem.mockImplementation((key, value) => {
    if (++writes > 1) throw new DOMException('quota', 'QuotaExceededError');
    storage.data.set(key, value);
  });
  expect(() => restore('classic', storage)).toThrow('浏览器未能恢复旧存储');
});
it('checks again just before profile replacement and does not overwrite a competing completion', () => {
  const storage = memory(),
    before = new Map(storage.data),
    baseline = storage.getItem(playerProfileKey);
  const write = storage.setItem.getMockImplementation()!;
  storage.setItem.mockImplementation((key, value) => {
    write(key, value);
    if (key === gameSaveKey)
      storage.data.set(playerProfileKey, 'new-completion');
  });
  expect(() => restore('classic', storage, baseline)).toThrow(
    PlayerProfileChangedError,
  );
  before.set(playerProfileKey, 'new-completion');
  expect(storage.data).toEqual(before);
});
it('never rolls back over another page replacement of an already-written key', () => {
  const storage = memory(),
    baseline = storage.getItem(playerProfileKey);
  const write = storage.setItem.getMockImplementation()!;
  storage.setItem.mockImplementation((key, value) => {
    if (key === gameSaveKey) {
      storage.data.set(activeReplayKey, 'another-page-replay');
      throw new DOMException('quota', 'QuotaExceededError');
    }
    write(key, value);
  });
  expect(() => restore('classic', storage, baseline)).toThrow(
    '浏览器未能恢复旧存储',
  );
  expect(storage.getItem(activeReplayKey)).toBe('another-page-replay');
  expect(storage.getItem(playerProfileKey)).toBe(baseline);
});
it.each(modes)(
  'rejects unavailable %s storage before any state change',
  (mode) => {
    expect(() => restore(mode, null)).toThrow('存储不可用');
  },
);
