import { characterCatalog } from '../game/characters';
import { classicReplayId, readClassicAiSettings } from '../game/classic-difficulty';
import { itemCatalog } from '../game/item-catalog';
import type { RuntimePlayerState, SettlementEvent } from '../game/item-types';
import {
  canonicalJson,
  replayRoomLocator,
  type ReplayLog,
} from './replay-record';
import { replayRuleFacts } from './replay-facts-codec';
import { toEventFact } from './replay-event-facts';

function fail(): never {
  throw new Error('回放记录损坏或结算事实不一致。');
}
function equal(a: unknown, b: unknown) {
  if (canonicalJson(a) !== canonicalJson(b)) fail();
}
function number(v: unknown, minimum = 0): asserts v is number {
  if (
    typeof v !== 'number' ||
    !Number.isFinite(v) ||
    v < minimum ||
    Math.abs(v) > 1e15
  )
    fail();
}
function integer(v: unknown, minimum = 0) {
  number(v, minimum);
  if (!Number.isInteger(v)) fail();
}
function text(v: unknown, maximum = 160): asserts v is string {
  if (typeof v !== 'string' || !v.trim() || v.length > maximum) fail();
}
function near(a: number, b: number, tolerance = 1e-7) {
  if (Math.abs(a - b) > tolerance) fail();
}
function round(v: number, decimals: number) {
  const factor = 10 ** decimals;
  return Math.round((v + Number.EPSILON) * factor) / factor;
}
const playerIds = [
  'human',
  ...Array.from({ length: 19 }, (_, i) => `ai-${i + 1}`),
];
const itemIds = new Set<string>(itemCatalog.map((i) => i.id));
const characterIds = new Set<string>(characterCatalog.map((c) => c.id));
function players(value: RuntimePlayerState[]) {
  if (!Array.isArray(value) || value.length !== 20) fail();
  value.forEach((p, index) => {
    if (
      !p ||
      p.id !== playerIds[index] ||
      p.isHuman !== (index === 0) ||
      !characterIds.has(String(p.characterId))
    )
      fail();
    integer(p.money);
    number(p.score);
    integer(p.characterFloorStartingMoney);
    integer(p.temporaryShields);
    integer(p.persistentShields);
    if (
      !Array.isArray(p.items) ||
      p.items.length > 2000 ||
      !Array.isArray(p.triggeredCollarsThisFloor) ||
      p.triggeredCollarsThisFloor.length > 2000
    )
      fail();
    const ids = new Set<string>();
    for (const item of p.items) {
      text(item.instanceId);
      integer(item.acquiredOrder, 1);
      if (!itemIds.has(item.itemId) || ids.has(item.instanceId)) fail();
      ids.add(item.instanceId);
    }
    if (
      new Set(p.triggeredCollarsThisFloor).size !==
        p.triggeredCollarsThisFloor.length ||
      p.triggeredCollarsThisFloor.some(
        (id) =>
          !p.items.some(
            (i) => i.instanceId === id && i.itemId === 'guppys_collar',
          ),
      )
    )
      fail();
  });
}
function events(value: SettlementEvent[], knownRules: boolean) {
  if (!Array.isArray(value) || value.length > 2000) fail();
  for (const e of value) {
    if (
      !e ||
      !playerIds.includes(e.playerId) ||
      ![
        'cost',
        'score',
        'entitlement',
        'refund',
        'destroy',
        'duplicate',
        'award',
        'money',
        'trigger',
      ].includes(e.type)
    )
      fail();
    text(e.message, 10000);
    if (e.group !== undefined && e.group !== 'A' && e.group !== 'B') fail();
    if (e.itemId !== undefined && !itemIds.has(e.itemId)) fail();
    if (e.effectItemId !== undefined && !itemIds.has(e.effectItemId)) fail();
    if (e.amount !== undefined) number(e.amount, -1e15);
    const fact = toEventFact(e);
    if (knownRules && fact.reason === 'legacy') fail();
    if (
      fact.targetPlayerId &&
      (!playerIds.includes(fact.targetPlayerId) ||
        fact.targetPlayerId === fact.playerId)
    )
      fail();
    if (
      [
        'cost',
        'turn_score',
        'heart_retroactive',
        'shield_refund',
        'bag_refund',
        'sale_saving',
        'interest_floor',
        'interest_room',
        'collar_recovery',
        'bag_transfer',
      ].includes(fact.reason)
    )
      number(fact.amount);
  }
}
function moneyDelta(value: SettlementEvent[], id: string): number | null {
  let delta = 0;
  for (const e of value) {
    const f = toEventFact(e);
    if (f.reason === 'legacy' && (e.type === 'money' || e.type === 'refund'))
      return null;
    if (f.reason === 'bag_transfer') {
      if (f.playerId === id) delta += f.amount!;
      if (f.targetPlayerId === id) delta -= f.amount!;
    } else if (
      f.playerId === id &&
      [
        'shield_refund',
        'bag_refund',
        'interest_floor',
        'interest_room',
        'collar_recovery',
      ].includes(f.reason)
    )
      delta += f.amount!;
    // sale_saving is not a second deposit; role_floor_start describes the reset base.
  }
  return delta;
}
/** Validate a read-only historical record. Never invoke AI, RNG, settlement or progression. */
export function validateReplayFacts(value: ReplayLog): ReplayLog {
  const log = value;
  text(log.id);
  text(log.rulesVersion);
  text(log.startedBuild);
  integer(log.seed);
  if (log.seed > 0xffffffff || !characterIds.has(log.characterId)) fail();
  const classicAi = Object.hasOwn(log, 'classicAi') ? readClassicAiSettings(log.classicAi) : undefined;
  const expectedId = classicReplayId(log.seed, log.characterId, log.rulesVersion, classicAi);
  if (log.id !== expectedId) fail();
  if (!log.playerNames || typeof log.playerNames !== 'object') fail();
  equal(Object.keys(log.playerNames).sort(), [...playerIds].sort());
  for (const name of Object.values(log.playerNames)) text(name);
  if (!Array.isArray(log.rooms) || log.rooms.length > 15) fail();
  const facts = replayRuleFacts(log);
  if (
    !Array.isArray(facts.floorStartingMoney) ||
    facts.floorStartingMoney.length !== 3 ||
    !Array.isArray(facts.cooperationRadii) ||
    facts.cooperationRadii.length !== 3
  )
    fail();
  facts.floorStartingMoney.forEach((v) => integer(v, 1));
  facts.cooperationRadii.forEach((v) => number(v));
  integer(facts.scoreStorageDecimals);
  if (facts.scoreStorageDecimals > 8) fail();
  const knownRules = log.rulesVersion === '20-personality-client-1-818e3e55';
  let previous: RuntimePlayerState[] | null = null;
  log.rooms.forEach((r, index) => {
    const s = r.settlement;
    if (
      !s ||
      r.seed !== log.seed ||
      r.location !== `F${Math.floor(index / 5) + 1}-R${(index % 5) + 1}` ||
      !['live', 'save-reconstruction', 'checkpoint-reconstruction'].includes(
        r.source,
      )
    )
      fail();
    text(r.build);
    if (
      r.locator &&
      r.locator !== replayRoomLocator(log, { ...r, locator: undefined })
    )
      fail();
    if (
      s.room.floorIndex !== Math.floor(index / 5) ||
      s.room.roomIndex !== index % 5 ||
      !['normal', 'treasure', 'shop', 'hidden', 'boss'].includes(s.room.kind) ||
      !Array.isArray(s.room.rewards) ||
      s.room.rewards.length !== 2
    )
      fail();
    s.room.rewards.forEach((reward, i) => {
      if (
        reward.group !== ['A', 'B'][i] ||
        !itemIds.has(reward.itemId) ||
        typeof reward.hidden !== 'boolean'
      )
        fail();
    });
    players(s.playersBefore);
    players(s.players);
    equal(r.previousPlayers, previous);
    if (s.playersBefore[0]!.characterId !== log.characterId) fail();
    events(r.entryEvents, knownRules);
    events(s.events, knownRules);
    if (!Array.isArray(s.turns) || s.turns.length !== 20) fail();
    equal(
      s.turns.map((t) => t.playerId),
      playerIds,
    );
    if (
      !Array.isArray(s.resolvedActions) ||
      s.resolvedActions.length !==
        s.turns.reduce((n, t) => n + t.actions.length, 0)
    )
      fail();
    let actionCursor = 0;
    for (const t of s.turns) {
      if (
        !Array.isArray(t.actions) ||
        t.actions.length < 1 ||
        t.actions.length > 2
      )
        fail();
      const before = s.playersBefore.find((p) => p.id === t.playerId)!;
      for (const [actionIndex, action] of t.actions.entries()) {
        if (!action || !['bid', 'disrupt', 'withdraw'].includes(action.type))
          fail();
        if (action.type !== 'withdraw') {
          integer(action.amount, 1);
          if (
            action.amount > before.money ||
            (action.group !== 'A' && action.group !== 'B')
          )
            fail();
        }
        const resolved = s.resolvedActions[actionCursor++];
        if (
          !resolved ||
          resolved.playerId !== t.playerId ||
          resolved.actionIndex !== actionIndex
        )
          fail();
        equal(resolved.action, action);
        integer(resolved.actualCost);
        for (const equivalent of [
          resolved.marketEquivalent,
          resolved.scoringEquivalent,
        ])
          if (equivalent !== null) number(equivalent);
        if (
          action.type === 'withdraw' &&
          (resolved.actualCost !== 0 ||
            resolved.marketEquivalent !== null ||
            resolved.scoringEquivalent !== null)
        )
          fail();
      }
    }
    const marketActions = s.resolvedActions.filter(
      (a) => a.marketEquivalent !== null,
    );
    if (marketActions.length === 0) {
      if (s.baseline !== null) fail();
    } else {
      if (!s.baseline || s.baseline.participantCount !== marketActions.length)
        fail();
      Object.values(s.baseline).forEach((v) => number(v));
      near(
        s.baseline.totalMarketEquivalent,
        marketActions.reduce((n, a) => n + a.marketEquivalent!, 0),
      );
      near(
        s.baseline.meanMarketBid,
        round(s.baseline.totalMarketEquivalent / marketActions.length, 4),
      );
    }
    if (
      !Array.isArray(r.aiChoices) ||
      r.aiChoices.length !== 19 ||
      new Set(r.aiChoices.map((c) => c.playerId)).size !== 19 ||
      r.aiChoices.some(
        (c) =>
          !playerIds.slice(1).includes(c.playerId) ||
          ![
            'high_bid',
            'cooperate',
            'disrupt_high',
            'disrupt_cooperate',
            'withdraw',
          ].includes(c.strategy),
      )
    )
      fail();
    if (
      !Array.isArray(s.awards) ||
      s.awards.length > 40 ||
      !Array.isArray(s.entitlements) ||
      s.entitlements.length > 40
    )
      fail();
    for (const a of s.awards) {
      integer(a.copies, 1);
      if (
        a.copies > 2 ||
        !playerIds.includes(a.playerId) ||
        !s.room.rewards.some(
          (r) => r.group === a.group && r.itemId === a.itemId,
        )
      )
        fail();
    }
    equal(Object.keys(s.roomScoreSummaries).sort(), [...playerIds].sort());
    equal(
      Object.keys(s.scoreBreakdowns).sort(),
      s.baseline ? [...playerIds].sort() : [],
    );
    for (const p of s.players) {
      const before = s.playersBefore.find((b) => b.id === p.id)!,
        summary = s.roomScoreSummaries[p.id]!;
      Object.values(summary).forEach((v) => number(v));
      const b = s.scoreBreakdowns[p.id];
      if (summary.initialScore !== (b?.score ?? 0)) fail();
      near(
        summary.finalScore,
        round(
          summary.initialScore + summary.retroactiveScore,
          facts.scoreStorageDecimals,
        ),
      );
      near(
        p.score,
        round(before.score + summary.finalScore, facts.scoreStorageDecimals),
      );
      if (b) {
        number(b.score);
        number(b.multiplier);
        if (typeof b.cleared !== 'boolean' || (b.cleared && b.score !== 0))
          fail();
        if (
          !Array.isArray(b.actions) ||
          b.actions.length !==
            s.turns.find((t) => t.playerId === p.id)!.actions.length ||
          !Array.isArray(b.triggers) ||
          b.triggers.length > 4000
        )
          fail();
        b.actions.forEach((a, i) => {
          if (a.playerId !== p.id || a.actionIndex !== i) fail();
          for (const v of [a.baseScore, a.additiveScore, a.subtotal]) number(v);
          if (a.scoringValue !== null) number(a.scoringValue);
        });
        b.triggers.forEach((t) => {
          if (!itemIds.has(t.itemId)) fail();
          text(t.kind);
          if (t.amount !== undefined) number(t.amount);
        });
      }
      const cost = s.resolvedActions
        .filter((a) => a.playerId === p.id)
        .reduce((n, a) => n + a.actualCost, 0);
      if (cost > before.money) fail();
      const delta = moneyDelta(s.events, p.id);
      if (delta !== null) near(p.money, before.money - cost + delta);
      if (previous) {
        const prior = previous.find((q) => q.id === p.id)!,
          entryDelta = moneyDelta(r.entryEvents, p.id);
        const resetBase =
          s.room.roomIndex === 0
            ? before.characterFloorStartingMoney!
            : prior.money;
        if (entryDelta !== null) near(before.money, resetBase + entryDelta);
        near(before.score, prior.score);
        equal(before.items, prior.items);
      }
      const added = p.items.slice(before.items.length);
      equal(p.items.slice(0, before.items.length), before.items);
      const awards = s.awards.filter((a) => a.playerId === p.id);
      const expectedItems = awards.flatMap((a) =>
        Array<string>(a.copies).fill(a.itemId),
      );
      equal(
        added.map((i) => i.itemId),
        expectedItems,
      );
      if (
        p.characterId !== before.characterId ||
        p.characterFloorStartingMoney !== before.characterFloorStartingMoney ||
        p.isHuman !== before.isHuman
      )
        fail();
    }
    for (const e of s.entitlements) {
      if (
        !playerIds.includes(e.playerId) ||
        !['A', 'B'].includes(e.group) ||
        !Array.isArray(e.sources) ||
        !e.sources.length ||
        e.sources.length > 20
      )
        fail();
      e.sources.forEach((v) => text(v));
    }
    for (const placements of [s.highPricePlacements, s.cooperationPlacements]) {
      if (!Array.isArray(placements) || placements.length > 40) fail();
      for (const p of placements)
        if (
          !s.turns.some(
            (t) =>
              t.playerId === p.playerId &&
              t.actions.some(
                (a) =>
                  a.type !== 'withdraw' &&
                  a.type === p.actionType &&
                  a.group === p.group,
              ),
          )
        )
          fail();
    }
    if (
      !Array.isArray(s.transcendenceRedemptions) ||
      s.transcendenceRedemptions.length > 40 ||
      s.transcendenceRedemptions.some(
        (r) =>
          !playerIds.includes(r.playerId) ||
          !['A', 'B'].includes(r.group) ||
          !['highest', 'cooperation'].includes(r.slotType),
      )
    )
      fail();
    previous = s.players;
  });
  if (log.final !== null) {
    const final = log.final;
    if (!final || log.rooms.length !== 15) fail();
    text(final.build);
    players(final.players);
    equal(final.players, previous);
    if (
      !Array.isArray(final.ranking) ||
      final.ranking.length !== 20 ||
      new Set(final.ranking.map((p) => p.playerId)).size !== 20
    )
      fail();
    equal(Object.keys(final.crownMultipliers).sort(), [...playerIds].sort());
    final.ranking.forEach((p, i) => {
      if (!playerIds.includes(p.playerId)) fail();
      number(p.finalScore);
      number(final.crownMultipliers[p.playerId]);
      const state = final.players.find((s) => s.id === p.playerId)!;
      near(
        p.finalScore,
        round(
          state.score * final.crownMultipliers[p.playerId]!,
          facts.scoreStorageDecimals,
        ),
      );
      if (i && final.ranking[i - 1]!.finalScore < p.finalScore) fail();
    });
  }
  return log;
}
