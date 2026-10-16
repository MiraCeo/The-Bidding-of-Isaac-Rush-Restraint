import { beforeAll, describe, expect, it } from 'vitest';
import {
  captureCurrentCorpus,
  buildCurrentLedgerFixture,
  corpusTime,
  currentCorpusShapes,
  type CurrentCorpusTrace,
} from './closeout-corpus.test-helper';
import { validateGrowthContext, applyGrowthContext } from './lifecycle';
import { createPlayerProfile, readPlayerProfile } from '../player-profile';
import {
  achievementRegistryModule,
  readAchievementRegistry,
  projectAchievementRegistry,
  validateAchievementRegistry,
  appendAchievementEvent,
} from './registry';
import { achievementReceiptKey, packAchievementRegistry } from './ledger-codec';
import { decodeAchievementEvent, encodeAchievementEvent } from './event-codec';
import { hasCurrentAchievementBaseline } from './baseline';
import { canonicalJson } from '../../shared/json-facts';
import {
  completionRegistryModule,
  readCompletionRegistry,
} from '../completion-registry';

let traces: CurrentCorpusTrace[];
beforeAll(() => {
  traces = captureCurrentCorpus();
});
describe('current schema6 closeout corpus, not frozen schema1/2 fixtures', () => {
  it('captures complete official classic and highest-survival traces with baseline1 and all current stage widths', () => {
    expect(traces.map((t) => t.id)).toEqual([
      'classic-42-bid',
      'survival-3-withdraw',
      'survival-3-pace',
      'survival-easy-3-pace',
      'survival-easy-3-fixed-300',
    ]);
    for (const t of traces) {
      const context = validateGrowthContext(t.context, t.mode);
      expect(context).toMatchObject({
        baseline: 1,
        excludedThrough: -1,
        expansionFrom: -1,
        milestonesFrom: -1,
        revisionsFrom: -1,
        cfFrom: -1,
      });
      expect(context.units.at(-1)!.stage).toBe('complete');
      for (const u of context.units)
        expect(u.values.length).toBe(
          u.stage === 'room'
            ? 17
            : u.stage === 'floor'
              ? 4
              : u.stage === 'final'
                ? 6
                : 5,
        );
      const committed = applyGrowthContext(
        createPlayerProfile(corpusTime),
        context,
        corpusTime,
      );
      expect(
        committed.profile.progression.modules[achievementRegistryModule],
      ).toMatchObject({ version: 7, catalogVersion: 6 });
      expect(
        applyGrowthContext(committed.profile, context, corpusTime).profile,
      ).toBe(committed.profile);
    }
    expect(
      traces[0]!.context.units.filter((u) => u.stage === 'room'),
    ).toHaveLength(15);
    expect(traces[1]!.humanEliminatedAt).not.toBeNull();
    const multi = traces.at(-1)!;
    expect(multi.humanEliminatedAt).toBe(4);
    expect(multi.context.units).toHaveLength(57);
    expect(
      multi.context.units
        .filter((u) => u.stage === 'floor')
        .map((u) => u.position),
    ).toEqual([0, 1, 2, 3, 4]);
    expect(multi.context.units.filter((u) => u.stage === 'room')).toHaveLength(
      25,
    );
    expect(
      multi.context.units
        .filter((u) => u.stage === 'room')
        .every((u) => u.position <= 24),
    ).toBe(true);
  });
  it.each(currentCorpusShapes)(
    'scales %s without changing metrics, parent links, full digests or input traces',
    (shape) => {
      const before = canonicalJson(traces);
      const f = buildCurrentLedgerFixture(traces, 256, shape, {
        historyRows: 200,
        paddingChars: 32768,
        completionReceipts: 16,
      });
      expect(hasCurrentAchievementBaseline(f.profile)).toBe(true);
      expect(f.wire).toMatchObject({
        version: 6,
        catalogVersion: 5,
        count: 256,
      });
      const raw = canonicalJson(f.profile),
        loaded = readPlayerProfile(JSON.parse(raw));
      expect(canonicalJson(loaded)).toBe(raw);
      expect(readAchievementRegistry(loaded)).toEqual(f.registry);
      expect(
        validateAchievementRegistry(packAchievementRegistry(f.registry!)),
      ).toEqual(f.registry);
      expect(projectAchievementRegistry(loaded)).toEqual(
        projectAchievementRegistry(f.profile),
      );
      expect(
        Object.keys(projectAchievementRegistry(loaded)!.progress),
      ).toHaveLength(117);
      const known = new Map();
      for (const r of f.registry!.receipts) {
        expect(r.key).toBe(achievementReceiptKey(r));
        expect(r.authorityHash).toMatch(/^[a-f0-9]{64}$/);
        expect(r.root).toMatch(/^[a-f0-9]{64}$/);
        if (r.parent) expect(known.get(r.parent)?.root).toBe(r.root);
        expect(known.has(r.key)).toBe(false);
        known.set(r.key, r);
        expect(
          encodeAchievementEvent(decodeAchievementEvent(r)).values,
        ).toEqual(r.values);
        expect(
          traces.some(
            (t) =>
              t.mode === r.mode &&
              t.context.units.some(
                (u) =>
                  u.stage === r.stage &&
                  u.position === r.position &&
                  canonicalJson(u.values) === canonicalJson(r.values),
              ),
          ),
        ).toBe(true);
      }
      const duplicate = f.registry!.receipts[0]!;
      expect(
        appendAchievementEvent(
          loaded,
          {
            source: 'live',
            mode: duplicate.mode,
            root: duplicate.root,
            parent: duplicate.parent,
            authorityHash: duplicate.authorityHash,
            event: decodeAchievementEvent(duplicate),
          },
          corpusTime,
        ),
      ).toBe(loaded);
      expect(canonicalJson(traces)).toBe(before);
      expect(canonicalJson(f.profile)).toBe(raw);
    },
  );
  it('keeps synthetic branch topology explicit and never counts two completions of the same root as two matches', () => {
    const f = buildCurrentLedgerFixture(
      traces,
      traces[0]!.context.units.length * 2 - 1,
      'mixed-branches',
    );
    expect(f.provenance).toMatchObject({
      roots: 1,
      forks: 1,
      completeTemplateEvents: 2,
      syntheticTopology: true,
    });
    const view = projectAchievementRegistry(readPlayerProfile(f.profile))!;
    expect(view.progress.E09).toBe(1);
    expect(view.progress.E10).toBe(1);
  });
  it('does not invent an activated schema6 ledger for an empty profile', () => {
    const f = buildCurrentLedgerFixture(traces, 0, 'classic');
    expect(f.wire).toBeNull();
    expect(f.registry).toBeNull();
    expect(readAchievementRegistry(readPlayerProfile(f.profile))).toBeNull();
    expect(hasCurrentAchievementBaseline(f.profile)).toBe(true);
  });
  it('builds independent completion-budget pressure as observed keys, not 8192 fabricated counted games', () => {
    const f = buildCurrentLedgerFixture(traces, 64, 'survival', {
      completionReceipts: 8192,
    });
    expect(f.provenance).toMatchObject({
      countedCompletionKeys: 1,
      observedCompletionKeys: 8191,
    });
    const completion = readCompletionRegistry(readPlayerProfile(f.profile))!;
    expect(Object.keys(completion.receipts)).toHaveLength(8192);
    expect(Object.values(completion.receipts).filter(Boolean)).toHaveLength(1);
    expect(
      f.profile.progression.modules[completionRegistryModule],
    ).toBeDefined();
  });
  it('bounds fixture options but does not claim every 16384-receipt construct fits production byte caps', () => {
    for (const count of [-1, 0.5, NaN, 16385])
      expect(() =>
        buildCurrentLedgerFixture(traces, count, 'classic'),
      ).toThrow();
    for (const options of [
      { historyRows: 201 },
      { paddingChars: -1 },
      { completionReceipts: 8193 },
    ])
      expect(() =>
        buildCurrentLedgerFixture(traces, 1, 'classic', options),
      ).toThrow();
    const oversized = buildCurrentLedgerFixture(traces, 64, 'classic', {
      paddingChars: 1024 * 1024,
    });
    expect(() => readPlayerProfile(oversized.profile)).toThrow();
  });
  // Each complete-game capture retains the default timeout and full comparison;
  // do not bundle five independent matches under one ordinary test deadline.
  it.each([
    'classic-42-bid',
    'survival-3-withdraw',
    'survival-3-pace',
    'survival-easy-3-pace',
    'survival-easy-3-fixed-300',
  ])(
    'recaptures the immutable facts, identities and timestamps for %s',
    (id) => {
      expect(captureCurrentCorpus(id)).toEqual(
        traces.filter((t) => t.id === id),
      );
    },
  );
  it('keeps fixture identities and timestamps deterministic for identical options', () => {
    expect(buildCurrentLedgerFixture(traces, 64, 'mixed-branches')).toEqual(
      buildCurrentLedgerFixture(traces, 64, 'mixed-branches'),
    );
  });
});
