import type {
  GeneratedRoom,
  ItemAward,
  PlayerTurn,
  ResolvedAction,
  RuntimePlayerState,
  SettlementEvent,
} from './item-types';
import { calculateTurnScore, type TurnScoreBreakdown } from './item-scoring';
import { roundMoney } from './money';
import { checkCollarTriggers } from './room-economy';
import { cloneRuntimePlayer, hasItem } from './runtime';
import { calculateHighPriceSlotCount } from './rewards';
import { resolveTurnActions, validateTurn } from './turns';
import type { MarketBaseline, RandomSource, RewardGroup, RulesConfig } from './types';

export interface Entitlement {
  playerId: string;
  group: RewardGroup;
  sources: string[];
}

export interface RoomSettlementResult {
  players: RuntimePlayerState[];
  baseline: MarketBaseline | null;
  resolvedActions: ResolvedAction[];
  scoreBreakdowns: Record<string, TurnScoreBreakdown>;
  entitlements: Entitlement[];
  awards: ItemAward[];
  events: SettlementEvent[];
  cooperationPlacements: Array<{
    group: RewardGroup;
    playerId: string;
    actionType: 'bid' | 'disrupt';
  }>;
  highPricePlacements: Array<{
    group: RewardGroup;
    playerId: string;
    actionType: 'bid' | 'disrupt';
  }>;
  transcendenceRedemptions: Array<{
    group: RewardGroup;
    playerId: string;
    slotType: 'highest' | 'cooperation';
  }>;
}

function roundTo(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function randomChoice<T>(values: readonly T[], random: RandomSource): T | undefined {
  if (values.length === 0) return undefined;
  return values[Math.min(values.length - 1, Math.floor(random.next() * values.length))];
}

function entitlementKey(playerId: string, group: RewardGroup): string {
  return `${playerId}:${group}`;
}

function calculateRuntimeBaseline(
  actions: readonly ResolvedAction[],
  floorIndex: number,
  rules: RulesConfig,
): MarketBaseline | null {
  const values = actions.flatMap((action) =>
    action.marketEquivalent === null ? [] : [action.marketEquivalent],
  );
  if (values.length === 0) return null;
  const floorMoney = rules.floorStartingMoney[floorIndex];
  if (floorMoney === undefined) throw new RangeError(`Unknown floor index: ${floorIndex}`);
  const totalMarketEquivalent = values.reduce((sum, value) => sum + value, 0);
  const meanMarketBid = roundTo(totalMarketEquivalent / values.length, 4);
  const floorConstant = roundTo(floorMoney * rules.targetConstantRatio, 4);
  return {
    participantCount: values.length,
    totalMarketEquivalent,
    meanMarketBid,
    floorConstant,
    target: roundTo(rules.baselineMeanMultiplier * meanMarketBid + floorConstant, 4),
  };
}

function grantEntitlement(
  map: Map<string, Entitlement>,
  playerId: string,
  group: RewardGroup,
  source: string,
): void {
  const key = entitlementKey(playerId, group);
  const existing = map.get(key);
  if (existing) existing.sources.push(source);
  else map.set(key, { playerId, group, sources: [source] });
}

function nextAcquisitionOrder(players: readonly RuntimePlayerState[]): number {
  return (
    players.reduce(
      (highest, player) =>
        Math.max(highest, ...player.items.map((instance) => instance.acquiredOrder)),
      0,
    ) + 1
  );
}

export function settleRuntimeRoom(
  room: GeneratedRoom,
  players: readonly RuntimePlayerState[],
  turns: readonly PlayerTurn[],
  rules: RulesConfig,
  random: RandomSource,
): RoomSettlementResult {
  const nextPlayers = players.map(cloneRuntimePlayer);
  const playerById = new Map(nextPlayers.map((player) => [player.id, player]));
  const turnByPlayer = new Map(turns.map((turn) => [turn.playerId, turn]));
  const events: SettlementEvent[] = [];
  const resolvedActions: ResolvedAction[] = [];

  for (const player of nextPlayers) {
    const turn = turnByPlayer.get(player.id);
    if (!turn) throw new RangeError(`Missing turn for player ${player.id}.`);
    const errors = validateTurn(player, turn, rules);
    if (errors.length > 0) throw new RangeError(`${player.id}: ${errors.join(' ')}`);
    const resolved = resolveTurnActions(player, turn, rules);
    resolvedActions.push(...resolved);
    const cost = resolved.reduce((sum, action) => sum + action.actualCost, 0);
    const nominalBidCost = resolved.reduce(
      (sum, action) => sum + (action.action.type === 'bid' ? action.action.amount : action.actualCost),
      0,
    );
    if (nominalBidCost > cost && hasItem(player, 'steam_sale')) {
      events.push({
        type: 'money',
        playerId: player.id,
        amount: nominalBidCost - cost,
        itemId: 'steam_sale',
        effectItemId: 'steam_sale',
        message: `Steam大促节省 ${nominalBidCost - cost} 资金。`,
      });
    }
    player.money = roundMoney(player.money - cost);
    if (cost > 0) {
      events.push({ type: 'cost', playerId: player.id, amount: cost, message: `实际扣款 ${cost}。` });
    }
    checkCollarTriggers(player, room.floorIndex, rules, random, events);
  }

  const baseline = calculateRuntimeBaseline(resolvedActions, room.floorIndex, rules);
  const highestMarketEquivalent = resolvedActions.reduce(
    (highest, action) => Math.max(highest, action.marketEquivalent ?? 0),
    0,
  );
  const scoreBreakdowns: Record<string, TurnScoreBreakdown> = {};

  if (baseline) {
    for (const player of nextPlayers) {
      const playerActions = resolvedActions.filter((action) => action.playerId === player.id);
      const breakdown = calculateTurnScore(
        player,
        playerActions,
        baseline.target,
        highestMarketEquivalent,
        room.floorIndex,
        room.kind,
        rules,
        random,
      );
      scoreBreakdowns[player.id] = breakdown;
      player.score = roundTo(player.score + breakdown.score, rules.scoreStorageDecimals);
      events.push({
        type: 'score',
        playerId: player.id,
        amount: breakdown.score,
        message: `本房间获得 ${breakdown.score} 分。`,
      });
    }
  }

  const entitlementMap = new Map<string, Entitlement>();
  const cooperationPlacements: RoomSettlementResult['cooperationPlacements'] = [];
  const highPricePlacements: RoomSettlementResult['highPricePlacements'] = [];
  const transcendenceRedemptions: RoomSettlementResult['transcendenceRedemptions'] = [];
  if (baseline) {
    const floorMoney = rules.floorStartingMoney[room.floorIndex]!;
    const cooperationRadius = floorMoney * rules.cooperationZoneRatio;
    for (const group of ['A', 'B'] as const) {
      const groupActions = resolvedActions.filter(
        (resolved) => resolved.action.type !== 'withdraw' && resolved.action.group === group,
      );
      const rankedParticipants = groupActions
        .map((resolved) => ({ resolved, tie: random.next() }))
        .sort((left, right) =>
          (right.resolved.marketEquivalent ?? 0) - (left.resolved.marketEquivalent ?? 0) ||
          left.tie - right.tie,
        );
      const highPriceSlotCount = calculateHighPriceSlotCount(rankedParticipants.length, rules);
      for (const { resolved } of rankedParticipants.slice(0, highPriceSlotCount)) {
        const actionType = resolved.action.type === 'disrupt' ? 'disrupt' : 'bid';
        highPricePlacements.push({ group, playerId: resolved.playerId, actionType });
        const player = playerById.get(resolved.playerId)!;
        if (actionType === 'bid') {
          grantEntitlement(entitlementMap, resolved.playerId, group, 'highest');
        } else if (hasItem(player, 'transcendence') && random.next() < 0.5) {
          grantEntitlement(entitlementMap, player.id, group, 'transcendence');
          transcendenceRedemptions.push({ group, playerId: player.id, slotType: 'highest' });
        }
      }

      const cooperationCandidates = groupActions
        .map((resolved) => ({
          resolved,
          distance: Math.abs((resolved.scoringEquivalent ?? baseline.target) - baseline.target),
          tie: random.next(),
        }))
        .filter((candidate) => candidate.distance <= cooperationRadius)
        .sort((left, right) => left.distance - right.distance || left.tie - right.tie);
      const placements = cooperationCandidates.slice(0, Math.ceil(cooperationCandidates.length / 2));
      for (const candidate of placements) {
        cooperationPlacements.push({
          group,
          playerId: candidate.resolved.playerId,
          actionType: candidate.resolved.action.type === 'disrupt' ? 'disrupt' : 'bid',
        });
      }

      for (const candidate of placements) {
        const player = playerById.get(candidate.resolved.playerId)!;
        if (candidate.resolved.action.type === 'bid') {
          grantEntitlement(entitlementMap, player.id, group, 'cooperation');
        } else if (hasItem(player, 'transcendence') && random.next() < 0.5) {
          grantEntitlement(entitlementMap, player.id, group, 'transcendence');
          transcendenceRedemptions.push({ group, playerId: player.id, slotType: 'cooperation' });
        }
      }

      for (const candidate of cooperationCandidates) {
        const player = playerById.get(candidate.resolved.playerId)!;
        if (candidate.resolved.action.type === 'bid' && hasItem(player, 'lucky_foot')) {
          grantEntitlement(entitlementMap, player.id, group, 'lucky_foot');
        }
      }
    }
  }

  // Shields refund failed normal bids before curse effects destroy an earned entitlement.
  for (const player of nextPlayers) {
    const failedBids = resolvedActions.filter(
      (resolved) =>
        resolved.playerId === player.id &&
        resolved.action.type === 'bid' &&
        !entitlementMap.has(entitlementKey(player.id, resolved.action.group)),
    );
    if (failedBids.length === 0 || player.temporaryShields + player.persistentShields === 0) continue;
    const refund = failedBids.reduce((sum, action) => sum + action.actualCost, 0);
    player.money = roundMoney(player.money + refund);
    const shieldItemId = player.temporaryShields > 0 ? 'holy_mantle' : 'wooden_cross';
    if (player.temporaryShields > 0) player.temporaryShields -= 1;
    else player.persistentShields -= 1;
    events.push({
      type: 'refund',
      playerId: player.id,
      amount: refund,
      itemId: shieldItemId,
      effectItemId: shieldItemId,
      message: `屏障退回 ${refund} 实际扣款。`,
    });
  }

  // More Options destroys one of two earned rewards after shield eligibility is decided.
  for (const player of nextPlayers) {
    const turn = turnByPlayer.get(player.id)!;
    if (turn.actions.length !== 2 || turn.actions[0]?.type !== 'bid' || !hasItem(player, 'more_options')) {
      continue;
    }
    const ownedGroups = (['A', 'B'] as const).filter((group) =>
      entitlementMap.has(entitlementKey(player.id, group)),
    );
    if (ownedGroups.length === 2) {
      const destroyed = randomChoice(ownedGroups, random)!;
      entitlementMap.delete(entitlementKey(player.id, destroyed));
      events.push({
        type: 'destroy',
        playerId: player.id,
        group: destroyed,
        effectItemId: 'more_options',
        message: `更多选择随机摧毁了 ${destroyed} 组道具。`,
      });
    }
  }

  const awards: ItemAward[] = [];
  for (const entitlement of entitlementMap.values()) {
    const player = playerById.get(entitlement.playerId)!;
    let copies = 1;
    if (hasItem(player, 'guppys_tail')) {
      const roll = random.next();
      copies = roll < 1 / 3 ? 0 : roll < 2 / 3 ? 1 : 2;
    }
    const reward = room.rewards.find((candidate) => candidate.group === entitlement.group)!;
    if (copies === 0) {
      events.push({
        type: 'destroy',
        playerId: player.id,
        group: entitlement.group,
        itemId: reward.itemId,
        effectItemId: 'guppys_tail',
        message: '嗝屁猫的尾巴使道具消失。',
      });
      continue;
    }
    if (copies === 2) {
      events.push({
        type: 'duplicate',
        playerId: player.id,
        group: entitlement.group,
        itemId: reward.itemId,
        effectItemId: 'guppys_tail',
        message: '嗝屁猫的尾巴使道具翻倍。',
      });
    }
    awards.push({ playerId: player.id, group: entitlement.group, itemId: reward.itemId, copies });
  }

  let acquisitionOrder = nextAcquisitionOrder(nextPlayers);
  for (const award of awards) {
    const player = playerById.get(award.playerId)!;
    for (let copy = 0; copy < award.copies; copy += 1) {
      const instanceId = `${room.floorIndex}:${room.roomIndex}:${award.group}:${player.id}:${acquisitionOrder}`;
      player.items.push({ instanceId, itemId: award.itemId, acquiredOrder: acquisitionOrder });
      acquisitionOrder += 1;

      if (award.itemId === 'holy_mantle') player.temporaryShields += 1;
      if (award.itemId === 'wooden_cross') player.persistentShields += 1;
      if (award.itemId === 'grab_bag') {
        const source = resolvedActions.find(
          (resolved) =>
            resolved.playerId === player.id &&
            resolved.action.type !== 'withdraw' &&
            resolved.action.group === award.group,
        );
        const refund = roundMoney((source?.actualCost ?? 0) * 0.75);
        player.money = roundMoney(player.money + refund);
        events.push({
          type: 'refund',
          playerId: player.id,
          itemId: 'grab_bag',
          amount: refund,
          message: `福袋返还 ${refund} 资金。`,
        });
      }
      events.push({
        type: 'award',
        playerId: player.id,
        group: award.group,
        itemId: award.itemId,
        message: `获得道具 ${award.itemId}。`,
      });
    }

    if (award.itemId === 'guppys_collar') {
      checkCollarTriggers(player, room.floorIndex, rules, random, events);
    }
    if (award.itemId === 'moms_heart' && room.kind === 'boss') {
      const previousRoomScore = scoreBreakdowns[player.id]?.score ?? 0;
      const multiplier = 2 ** award.copies;
      const bonus = roundTo(previousRoomScore * (multiplier - 1), rules.scoreStorageDecimals);
      player.score = roundTo(player.score + bonus, rules.scoreStorageDecimals);
      events.push({
        type: 'score',
        playerId: player.id,
        itemId: 'moms_heart',
        amount: bonus,
        message: `妈妈的心脏追溯增加 ${bonus} 分。`,
      });
    }
  }

  return {
    players: nextPlayers,
    baseline,
    resolvedActions,
    scoreBreakdowns,
    entitlements: [...entitlementMap.values()],
    awards,
    events,
    cooperationPlacements,
    highPricePlacements,
    transcendenceRedemptions,
  };
}
