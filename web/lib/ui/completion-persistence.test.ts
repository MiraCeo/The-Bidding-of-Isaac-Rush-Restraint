import { expect, it } from 'vitest';
import { persistCompletionProfile } from './completion-persistence';
import {
  createPlayerProfile,
  playerProfileKey,
  readPlayerProfile,
} from './player-profile';
import {
  registerCompletion,
  readCompletionRegistry,
  sumCounters,
} from './completion-registry';
import { completionRecordFixture } from './completion-registry.test-helper';

const register = (p: ReturnType<typeof createPlayerProfile>, i: number) =>
  registerCompletion(p, completionRecordFixture(i), [], false);
const total = (source: string) =>
  sumCounters(
    Object.values(
      readCompletionRegistry(readPlayerProfile(JSON.parse(source)))!.groups,
    ),
  ).completed;
function store(source: string | null = null) {
  let raw = source;
  const writes: string[] = [];
  return {
    getItem: (key: string) => {
      expect(key).toBe(playerProfileKey);
      return raw;
    },
    setItem: (key: string, value: string) => {
      expect(key).toBe(playerProfileKey);
      raw = value;
      writes.push(value);
    },
    replace: (value: string) => {
      raw = value;
    },
    raw: () => raw,
    writes,
  };
}
it('commits counters, receipt and history in one profile write, with no write for duplicates', () => {
  const s = store();
  expect(persistCompletionProfile(s, (p) => register(p, 1)).changed).toBe(true);
  const before = s.raw();
  expect(total(before!)).toBe(1);
  expect(persistCompletionProfile(s, (p) => register(p, 1)).changed).toBe(
    false,
  );
  expect(s.raw()).toBe(before);
  expect(s.writes).toHaveLength(1);
});
it('rebases onto a newer profile rather than overwriting concurrent counters or extension data', () => {
  const s = store(JSON.stringify(register(createPlayerProfile(), 0)));
  let computations = 0;
  persistCompletionProfile(s, (p) => {
    if (++computations === 1) {
      const other = register(p, 2);
      other.progression.modules.externalModule = { keep: true };
      s.replace(JSON.stringify(other));
    }
    return register(p, 1);
  });
  expect(computations).toBe(2);
  expect(s.writes).toHaveLength(1);
  expect(total(s.raw()!)).toBe(3);
  expect(JSON.parse(s.raw()!).progression.modules.externalModule).toEqual({
    keep: true,
  });
});
it('deduplicates when the same completion is committed during hashing', () => {
  const s = store();
  let calls = 0;
  const result = persistCompletionProfile(s, (p) => {
    const next = register(p, 1);
    if (++calls === 1) s.replace(JSON.stringify(next));
    return next;
  });
  expect(result.changed).toBe(false);
  expect(calls).toBe(2);
  expect(s.writes).toHaveLength(0);
  expect(total(s.raw()!)).toBe(1);
});
it('stops after three source changes and keeps the latest external profile', () => {
  const s = store();
  let calls = 0;
  expect(() =>
    persistCompletionProfile(s, (p) => {
      s.replace(JSON.stringify(register(p, ++calls)));
      return register(p, 100);
    }),
  ).toThrow('持续发生变化');
  expect(calls).toBe(3);
  expect(s.writes).toHaveLength(0);
  expect(total(s.raw()!)).toBe(3);
  expect(
    JSON.parse(s.raw()!).history.map((h: { replayId: string }) => h.replayId),
  ).not.toContain('fixture-classic-100');
});
it('preserves a malformed or unreadable source without replacing it with an empty profile', () => {
  const s = store('corrupt');
  expect(() => persistCompletionProfile(s, (p) => register(p, 1))).toThrow();
  expect(s.raw()).toBe('corrupt');
  expect(s.writes).toHaveLength(0);
  expect(() => persistCompletionProfile(null, (p) => register(p, 1))).toThrow(
    '不可用',
  );
  expect(() =>
    persistCompletionProfile(
      {
        getItem: () => {
          throw Error('blocked');
        },
        setItem: () => {
          throw Error('unexpected write');
        },
      },
      (p) => register(p, 1),
    ),
  ).toThrow('blocked');
});
it('leaves all old data intact on a quota failure and counts exactly once after retry', () => {
  const source = JSON.stringify(register(createPlayerProfile(), 0));
  const s = store(source);
  expect(() =>
    persistCompletionProfile(
      {
        ...s,
        setItem: () => {
          throw Error('quota');
        },
      },
      (p) => register(p, 1),
    ),
  ).toThrow('quota');
  expect(s.raw()).toBe(source);
  persistCompletionProfile(s, (p) => register(p, 1));
  persistCompletionProfile(s, (p) => register(p, 1));
  expect(total(s.raw()!)).toBe(2);
  expect(s.writes).toHaveLength(1);
});
