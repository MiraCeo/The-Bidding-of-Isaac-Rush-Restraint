import { expect, it } from 'vitest';
import {
  achievementCatalog,
  characterAchievementRequirements,
} from './catalog';
import { revision066Catalog } from './revision066-catalog';
import { balance081Targets } from './balance081-targets';
import { achievementIdForNumber } from './numbering';
import { achievementPresentation } from './presentation';
import { createPlayerProfile } from '../player-profile';
import { readPlayerProfile } from '../player-profile';
import {
  appendAchievementEvent,
  projectAchievementRegistry as view,
  readAchievementRegistry,
  achievementRegistryModule,
} from './registry';
import {
  decodeAchievementEvent,
  type EncodedAchievementEvent,
} from './event-codec';
import { cfRoom } from './revision058.test-helper';
import { packAchievementRegistry } from './ledger-codec';
import { sha256Hex } from '../../shared/sha256';
import {
  serializePlayerProfileBackup,
  parsePlayerProfileBackup,
} from '../player-profile-file';
const now = new Date('2026-10-21T08:00:00.000Z');
let serial = 0;
function append(
  p: ReturnType<typeof createPlayerProfile>,
  event: EncodedAchievementEvent,
  mode: 'classic' | 'survival' = 'classic',
  at = now,
) {
  const n = serial++;
  return appendAchievementEvent(
    p,
    {
      source: 'live',
      mode,
      root: sha256Hex('closeout-root-' + n),
      parent: null,
      authorityHash: sha256Hex('closeout-authority-' + n),
      event: decodeAchievementEvent(event),
    },
    at,
  );
}
it('changes exactly the five approved targets, preserving all other 112 targets and historical catalogs', () => {
  const expected = { E12: 10, F13: 10, B09: 5, B10: 10, E20: 10 };
  expect(Object.keys(balance081Targets)).toHaveLength(5);
  expect(achievementCatalog).toHaveLength(117);
  const changed = achievementCatalog
    .filter(
      (a) =>
        a.target !== revision066Catalog.find((old) => old.id === a.id)!.target,
    )
    .map((a) => a.id)
    .sort();
  expect(changed).toEqual(Object.keys(balance081Targets).sort());
  for (const [number, target] of Object.entries(expected))
    expect(
      achievementCatalog.find((a) => a.id === achievementIdForNumber(number))!
        .target,
    ).toBe(target);
  for (const ids of Object.values(characterAchievementRequirements))
    for (const id of ids) expect(balance081Targets[id]).toBeUndefined();
  expect(revision066Catalog.find((a) => a.id === 'E10')!.target).toBe(20);
  expect(revision066Catalog.find((a) => a.id === 'E22')!.target).toBe(20);
});
it('keeps display target, summary and full condition aligned for all five badges', () => {
  for (const [id, target] of Object.entries(balance081Targets)) {
    const a = achievementCatalog.find((a) => a.id === id)!;
    expect(a.condition).toContain(String(target));
    expect(achievementPresentation[a.id].summary).toContain(String(target));
  }
  expect(achievementPresentation.E10.note).toContain('10是总局数');
  expect(achievementPresentation.F09.summary).toContain('10局');
});
it('awards watched vacancy stages at 1/5/10 actual events, never at 4 or 9 and never from ordinary withdraws', () => {
  let p = createPlayerProfile(now);
  for (let n = 1; n <= 10; n++) {
    p = append(p, cfRoom(0, { mask: 4 }));
    expect(view(p)!.progress.B17).toBe(n);
    expect(Boolean(view(p)!.achievedAt.B04)).toBe(n >= 1);
    expect(Boolean(view(p)!.achievedAt.B16)).toBe(n >= 5);
    expect(Boolean(view(p)!.achievedAt.B17)).toBe(n >= 10);
  }
  p = append(p, cfRoom());
  expect(view(p)!.progress.B17).toBe(10);
});
it('awards Eternal stages at 1/5/10 positive-score clears, with zero-score clears excluded and time stable after 20', () => {
  let p = createPlayerProfile(now);
  for (let n = 1; n <= 20; n++) {
    const event = cfRoom(0, { mask: 512 });
    event.values[4] = 1;
    p = append(p, event, 'classic', new Date(now.getTime() + n * 1000));
    const v = view(p)!;
    expect(v.progress.E22).toBe(n);
    expect(Boolean(v.achievedAt.E01)).toBe(n >= 1);
    expect(Boolean(v.achievedAt.E21)).toBe(n >= 5);
    expect(Boolean(v.achievedAt.E22)).toBe(n >= 10);
    if (n >= 10)
      expect(v.achievedAt.E22).toBe(
        new Date(now.getTime() + 10000).toISOString(),
      );
    if (n === 9) {
      const zero = cfRoom(0, { mask: 512 });
      zero.values[4] = 0;
      p = append(p, zero);
      expect(view(p)!.progress.E22).toBe(9);
      expect(view(p)!.achievedAt.E22).toBeUndefined();
    }
  }
});
it.each(['classic', 'survival'] as const)(
  'counts ten unique %s completions, keeps modes separate and never shifts the earned time at 15/20',
  (mode) => {
    let p = createPlayerProfile(now);
    const id = mode === 'classic' ? 'E10' : 'F09',
      other = mode === 'classic' ? 'F09' : 'E10';
    for (let n = 1; n <= 20; n++) {
      p = append(
        p,
        {
          stage: 'complete',
          position: mode === 'classic' ? 0 : 1,
          values: [0, 0, 1, 6, 1],
        },
        mode,
        new Date(now.getTime() + n * 1000),
      );
      const v = view(p)!;
      expect(v.progress[id]).toBe(n);
      expect(v.progress[other]).toBe(0);
      expect(Boolean(v.achievedAt[id])).toBe(n >= 10);
      if (n >= 10)
        expect(v.achievedAt[id]).toBe(
          new Date(now.getTime() + 10000).toISOString(),
        );
    }
    const before = JSON.stringify(p),
      projection = view(p);
    expect(readPlayerProfile(JSON.parse(before))).toEqual(p);
    expect(
      view(parsePlayerProfileBackup(serializePlayerProfileBackup(p)).profile),
    ).toEqual(projection);
    expect(JSON.stringify(p)).toBe(before);
  },
);
it('retains recorded progress behind the existing stage activation boundary and grants only at a fresh eligible receipt', () => {
  let p = createPlayerProfile(now);
  for (let n = 0; n < 10; n++) {
    const e = cfRoom(0, { mask: 512 });
    e.values[4] = 1;
    p = append(p, e);
  }
  const registry = readAchievementRegistry(p)!;
  delete registry.stages;
  p.progression.modules[achievementRegistryModule] = packAchievementRegistry(
    registry,
  ) as never;
  const before = JSON.stringify(p);
  expect(view(p)!.progress.E22).toBe(10);
  expect(view(p)!.achievedAt.E22).toBeUndefined();
  expect(JSON.stringify(p)).toBe(before);
  const next = append(p, cfRoom(), 'classic', new Date(now.getTime() + 1000));
  expect(view(next)!.achievedAt.E22).toBe(
    new Date(now.getTime() + 1000).toISOString(),
  );
});
