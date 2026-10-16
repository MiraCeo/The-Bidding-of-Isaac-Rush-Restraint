import { describe, it, expect, vi } from 'vitest';
import {
  achievementCatalog,
  achievementCategories,
  characterAchievementRequirements,
} from './catalog';
import { revision057Catalog } from './revision057-catalog';
import { revision058NewIds, revision058NewSeries } from './revision058-catalog';
import { achievementCollectionMetadata as metal } from './collection-metadata';
import { achievementSeries, selectAchievementCards } from './series';
import { achievementGlyphs } from '../../../components/game/achievement-badge';
import { achievementCollectionNotes } from './collection-notes';
import { achievementPresentation } from './presentation';
import { extractRevision058RoomCounts } from './revision058-facts';
import { extractAchievementRoomFacts } from './facts';
import { createRuntimePlayer, grantItemInstance } from '../../game/runtime';
import { settleRuntimeRoom } from '../../game/room-engine';
import { defaultRules } from '../../game/config';
import type { ItemId, PlayerTurn, GeneratedRoom } from '../../game/item-types';

const bid = (amount: number, group: 'A' | 'B' = 'A') => ({
  type: 'bid' as const,
  amount,
  group,
});
const disrupt = (amount: number, group: 'A' | 'B' = 'A') => ({
  type: 'disrupt' as const,
  amount,
  group,
});
const withdraw = { type: 'withdraw' as const };
function settle(
  actions: PlayerTurn['actions'][],
  o: {
    items?: ItemId[][];
    shields?: number;
    roll?: number;
    humanLast?: boolean;
  } = {},
) {
  const players = actions.map((_, i) => {
    const p = createRuntimePlayer({
      id: i ? 'p' + i : 'human',
      isHuman: i === 0,
      money: 200,
      score: 0,
    });
    if (!i) p.temporaryShields = o.shields ?? 0;
    for (const [j, itemId] of (o.items?.[i] ?? []).entries())
      grantItemInstance(p, {
        itemId,
        instanceId: `cf-${i}-${j}`,
        acquiredOrder: j + 1,
      });
    return p;
  });
  const room: GeneratedRoom = {
    floorIndex: 0,
    roomIndex: 0,
    kind: 'normal',
    rewards: [
      { group: 'A', itemId: 'score_charm', hidden: false },
      { group: 'B', itemId: 'interest', hidden: false },
    ],
  };
  const turns = players.map((p, i) => ({
    playerId: p.id,
    actions: actions[i]!,
  }));
  if (o.humanLast) players.reverse();
  const next = vi.fn(() => o.roll ?? 0.9);
  const record = {
    ...settleRuntimeRoom(room, players, turns, defaultRules, { next }),
    room,
    turns,
    playersBefore: players,
  };
  return { record, next };
}
describe('approved C-F catalog', () => {
  it('publishes 107 medals, 57 cards and 25 series without renumbering A-B or restoring deferred IDs', () => {
    expect(achievementCatalog).toHaveLength(107);
    expect(new Set(achievementCatalog.map((a) => a.id)).size).toBe(107);
    expect(revision058NewIds).toHaveLength(20);
    expect(achievementSeries).toHaveLength(25);
    expect(achievementCategories.map((c) => c.count)).toEqual([
      13, 24, 15, 22, 18, 15,
    ]);
    expect(
      selectAchievementCards(
        {
          category: 'all',
          query: '',
          status: 'all',
          sort: 'catalog',
          tier: 'all',
        },
        {},
        {},
      ),
    ).toHaveLength(57);
    expect(
      achievementCatalog.filter(
        (a) => a.category === 'A' || a.category === 'B',
      ),
    ).toEqual(
      revision057Catalog.filter(
        (a) => a.category === 'A' || a.category === 'B',
      ),
    );
    for (const id of ['B10', 'E13', 'E14', 'F11', 'A02', 'A04'])
      expect(achievementCatalog.some((a) => a.id === id)).toBe(false);
    expect(characterAchievementRequirements.lost).toEqual(['E01', 'A10']);
    expect(characterAchievementRequirements.eden).toEqual(['E05']);
  });
  it.each(revision058NewSeries)(
    'gives $name independent public metal stages and complete presentation',
    (s) => {
      expect(
        s.ids.map((id) => achievementCatalog.find((a) => a.id === id)!.target),
      ).toEqual(s.targets);
      expect(s.ids.map((id) => metal[id].tier)).toEqual([
        'bronze',
        'silver',
        'gold',
      ]);
      for (const id of s.ids) {
        expect(metal[id].hidden).toBe(false);
        expect(achievementGlyphs[id]).toBe(achievementGlyphs[s.anchor]);
        expect(achievementCollectionNotes[id]).toBeTruthy();
        expect(achievementPresentation[id].note).toContain(
          achievementCatalog.find((a) => a.id === id)!.condition,
        );
      }
    },
  );
  it('applies six eighteen sixty-six, the preserved third-floor silver, role breadth and special hidden challenges', () => {
    expect(
      revision058NewSeries.find((s) => s.anchor === 'C06')!.targets,
    ).toEqual([6, 18, 66]);
    expect(
      revision058NewSeries.find((s) => s.anchor === 'C01')!.targets,
    ).toEqual([1, 10, 20]);
    expect(revision058NewSeries.find((s) => s.anchor === 'F04')!.ids).toEqual([
      'F15',
      'F04',
      'F16',
    ]);
    expect(achievementCatalog.find((a) => a.id === 'C08')).toMatchObject({
      target: 2,
      kind: 'same-match',
    });
    expect(metal.C08).toEqual({ tier: 'gold', hidden: true });
    expect(metal.D12.tier).toBe('bronze');
    expect(metal.E08.tier).toBe('silver');
    expect(metal.E11.hidden).toBe(true);
    expect(metal.F05.hidden).toBe(true);
    expect(
      ['bronze', 'silver', 'gold'].map(
        (t) => achievementCatalog.filter((a) => metal[a.id].tier === t).length,
      ),
    ).toEqual([38, 36, 33]);
    expect(achievementCatalog.filter((a) => metal[a.id].hidden)).toHaveLength(
      11,
    );
  });
});
describe('C-F real settlement cause multiplicities without engine changes', () => {
  it('counts personal A-B disruptions separately, never each highest/cooperation path twice', () => {
    const { record, next } = settle(
      [[disrupt(80), disrupt(80, 'B')], [bid(30)], [bid(30, 'B')], [withdraw]],
      { items: [['more_options_question']] },
    );
    const before = JSON.stringify(record),
      calls = next.mock.calls.length;
    expect(extractRevision058RoomCounts(record)).toEqual([2, 0, 0]);
    expect(extractAchievementRoomFacts(record)!.causedVacancy).toBe(true);
    expect(
      extractRevision058RoomCounts({
        ...record,
        highPricePlacements: [
          ...record.highPricePlacements,
          ...record.highPricePlacements,
        ],
      }),
    ).toEqual([2, 0, 0]);
    expect(next.mock.calls).toHaveLength(calls);
    expect(JSON.stringify(record)).toBe(before);
  });
  it('does not count AI vacancies or redeemed personal placements as a personal vacancy', () => {
    expect(
      extractRevision058RoomCounts(
        settle([[withdraw], [disrupt(80)], [bid(20)]], {}).record,
      ),
    ).toEqual([0, 0, 0]);
    const { record } = settle([[disrupt(80)], [bid(20)], [withdraw]], {
      items: [['transcendence']],
      roll: 0,
    });
    expect(
      record.transcendenceRedemptions.some((r) => r.playerId === 'human'),
    ).toBe(true);
    expect(extractRevision058RoomCounts(record)![0]).toBe(0);
  });
  it('counts two positive-cost failed actions covered by one aggregate shield event, not its event count', () => {
    const { record } = settle(
      [[bid(1), bid(2, 'B')], [bid(100)], [bid(100, 'B')]],
      { items: [['more_options']], shields: 1 },
    );
    expect(
      record.events.filter(
        (e) => e.type === 'refund' && e.playerId === 'human',
      ),
    ).toHaveLength(1);
    expect(extractRevision058RoomCounts(record)).toEqual([0, 2, 0]);
    expect(
      extractRevision058RoomCounts({
        ...record,
        events: [...record.events, ...record.events],
      }),
    ).toEqual([0, 2, 0]);
    expect(
      extractRevision058RoomCounts({
        ...record,
        events: record.events.filter((e) => e.type !== 'refund'),
      })![1],
    ).toBe(0);
  });
  it('does not include zero-cost failed actions in a positive aggregate refund', () => {
    const { record } = settle(
      [[bid(1), bid(2, 'B')], [bid(100)], [bid(100, 'B')]],
      {
        items: [['more_options', 'steam_sale', 'steam_sale', 'steam_sale']],
        shields: 1,
      },
    );
    expect(extractRevision058RoomCounts(record)![1]).toBe(1);
  });
  it('does not call qualified rewards destroyed by More Options or tail a refunded failure', () => {
    for (const item of ['more_options', 'guppys_tail'] as const) {
      const { record } = settle([[bid(40), bid(39, 'B')], [withdraw]], {
        items: [[item, 'more_options']],
        shields: 1,
        roll: 0,
      });
      expect(
        record.events.some(
          (e) => e.playerId === 'human' && e.type === 'destroy',
        ),
      ).toBe(true);
      expect(extractRevision058RoomCounts(record)![1]).toBe(0);
    }
  });
  it('requires lucky-foot necessary qualification and actual delivery, excludes copying and redundant qualification', () => {
    const { record } = settle([[bid(20)], [bid(40)]], {
      items: [['lucky_foot', 'guppys_tail']],
      roll: 0.9,
      humanLast: true,
    });
    expect(extractRevision058RoomCounts(record)![2]).toBe(1);
    expect(record.awards.find((a) => a.playerId === 'human')!.copies).toBe(2);
    expect(
      extractRevision058RoomCounts(
        settle([[bid(20)], [bid(40)]], {
          items: [['lucky_foot', 'guppys_tail']],
          roll: 0,
          humanLast: true,
        }).record,
      )![2],
    ).toBe(0);
    expect(
      extractRevision058RoomCounts(
        settle([[bid(40)], [bid(20)]], { items: [['lucky_foot']] }).record,
      )![2],
    ).toBe(0);
  });
  it('does not manufacture human facts in AI-only survival rooms', () => {
    const { record } = settle([[withdraw], [bid(40)]]);
    expect(
      extractRevision058RoomCounts({
        ...record,
        playersBefore: record.playersBefore.filter((p) => !p.isHuman),
      }),
    ).toBeNull();
  });
});
