// @vitest-environment happy-dom
import { act, createElement, StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  ClassicGameApp,
  type ClassicGameAppProps,
} from '@/components/game/classic-game-app';
import { PlayerProfileManagement } from '@/components/game/player-profile-management';
import type { SessionTools } from '@/components/game/session-context';
import { createGameSession, reduceGameSession } from '../game-session';
import { beginClassicGrowth } from './lifecycle';
import { readAchievementRegistry } from './registry';
import {
  gameSaveKey,
  serializeGameCheckpoint,
  parseGameSave,
} from '../game-save';
import { createPlayerProfile, playerProfileKey } from '../player-profile';
import { serializePlayerProfileBackup } from '../player-profile-file';
import {
  profileWriteLockName,
  profileReplacementEpochKey,
} from '../profile-write-coordinator';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root,
  container: HTMLDivElement,
  descriptor: PropertyDescriptor | undefined;
beforeEach(() => {
  localStorage.clear();
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  descriptor = Object.getOwnPropertyDescriptor(navigator, 'locks');
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  if (descriptor) Object.defineProperty(navigator, 'locks', descriptor);
  else Reflect.deleteProperty(navigator, 'locks');
});
function coordinator(gate: Promise<void> = Promise.resolve()) {
  let tail: Promise<unknown> = gate;
  Object.defineProperty(navigator, 'locks', {
    configurable: true,
    value: {
      request: (name: string, _options: unknown, work: () => unknown) => {
        expect(name).toBe(profileWriteLockName);
        const next = tail.then(work);
        tail = next.catch(() => {});
        return next;
      },
    },
  });
}
function start(seed = 42) {
  return beginClassicGrowth(
    reduceGameSession(createGameSession(seed), {
      type: 'start_game',
      characterId: 'lost',
    }),
  );
}
function button(label: string) {
  const node = [
    ...container.querySelectorAll<HTMLButtonElement>('button'),
  ].find((b) => b.textContent?.trim() === label);
  if (!node) throw Error(`Missing ${label}`);
  return node;
}
const click = async (label: string) => act(async () => button(label).click());
async function waitUi(check: () => void) {
  for (let i = 0; i < 100; i++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    try {
      check();
      return;
    } catch (error) {
      if (i === 99) throw error;
    }
  }
}
function profile() {
  return JSON.parse(localStorage.getItem(playerProfileKey)!);
}

it('formal classic UI acknowledges actual local pending entry once, including StrictMode effect retries', async () => {
  coordinator();
  localStorage.setItem(gameSaveKey, serializeGameCheckpoint(start()));
  let tools: SessionTools | undefined;
  await act(async () =>
    root.render(
      createElement(
        StrictMode,
        null,
        createElement<ClassicGameAppProps>(ClassicGameApp, {
          onToolsChange: (next) => {
            tools = next;
          },
        }),
      ),
    ),
  );
  await waitUi(() => expect(tools?.session.growth?.acknowledged).toBe(1));
  expect(readAchievementRegistry(profile())!.receipts).toHaveLength(1);
  await click('出价竞拍');
  await waitUi(() => expect(tools?.session.growth?.acknowledged).toBe(2));
  expect(readAchievementRegistry(profile())!.receipts).toHaveLength(2);
  expect(
    parseGameSave(localStorage.getItem(gameSaveKey)!).session.growth!
      .acknowledged,
  ).toBe(2);
});
it('formal classic autosave quota failure stays pending and explicit retry grants once', async () => {
  coordinator();
  localStorage.setItem(gameSaveKey, serializeGameCheckpoint(start()));
  const base = localStorage.setItem.bind(localStorage);
  let blocked = true;
  vi.spyOn(localStorage, 'setItem').mockImplementation((key, value) => {
    if (blocked && key === playerProfileKey) throw Error('quota');
    base(key, value);
  });
  await act(async () => root.render(createElement(ClassicGameApp)));
  await waitUi(() => expect(container.textContent).toContain('待重试'));
  expect(localStorage.getItem(playerProfileKey)).toBeNull();
  expect(
    parseGameSave(localStorage.getItem(gameSaveKey)!).session.growth!
      .acknowledged,
  ).toBe(0);
  blocked = false;
  await click('重试保存');
  await waitUi(() =>
    expect(readAchievementRegistry(profile())!.receipts).toHaveLength(1),
  );
  expect(
    parseGameSave(localStorage.getItem(gameSaveKey)!).session.growth!
      .acknowledged,
  ).toBe(1);
});
it('old queued save is cancelled on explicit classic import and imported pending units are not awarded', async () => {
  let release!: () => void;
  coordinator(
    new Promise<void>((resolve) => {
      release = resolve;
    }),
  );
  localStorage.setItem(gameSaveKey, serializeGameCheckpoint(start()));
  let tools: SessionTools | undefined;
  await act(async () =>
    root.render(
      createElement<ClassicGameAppProps>(ClassicGameApp, {
        onToolsChange: (next) => {
          tools = next;
        },
      }),
    ),
  );
  const imported = reduceGameSession(start(90), {
    type: 'submit_player_turn',
    turn: { playerId: 'human', actions: [{ type: 'withdraw' }] },
  });
  await act(async () => {
    await tools!.onRestore(imported);
  });
  await act(async () => {
    release();
    await Promise.resolve();
  });
  await waitUi(() =>
    expect(
      parseGameSave(localStorage.getItem(gameSaveKey)!).session.game.seed,
    ).toBe(90),
  );
  expect(localStorage.getItem(playerProfileKey)).toBeNull();
  expect(tools!.session.growth!.ignoredThrough).toBe(2);
});
it('foreign tab changes checkpoint while lock queued, no auto-rebase or overwrite on retry', async () => {
  let release!: () => void;
  coordinator(
    new Promise<void>((resolve) => {
      release = resolve;
    }),
  );
  localStorage.setItem(gameSaveKey, serializeGameCheckpoint(start()));
  await act(async () => root.render(createElement(ClassicGameApp)));
  const foreign = serializeGameCheckpoint(start(90));
  localStorage.setItem(gameSaveKey, foreign);
  await act(async () => {
    release();
    await Promise.resolve();
  });
  await waitUi(() => expect(container.textContent).toContain('其他页面'));
  await click('重试保存');
  expect(localStorage.getItem(gameSaveKey)).toBe(foreign);
  expect(localStorage.getItem(playerProfileKey)).toBeNull();
});
it('independent profile preview cancel aborts queued replacement before profile or epoch writes', async () => {
  let release!: () => void;
  coordinator(
    new Promise<void>((resolve) => {
      release = resolve;
    }),
  );
  const original = JSON.stringify(createPlayerProfile(new Date('2026-01-01')));
  localStorage.setItem(playerProfileKey, original);
  await act(async () => root.render(createElement(PlayerProfileManagement)));
  const node = container.querySelector<HTMLInputElement>('input[type=file]')!,
    file = new File(['json'], 'profile.json');
  Object.defineProperty(file, 'text', {
    value: () =>
      Promise.resolve(
        serializePlayerProfileBackup(
          createPlayerProfile(new Date('2026-02-01')),
        ),
      ),
  });
  Object.defineProperty(node, 'files', { configurable: true, value: [file] });
  await act(async () =>
    node.dispatchEvent(new Event('change', { bubbles: true })),
  );
  await waitUi(() =>
    expect(container.querySelector('.profile-candidate')).not.toBeNull(),
  );
  await act(async () =>
    container
      .querySelector<HTMLInputElement>('.profile-restore-ack input')!
      .click(),
  );
  await click('确认恢复玩家档案');
  expect(button('确认恢复玩家档案').disabled).toBe(true);
  await click('取消恢复档案');
  await act(async () => {
    release();
    await Promise.resolve();
  });
  expect(localStorage.getItem(playerProfileKey)).toBe(original);
  expect(localStorage.getItem(profileReplacementEpochKey)).toBeNull();
  expect(container.textContent).toContain('已取消档案操作');
});
import { GameApp } from '@/components/game/game-app';
import { beginSurvivalGrowth } from './lifecycle';
import { startSurvivalClient, activeModeKey } from '../survival-client';
import {
  survivalSaveKey,
  serializeSurvivalCheckpoint,
  parseSurvivalCheckpoint,
} from '../survival-persistence';
import * as survivalRecords from '../survival-record';
it('formal survival UI grants actual entry/room and reuses the replay snapshot on acknowledgement renders', async () => {
  coordinator();
  const s = beginSurvivalGrowth(startSurvivalClient('isaac', 42));
  localStorage.setItem(activeModeKey, 'survival');
  localStorage.setItem(
    survivalSaveKey,
    serializeSurvivalCheckpoint(s.game, s.draft, new Date(), s.growth),
  );
  const replay = vi.spyOn(survivalRecords, 'createSurvivalReplay');
  await act(async () => root.render(createElement(GameApp)));
  await waitUi(() =>
    expect(
      parseSurvivalCheckpoint(localStorage.getItem(survivalSaveKey)!).growth!
        .acknowledged,
    ).toBe(1),
  );
  const count = replay.mock.calls.length;
  await click('出价竞拍');
  await waitUi(() =>
    expect(
      parseSurvivalCheckpoint(localStorage.getItem(survivalSaveKey)!).growth!
        .acknowledged,
    ).toBe(2),
  );
  expect(
    readAchievementRegistry(profile())!.receipts.filter(
      (r) => r.mode === 'survival',
    ),
  ).toHaveLength(2);
  expect(replay.mock.calls.length).toBe(count + 1);
});
it('paired restore pins its committed checkpoint source even if another tab changes it before the next render', async () => {
  coordinator();
  localStorage.setItem(gameSaveKey, serializeGameCheckpoint(start()));
  let tools: SessionTools | undefined;
  await act(async () =>
    root.render(
      createElement<ClassicGameAppProps>(ClassicGameApp, {
        onToolsChange: (next) => {
          tools = next;
        },
      }),
    ),
  );
  await waitUi(() => expect(tools!.session.growth!.acknowledged).toBe(1));
  let disturbed = false;
  Object.defineProperty(navigator, 'locks', {
    configurable: true,
    value: {
      request: async (_name: string, _opts: unknown, work: () => unknown) => {
        const before = localStorage.getItem(profileReplacementEpochKey),
          result = work();
        if (
          !disturbed &&
          localStorage.getItem(profileReplacementEpochKey) !== before
        ) {
          disturbed = true;
          localStorage.setItem(gameSaveKey, 'foreign-after-paired-commit');
        }
        return result;
      },
    },
  });
  await act(async () => {
    await tools!.onRestore(
      start(90),
      createPlayerProfile(),
      localStorage.getItem(playerProfileKey),
    );
  });
  await waitUi(() => expect(container.textContent).toContain('其他页面'));
  expect(tools!.session.game.seed).toBe(90);
  expect(localStorage.getItem(gameSaveKey)).toBe('foreign-after-paired-commit');
  expect(readAchievementRegistry(profile())).toBeNull();
});
it('unmount cancels pending formal writer, and later lock availability does not resurrect the old session', async () => {
  let release!: () => void;
  coordinator(
    new Promise<void>((resolve) => {
      release = resolve;
    }),
  );
  const source = serializeGameCheckpoint(start());
  localStorage.setItem(gameSaveKey, source);
  await act(async () => root.render(createElement(ClassicGameApp)));
  await act(async () => root.render(null));
  await act(async () => {
    release();
    await Promise.resolve();
  });
  expect(localStorage.getItem(gameSaveKey)).toBe(source);
  expect(localStorage.getItem(playerProfileKey)).toBeNull();
});
import { serializeGameBackup } from '../game-save';
import { serializeSurvivalBackup } from '../survival-backup';
it.each(['classic', 'survival'] as const)(
  'cancelling the %s paired file preview while its shared lock is queued changes neither installed mode nor profile',
  async (mode) => {
    let release!: () => void;
    coordinator(
      new Promise<void>((resolve) => {
        release = resolve;
      }),
    );
    const old = start(),
      plain = { ...old, growth: undefined };
    const original = JSON.stringify(
      createPlayerProfile(new Date('2026-01-01')),
    );
    localStorage.setItem(gameSaveKey, serializeGameCheckpoint(plain));
    localStorage.setItem(playerProfileKey, original);
    localStorage.setItem(activeModeKey, 'classic');
    await act(async () => root.render(createElement(GameApp)));
    await click('进度');
    await click('存档与备份');
    await click('导入文件');
    const next = start(90),
      s = beginSurvivalGrowth(startSurvivalClient('isaac', 90));
    const source =
      mode === 'classic'
        ? serializeGameBackup(next, createPlayerProfile())
        : serializeSurvivalBackup(
            s.game,
            s.draft,
            createPlayerProfile(),
            new Date(),
            s.growth,
          );
    const node = container.querySelector<HTMLInputElement>(
        'input[aria-label="导入对局文件"]',
      )!,
      file = new File(['json'], 'paired.json');
    Object.defineProperty(file, 'text', {
      value: () => Promise.resolve(source),
    });
    Object.defineProperty(node, 'files', { configurable: true, value: [file] });
    await act(async () =>
      node.dispatchEvent(new Event('change', { bubbles: true })),
    );
    await waitUi(() =>
      expect(container.querySelector('.data-candidate')).not.toBeNull(),
    );
    const checkbox = container.querySelector<HTMLInputElement>(
      '.data-profile-choice input[type=checkbox]',
    )!;
    await act(async () => checkbox.click());
    const label = mode === 'classic' ? '恢复完整备份' : '载入生存对局';
    await click(label);
    expect(button(label).disabled).toBe(true);
    await click('取消');
    await act(async () => {
      release();
      await Promise.resolve();
    });
    expect(
      parseGameSave(localStorage.getItem(gameSaveKey)!).session.game.seed,
    ).toBe(42);
    expect(localStorage.getItem(survivalSaveKey)).toBeNull();
    expect(localStorage.getItem(playerProfileKey)).toBe(original);
    expect(localStorage.getItem(profileReplacementEpochKey)).toBeNull();
  },
);
import { replacePlayerProfileCoordinated } from '../profile-operations';
it('explicit profile rollback refreshes only operational cursor before another gameplay action, keeping paired export immediately consistent', async () => {
  coordinator();
  localStorage.setItem(gameSaveKey, serializeGameCheckpoint(start()));
  let tools: SessionTools | undefined;
  await act(async () =>
    root.render(
      createElement<ClassicGameAppProps>(ClassicGameApp, {
        onToolsChange: (next) => {
          tools = next;
        },
      }),
    ),
  );
  await waitUi(() => expect(tools!.session.growth!.acknowledged).toBe(1));
  const game = tools!.session.game,
    old = createPlayerProfile(new Date('2026-01-01'));
  await act(async () => {
    await replacePlayerProfileCoordinated(
      localStorage,
      old,
      localStorage.getItem(playerProfileKey),
    );
  });
  await waitUi(() => expect(tools!.session.growth!.ignoredThrough).toBe(1));
  expect(tools!.session.game).toBe(game);
  expect(localStorage.getItem(playerProfileKey)).toBe(JSON.stringify(old));
  expect(() => serializeGameBackup(tools!.session, old)).not.toThrow();
  expect(
    parseGameSave(localStorage.getItem(gameSaveKey)!).session.growth!
      .profileEpoch,
  ).toBe(localStorage.getItem(profileReplacementEpochKey));
});
