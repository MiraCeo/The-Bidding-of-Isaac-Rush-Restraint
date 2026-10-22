import {
  achievementCatalog as frozenCatalog,
  characterAchievementRequirements as frozenRequirements,
} from './v056-catalog';
import { achievementCollectionMetadata as frozenMetadata } from './v056-collection-metadata';
import { describe, it, expect, vi } from 'vitest';
import { defaultRules } from '../../game/config';
import { createRuntimePlayer, grantItemInstance } from '../../game/runtime';
import { settleRuntimeRoom } from '../../game/room-engine';
import type {
  CharacterId,
  GeneratedRoom,
  ItemId,
  PlayerTurn,
} from '../../game/item-types';
import { createGameSession, reduceGameSession } from '../game-session';
import { startSurvivalClient } from '../survival-client';
import {
  achievementCatalog,
  characterAchievementRequirements,
} from './catalog';
import { achievementCollectionMetadata } from './collection-metadata';
import {
  extractRevision057RoomFacts,
  extractRevision057CompletionFacts,
} from './revision057-facts';
import {
  revision057Catalog,
  revision057Categories,
  revision057CharacterRequirements,
  revision057Metadata,
  revision057NewIds,
  revision057NewSeries,
  revision057RetiredIds,
  revision057Series,
} from './revision057-catalog';

const bid = (amount: number, group: 'A' | 'B' = 'A') => ({
  type: 'bid' as const,
  group,
  amount,
});
const disrupt = (amount: number, group: 'A' | 'B' = 'A') => ({
  type: 'disrupt' as const,
  group,
  amount,
});
const withdraw = { type: 'withdraw' as const };
function settle(
  turnActions: PlayerTurn['actions'][],
  options: {
    items?: ItemId[][];
    role?: CharacterId;
    roll?: number;
    rolls?: number[];
    reward?: ItemId;
  } = {},
) {
  const players = Array.from(
    { length: Math.max(4, turnActions.length) },
    (_, i) => {
      const p = createRuntimePlayer({
        id: i ? 'p' + i : 'human',
        isHuman: i === 0,
        money: 200,
        score: 0,
      });
      p.characterId = i === 0 ? (options.role ?? 'isaac') : 'isaac';
      for (const [j, itemId] of (options.items?.[i] ?? []).entries())
        grantItemInstance(p, {
          itemId,
          instanceId: `initial-${i}-${j}`,
          acquiredOrder: j + 1,
        });
      return p;
    },
  );
  const room: GeneratedRoom = {
    floorIndex: 0,
    roomIndex: 0,
    kind: 'normal',
    rewards: [
      { group: 'A', itemId: options.reward ?? 'score_charm', hidden: false },
      { group: 'B', itemId: 'interest', hidden: false },
    ],
  };
  const turns = players.map((p, i) => ({
    playerId: p.id,
    actions: turnActions[i] ?? [withdraw],
  }));
  let draw = 0;
  const next = vi.fn(() => options.rolls?.[draw++] ?? options.roll ?? 0.9);
  const result = settleRuntimeRoom(room, players, turns, defaultRules, {
    next,
  });
  return { record: { ...result, room, turns, playersBefore: players }, next };
}

describe('approved 0.5.7 runtime catalog and frozen historical semantics', () => {
  it('has 87 badges, 57 cards, 15 series and no collisions with deferred IDs', () => {
    expect(revision057Catalog).toHaveLength(87);
    expect(new Set(revision057Catalog.map((a) => a.id)).size).toBe(87);
    expect(revision057NewIds).toHaveLength(29);
    expect(revision057Categories.map((c) => c.count)).toEqual([
      13, 24, 9, 16, 14, 11,
    ]);
    expect(revision057Series).toHaveLength(15);
    expect(
      87 - revision057Series.reduce((sum, s) => sum + s.ids.length - 1, 0),
    ).toBe(57);
    for (const id of ['B10', 'E13', 'E14', 'F11', 'A02', 'A04'])
      expect(revision057Catalog.some((a) => a.id === id)).toBe(false);
    expect(revision057RetiredIds).toEqual(['A02', 'A04']);
  });
  it.each(revision057NewSeries)(
    'keeps ordered independent copper/silver/gold levels in $name',
    (s) => {
      expect(
        s.ids.map((id) => revision057Catalog.find((a) => a.id === id)!.target),
      ).toEqual(s.targets);
      expect(s.ids.map((id) => revision057Metadata.get(id)!.tier)).toEqual([
        'bronze',
        'silver',
        'gold',
      ]);
      expect(
        s.ids.every((id) => revision057Metadata.get(id)!.hidden === false),
      ).toBe(true);
      expect(s.ids).toContain(s.anchor);
    },
  );
  it('matches all changed visibility, grades and the retained E01 role prerequisite', () => {
    expect(revision057Metadata.get('A03')).toEqual({
      tier: 'silver',
      hidden: false,
    });
    expect(revision057Metadata.get('E12')).toEqual({
      tier: 'bronze',
      hidden: false,
    });
    expect(revision057Metadata.get('B12')).toEqual({
      tier: 'silver',
      hidden: true,
    });
    expect(revision057Metadata.get('B13')).toEqual({
      tier: 'gold',
      hidden: true,
    });
    for (const id of ['A05', 'B03'] as const)
      expect(revision057Metadata.get(id)!.hidden).toBe(true);
    expect(revision057CharacterRequirements.lost).toEqual(['E01', 'A10']);
    expect(revision057Catalog.find((a) => a.id === 'A03')!.target).toBe(5);
    expect(
      ['bronze', 'silver', 'gold'].map(
        (t) =>
          revision057Catalog.filter(
            (a) => revision057Metadata.get(a.id)!.tier === t,
          ).length,
      ),
    ).toEqual([32, 32, 23]);
    expect(
      revision057Catalog.filter((a) => revision057Metadata.get(a.id)!.hidden),
    ).toHaveLength(8);
  });
  it('enables approved rules without mutating frozen 0.5.6 reconstruction semantics', () => {
    expect(achievementCatalog).toHaveLength(117);
    expect(frozenCatalog).toHaveLength(60);
    expect(frozenCatalog.find((a) => a.id === 'A02')!.condition).toBe(
      '累计正常竞拍失败10次。',
    );
    expect(frozenMetadata.A03).toEqual({
      tier: 'gold',
      hidden: true,
    });
    expect(frozenMetadata.E12.tier).toBe('silver');
    expect(achievementCollectionMetadata.E12.tier).toBe('bronze');
    expect(frozenRequirements.lost).toEqual(['E01', 'A02']);
    expect(characterAchievementRequirements.lost).toEqual(['E01', 'A10']);
  });
});

describe('read-only 0.5.7 authority facts', () => {
  it('counts an actual cooperative opportunity once despite dual qualification or tail copies', () => {
    const r = settle([[bid(40)], [bid(60)], [bid(40)], [bid(40)]], {
      items: [['guppys_tail']],
    });
    expect(r.record.awards.find((a) => a.playerId === 'human')!.copies).toBe(2);
    expect(extractRevision057RoomFacts(r.record)).toMatchObject({
      cooperativeAwardOpportunities: 1,
      alternativeAwardOpportunities: 1,
    });
    const both = settle([[bid(40)], [bid(40)], [bid(40)], [bid(40)]]);
    expect(
      both.record.entitlements.find((e) => e.playerId === 'human')!.sources,
    ).toEqual(expect.arrayContaining(['highest', 'cooperation']));
    expect(
      extractRevision057RoomFacts(both.record)!.cooperativeAwardOpportunities,
    ).toBe(1);
  });
  it('does not count qualification without actual delivery as cooperation or an alternative award', () => {
    const r = settle([[bid(40)], [bid(60)], [bid(40)], [bid(40)]], {
      items: [['guppys_tail']],
      roll: 0,
    });
    expect(extractRevision057RoomFacts(r.record)).toMatchObject({
      cooperativeAwardOpportunities: 0,
      alternativeAwardOpportunities: 0,
      missedCooperationActions: 0,
    });
  });
  it('counts both A and B misses using the original distinct tie draws, not one room boolean', () => {
    const r = settle(
      [
        [bid(40), bid(40, 'B')],
        [bid(45), bid(45, 'B')],
        [bid(40), bid(40, 'B')],
        [bid(40), bid(40, 'B')],
      ],
      {
        items: Array.from({ length: 4 }, () => ['more_options']),
        rolls: [
          0.2, 0.1, 0.3, 0.4, 0.9, 0.1, 0.1, 0.2, 0.2, 0.1, 0.3, 0.4, 0.9, 0.1,
          0.1, 0.2,
        ],
      },
    );
    expect(extractRevision057RoomFacts(r.record)).toMatchObject({
      missedCooperationActions: 2,
      missedHighPriceActions: 2,
    });
  });
  it('uses the exact last high-price placement including disruptors, not the last normal recipient', () => {
    const others = [
      [disrupt(50)],
      ...Array.from({ length: 8 }, () => [bid(10)]),
    ];
    expect(
      extractRevision057RoomFacts(settle([[bid(80)], ...others]).record)!
        .lastHighPriceAwardOpportunities,
    ).toBe(1);
    expect(
      extractRevision057RoomFacts(settle([[bid(200)], ...others]).record)!
        .lastHighPriceAwardOpportunities,
    ).toBe(0);
  });
  it('allows AI-caused whole-path vacancies witnessed by a withdrawing human and both hidden badges together', () => {
    const r = settle([[withdraw], [disrupt(30)], [bid(20)], [bid(20)]]);
    expect(extractRevision057RoomFacts(r.record)).toMatchObject({
      onePathEntirelyVacant: true,
      bothPathsEntirelyVacant: true,
    });
    expect(
      r.record.resolvedActions.find((a) => a.playerId === 'human')!.action.type,
    ).toBe('withdraw');
  });
  it('does not treat an empty cooperation group as an allocated all-vacant path', () => {
    const r = settle([[withdraw], [disrupt(1)]]);
    expect(extractRevision057RoomFacts(r.record)).toMatchObject({
      onePathEntirelyVacant: true,
      bothPathsEntirelyVacant: false,
    });
    expect(
      extractRevision057RoomFacts(settle([[withdraw]]).record),
    ).toMatchObject({
      onePathEntirelyVacant: false,
      bothPathsEntirelyVacant: false,
    });
  });
  it('does not combine an A highest vacancy and B cooperation vacancy into an entire group', () => {
    const r = settle([
      [withdraw],
      [disrupt(1)],
      [bid(100, 'B')],
      [disrupt(35, 'B')],
    ]);
    expect(extractRevision057RoomFacts(r.record)).toMatchObject({
      onePathEntirelyVacant: true,
      bothPathsEntirelyVacant: false,
    });
  });
  it('excludes a partially filled path and normal rewards eliminated by the tail', () => {
    const r = settle([
      [bid(80)],
      [disrupt(50)],
      ...Array.from({ length: 8 }, () => [bid(10)]),
    ]);
    expect(extractRevision057RoomFacts(r.record)!.onePathEntirelyVacant).toBe(
      false,
    );
    const tail = settle([[bid(200)]], { items: [['guppys_tail']], roll: 0 });
    expect(
      tail.record.awards.filter((a) => a.playerId === 'human'),
    ).toHaveLength(0);
    expect(
      extractRevision057RoomFacts(tail.record)!.onePathEntirelyVacant,
    ).toBe(false);
  });
  it('never calls a redeemed disruption slot vacant even if its delivered reward is destroyed', () => {
    const r = settle([[withdraw], [disrupt(30)], [bid(20)], [bid(20)]], {
      items: [[], ['transcendence', 'guppys_tail']],
      roll: 0,
    });
    expect(r.record.transcendenceRedemptions).toHaveLength(2);
    expect(r.record.awards.filter((a) => a.playerId === 'p1')).toHaveLength(0);
    expect(extractRevision057RoomFacts(r.record)).toMatchObject({
      onePathEntirelyVacant: false,
      bothPathsEntirelyVacant: false,
    });
  });
  it('requires a Lost room award of holy mantle, not the initial item, another role or a destroyed reward', () => {
    const won = settle([[bid(200)]], {
      role: 'lost',
      items: [['holy_mantle']],
      reward: 'holy_mantle',
    });
    expect(extractRevision057RoomFacts(won.record)!.lostHolyMantleAward).toBe(
      true,
    );
    expect(
      extractRevision057RoomFacts(
        settle([[withdraw]], {
          role: 'lost',
          items: [['holy_mantle']],
          reward: 'holy_mantle',
        }).record,
      )!.lostHolyMantleAward,
    ).toBe(false);
    expect(
      extractRevision057RoomFacts(
        settle([[bid(200)]], { role: 'isaac', reward: 'holy_mantle' }).record,
      )!.lostHolyMantleAward,
    ).toBe(false);
    expect(
      extractRevision057RoomFacts(
        settle([[bid(200)]], {
          role: 'lost',
          items: [['guppys_tail']],
          reward: 'holy_mantle',
          roll: 0,
        }).record,
      )!.lostHolyMantleAward,
    ).toBe(false);
  });
  it('does not consume RNG, mutate input or count AI-only rooms', () => {
    const r = settle([[bid(40)], [bid(60)], [bid(40)], [bid(40)]]),
      original = JSON.stringify(r.record),
      draws = r.next.mock.calls.length;
    expect(extractRevision057RoomFacts(r.record)).toEqual(
      extractRevision057RoomFacts(r.record),
    );
    expect(r.next).toHaveBeenCalledTimes(draws);
    expect(JSON.stringify(r.record)).toBe(original);
    const clone = structuredClone(r.record);
    clone.playersBefore[0]!.isHuman = false;
    expect(extractRevision057RoomFacts(clone)).toBeNull();
    expect(() =>
      extractRevision057RoomFacts(structuredClone(r.record)),
    ).toThrow('缺少权威按组落选证据');
  });
});

describe('official finish rank observation, not a loss counter or a historical import', () => {
  function classic() {
    const session = reduceGameSession(createGameSession(42), {
      type: 'start_game',
      characterId: 'isaac',
    });
    if (session.game.phase === 'character_selection')
      throw Error('Expected active game');
    return session.game;
  }
  it('waits for an actual terminal phase and reads the final array position without reranking tied scores', () => {
    const g = classic();
    expect(extractRevision057CompletionFacts(g)).toBeNull();
    const ranking = Array.from({ length: 20 }, (_, i) => ({
      playerId: 'p' + i,
      finalScore: 100,
    }));
    ranking[4]!.playerId = 'human';
    expect(
      extractRevision057CompletionFacts({
        ...g,
        phase: 'game_result',
        finalRanking: ranking,
      })!.finalRank,
    ).toBe(5);
    ranking[4]!.playerId = 'p4';
    ranking[5]!.playerId = 'human';
    expect(
      extractRevision057CompletionFacts({
        ...g,
        phase: 'game_result',
        finalRanking: ranking,
      })!.finalRank,
    ).toBe(6);
  });
  it('reads the explicit survival formal rank rather than cumulative score or elimination alone', () => {
    const g = startSurvivalClient('lost', 42, 'standard').game;
    expect(extractRevision057CompletionFacts(g)).toBeNull();
    const human = {
      playerId: 'human',
      rank: 6,
      finalScore: 99999,
      eliminationFloorIndex: null,
      tieBreaker: 0.5,
      status: 'survived' as const,
      isChampion: false,
    };
    const ranking = Array.from({ length: 20 }, (_, i) => ({
      ...human,
      playerId: 'p' + i,
      rank: i + 1,
      finalScore: 0,
    }));
    ranking[5] = human;
    expect(
      extractRevision057CompletionFacts({
        ...g,
        phase: 'competition_complete',
        finalRanking: ranking,
        championId: 'p0',
      }),
    ).toEqual({
      mode: 'survival',
      characterId: 'lost',
      finalRank: 6,
      champion: false,
    });
    expect(
      extractRevision057CompletionFacts({
        ...g,
        phase: 'floor_result',
        finalRanking: ranking,
      }),
    ).toBeNull();
  });
  it('rejects missing or invalid human final ranks instead of manufacturing a failure', () => {
    const g = classic();
    expect(() =>
      extractRevision057CompletionFacts({
        ...g,
        phase: 'game_result',
        finalRanking: [],
      }),
    ).toThrow('缺少真人排名');
    const s = startSurvivalClient('isaac', 42, 'standard').game;
    expect(() =>
      extractRevision057CompletionFacts({
        ...s,
        phase: 'competition_complete',
        finalRanking: [],
      }),
    ).toThrow('缺少有效真人排名');
  });
});
