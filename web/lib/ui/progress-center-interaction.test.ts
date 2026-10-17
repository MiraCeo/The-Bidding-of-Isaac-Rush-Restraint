import { appVersion } from './game-version';
import { manuallyUnlockAchievementCharacters } from './achievements/registry';
// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import { GameApp } from '@/components/game/game-app';
import { createGameSession, reduceGameSession } from './game-session';
import {
  gameSaveKey,
  serializeGameCheckpoint,
  parseGameSave,
} from './game-save';
import { startSurvivalClient, activeModeKey } from './survival-client';
import {
  survivalSaveKey,
  serializeSurvivalCheckpoint,
  parseSurvivalCheckpoint,
} from './survival-persistence';
import { playLongRun } from './survival-long-run';
import { createPlayerProfile, playerProfileKey } from './player-profile';
import { packDataFile } from './compressed-file';
import { waitForFileUi } from './file-export.test-helper';
import oldCheckpoint from './fixtures/checkpoint-v2-lost-20261012.json';
(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
let container: HTMLDivElement, root: Root;
beforeEach(() => {
  localStorage.clear();
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.restoreAllMocks();
});
function button(label: string) {
  const found = [
    ...container.querySelectorAll<HTMLButtonElement>('button'),
  ].find((b) => b.textContent?.trim() === label);
  if (!found) throw new Error('Missing ' + label);
  return found;
}
const click = async (label: string) => act(async () => button(label).click());
const mount = async () => act(async () => root.render(createElement(GameApp)));
it('points restart preservation to progress and keeps the current match when cancellation is chosen', async () => {
  classic();
  localStorage.setItem(activeModeKey, 'classic');
  await mount();
  const before = localStorage.getItem(gameSaveKey);
  await click('重新选角');
  const confirmation = container.querySelector('.match-restart-confirm')!;
  expect(confirmation.textContent).toContain('进度 → 存档与备份');
  expect(confirmation.textContent).not.toContain('设置中');
  await click('保留当前对局');
  expect(container.querySelector('.match-restart-confirm')).toBeNull();
  expect(localStorage.getItem(gameSaveKey)).toBe(before);
  expect(
    container.querySelector<HTMLInputElement>(
      'input[aria-label="竞拍奖励 A 的数值"]',
    )?.value,
  ).toBe('17');
});
it('describes existing profile data in the backup preview and cancels back to the focused progress page without saving', async () => {
  classic();
  localStorage.setItem(activeModeKey, 'classic');
  await mount();
  const before = localStorage.getItem(gameSaveKey);
  const profile = localStorage.getItem(playerProfileKey);
  await click('进度');
  await click('存档与备份');
  await click('完整备份');
  const preview = container.querySelector('.data-backup-preview')!;
  expect(preview.textContent).toContain('完成记录、累计统计、去重凭据');
  expect(preview.textContent).toContain(
    '恢复操作不额外发放成就；角色权限按恢复后的档案快照生效',
  );
  expect(preview.textContent).not.toContain('已保存的解锁');
  expect(document.activeElement?.id).toBe('progress-title');
  await act(async () =>
    window.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
    ),
  );
  expect(container.querySelector('.data-backup-preview')).toBeNull();
  expect(container.querySelector('#progress-title')?.textContent).toBe('进度');
  expect(document.activeElement?.id).toBe('progress-title');
  expect(localStorage.getItem(gameSaveKey)).toBe(before);
  expect(localStorage.getItem(playerProfileKey)).toBe(profile);
});
it('keeps one product identity across all five navigation entries and moves progress return actions into the shared page heading', async () => {
  await mount();
  for (const page of ['设置', '进度', '规则', '排行', '游戏']) {
    await act(async () =>
      [
        ...container.querySelectorAll<HTMLButtonElement>(
          'nav[aria-label="主导航"] button',
        ),
      ]
        .find((b) => b.textContent?.trim() === page)!
        .click(),
    );
    expect(
      container.querySelector('.topbar .brand-block .eyebrow')?.textContent,
    ).toBe('THE BIDDING OF ISAAC');
    expect(container.querySelector('.topbar h1')?.textContent).toBe(
      '以撒的竞合：冲 · 慎',
    );
    if (page === '进度') {
      expect(
        container
          .querySelector('.progress-stage')
          ?.classList.contains('ranking-stage'),
      ).toBe(true);
      expect(
        container
          .querySelector('.progress-stage')
          ?.classList.contains('game-tools-stage'),
      ).toBe(true);
      expect(
        container.querySelector(
          '.progress-stage .ranking-page-heading #progress-title',
        ),
      ).not.toBeNull();
      expect(
        container
          .querySelector('.progress-stage .ranking-page-heading')
          ?.contains(button('返回主菜单')),
      ).toBe(true);
      expect(container.querySelector('.topbar button')?.textContent).not.toBe(
        '返回主菜单',
      );
      expect(container.querySelector('.topbar .app-version')?.textContent).toBe(
        `v${appVersion}`,
      );
      expect(container.querySelector('.topbar')?.textContent).not.toContain(
        '主菜单',
      );
      expect(container.querySelector('.page-context-bar')).toBeNull();
    }
  }
});
it('uses the same heading skeleton for all four progress categories and keeps the header independent of selected filters', async () => {
  await mount();
  await click('进度');
  for (const tab of ['总览', '对局记录', '统计', '存档与备份']) {
    await click(tab);
    expect(
      container.querySelector(
        '.progress-stage > .ranking-page-heading #progress-title',
      )?.textContent,
    ).toBe('进度');
    expect(
      container.querySelector(
        '.progress-stage > .ranking-page-heading .eyebrow',
      )?.textContent,
    ).toBe('PLAYER PROGRESS');
    expect(
      container.querySelector(
        'nav[aria-label="进度分类"] [aria-current="page"]',
      )?.textContent,
    ).toBe(tab);
  }
  await click('生存');
  expect(container.querySelector('.topbar .app-version')?.textContent).toBe(
    `v${appVersion}`,
  );
  expect(container.querySelector('.topbar')?.textContent).not.toContain(
    '主菜单',
  );
  expect(container.querySelector('.page-context-bar')).toBeNull();
  expect(localStorage.getItem(gameSaveKey)).toBeNull();
  expect(localStorage.getItem(survivalSaveKey)).toBeNull();
});
it.each(['classic', 'survival'] as const)(
  'hides the %s HUD in progress and preserves draft when returning to game before opening build',
  async (mode) => {
    const c = classic(),
      s = survival();
    localStorage.setItem(activeModeKey, mode);
    await mount();
    const beforeC = localStorage.getItem(gameSaveKey),
      beforeS = localStorage.getItem(survivalSaveKey);
    await click('进度');
    const game = mode === 'classic' ? c.game : s.game;
    if (game.phase === 'character_selection')
      throw Error('Expected a started source match');
    expect(container.querySelector('.page-context-bar')).toBeNull();
    await click('对局记录');
    await click(mode === 'classic' ? '生存' : '经典');
    expect(container.querySelector('.page-context-bar')).toBeNull();
    expect(localStorage.getItem(gameSaveKey)).toBe(beforeC);
    expect(localStorage.getItem(survivalSaveKey)).toBe(beforeS);
    await click('返回游戏');
    expect(
      container.querySelector('.page-context-bar .status-chip-money strong')
        ?.textContent,
    ).toBe(String(game.players.find((p) => p.isHuman)!.money));
    await act(async () =>
      container
        .querySelector<HTMLButtonElement>(
          '.page-context-bar [aria-label="查看角色构筑"]',
        )!
        .click(),
    );
    expect(container.textContent).toContain('构筑与当前状态');
    await click('返回游戏');
    expect(
      container.querySelector<HTMLInputElement>(
        `input[aria-label="竞拍奖励 ${mode === 'classic' ? 'A' : 'B'} 的数值"]`,
      )?.value,
    ).toBe(mode === 'classic' ? '17' : '23');
    expect(localStorage.getItem(gameSaveKey)).toBe(beforeC);
    expect(localStorage.getItem(survivalSaveKey)).toBe(beforeS);
  },
);
function classic() {
  const session = reduceGameSession(createGameSession(42), {
    type: 'start_game',
    characterId: 'isaac',
  });
  session.draft!.amounts.A.bid = 17;
  localStorage.setItem(gameSaveKey, serializeGameCheckpoint(session));
  return session;
}
function survival() {
  const session = startSurvivalClient('lost', 99, 'easy');
  session.draft!.amounts.B.bid = 23;
  localStorage.setItem(
    survivalSaveKey,
    serializeSurvivalCheckpoint(session.game, session.draft),
  );
  return session;
}
it('opens the shared progress center from an empty menu and exposes both file modes without creating a match', async () => {
  await mount();
  await click('进度');
  expect(container.querySelector('#progress-title')).not.toBeNull();
  expect(container.textContent).toContain('尚未开始对局');
  expect(localStorage.getItem(survivalSaveKey)).toBeNull();
  await click('存档与备份');
  expect(button('导入文件')).toBeDefined();
  await click('生存');
  expect(button('导出生存续玩存档').disabled).toBe(true);
  await click('返回主菜单');
  expect(container.textContent).toContain('选择你的竞合方式');
});
it('preserves both authoritative matches and their drafts across progress, mode switching and settings', async () => {
  const c = classic(),
    s = survival();
  localStorage.setItem(activeModeKey, 'classic');
  await mount();
  const beforeClassic = localStorage.getItem(gameSaveKey),
    beforeSurvival = localStorage.getItem(survivalSaveKey);
  await click('进度');
  expect(container.textContent).toContain('经典模式');
  expect(container.textContent).toContain('生存模式');
  await click('继续生存对局');
  expect(
    container.querySelector<HTMLInputElement>(
      'input[aria-label="竞拍奖励 B 的数值"]',
    )!.value,
  ).toBe('23');
  await click('设置');
  expect(container.querySelector('.survival-status')).toBeNull();
  expect(container.textContent).not.toContain('生存模式 · 存档与文件');
  expect(
    [...container.querySelectorAll('button')].map((b) => b.textContent?.trim()),
  ).not.toContain('重新选角');
  await click('进度');
  await click('继续经典对局');
  expect(
    container.querySelector<HTMLInputElement>(
      'input[aria-label="竞拍奖励 A 的数值"]',
    )!.value,
  ).toBe('17');
  expect(localStorage.getItem(gameSaveKey)).toBe(beforeClassic);
  expect(localStorage.getItem(survivalSaveKey)).toBe(beforeSurvival);
  expect(parseGameSave(beforeClassic!).session).toEqual(c);
  expect(parseSurvivalCheckpoint(beforeSurvival!).draft).toEqual(s.draft);
});
it('routes the progress header to settings and rules without restarting the current room', async () => {
  classic();
  await mount();
  const before = localStorage.getItem(gameSaveKey);
  await click('进度');
  await click('设置');
  expect(container.querySelector('.settings-display')).not.toBeNull();
  expect(container.querySelector('.data-management')).toBeNull();
  await click('进度');
  await click('规则');
  expect(container.querySelector('#room-utilities-title')!.textContent).toBe(
    '规则',
  );
  await click('游戏');
  expect(
    container.querySelector<HTMLInputElement>(
      'input[aria-label="竞拍奖励 A 的数值"]',
    )!.value,
  ).toBe('17');
  expect(localStorage.getItem(gameSaveKey)).toBe(before);
});
it('shows truthful limited history by mode alongside the implemented achievement entry', async () => {
  const p = createPlayerProfile();
  p.history = [
    {
      key: 'a',
      replayId: 'a',
      characterId: 'isaac',
      completedAt: new Date().toISOString(),
      finalScore: 123,
      rank: 2,
    },
    {
      key: 'b',
      replayId: 'b',
      characterId: 'lost',
      completedAt: new Date().toISOString(),
      finalScore: 456,
      rank: 3,
      mode: 'survival',
      aiDifficulty: 'easy',
      status: 'survived',
      eliminationFloorIndex: null,
    },
  ];
  localStorage.setItem(playerProfileKey, JSON.stringify(p));
  await mount();
  await click('进度');
  expect(
    container.querySelectorAll('nav[aria-label="进度分类"] button'),
  ).toHaveLength(5);
  expect(button('成就')).toBeDefined();
  await click('对局记录');
  expect(container.querySelector('table')!.textContent).toContain('123.00');
  expect(container.querySelector('table')!.textContent).not.toContain('456.00');
  await click('生存');
  expect(container.querySelector('table')!.textContent).toContain('456.00');
  expect(container.textContent).toContain('不承诺每条记录都保留完整回放');
  expect(localStorage.getItem(playerProfileKey)).toBe(JSON.stringify(p));
});
it('keeps AI continuation alive while progress is open and refreshes completed history and replay availability', async () => {
  const game = playLongRun(3).states.find(
    (g) => g.humanEliminatedAt !== null && g.phase !== 'competition_complete',
  )!;
  localStorage.setItem(activeModeKey, 'survival');
  localStorage.setItem(survivalSaveKey, serializeSurvivalCheckpoint(game));
  vi.useFakeTimers();
  await mount();
  await click('进度');
  expect(container.textContent).toContain('AI续赛中');
  await click('对局记录');
  for (let i = 0; i < 80; i++)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30);
    });
  expect(container.querySelector('.progress-page')).not.toBeNull();
  expect(container.textContent).toContain('已结束');
  expect(container.querySelector('table')!.textContent).toContain('第1层淘汰');
  expect(button('查看本局生存回放')).toBeDefined();
  await click('查看本局生存回放');
  expect(container.textContent).toContain('已结算 35 房');
  await click('返回进度');
  expect(container.querySelector('#progress-title')).not.toBeNull();
  expect(button('对局记录').getAttribute('aria-current')).toBe('page');
}, 20000); // Full 77-command UI continuation, not a 5-second performance assertion.
it('preserves an unstarted character selection through shared progress without starting a match', async () => {
  localStorage.setItem(
    playerProfileKey,
    JSON.stringify(manuallyUnlockAchievementCharacters(createPlayerProfile())),
  );

  localStorage.setItem(activeModeKey, 'classic');
  await mount();
  await act(async () =>
    container.querySelector<HTMLInputElement>('input[value="lost"]')!.click(),
  );
  await click('进度');
  await click('返回游戏');
  expect(
    container.querySelector<HTMLInputElement>('input[value="lost"]')!.checked,
  ).toBe(true);
  expect(localStorage.getItem(gameSaveKey)).toBeNull();
  await click('返回主菜单');
  await click('生存模式');
  await act(async () =>
    container.querySelector<HTMLInputElement>('input[value="eden"]')!.click(),
  );
  await click('进度');
  await click('返回游戏');
  expect(
    container.querySelector<HTMLInputElement>('input[value="eden"]')!.checked,
  ).toBe(true);
  expect(localStorage.getItem(survivalSaveKey)).toBeNull();
});
it('cancels a classic read on a mode change and discards a late result without altering either save', async () => {
  classic();
  survival();
  localStorage.setItem(activeModeKey, 'classic');
  await mount();
  await click('进度');
  await click('存档与备份');
  const beforeClassic = localStorage.getItem(gameSaveKey),
    beforeSurvival = localStorage.getItem(survivalSaveKey);
  let finish!: (source: string) => void;
  const reading = new Promise<string>((resolve) => {
    finish = resolve;
  });
  const file = new File(['pending'], 'pending.json');
  Object.defineProperty(file, 'text', { value: () => reading });
  await click('导入文件');
  const input = container.querySelector<HTMLInputElement>(
    'input[aria-label="导入对局文件"]',
  )!;
  Object.defineProperty(input, 'files', { configurable: true, value: [file] });
  await act(async () =>
    input.dispatchEvent(new Event('change', { bubbles: true })),
  );
  await click('生存');
  await act(async () => {
    finish(beforeClassic!);
    await reading;
  });
  expect(container.querySelector('.data-candidate')).toBeNull();
  expect(localStorage.getItem(gameSaveKey)).toBe(beforeClassic);
  expect(localStorage.getItem(survivalSaveKey)).toBe(beforeSurvival);
});
it('rejects old raw and compressed development files from the shared entry without replacing either game or profile', async () => {
  classic();
  survival();
  localStorage.setItem(activeModeKey, 'classic');
  const profile = JSON.stringify(createPlayerProfile());
  localStorage.setItem(playerProfileKey, profile);
  await mount();
  await click('进度');
  await click('存档与备份');
  await click('导入文件');
  const beforeClassic = localStorage.getItem(gameSaveKey),
    beforeSurvival = localStorage.getItem(survivalSaveKey),
    input = container.querySelector<HTMLInputElement>(
      'input[aria-label="导入对局文件"]',
    )!;
  const oldSurvival = JSON.parse(beforeSurvival!);
  oldSurvival.version = 4;
  for (const source of [
    JSON.stringify(oldCheckpoint),
    (await packDataFile(JSON.stringify(oldSurvival))).source,
  ]) {
    Object.defineProperty(input, 'files', {
      configurable: true,
      value: [new File([source], 'old.json')],
    });
    await act(async () =>
      input.dispatchEvent(new Event('change', { bubbles: true })),
    );
    await waitForFileUi(() =>
      expect(container.textContent).toContain('仅支持当前v5'),
    );
    expect(container.querySelector('.data-candidate')).toBeNull();
    expect(localStorage.getItem(gameSaveKey)).toBe(beforeClassic);
    expect(localStorage.getItem(survivalSaveKey)).toBe(beforeSurvival);
    expect(localStorage.getItem(playerProfileKey)).toBe(profile);
  }
});
