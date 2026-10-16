// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { AchievementNotice } from '@/components/game/achievement-notice';
import { AchievementBadge } from '@/components/game/achievement-badge';
import { useLivePersistence } from '@/components/game/use-live-persistence';
import {
  createGameSession,
  reduceGameSession,
  type GameSession,
} from '../game-session';
import { profileReplacementEpochKey } from '../profile-write-coordinator';
import { notifyPlayerProfileChanged } from '../profile-events';
import {
  saveClassicClient,
  saveSurvivalClient,
  type ClientSaveResult,
} from './client-persistence';
import { achievementCollectionNotes } from './collection-notes';
import { achievementCatalog } from './catalog';
import { startSurvivalClient } from '../survival-client';

// The writer contract is isolated here; real saved-only/quota/reload assertions
// remain in achievement-progress-interaction and client-persistence-interaction.
vi.mock('./client-persistence', () => ({
  saveClassicClient: vi.fn(),
  saveSurvivalClient: vi.fn(),
}));
(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root, node: HTMLDivElement;
beforeEach(() => {
  localStorage.clear();
  vi.resetAllMocks();
  node = document.createElement('div');
  document.body.append(node);
  root = createRoot(node);
});
afterEach(async () => {
  await act(async () => root.unmount());
  node.remove();
  vi.restoreAllMocks();
});
const click = async (label: string) =>
  act(async () =>
    [...node.querySelectorAll<HTMLButtonElement>('button')]
      .find((b) => b.textContent === label)!
      .click(),
  );
function session(seed = 42) {
  return reduceGameSession(createGameSession(seed), {
    type: 'start_game',
    characterId: 'isaac',
  });
}
function result(s: GameSession, ids: string[]): ClientSaveResult<GameSession> {
  return { session: s, source: null, newlyAchieved: ids, message: '' };
}
function Probe({ s, revision = 0 }: { s: GameSession; revision?: number }) {
  const p = useLivePersistence({
    mode: 'classic',
    session: s,
    revision,
    origin: () => 'live',
    onAcknowledged: () => {},
  });
  return createElement(
    'div',
    null,
    createElement(AchievementNotice, {
      ids: p.achievementNotice,
      onDismiss: p.dismissNotice,
    }),
    createElement('button', { onClick: p.retry }, '重试'),
    createElement('button', null, '保持焦点'),
  );
}
const render = async (s: GameSession, revision = 0) =>
  act(async () => root.render(createElement(Probe, { s, revision })));
it('renders earned glyphs, metal labels and notes for a deduplicated batch without a modal, focus capture or storage writes', async () => {
  await act(async () => root.render(createElement('button', null, '原按钮')));
  const origin = node.querySelector('button')!;
  origin.focus();
  const dismiss = vi.fn();
  await act(async () =>
    root.render(
      createElement(
        'div',
        null,
        createElement('button', null, '原按钮'),
        createElement(AchievementNotice, {
          ids: ['A01', 'F02', 'A01'],
          onDismiss: dismiss,
        }),
      ),
    ),
  );
  const notice = node.querySelector('.achievement-notice')!;
  expect(notice.querySelector('output')).not.toBeNull();
  expect(notice.querySelector('output')!.getAttribute('aria-live')).toBe(
    'polite',
  );
  expect(notice.textContent).toContain('2 枚新徽章');
  expect(notice.querySelectorAll('li')).toHaveLength(2);
  expect(notice.textContent).toContain('逃出生天');
  expect(notice.textContent).toContain('铜徽章');
  expect(notice.textContent).toContain('金徽章');
  expect(notice.textContent).toContain(achievementCollectionNotes.A01);
  expect(
    notice.querySelectorAll('.achievement-badge[data-achieved=true]'),
  ).toHaveLength(2);
  expect(node.querySelector('[role=dialog]')).toBeNull();
  expect(document.activeElement).not.toBe(notice.querySelector('button'));
  await click('知道了');
  expect(dismiss).toHaveBeenCalledOnce();
  expect(localStorage.length).toBe(0);
});
it.each([
  ['A01', '铜', 1],
  ['A03', '银', 2],
  ['C07', '金', 3],
] as const)(
  'identifies %s metal on the left badge before earning it and keeps hidden glyphs unknown',
  async (id, label, pips) => {
    await act(async () =>
      root.render(
        createElement(AchievementBadge, { id, concealed: id === 'C07' }),
      ),
    );
    expect(node.querySelector('.achievement-badge-rank')!.textContent).toBe(
      label,
    );
    expect(node.querySelectorAll('.achievement-badge-pips i')).toHaveLength(
      pips,
    );
    expect(
      node.querySelector('.achievement-badge')!.getAttribute('data-achieved'),
    ).toBe('false');
    if (id === 'C07')
      expect(node.querySelector('svg')!.getAttribute('class')).toContain(
        'circle-question-mark',
      );
  },
);
it('shows nothing until the writer resolves, then merges unread awards without duplicating or writing a feed', async () => {
  const s = session();
  let finish!: (r: ClientSaveResult<GameSession>) => void;
  vi.mocked(saveClassicClient).mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  await render(s);
  expect(node.querySelector('.achievement-notice')).toBeNull();
  const focus = node.querySelectorAll<HTMLButtonElement>('button')[1]!;
  focus.focus();
  await act(async () => finish(result(s, ['A01'])));
  expect(node.querySelectorAll('.achievement-notice li')).toHaveLength(1);
  expect(document.activeElement).toBe(focus);
  const next = structuredClone(s);
  vi.mocked(saveClassicClient).mockResolvedValueOnce(
    result(next, ['B05', 'A01']),
  );
  await render(next);
  expect(node.querySelectorAll('.achievement-notice li')).toHaveLength(2);
  await click('知道了');
  expect(node.querySelector('.achievement-notice')).toBeNull();
  vi.mocked(saveClassicClient).mockResolvedValueOnce(result(next, []));
  await click('重试');
  expect(node.querySelector('.achievement-notice')).toBeNull();
  expect(localStorage.length).toBe(0);
});
it('does not invent feedback on a rejected save and shows a retry result only once', async () => {
  const s = session();
  vi.mocked(saveClassicClient).mockRejectedValueOnce(Error('quota'));
  await render(s);
  expect(node.querySelector('.achievement-notice')).toBeNull();
  vi.mocked(saveClassicClient).mockResolvedValueOnce(result(s, ['A01']));
  await click('重试');
  expect(node.querySelectorAll('.achievement-notice li')).toHaveLength(1);
  await click('知道了');
  vi.mocked(saveClassicClient).mockResolvedValueOnce(result(s, []));
  await click('重试');
  expect(node.querySelector('.achievement-notice')).toBeNull();
});
it('clears old-game notices on a new anchor and rejects late feedback after profile replacement', async () => {
  const s = session();
  vi.mocked(saveClassicClient).mockResolvedValueOnce(result(s, ['A01']));
  await render(s);
  expect(node.querySelector('.achievement-notice')).not.toBeNull();
  const next = session(99);
  let finish!: (r: ClientSaveResult<GameSession>) => void;
  vi.mocked(saveClassicClient).mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  await render(next);
  expect(node.querySelector('.achievement-notice')).toBeNull();
  await act(async () => {
    localStorage.setItem(profileReplacementEpochKey, 'a'.repeat(64));
    notifyPlayerProfileChanged();
  });
  await act(async () => finish(result(next, ['F02'])));
  expect(node.querySelector('.achievement-notice')).toBeNull();
});
it('does not revive dismissed feedback on remount and uses the same component for survival writer results', async () => {
  const s = startSurvivalClient('isaac', 3, 'standard');
  function SurvivalProbe() {
    const p = useLivePersistence({
      mode: 'survival',
      session: s,
      revision: 0,
      origin: () => 'live',
      onAcknowledged: () => {},
    });
    return createElement(AchievementNotice, {
      ids: p.achievementNotice,
      onDismiss: p.dismissNotice,
    });
  }
  vi.mocked(saveSurvivalClient).mockResolvedValueOnce({
    session: s,
    source: null,
    newlyAchieved: ['F02'],
    message: '',
  });
  await act(async () => root.render(createElement(SurvivalProbe)));
  expect(node.textContent).toContain('逃出生天');
  await click('知道了');
  await act(async () => root.render(null));
  vi.mocked(saveSurvivalClient).mockResolvedValueOnce({
    session: s,
    source: null,
    newlyAchieved: [],
    message: '',
  });
  await act(async () => root.render(createElement(SurvivalProbe)));
  expect(node.querySelector('.achievement-notice')).toBeNull();
});
it('has bounded scrollable passive feedback and respects both existing and OS reduced-motion controls at source level', () => {
  const css = readFileSync('app/globals.css', 'utf8');
  expect(css).toContain('.achievement-notice { position:fixed;');
  expect(css).toContain('right:24px;');
  expect(css).toContain('max-height:min(340px,calc(100dvh - 210px))');
  expect(css).toContain(
    '@media (prefers-reduced-motion:reduce) { .achievement-notice { animation:none; } }',
  );
  expect(css).toContain(".game-client[data-reduce-motion='true'] *");
  for (const tier of ['bronze', 'silver', 'gold'])
    expect(css).toContain(`[data-tier="${tier}"] { --medal-ink:`);
});

it('retains a large saved batch without dropping entries or starting any dismissal timer', async () => {
  const timer = vi.spyOn(globalThis, 'setTimeout');
  await act(async () =>
    root.render(
      createElement(AchievementNotice, {
        ids: achievementCatalog.map((a) => a.id),
        onDismiss: () => {},
      }),
    ),
  );
  expect(node.querySelectorAll('.achievement-notice-item')).toHaveLength(107);
  expect(node.querySelector('.achievement-notice')!.textContent).toContain(
    '107 枚新徽章',
  );
  expect(timer).not.toHaveBeenCalled();
  timer.mockRestore();
});

it('clears an existing unread batch when the player profile is explicitly replaced', async () => {
  const s = session();
  vi.mocked(saveClassicClient).mockResolvedValueOnce(result(s, ['A01']));
  await render(s);
  expect(node.querySelector('.achievement-notice')).not.toBeNull();
  await act(async () => {
    localStorage.setItem(profileReplacementEpochKey, 'b'.repeat(64));
    notifyPlayerProfileChanged();
  });
  expect(node.querySelector('.achievement-notice')).toBeNull();
  expect(vi.mocked(saveClassicClient)).toHaveBeenCalledOnce();
});
