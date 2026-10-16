import { saveClassicClient } from './client-persistence';
import { gameSaveKey } from '../game-save';
import { playerProfileKey } from '../player-profile';
import { stringifyChecked } from '../file-json';
import { describe, it, expect } from 'vitest';
import {
  createPlayerProfile,
  readPlayerProfile,
  type PlayerProfile,
} from '../player-profile';
import {
  appendAchievementEvent,
  readAchievementRegistry,
  projectAchievementRegistry,
  compactAchievementProfile,
} from './registry';
import {
  decodeAchievementEvent,
  isMilestoneEvent,
  type EncodedAchievementEvent,
} from './event-codec';
import { sha256Hex } from '../../shared/sha256';
import {
  beginClassicGrowth,
  applyGrowthContext,
  bindGrowthEpoch,
  validateGrowthContext,
  beginSurvivalGrowth,
} from './lifecycle';
import {
  createGameSession,
  reduceGameSession,
  type GameSession,
} from '../game-session';
import {
  parseGameSave,
  serializeGameCheckpoint,
  serializeGameBackup,
} from '../game-save';
import { startSurvivalClient, reduceSurvivalClient } from '../survival-client';
import { longRunAction } from '../survival-long-run';
import {
  serializeSurvivalCheckpoint,
  parseSurvivalCheckpoint,
} from '../survival-persistence';
import {
  serializePlayerProfileBackup,
  parsePlayerProfileBackup,
} from '../player-profile-file';
import { milestoneAchievementIds, achievementCatalog } from './catalog';
import { packAchievementRegistry } from './ledger-codec';
import { padProfileTo } from './growth-capacity.test-helper';
const oldAt = new Date('2026-10-15T00:00:00.000Z'),
  now = new Date('2026-10-15T15:00:00.000Z');
let serial = 0;
function append(
  p: PlayerProfile,
  e: EncodedAchievementEvent,
  options: {
    root?: string;
    parent?: string | null;
    mode?: 'classic' | 'survival';
    at?: Date;
    authority?: string;
  } = {},
) {
  return appendAchievementEvent(
    p,
    {
      source: 'live',
      mode: options.mode ?? 'classic',
      root: sha256Hex(options.root ?? 'root-' + serial),
      parent: options.parent ?? null,
      authorityHash: sha256Hex(options.authority ?? 'authority-' + serial++),
      event: decodeAchievementEvent(e),
    },
    options.at ?? now,
  );
}
const last = (p: PlayerProfile) =>
  readAchievementRegistry(p)!.receipts.at(-1)!.key;
const room = (
  position = 0,
  flags = 0,
  mask = 0,
  bid = 1,
  awards = 0,
  savings = 0,
): EncodedAchievementEvent => ({
  stage: 'room',
  position,
  values: [bid, mask, awards, 0, null, 0, flags, savings],
});
function freshClassic() {
  return beginClassicGrowth(
    reduceGameSession(createGameSession(42), {
      type: 'start_game',
      characterId: 'isaac',
    }),
  );
}
function step(s: GameSession) {
  return reduceGameSession(s, {
    type: 'submit_player_turn',
    turn: {
      playerId: 'human',
      actions: [{ type: 'bid', group: 'A', amount: 1 }],
    },
  });
}
describe('catalog3 activation and reliable metric inheritance', () => {
  it('keeps all prior receipts/timestamps and previews reliable metrics without granting until one novel prospective fact commits', () => {
    let p = createPlayerProfile(oldAt);
    p = append(
      p,
      { stage: 'entry', position: 0, values: [150, 6000] },
      { at: oldAt },
    );
    for (let i = 0; i < 25; i++)
      p = append(
        p,
        { stage: 'room', position: 0, values: [2, 2 ** 11, 2, 0, null] },
        { root: 'market-' + i, at: oldAt },
      );
    for (let i = 0; i < 20; i++)
      p = append(
        p,
        { stage: 'complete', position: 0, values: [0, 0] },
        { root: 'classic-' + i, at: oldAt },
      );
    for (let i = 0; i < 15; i++)
      p = append(
        p,
        { stage: 'complete', position: 1, values: [0, 0] },
        { root: 'survival-' + i, mode: 'survival', at: oldAt },
      );
    p = compactAchievementProfile(p);
    const before = JSON.stringify(p),
      old = readAchievementRegistry(p)!,
      prior = projectAchievementRegistry(p)!;
    expect(prior.progress.B08).toBe(50);
    expect(prior.progress.E10).toBe(20);
    expect(prior.progress.F09).toBe(15);
    for (const id of milestoneAchievementIds)
      expect(prior.achievedAt[id]).toBeUndefined();
    const q = append(
        p,
        { stage: 'entry', position: 0, values: [0, 0, 1] },
        { root: 'activation' },
      ),
      view = projectAchievementRegistry(q)!;
    expect(
      (q.progression.modules.achievementRegistryV1 as { version: number })
        .version,
    ).toBe(4);
    for (const id of [
      'B07',
      'B08',
      'D07',
      'D08',
      'D11',
      'E09',
      'E10',
      'F07',
      'F08',
      'F09',
    ] as const)
      expect(view.achievedAt[id]).toBe(now.toISOString());
    expect(view.achievedAt.D10).toBeUndefined();
    expect(view.progress.D10).toBe(0);
    for (const [id, at] of Object.entries(prior.achievedAt))
      expect(view.achievedAt[id as keyof typeof view.achievedAt]).toBe(at);
    expect(
      readAchievementRegistry(q)!.receipts.slice(0, old.receipts.length),
    ).toEqual(old.receipts);
    expect(JSON.stringify(p)).toBe(before);
    expect(
      parsePlayerProfileBackup(serializePlayerProfileBackup(q)).profile,
    ).toEqual(q);
  });
  it('does not activate on a legacy duplicate, enrich old causes, migrate on read, or award manual permissions', () => {
    const source = room(0, 0, 0, 1),
      old = { ...source, values: source.values.slice(0, 5) };
    const p = append(createPlayerProfile(oldAt), old, {
        root: 'r',
        authority: 'same',
        at: oldAt,
      }),
      before = JSON.stringify(p);
    const q = append(p, source, { root: 'r', authority: 'same' });
    expect(q).toBe(p);
    expect(readAchievementRegistry(q)!.milestones).toBeUndefined();
    expect(JSON.stringify(p)).toBe(before);
  });
  it('deduplicates completed match roots across differing terminal branches and keeps modes separate', () => {
    let p = append(
      createPlayerProfile(now),
      { stage: 'complete', position: 1, values: [0, 0, 1] },
      { root: 's', mode: 'survival' },
    );
    p = append(
      p,
      { stage: 'complete', position: 1, values: [0, 1, 1] },
      { root: 's', mode: 'survival' },
    );
    expect(projectAchievementRegistry(p)!.progress.F08).toBe(1);
    p = append(
      p,
      { stage: 'complete', position: 0, values: [0, 1, 1] },
      { root: 's' },
    );
    expect(projectAchievementRegistry(p)!.progress.E09).toBe(1);
    expect(projectAchievementRegistry(p)!.progress.F08).toBe(1);
  });
  it('counts only new actual savings and preserves limits/atomic source on over-budget installation', () => {
    let p = append(createPlayerProfile(now), room(0, 0, 2 ** 11, 1, 0, 50), {
      root: 's1',
    });
    expect(projectAchievementRegistry(p)!.progress.D10).toBe(50);
    p = append(p, room(0, 0, 2 ** 11, 1, 0, 50), { root: 's2' });
    expect(projectAchievementRegistry(p)!.achievedAt.D10).toBe(
      now.toISOString(),
    );
    const padded = padProfileTo(p, 1024 * 1024),
      before = JSON.stringify(padded);
    expect(() => append(padded, room(), { root: 'over' })).toThrow();
    expect(JSON.stringify(padded)).toBe(before);
  });
});
describe('prospective causes and single-parent run combinations', () => {
  it.each([
    ['B09', 1, 0, 2, 1],
    ['B11', 2, 1, 2, 0],
    ['C08', 4, 2 ** 5, 0, 0],
    ['C09', 8, 2 ** 3, 0, 0],
    ['D09', 16, 2 ** 14, 2, 1],
    ['E15', 32, 0, 5, 1],
  ] as const)(
    'records exact versioned room cause %s once',
    (id, flag, mask, bid, awards) => {
      const p = append(
        createPlayerProfile(now),
        room(0, flag, mask, bid, awards),
      );
      expect(projectAchievementRegistry(p)!.achievedAt[id]).toBe(
        now.toISOString(),
      );
    },
  );
  it('does not borrow old failures, same-room mixed failures, or another branch for recovery/win composites', () => {
    let p = append(
      createPlayerProfile(oldAt),
      { stage: 'room', position: 0, values: [1, 0, 0, 0, null] },
      { root: 'r', at: oldAt },
    );
    const oldParent = last(p);
    p = append(p, room(1, 0, 0, 2, 1), { root: 'r', parent: oldParent });
    expect(
      projectAchievementRegistry(p)!.legacyAchievements.A04,
    ).toBeUndefined();
    p = append(p, room(2, 0, 0, 3), { root: 'r', parent: last(p) });
    const failure = last(p);
    const q = append(p, room(3, 0, 0, 5, 1), { root: 'r', parent: failure });
    expect(projectAchievementRegistry(q)!.legacyAchievements.A04).toBe(
      now.toISOString(),
    );
    const win = append(
      p,
      { stage: 'complete', position: 0, values: [0, 1, 1] },
      { root: 'r', parent: failure },
    );
    expect(projectAchievementRegistry(win)!.achievedAt.A05).toBe(
      now.toISOString(),
    );
    const branch = append(
      p,
      { stage: 'complete', position: 0, values: [0, 1, 1] },
      { root: 'r', parent: oldParent },
    );
    expect(projectAchievementRegistry(branch)!.achievedAt.A05).toBeUndefined();
    const mixed = append(createPlayerProfile(now), room(0, 0, 0, 5, 1));
    expect(
      projectAchievementRegistry(mixed)!.legacyAchievements.A04,
    ).toBeUndefined();
  });
  it('isolates same-run interest, refund-role completion and survival difficulty/lowest survival', () => {
    let p = append(
      createPlayerProfile(oldAt),
      { stage: 'entry', position: 0, values: [0, 190] },
      { root: 'r', at: oldAt },
    );
    p = append(
      p,
      { stage: 'entry', position: 1, values: [0, 10, 1] },
      { root: 'r', parent: last(p) },
    );
    expect(projectAchievementRegistry(p)!.progress.D12).toBe(10);
    p = append(
      p,
      { stage: 'entry', position: 2, values: [0, 190, 1] },
      { root: 'r', parent: last(p) },
    );
    expect(projectAchievementRegistry(p)!.achievedAt.D12).toBe(
      now.toISOString(),
    );
    p = append(p, room(2, 0, 2 ** 4), { root: 'r', parent: last(p) });
    const parent = last(p),
      lost = append(
        p,
        { stage: 'complete', position: 0, values: [1, 0, 1] },
        { root: 'r', parent },
      );
    expect(projectAchievementRegistry(lost)!.achievedAt.E12).toBe(
      now.toISOString(),
    );
    const isaac = append(
      p,
      { stage: 'complete', position: 0, values: [0, 0, 1] },
      { root: 'r', parent },
    );
    expect(projectAchievementRegistry(isaac)!.achievedAt.E12).toBeUndefined();
    let s = append(
      createPlayerProfile(now),
      { stage: 'floor', position: 0, values: [11, 1] },
      { root: 's', mode: 'survival' },
    );
    s = append(
      s,
      { stage: 'final', position: 5, values: [1, 1, null, 1] },
      { root: 's', mode: 'survival', parent: last(s) },
    );
    s = append(
      s,
      { stage: 'complete', position: 1, values: [0, 1, 1] },
      { root: 's', mode: 'survival', parent: last(s) },
    );
    expect(projectAchievementRegistry(s)!.achievedAt.F10).toBe(
      now.toISOString(),
    );
    expect(projectAchievementRegistry(s)!.achievedAt.F12).toBe(
      now.toISOString(),
    );
  });
  it('rejects contradictory new causes, stage markers, wrong versions and activation tampering', () => {
    for (const e of [
      room(0, 1),
      room(0, 8, 0, 0),
      room(0, 32, 0, 3),
      room(0, 0, 0, 1, 0, 2),
      { stage: 'entry', position: 0, values: [0, 0, 2] },
    ] as EncodedAchievementEvent[])
      expect(() => decodeAchievementEvent(e)).toThrow();
    const p = append(createPlayerProfile(now), room()),
      wire = p.progression.modules.achievementRegistryV1!;
    for (const patch of [
      { version: 4, catalogVersion: 2 },
      { milestones: { from: 99, at: now.toISOString() } },
      { milestones: { from: 0, at: oldAt.toISOString() } },
    ]) {
      const q = structuredClone(p);
      Object.assign(q.progression.modules.achievementRegistryV1!, patch);
      expect(() => readPlayerProfile(q)).toThrow();
    }
    const view = readAchievementRegistry(p)!;
    delete view.milestones;
    expect(() => packAchievementRegistry(view)).toThrow();
    expect(wire).toBeTruthy();
  });
});
describe('live recovery transcripts and legacy boundaries', () => {
  it('round-trips new contexts, refuses re-signed cause changes and never awards imported prefixes', () => {
    const s = step(freshClassic());
    expect(s.growth!.units[0]!.values).toHaveLength(4);
    expect(s.growth!.units[1]!.values).toHaveLength(14);
    expect(parseGameSave(serializeGameCheckpoint(s)).session.growth).toEqual(
      s.growth,
    );
    const p = applyGrowthContext(createPlayerProfile(now), s.growth!, now);
    expect(readAchievementRegistry(p.profile)!.milestones).toBeTruthy();
    expect(
      parseGameSave(serializeGameBackup({ ...s, growth: p.context }, p.profile))
        .profile,
    ).toEqual(p.profile);
    const ignored = applyGrowthContext(
      createPlayerProfile(now),
      bindGrowthEpoch(s.growth!, null, { imported: true }),
      now,
    );
    expect(projectAchievementRegistry(ignored.profile)).toBeNull();
    const doc = JSON.parse(serializeGameCheckpoint(s));
    doc.growth.units[1].values[0] = 2;
    doc.growth.units[1].values[2] = 1;
    doc.growth.units[1].values[6] = 1;
    expect(() => parseGameSave(stringifyChecked(doc))).toThrow();
    const bad = structuredClone(s.growth!);
    delete bad.milestonesFrom;
    expect(() => validateGrowthContext(bad, 'classic')).toThrow();
  });
  it('loads a real legacy growth prefix without adding markers, and starts only the next authority stage', () => {
    let legacy = beginClassicGrowth(
      reduceGameSession(createGameSession(42), {
        type: 'start_game',
        characterId: 'isaac',
      }),
      -1,
      -1,
      34,
    );
    legacy = step(legacy);
    delete legacy.growth!.milestonesFrom;
    delete legacy.growth!.revisionsFrom;
    const loaded = parseGameSave(serializeGameCheckpoint(legacy)).session;
    expect(loaded.growth!.milestonesFrom).toBeUndefined();
    const next = step(reduceGameSession(loaded, { type: 'advance_room' }));
    expect(next.growth!.units[0]!.values).toHaveLength(2);
    expect(next.growth!.units.at(-1)!.values).toHaveLength(14);
    expect(next.growth!.milestonesFrom).toBe(1);
  });
  it('round-trips an eliminated survival personal result and counts it once', () => {
    let s = beginSurvivalGrowth(startSurvivalClient('lost', 3, 'highest'));
    while (s.game.phase !== 'competition_complete')
      s = reduceSurvivalClient(s, longRunAction(s.game));
    expect(s.game.humanEliminatedAt).not.toBeNull();
    expect(isMilestoneEvent(s.growth!.units.at(-1)!)).toBe(true);
    const parsed = parseSurvivalCheckpoint(
      serializeSurvivalCheckpoint(s.game, s.draft, now, s.growth),
    );
    expect(parsed.growth).toEqual(s.growth);
    const p = applyGrowthContext(createPlayerProfile(now), s.growth!, now);
    expect(projectAchievementRegistry(p.profile)!.progress.F08).toBe(1);
    expect(
      projectAchievementRegistry(p.profile)!.achievedAt.F10,
    ).toBeUndefined();
  }, 20000);
  it('does not register the four explicitly deferred IDs', () => {
    for (const id of ['B10', 'E13', 'E14', 'F11'])
      expect(achievementCatalog.some((a) => (a.id as string) === id)).toBe(
        false,
      );
    expect(achievementCatalog).toHaveLength(87);
  });
});

it('atomically rolls back schema5 activation on quota failure and retries the pending prefix exactly once', async () => {
  const s = step(freshClassic()),
    values = new Map<string, string>();
  let blocked = true,
    writes = 0;
  const storage = {
    getItem: (k: string) => values.get(k) ?? null,
    setItem: (k: string, v: string) => {
      if (k === playerProfileKey && blocked) {
        blocked = false;
        throw Error('quota');
      }
      values.set(k, v);
      if (k === playerProfileKey) writes++;
    },
    removeItem: (k: string) => {
      values.delete(k);
    },
  };
  const coordinator = { exclusive: async <T>(_n: string, f: () => T) => f() };
  const pending = await saveClassicClient(storage, s, {
    expectedSource: null,
    coordinator,
  });
  expect(pending.message).toBeTruthy();
  expect(pending.newlyAchieved).toEqual([]);
  expect(storage.getItem(playerProfileKey)).toBeNull();
  expect(pending.session.growth!.acknowledged).toBe(0);
  const saved = await saveClassicClient(storage, pending.session, {
    expectedSource: storage.getItem(gameSaveKey),
    coordinator,
  });
  expect(saved.message).toBe('');
  const raw = storage.getItem(playerProfileKey)!;
  expect(
    (
      JSON.parse(raw).progression.modules.achievementRegistryV1 as {
        version: number;
      }
    ).version,
  ).toBe(5);
  const again = await saveClassicClient(storage, saved.session, {
    expectedSource: storage.getItem(gameSaveKey),
    coordinator,
  });
  expect(again.newlyAchieved).toEqual([]);
  expect(storage.getItem(playerProfileKey)).toBe(raw);
  expect(writes).toBe(1);
});
