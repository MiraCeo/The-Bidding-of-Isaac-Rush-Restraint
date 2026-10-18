import { expect, it } from 'vitest';
import { createGameSession, reduceGameSession } from '../game-session';
import {
  startSurvivalClient,
  reduceSurvivalClient,
  type SurvivalClientSession,
} from '../survival-client';
import { longRunAction } from '../survival-long-run';
import { beginClassicGrowth, beginSurvivalGrowth } from './lifecycle';
import { saveClassicClient, saveSurvivalClient } from './client-persistence';
import {
  gameSaveKey,
  loadAutoSave,
  parseGameSave,
  serializeGameBackup,
} from '../game-save';
import {
  survivalSaveKey,
  parseSurvivalCheckpoint,
  parseSurvivalReplay,
  serializeSurvivalReplay,
} from '../survival-persistence';
import {
  serializeSurvivalBackup,
  parseSurvivalBackup,
} from '../survival-backup';
import { serializeReplay, parseReplay } from '../game-replay';
import { createSurvivalReplay } from '../survival-record';
import {
  restoreClassicCoordinated,
  restoreSurvivalCoordinated,
} from '../profile-operations';
import { playerProfileKey, readPlayerProfile } from '../player-profile';
import {
  readAchievementRegistry,
  projectAchievementRegistry,
  achievementRegistryModule,
} from './registry';
import { readCompletionRegistry, sumCounters } from '../completion-registry';
import { packDataFile, unpackDataFile } from '../compressed-file';
import { canonicalJson } from '../../shared/json-facts';
import type { ProfileWriteCoordinator } from '../profile-write-coordinator';
function memory() {
  const data = new Map<string, string>([['sentinel', 'keep']]);
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
const coordinator: ProfileWriteCoordinator = {
  exclusive: async (_name, work) => work(),
};
function profile(store: ReturnType<typeof memory>) {
  return readPlayerProfile(JSON.parse(store.getItem(playerProfileKey)!));
}
async function portable(text: string) {
  return (await unpackDataFile((await packDataFile(text)).source)).source;
}
it('current schema8 classic checkpoints survive every room reload and a mid-game paired restore without duplicate awards', async () => {
  let store = memory();
  let s = beginClassicGrowth(
    reduceGameSession(createGameSession(42), {
      type: 'start_game',
      characterId: 'isaac',
    }),
  );
  const save = async () => {
    const saved = await saveClassicClient(store, s, {
      expectedSource: store.getItem(gameSaveKey),
      coordinator,
    });
    expect(saved.message).toBe('');
    s = saved.session;
    expect(store.getItem('sentinel')).toBe('keep');
    expect(s.growth!.acknowledged).toBe(s.growth!.units.length);
  };
  await save();
  for (let room = 0; room < 15; room++) {
    s = reduceGameSession(s, {
      type: 'submit_player_turn',
      turn: {
        playerId: 'human',
        actions: [{ type: 'bid', group: 'A', amount: 1 }],
      },
    });
    await save();
    const before = canonicalJson(s.game),
      raw = store.getItem(playerProfileKey);
    s = loadAutoSave(store).session!;
    expect(canonicalJson(s.game)).toBe(before);
    await save();
    expect(store.getItem(playerProfileKey)).toBe(raw);
    if (room === 6) {
      const parsed = parseGameSave(
        await portable(serializeGameBackup(s, profile(store))),
      );
      const fresh = memory();
      await restoreClassicCoordinated(
        fresh,
        parsed.session,
        parsed.profile!,
        null,
        { coordinator },
      );
      expect(profile(fresh)).toEqual(profile(store));
      store = fresh;
      s = loadAutoSave(store).session!;
      const old = store.getItem(playerProfileKey);
      await save();
      expect(store.getItem(playerProfileKey)).toBe(old);
    }
    s = reduceGameSession(s, { type: 'advance_room' });
    await save();
  }
  expect(s.game.phase).toBe('game_result');
  expect(
    profile(store).progression.modules[achievementRegistryModule],
  ).toMatchObject({ version: 8, catalogVersion: 7 });
  expect(readAchievementRegistry(profile(store))!.receipts).toHaveLength(31);
  expect(
    sumCounters(Object.values(readCompletionRegistry(profile(store))!.groups))
      .completed,
  ).toBe(1);
  const raw = store.getItem(playerProfileKey),
    projection = projectAchievementRegistry(profile(store));
  for (let i = 0; i < 3; i++) {
    const replay = parseReplay(
      serializeReplay(s.replay!, 'closeout-reliability'),
    );
    expect(replay.replay.rooms).toHaveLength(15);
    const doc = parseGameSave(
      await portable(serializeGameBackup(s, profile(store))),
    );
    expect(doc.profile).toEqual(profile(store));
    await save();
    expect(store.getItem(playerProfileKey)).toBe(raw);
    expect(projectAchievementRegistry(profile(store))).toEqual(projection);
  }
}, 30000);
it('current schema8 survival reloads and paired import preserve eliminated human facts through automatic AI completion', async () => {
  let store = memory(),
    s = beginSurvivalGrowth(startSurvivalClient('isaac', 3, 'easy')),
    restored = false,
    steps = 0;
  const save = async () => {
    const saved = await saveSurvivalClient(store, s, {
      expectedSource: store.getItem(survivalSaveKey),
      coordinator,
    });
    expect(saved.message).toBe('');
    s = saved.session;
    expect(s.growth!.acknowledged).toBe(s.growth!.units.length);
    expect(store.getItem('sentinel')).toBe('keep');
  };
  await save();
  while (s.game.phase !== 'competition_complete') {
    expect(++steps).toBeLessThan(160);
    let action = longRunAction(s.game, 'pace');
    if (
      s.game.phase === 'room_action' &&
      s.game.activePlayerIds.includes('human')
    ) {
      const money = s.game.players.find((p) => p.isHuman)!.money;
      action = {
        type: 'submit_player_turn',
        turn: {
          playerId: 'human',
          actions:
            money > 0
              ? [{ type: 'bid', group: 'A', amount: Math.min(300, money) }]
              : [{ type: 'withdraw' }],
        },
      };
    }
    s = reduceSurvivalClient(s, action);
    await save();
    const before = canonicalJson(s.game),
      raw = store.getItem(playerProfileKey);
    const cp = parseSurvivalCheckpoint(store.getItem(survivalSaveKey)!);
    s = {
      game: cp.game,
      draft: cp.draft,
      growth: cp.growth,
    } satisfies SurvivalClientSession;
    expect(canonicalJson(s.game)).toBe(before);
    await save();
    expect(store.getItem(playerProfileKey)).toBe(raw);
    if (
      !restored &&
      s.game.phase === 'floor_result' &&
      s.game.floorIndex === 1
    ) {
      const backup = parseSurvivalBackup(
        await portable(
          serializeSurvivalBackup(
            s.game,
            s.draft,
            profile(store),
            new Date(),
            s.growth,
          ),
        ),
      );
      const fresh = memory();
      await restoreSurvivalCoordinated(
        fresh,
        backup.checkpoint,
        backup.profile,
        null,
        { coordinator },
      );
      expect(profile(fresh)).toEqual(profile(store));
      store = fresh;
      const loaded = parseSurvivalCheckpoint(store.getItem(survivalSaveKey)!);
      s = { game: loaded.game, draft: loaded.draft, growth: loaded.growth };
      restored = true;
      const old = store.getItem(playerProfileKey);
      await save();
      expect(store.getItem(playerProfileKey)).toBe(old);
    }
  }
  expect(restored).toBe(true);
  expect(s.game.humanEliminatedAt).toBe(4);
  const p = profile(store),
    registry = readAchievementRegistry(p)!;
  expect(p.progression.modules[achievementRegistryModule]).toMatchObject({
    version: 8,
    catalogVersion: 7,
  });
  expect(registry.receipts).toHaveLength(s.growth!.units.length);
  expect(
    registry.receipts
      .filter((r) => r.stage === 'room')
      .every((r) => r.position <= 24),
  ).toBe(true);
  expect(
    sumCounters(Object.values(readCompletionRegistry(p)!.groups)).completed,
  ).toBe(1);
  const raw = store.getItem(playerProfileKey),
    log = createSurvivalReplay(s.game);
  for (let i = 0; i < 3; i++) {
    expect(
      parseSurvivalReplay(serializeSurvivalReplay(log, s.game.currentBuild))
        .replay.rooms.length,
    ).toBe(log.rooms.length);
    expect(
      parseSurvivalBackup(
        await portable(
          serializeSurvivalBackup(s.game, s.draft, p, new Date(), s.growth),
        ),
      ).profile,
    ).toEqual(p);
    await save();
    expect(store.getItem(playerProfileKey)).toBe(raw);
  }
}, 60000);
