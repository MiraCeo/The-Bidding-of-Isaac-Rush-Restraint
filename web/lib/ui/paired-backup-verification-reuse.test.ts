import { beforeAll, afterEach, expect, it, vi } from 'vitest';
import {
  captureCurrentCorpus,
  buildCurrentLedgerFixture,
  corpusTime,
  type CurrentCorpusTrace,
} from './achievements/closeout-corpus.test-helper';
import * as registry from './achievements/registry';
import * as evaluation from './achievements/evaluation';
import { createGameSession, reduceGameSession } from './game-session';
import {
  beginClassicGrowth,
  applyGrowthContext,
} from './achievements/lifecycle';
import { serializeGameBackup, parseGameSave } from './game-save';
import { canonicalJson } from '../shared/json-facts';
let traces: CurrentCorpusTrace[];
beforeAll(() => {
  traces = captureCurrentCorpus();
});
afterEach(() => vi.restoreAllMocks());
function fixture(paired = false) {
  const p = buildCurrentLedgerFixture(traces, 64, 'mixed-branches', {
    schema: 8,
  }).profile;
  const s = beginClassicGrowth(
    reduceGameSession(createGameSession(99), {
      type: 'start_game',
      characterId: 'isaac',
    }),
  );
  if (!paired) return { p, s: { ...s, growth: undefined } };
  const applied = applyGrowthContext(p, s.growth!, corpusTime);
  return { p: applied.profile, s: { ...s, growth: applied.context } };
}
it.each([false, true])(
  'keeps exact paired backup bytes while reusing only one full-ledger scan (growth=%s)',
  (paired) => {
    const { p, s } = fixture(paired),
      before = canonicalJson({ p, s });
    const scan = vi.spyOn(evaluation, 'evaluateAchievementRun');
    const unscoped = vi
      .spyOn(registry, 'withAchievementVerificationScope')
      .mockImplementation((work) => work());
    const reference = serializeGameBackup(s, p, corpusTime);
    const oldCalls = scan.mock.calls.length;
    unscoped.mockRestore();
    scan.mockClear();
    expect(serializeGameBackup(s, p, corpusTime)).toBe(reference);
    expect(scan).toHaveBeenCalledTimes(paired ? 65 : 64);
    expect(oldCalls).toBeGreaterThan(scan.mock.calls.length);
    expect(canonicalJson({ p, s })).toBe(before);
    expect(parseGameSave(reference).profile).toEqual(p);
  },
);
it('revalidates across calls and rejects mutated or non-finite input without poisoning a later export', () => {
  const { p, s } = fixture(),
    original = canonicalJson(p);
  const scan = vi.spyOn(evaluation, 'evaluateAchievementRun');
  const good = serializeGameBackup(s, p, corpusTime);
  scan.mockClear();
  expect(serializeGameBackup(s, p, corpusTime)).toBe(good);
  expect(scan).toHaveBeenCalledTimes(64);
  const broken = structuredClone(p);
  (
    broken.progression.modules.achievementRegistryV1 as unknown as {
      data: string[];
    }
  ).data[0] = 'bad';
  expect(() => serializeGameBackup(s, broken, corpusTime)).toThrow();
  const bad = structuredClone(p);
  bad.progression.modules.nonFinite = Infinity;
  expect(() => serializeGameBackup(s, bad, corpusTime)).toThrow();
  expect(serializeGameBackup(s, p, corpusTime)).toBe(good);
  expect(canonicalJson(p)).toBe(original);
});
