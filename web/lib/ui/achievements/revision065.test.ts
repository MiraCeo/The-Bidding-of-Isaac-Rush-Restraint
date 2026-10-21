import { expect, it } from 'vitest';
import {
  achievementCatalog,
  characterAchievementRequirements,
} from './catalog';
import { revision065NewSeries } from './revision065-catalog';
import { selectAchievementCards, achievementSeries } from './series';
import { achievementCollectionMetadata } from './collection-metadata';
import { achievementGlyphs } from '../../../components/game/achievement-badge';
import { achievementCollectionNotes } from './collection-notes';
import { achievementNumber } from './numbering';
import { achievementPresentation } from './presentation';
import { createPlayerProfile } from '../player-profile';
import { appendCf, cfRoom, cfNow, cfEntry } from './revision058.test-helper';
import {
  readAchievementRegistry,
  projectAchievementRegistry,
  achievementRegistryModule,
  appendAchievementEvent,
  validateAchievementRegistry,
  manuallyUnlockAchievementCharacters,
  createAchievementBatch,
} from './registry';
import { packAchievementRegistry } from './ledger-codec';
import {
  parsePlayerProfileBackup,
  serializePlayerProfileBackup,
} from '../player-profile-file';
import { sha256Hex } from '../../shared/sha256';
const all = {
  query: '',
  category: 'all',
  status: 'all',
  sort: 'collection',
  tier: 'all',
} as const;
const mask = 64 + 128 + 512 + 32768 + 65536;
function room() {
  const r = cfRoom(0, { mask });
  r.values[4] = 12;
  return r;
}
it('adds ten badges without adding cards or raising character requirements; preserves every original public number', () => {
  expect(achievementCatalog).toHaveLength(117);
  expect(selectAchievementCards(all, {}, {})).toHaveLength(57);
  expect(achievementSeries).toHaveLength(30);
  for (const a of achievementCatalog) {
    expect(achievementGlyphs[a.id]).toBeDefined();
    expect(achievementCollectionNotes[a.id]).toBeTruthy();
    expect(achievementPresentation[a.id].summary).toBeTruthy();
  }
  expect(characterAchievementRequirements.lost).toEqual(['E01', 'A10']);
  expect(characterAchievementRequirements.jacob_esau).toEqual(['E02']);
  expect(characterAchievementRequirements.azazel).toEqual(['E03', 'E04']);
  expect(achievementNumber('C04')).toBe('C08');
  expect(achievementNumber('E01')).toBe('E01');
  expect(achievementNumber('E21')).toBe('E19');
  expect(
    achievementCatalog.filter(
      (a) => achievementCollectionMetadata[a.id].hidden,
    ),
  ).toHaveLength(11);
});
it('counts exact effect/reward rooms once, not initial equipment or copies; preserves each earned timestamp', () => {
  let p = createPlayerProfile(cfNow);
  p = appendCf(p, cfEntry);
  expect(projectAchievementRegistry(p)!.progress.E02).toBe(0);
  for (let n = 1; n <= 20; n++) {
    p = appendCf(p, room());
    const v = projectAchievementRegistry(p)!;
    for (const s of revision065NewSeries)
      s.ids.forEach((id) => {
        expect(v.progress[id]).toBe(n);
        expect(!!v.achievedAt[id]).toBe(
          n >= achievementCatalog.find((a) => a.id === id)!.target,
        );
        if (v.achievedAt[id])
          expect(v.achievedAt[id]).toBe(cfNow.toISOString());
      });
  }
  const zero = cfRoom(0, { mask: 512 });
  zero.values[4] = 0;
  const next = appendCf(p, zero);
  expect(projectAchievementRegistry(next)!.progress.E01).toBe(20);
  expect(readAchievementRegistry(next)!.stages).toBeDefined();
});
it('inherits retained exact counts but grants new stages only on a new live authority receipt, never read/import/duplicate', () => {
  let p = createPlayerProfile(cfNow);
  for (let n = 0; n < 10; n++) p = appendCf(p, room());
  const decoded = readAchievementRegistry(p)!;
  delete decoded.stages;
  const oldWire = packAchievementRegistry(decoded);
  expect(oldWire.version).toBe(6);
  p.progression.modules[achievementRegistryModule] = oldWire as never;
  const raw = JSON.stringify(p),
    old = projectAchievementRegistry(p)!;
  expect(old.progress.C16).toBe(10);
  expect(old.achievedAt.C16).toBeUndefined();
  expect(old.achievedAt.C04).toBe(cfNow.toISOString());
  const last = decoded.receipts.at(-1)!;
  const duplicate = {
    source: 'live' as const,
    mode: last.mode,
    root: last.root,
    parent: last.parent,
    authorityHash: last.authorityHash,
    event: { stage: 'room' as const, facts: decodeRoom(last) },
  };
  expect(appendAchievementEvent(p, duplicate, cfNow)).toBe(p);
  expect(appendCf(p, room(), { source: 'read-only' })).toBe(p);
  expect(appendCf(p, room(), { source: 'historical' })).toBe(p);
  const restored = parsePlayerProfileBackup(
    serializePlayerProfileBackup(p),
  ).profile;
  expect(projectAchievementRegistry(restored)!.achievedAt.C16).toBeUndefined();
  expect(JSON.stringify(p)).toBe(raw);
  const manual = manuallyUnlockAchievementCharacters(p, cfNow);
  expect(
    (
      manual.progression.modules[achievementRegistryModule] as unknown as {
        version: number;
      }
    ).version,
  ).toBe(6);
  expect(projectAchievementRegistry(manual)!.achievedAt.C16).toBeUndefined();
  const failed = createAchievementBatch(p, cfNow);
  failed.append({
    ...duplicate,
    root: sha256Hex('candidate-before-failure'),
    parent: null,
    authorityHash: sha256Hex('candidate-before-failure'),
    event: {
      stage: 'entry',
      facts: {
        floorIndex: 0,
        roomIndex: 0,
        stolenMoney: 0,
        interestMoney: 0,
        milestones: true,
        revisions: true,
        cf: true,
      },
    },
  });
  expect(() => failed.append({ ...duplicate, root: 'invalid' })).toThrow();
  expect(() => failed.finish()).toThrow();
  expect(JSON.stringify(p)).toBe(raw);
  const later = new Date(cfNow.getTime() + 60000);
  const next = appendAchievementEvent(
    p,
    {
      ...duplicate,
      root: sha256Hex('new-stage-root'),
      parent: null,
      authorityHash: sha256Hex('new-stage-authority'),
      event: {
        stage: 'entry',
        facts: {
          floorIndex: 0,
          roomIndex: 0,
          stolenMoney: 0,
          interestMoney: 0,
          milestones: true,
          revisions: true,
          cf: true,
        },
      },
    },
    later,
  );
  const view = projectAchievementRegistry(next)!;
  expect(view.achievedAt.C16).toBe(later.toISOString());
  expect(view.achievedAt.C04).toBe(old.achievedAt.C04);
  const newWire = next.progression.modules[
    achievementRegistryModule
  ] as unknown as { version: number; catalogVersion: number };
  expect(newWire.version).toBe(7);
  expect(newWire.catalogVersion).toBe(6);
  expect(
    projectAchievementRegistry(
      parsePlayerProfileBackup(serializePlayerProfileBackup(next)).profile,
    ),
  ).toEqual(view);
});
import { decodeAchievementEvent } from './event-codec';
function decodeRoom(r: Parameters<typeof decodeAchievementEvent>[0]) {
  const e = decodeAchievementEvent(r);
  if (e.stage !== 'room') throw Error('not room');
  return e.facts;
}
it('sorts fixed series before standalone bronze/silver/gold without moving earned series, and uses real next-target progress', () => {
  const progress = { A01: 1, A08: 1, B01: 9, B14: 9 },
    achieved = { A01: cfNow.toISOString() };
  const cards = selectAchievementCards(all, progress, achieved);
  for (const category of ['A', 'B', 'C', 'D', 'E', 'F']) {
    const group = cards.filter((c) => c.definition.category === category);
    const ranks = group.map((c) =>
      c.series
        ? 0
        : ['bronze', 'silver', 'gold'].indexOf(
            achievementCollectionMetadata[c.definition.id].tier,
          ) + 1,
    );
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
  }
  const sorted = selectAchievementCards(
    { ...all, sort: 'progress' },
    progress,
    achieved,
  );
  expect(sorted.findIndex((c) => c.id === 'B01')).toBeLessThan(
    sorted.findIndex((c) => c.id === 'A01'),
  );
  const pending = selectAchievementCards(
    { ...all, tier: 'gold', status: 'pending' },
    progress,
    achieved,
  );
  expect(pending.find((c) => c.id === 'A01')!.matchingCompleted).toBe(0);
});

it('strictly rejects malformed stage headers and preserves raw receipt bytes across schema6/7', () => {
  const p = appendCf(createPlayerProfile(cfNow), room());
  const registry = readAchievementRegistry(p)!;
  const wire = packAchievementRegistry(registry);
  const old = structuredClone(registry);
  delete old.stages;
  const oldWire = packAchievementRegistry(old);
  expect(wire.data).toEqual(oldWire.data);
  expect(wire.roots).toEqual(oldWire.roots);
  expect(wire.count).toBe(oldWire.count);
  for (const change of [
    { catalogVersion: 5 },
    { stages: { from: -1, at: cfNow.toISOString() } },
    { stages: { from: 1, at: cfNow.toISOString() } },
    { stages: { from: 0, at: new Date(0).toISOString() } },
    { stages: { from: 0, at: cfNow.toISOString(), extra: true } },
    { cf: null },
  ])
    expect(() => validateAchievementRegistry({ ...wire, ...change })).toThrow();
});
// Explicit development snapshot only; never writes during the ordinary suite.
import { writeFileSync, readFileSync } from 'node:fs';
import { achievementNumbering } from './numbering';
if (process.env.BIDDING_EXPORT_065)
  it('exports a new current catalog snapshot for documentation checks', () => {
    writeFileSync(
      process.env.BIDDING_EXPORT_065!,
      JSON.stringify(
        {
          catalog: achievementCatalog,
          metadata: achievementCollectionMetadata,
          notes: achievementCollectionNotes,
          numbering: achievementNumbering,
          presentation: achievementPresentation,
          series: achievementSeries,
          roles: characterAchievementRequirements,
        },
        null,
        2,
      ) + '\n',
      { flag: 'wx' },
    );
  });

it('keeps all 107 prior public numbers exactly as the archived catalog, not only sample IDs', () => {
  const archived = readFileSync(
    new URL(
      '../../../../docs/归档/0.6/成就总表修订6_0.6.4.md',
      import.meta.url,
    ),
    'utf8',
  );
  const mappings = [
    ...archived.matchAll(
      /^\| \[([A-F]\d{2})\]\(#[a-f]\d{2}\) \| ([A-F]\d{2}) \|/gm,
    ),
  ];
  expect(mappings).toHaveLength(107);
  for (const [, number, id] of mappings)
    expect(
      achievementNumber(id as Parameters<typeof achievementNumber>[0]),
    ).toBe(number);
});
