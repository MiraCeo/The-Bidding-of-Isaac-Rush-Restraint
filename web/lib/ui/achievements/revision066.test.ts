import { expect, it } from 'vitest';
import {
  achievementCatalog,
  characterAchievementRequirements,
} from './catalog';
import { achievementCollectionMetadata as metal } from './collection-metadata';
import { achievementPresentation as copy } from './presentation';
import { createPlayerProfile } from '../player-profile';
import {
  appendCf,
  cfRoom,
  cfFloor,
  cfLast,
  cfNow,
} from './revision058.test-helper';
import {
  projectAchievementRegistry as view,
  readAchievementRegistry,
  validateAchievementRegistry,
  achievementRegistryModule,
} from './registry';
import {
  decodeAchievementEvent,
  encodeAchievementEvent,
  sameAchievementEventFacts,
} from './event-codec';
import { packAchievementRegistry } from './ledger-codec';
import {
  serializePlayerProfileBackup,
  parsePlayerProfileBackup,
} from '../player-profile-file';
import { extractAllInCapital } from './revision066-facts';
import { createRuntimePlayer } from '../../game/runtime';
import { settleRuntimeRoom } from '../../game/room-engine';
import { defaultRules } from '../../game/config';
import type { ClientRoomSettlementRecord } from '../../game/client-session';
const capitalRoom = (debit: number, base: number) => {
  const e = cfRoom(0, { code: 1, mask: 2 ** 14 });
  e.values.push(debit, base);
  return e;
};
it('keeps 117 stable badges, tightens only approved targets and leaves role gates unchanged', () => {
  expect(achievementCatalog).toHaveLength(117);
  expect(
    ['B05', 'B18', 'B19'].map(
      (id) => achievementCatalog.find((a) => a.id === id)!.target,
    ),
  ).toEqual([1, 10, 50]);
  expect(
    ['B11', 'B24', 'B25'].map(
      (id) => achievementCatalog.find((a) => a.id === id)!.target,
    ),
  ).toEqual([1, 10, 50]);
  expect(metal.B12).toEqual({ tier: 'bronze', hidden: true });
  expect(metal.B13).toEqual({ tier: 'silver', hidden: true });
  expect(
    ['bronze', 'silver', 'gold'].map(
      (t) => achievementCatalog.filter((a) => metal[a.id].tier === t).length,
    ),
  ).toEqual([39, 41, 37]);
  expect(copy.D06.summary).toContain('50%');
  expect(achievementCatalog.find((a) => a.id === 'F16')!.condition).toContain(
    '困难或最高',
  );
  expect(
    achievementCatalog.find((a) => a.id === 'F04')!.condition,
  ).not.toContain('困难');
  expect(characterAchievementRequirements.lost).toEqual(['E01', 'A10']);
});
it.each([
  [1, 100, false],
  [49, 100, false],
  [50, 100, true],
  [50, 101, false],
  [51, 101, true],
  [0, 100, false],
] as const)(
  'requires actual debit %s of floor base %s: %s',
  (debit, base, earned) => {
    const p = appendCf(createPlayerProfile(cfNow), capitalRoom(debit, base));
    expect(!!view(p)!.achievedAt.D06).toBe(earned);
    expect(p.progression.modules[achievementRegistryModule]).toMatchObject({
      version: 8,
      catalogVersion: 7,
    });
  },
);
it('does not guess capital from old all-in bits, and preserves ordinary all-in award progress', () => {
  let p = appendCf(
    createPlayerProfile(cfNow),
    cfRoom(0, { code: 2, mask: 2 ** 14, flags: 16 }),
  );
  expect(view(p)!.achievedAt.D06).toBeUndefined();
  expect(view(p)!.progress.D09).toBe(1);
  p = appendCf(p, capitalRoom(1, 100));
  expect(view(p)!.achievedAt.D06).toBeUndefined();
  expect(view(p)!.progress.D09).toBe(1);
});
it.each(['easy', 'standard', 'hard', 'highest', undefined] as const)(
  'only hard/highest complete five-floor prefixes award gold: %s',
  (difficulty) => {
    let p = createPlayerProfile(cfNow);
    let parent: string | null = null;
    for (let n = 0; n < 5; n++) {
      const e = cfFloor(n);
      if (difficulty !== undefined)
        e.values.push(
          ['easy', 'standard', 'hard', 'highest'].indexOf(difficulty),
        );
      p = appendCf(p, e, {
        mode: 'survival',
        root: 'same-five-floor-run',
        parent,
      });
      parent = cfLast(p);
    }
    expect(view(p)!.progress.F04).toBe(5);
    expect(view(p)!.achievedAt.F15).toBeDefined();
    expect(view(p)!.achievedAt.F04).toBeDefined();
    expect(!!view(p)!.achievedAt.F16).toBe(
      difficulty === 'hard' || difficulty === 'highest',
    );
    expect(view(p)!.progress.F16).toBe(
      difficulty === 'hard' || difficulty === 'highest' ? 5 : 0,
    );
  },
);
it('does not combine roots, missing first floors or low-difficulty prefixes into hard gold', () => {
  let p = createPlayerProfile(cfNow);
  for (let n = 0; n < 5; n++) {
    const e = cfFloor(n);
    e.values.push(2);
    p = appendCf(p, e, { mode: 'survival' });
  }
  expect(view(p)!.progress.F16).toBe(1);
  let q = createPlayerProfile(cfNow);
  let parent: string | null = null;
  for (let n = 0; n < 5; n++) {
    const e = cfFloor(n);
    e.values.push(n === 0 ? 1 : 2);
    q = appendCf(q, e, { mode: 'survival', root: 'mixed-difficulty', parent });
    parent = cfLast(q);
  }
  expect(view(q)!.progress.F16).toBe(0);
});
it('round-trips new proof and backup without duplicate awards or silent enrichment', () => {
  const old = cfRoom(0, { code: 1, mask: 2 ** 14 });
  const fresh = capitalRoom(50, 100);
  expect(sameAchievementEventFacts(old, fresh)).toBe(true);
  expect(sameAchievementEventFacts(fresh, capitalRoom(49, 100))).toBe(false);
  const p = appendCf(createPlayerProfile(cfNow), fresh, {
    root: 'stable',
    authority: 'stable',
  });
  const wire = p.progression.modules[achievementRegistryModule];
  validateAchievementRegistry(wire);
  expect(packAchievementRegistry(readAchievementRegistry(p)!)).toEqual(wire);
  const restored = parsePlayerProfileBackup(
    serializePlayerProfileBackup(p),
  ).profile;
  expect(view(restored)).toEqual(view(p));
  const duplicate = appendCf(restored, fresh, {
    root: 'stable',
    authority: 'stable',
  });
  expect(duplicate).toBe(restored);
  expect(appendCf(restored, fresh, { source: 'read-only' })).toBe(restored);
  expect(appendCf(restored, fresh, { source: 'historical' })).toBe(restored);
});
it('rejects invalid capital evidence, unknown difficulty, and malformed schema8 envelopes', () => {
  for (const [cost, base] of [
    [50, 0],
    [-1, 100],
    [0.5, 100],
  ])
    expect(() => decodeAchievementEvent(capitalRoom(cost, base))).toThrow();
  const notAllIn = capitalRoom(50, 100);
  notAllIn.values[1] = 0;
  expect(() => decodeAchievementEvent(notAllIn)).toThrow();
  const floor = cfFloor(0);
  floor.values.push(4);
  expect(() => decodeAchievementEvent(floor)).toThrow();
  const p = appendCf(createPlayerProfile(cfNow), capitalRoom(50, 100));
  const wire = p.progression.modules[
    achievementRegistryModule
  ] as unknown as Record<string, unknown>;
  expect(() =>
    validateAchievementRegistry({ ...wire, catalogVersion: 6 }),
  ).toThrow();
  expect(() => validateAchievementRegistry({ ...wire, version: 7 })).toThrow();
});
it('observes character floor base and true discounted debit, not current balance or refund effects', () => {
  const player = createRuntimePlayer({
    id: 'human',
    money: 100,
    score: 0,
    isHuman: true,
  });
  player.characterFloorStartingMoney = 100;
  const room = {
    floorIndex: 0,
    roomIndex: 0,
    kind: 'normal' as const,
    rewards: [
      { group: 'A' as const, itemId: 'score_charm' as const, hidden: false },
      { group: 'B' as const, itemId: 'interest' as const, hidden: false },
    ] as const,
  };
  const turns = [
    {
      playerId: 'human',
      actions: [{ type: 'bid' as const, group: 'A' as const, amount: 100 }],
    },
  ];
  for (const copies of [0, 1, 2]) {
    player.items = Array.from({ length: copies }, (_, i) => ({
      instanceId: 'sale' + i,
      itemId: 'steam_sale' as const,
      acquiredOrder: i,
    }));
    const record: ClientRoomSettlementRecord = {
      room,
      turns,
      playersBefore: [player],
      ...settleRuntimeRoom(room, [player], turns, defaultRules, {
        next: () => 0.5,
      }),
    };
    const proof = extractAllInCapital(record)!;
    expect(proof).toEqual([copies === 0 ? 100 : copies === 1 ? 70 : 49, 100]);
    const e = capitalRoom(...proof);
    const facts = decodeAchievementEvent(e);
    expect(encodeAchievementEvent(facts)).toEqual(e);
  }
  player.characterFloorStartingMoney = null;
  expect(() =>
    extractAllInCapital({
      playersBefore: [player],
    } as ClientRoomSettlementRecord),
  ).toThrow();
  expect(
    extractAllInCapital({
      playersBefore: [],
    } as unknown as ClientRoomSettlementRecord),
  ).toBeUndefined();
});

it('retains the authoritative debit even if a real shield refund restores all money', () => {
  const human = createRuntimePlayer({
    id: 'human',
    money: 100,
    score: 0,
    isHuman: true,
  });
  human.characterFloorStartingMoney = 100;
  human.persistentShields = 1;
  human.items = [
    { instanceId: 'cross', itemId: 'wooden_cross', acquiredOrder: 0 },
  ];
  const ai = createRuntimePlayer({
    id: 'ai',
    money: 300,
    score: 0,
    isHuman: false,
  });
  const room = {
    floorIndex: 0,
    roomIndex: 0,
    kind: 'normal' as const,
    rewards: [
      { group: 'A' as const, itemId: 'score_charm' as const, hidden: false },
      { group: 'B' as const, itemId: 'interest' as const, hidden: false },
    ] as const,
  };
  const turns = [
    {
      playerId: 'human',
      actions: [{ type: 'bid' as const, group: 'A' as const, amount: 100 }],
    },
    {
      playerId: 'ai',
      actions: [{ type: 'bid' as const, group: 'A' as const, amount: 300 }],
    },
  ];
  const record: ClientRoomSettlementRecord = {
    room,
    turns,
    playersBefore: [human, ai],
    ...settleRuntimeRoom(room, [human, ai], turns, defaultRules, {
      next: () => 0.5,
    }),
  };
  expect(
    record.events.some(
      (e) => e.playerId === 'human' && e.type === 'refund' && e.amount === 100,
    ),
  ).toBe(true);
  expect(extractAllInCapital(record)).toEqual([100, 100]);
});
it('does not enrich an old recorded authority with new capital, and rejects conflicts between two new proofs', () => {
  const old = cfRoom(0, { code: 1, mask: 2 ** 14 });
  const p = appendCf(createPlayerProfile(cfNow), old, {
    root: 'old-proof',
    authority: 'old-proof',
  });
  expect(
    appendCf(p, capitalRoom(100, 100), {
      root: 'old-proof',
      authority: 'old-proof',
    }),
  ).toBe(p);
  expect(view(p)!.achievedAt.D06).toBeUndefined();
  const next = appendCf(p, capitalRoom(50, 100), {
    root: 'new-proof',
    authority: 'new-proof',
  });
  expect(() =>
    appendCf(next, capitalRoom(49, 100), {
      root: 'new-proof',
      authority: 'new-proof',
    }),
  ).toThrow('冲突');
});
