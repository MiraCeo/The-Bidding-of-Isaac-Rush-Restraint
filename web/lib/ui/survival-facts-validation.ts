import { survivalFactsV1Mechanics as survivalMechanics } from './survival-facts-v1';
import { isSurvivalDifficulty } from '../game/survival-difficulty';
import type { RuntimePlayerState, SettlementEvent } from '../game/item-types';
import {
  calculateSurvivalFloorScore,
  validateSurvivalStoredScore,
} from '../game/survival-floor';
import {
  resolveSurvivalPlanFacts,
  rankSurvivalFacts,
} from '../game/survival-results';
import {
  maximumSurvivalFloors,
  validateSurvivalRules,
} from '../game/survival-rules';
import type { SurvivalReplayLog, SurvivalRuleFacts } from './survival-record';
import { survivalCompatibility, survivalMatchId } from './survival-record';
import { toEventFact } from './replay-event-facts';
import { copySnapshot } from '../shared/json-facts';
import {
  array,
  equal,
  fail,
  integer,
  keys,
  near,
  number,
  text,
} from './survival-json';

const rosterIds = [
  'human',
  ...Array.from({ length: 19 }, (_, index) => `ai-${index + 1}`),
];
const strategies = [
  'high_bid',
  'cooperate',
  'disrupt_high',
  'disrupt_cooperate',
  'withdraw',
];
const eventTypes = [
  'cost',
  'score',
  'entitlement',
  'refund',
  'destroy',
  'duplicate',
  'award',
  'money',
  'trigger',
];
const ruleKeys = [
  'initialPlayerCount',
  'roomsPerFloor',
  'floorStartingMoney',
  'minimumEliminations',
  'finalSurvivorCount',
  'moneyExchangeRatio',
  'scoreInheritanceRatio',
  'scoreStorageDecimals',
];
const roomRuleKeys = [
  'playerCount',
  'roomsPerFloor',
  'floorStartingMoney',
  'disruptionMaxMoneyRatio',
  'disruptionMarketMultiplier',
  'disruptionScoringMultiplier',
  'highPriceWinnerRatio',
  'baselineMeanMultiplier',
  'targetConstantRatio',
  'maximumBaseScore',
  'scoreSigmaRatio',
  'cooperationZoneRatio',
  'scoreStorageDecimals',
  'scoreDisplayDecimals',
  'roomScoreMultipliers',
];

export function validateSurvivalRuleFacts(facts: SurvivalRuleFacts): void {
  keys(facts, [
    'engineVersion',
    'parameters',
    'mechanics',
    'roomRules',
    'items',
    'characters',
  ]);
  text(facts.engineVersion);
  if (!/^[a-z0-9-]+$/.test(facts.engineVersion)) fail();
  keys(
    facts.parameters,
    ['rules', 'cutLines', 'bossRewards'],
    ['aiDifficulty', 'aiPolicy'],
  );
  if (
    Object.hasOwn(facts.parameters, 'aiPolicy') &&
    (facts.parameters.aiPolicy !== 'role-aware-1' ||
      facts.parameters.aiDifficulty === undefined)
  )
    fail('未知生存AI策略或缺少难度。');
  if (
    Object.hasOwn(facts.parameters, 'aiDifficulty') &&
    !isSurvivalDifficulty(facts.parameters.aiDifficulty)
  )
    fail('未知生存AI难度。');
  keys(facts.parameters.rules, ruleKeys);
  validateSurvivalRules(facts.parameters.rules);
  const rules = facts.parameters.rules,
    maximum = maximumSurvivalFloors(rules);
  if (
    rules.initialPlayerCount !== 20 ||
    rules.roomsPerFloor !== 5 ||
    maximum < 1 ||
    maximum > 20
  )
    fail();
  array(facts.parameters.cutLines, maximum);
  if (
    facts.parameters.cutLines.length !== maximum ||
    facts.parameters.bossRewards !== 'standard'
  )
    fail();
  facts.parameters.cutLines.forEach((value) =>
    validateSurvivalStoredScore(value, rules.scoreStorageDecimals),
  );
  equal(facts.mechanics, survivalMechanics);
  keys(facts.roomRules, roomRuleKeys);
  const common = facts.roomRules;
  equal(common.roomsPerFloor, Array(maximum).fill(5));
  equal(
    common.floorStartingMoney,
    Array(maximum).fill(rules.floorStartingMoney),
  );
  if (
    common.playerCount !== 20 ||
    common.scoreStorageDecimals !== rules.scoreStorageDecimals
  )
    fail();
  for (const key of roomRuleKeys.filter(
    (key) =>
      !['roomsPerFloor', 'floorStartingMoney', 'roomScoreMultipliers'].includes(
        key,
      ),
  ))
    number((common as unknown as Record<string, unknown>)[key]);
  if (
    common.scoreSigmaRatio <= 0 ||
    common.baselineMeanMultiplier <= 0 ||
    common.disruptionMaxMoneyRatio > 1
  )
    fail();
  integer(common.scoreDisplayDecimals);
  if (common.scoreDisplayDecimals > 8) fail();
  keys(common.roomScoreMultipliers, [
    'normal',
    'treasure',
    'shop',
    'hidden',
    'boss',
  ]);
  Object.values(common.roomScoreMultipliers).forEach((value) => number(value));
  array(facts.items, 1000);
  array(facts.characters, 100);
  const items = new Set<string>(),
    characters = new Set<string>();
  for (const item of facts.items) {
    keys(item, ['id', 'name', 'pool', 'rarity', 'effectStacks']);
    text(item.id);
    text(item.name);
    if (
      items.has(item.id) ||
      item.id === 'dark_princes_crown' ||
      !['common', 'boss', 'curse'].includes(item.pool) ||
      !['normal', 'rare'].includes(item.rarity) ||
      typeof item.effectStacks !== 'boolean'
    )
      fail();
    items.add(item.id);
  }
  if (!items.size) fail();
  for (const character of facts.characters) {
    keys(character, [
      'id',
      'name',
      'fixedStartingItems',
      'randomStartingItemCount',
    ]);
    text(character.id);
    text(character.name);
    array(character.fixedStartingItems, 100);
    integer(character.randomStartingItemCount);
    if (
      characters.has(character.id) ||
      character.fixedStartingItems.some((id) => !items.has(id)) ||
      character.randomStartingItemCount > items.size
    )
      fail();
    characters.add(character.id);
  }
  if (!characters.size) fail();
}

/** Saved arithmetic and identity validation only: no AI, RNG, room engine or progression. */
export function validateSurvivalReplayFacts(
  log: SurvivalReplayLog,
): SurvivalReplayLog {
  keys(log, [
    'mode',
    'encoding',
    'id',
    'compatibility',
    'seed',
    'characterId',
    'startedBuild',
    'ruleFacts',
    'playerNames',
    'initialPlayers',
    'initialEntryEvents',
    'rooms',
    'floors',
    'final',
  ]);
  if (log.mode !== 'survival' || log.encoding !== 'survival-facts-1') fail();
  integer(log.seed);
  if (log.seed > 0xffffffff) fail();
  text(log.startedBuild);
  text(log.compatibility);
  text(log.id, 300);
  validateSurvivalRuleFacts(log.ruleFacts);
  if (
    log.compatibility !== survivalCompatibility(log.ruleFacts) ||
    log.id !== survivalMatchId(log.seed, log.characterId, log.compatibility)
  )
    fail();
  const facts = log.ruleFacts,
    rules = facts.parameters.rules,
    common = facts.roomRules;
  const maximum = maximumSurvivalFloors(rules),
    decimals = rules.scoreStorageDecimals;
  const round = (value: number) =>
    Math.round((value + Number.EPSILON) * 10 ** decimals) / 10 ** decimals;
  const itemIds = new Set(facts.items.map((item) => item.id)),
    characterIds = new Set(facts.characters.map((character) => character.id));
  if (!characterIds.has(log.characterId)) fail();
  keys(log.playerNames, rosterIds);
  Object.values(log.playerNames).forEach((name) => text(name));
  const instances = new Map<
    string,
    { owner: string; itemId: string; acquiredOrder: number }
  >();

  function players(
    value: RuntimePlayerState[],
    expected: readonly string[],
  ): void {
    array(value, 20);
    equal(
      value.map((player) => player?.id),
      expected,
    );
    for (const player of value) {
      keys(player, [
        'id',
        'money',
        'score',
        'isHuman',
        'characterId',
        'characterFloorStartingMoney',
        'items',
        'temporaryShields',
        'persistentShields',
        'triggeredCollarsThisFloor',
      ]);
      if (
        player.isHuman !== (player.id === 'human') ||
        !characterIds.has(player.characterId!)
      )
        fail();
      integer(player.money);
      validateSurvivalStoredScore(player.score, decimals);
      integer(player.characterFloorStartingMoney, 1);
      integer(player.temporaryShields);
      integer(player.persistentShields);
      array(player.items, 2000);
      array(player.triggeredCollarsThisFloor, 2000);
      const local = new Set<string>();
      for (const item of player.items) {
        keys(item, ['instanceId', 'itemId', 'acquiredOrder']);
        text(item.instanceId);
        integer(item.acquiredOrder, 1);
        if (!itemIds.has(item.itemId) || local.has(item.instanceId)) fail();
        local.add(item.instanceId);
        const entry = {
          owner: player.id,
          itemId: item.itemId,
          acquiredOrder: item.acquiredOrder,
        };
        if (instances.has(item.instanceId))
          equal(instances.get(item.instanceId), entry);
        else instances.set(item.instanceId, entry);
      }
      if (
        new Set(player.triggeredCollarsThisFloor).size !==
          player.triggeredCollarsThisFloor.length ||
        player.triggeredCollarsThisFloor.some(
          (id) =>
            !player.items.some(
              (item) =>
                item.instanceId === id && item.itemId === 'guppys_collar',
            ),
        )
      )
        fail();
    }
  }

  function events(value: SettlementEvent[], active: readonly string[]): void {
    array(value, 4000);
    for (const event of value) {
      keys(
        event,
        ['type', 'playerId', 'message'],
        ['amount', 'group', 'itemId', 'effectItemId'],
      );
      if (!eventTypes.includes(event.type) || !active.includes(event.playerId))
        fail();
      text(event.message, 10000);
      if (event.group !== undefined && !['A', 'B'].includes(event.group))
        fail();
      if (event.itemId !== undefined && !itemIds.has(event.itemId)) fail();
      if (event.effectItemId !== undefined && !itemIds.has(event.effectItemId))
        fail();
      if (event.amount !== undefined)
        number(event.amount, -Number.MAX_SAFE_INTEGER);
      const fact = toEventFact(event);
      if (fact.reason === 'legacy') fail('生存回放包含此编码无法解释的事件。');
      if (
        fact.targetPlayerId &&
        (!active.includes(fact.targetPlayerId) ||
          fact.targetPlayerId === event.playerId)
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
  function moneyDelta(value: SettlementEvent[], id: string): number {
    let delta = 0;
    for (const event of value) {
      const fact = toEventFact(event);
      if (fact.reason === 'bag_transfer') {
        if (fact.playerId === id) delta += fact.amount!;
        if (fact.targetPlayerId === id) delta -= fact.amount!;
      } else if (
        fact.playerId === id &&
        [
          'shield_refund',
          'bag_refund',
          'interest_floor',
          'interest_room',
          'collar_recovery',
        ].includes(fact.reason)
      )
        delta += fact.amount!;
    }
    return delta;
  }

  players(log.initialPlayers, rosterIds);
  if (
    log.initialPlayers[0]!.characterId !== log.characterId ||
    log.initialPlayers.some((player) => player.score !== 0)
  )
    fail();
  events(log.initialEntryEvents, rosterIds);
  array(log.rooms, maximum * 5);
  array(log.floors, maximum);
  let active = [...rosterIds],
    terminal = false,
    floorCursor = 0;
  const roster = new Map(
    log.initialPlayers.map((player) => [player.id, player]),
  );
  const priorSurvival = Object.fromEntries(rosterIds.map((id) => [id, 0]));
  const cumulative = Object.fromEntries(rosterIds.map((id) => [id, 0]));
  const eliminated: NonNullable<SurvivalReplayLog['final']>['eliminated'] = {};

  for (const [index, room] of log.rooms.entries()) {
    if (terminal) fail('生存回放在结束阈值后仍有房间。');
    const floor = Math.floor(index / 5),
      ordinal = index % 5;
    if (ordinal === 0 && floor !== floorCursor)
      fail('生存回放缺少前一层淘汰事实。');
    keys(room, [
      'build',
      'room',
      'turns',
      'playersBefore',
      'players',
      'baseline',
      'resolvedActions',
      'scoreBreakdowns',
      'roomScoreSummaries',
      'entitlements',
      'awards',
      'events',
      'cooperationPlacements',
      'highPricePlacements',
      'transcendenceRedemptions',
      'entryEvents',
      'activePlayerIds',
      'aiChoices',
    ]);
    text(room.build);
    equal(room.activePlayerIds, active);
    keys(room.room, ['floorIndex', 'roomIndex', 'kind', 'rewards']);
    if (
      room.room.floorIndex !== floor ||
      room.room.roomIndex !== ordinal ||
      !['normal', 'treasure', 'shop', 'hidden', 'boss'].includes(
        room.room.kind,
      ) ||
      (ordinal === 4 && room.room.kind !== 'boss')
    )
      fail();
    array(room.room.rewards, 2);
    if (room.room.rewards.length !== 2) fail();
    room.room.rewards.forEach((reward, i) => {
      keys(reward, ['group', 'itemId', 'hidden']);
      if (
        reward.group !== ['A', 'B'][i] ||
        !itemIds.has(reward.itemId) ||
        reward.hidden !== (room.room.kind === 'treasure' && i === 1)
      )
        fail();
    });
    if (room.room.rewards[0].itemId === room.room.rewards[1].itemId) fail();
    players(room.playersBefore, active);
    players(room.players, active);
    events(room.entryEvents, active);
    events(room.events, active);
    if (index === 0) {
      equal(room.playersBefore, log.initialPlayers);
      equal(room.entryEvents, log.initialEntryEvents);
    }
    array(room.turns, 20);
    equal(
      room.turns.map((turn) => turn.playerId),
      active,
    );
    array(room.resolvedActions, 40);
    let actionCursor = 0;
    for (const turn of room.turns) {
      keys(turn, ['playerId', 'actions']);
      array(turn.actions, 2);
      if (!turn.actions.length) fail();
      const before = room.playersBefore.find(
        (player) => player.id === turn.playerId,
      )!;
      for (const [actionIndex, action] of turn.actions.entries()) {
        keys(
          action,
          action.type === 'withdraw' ? ['type'] : ['type', 'group', 'amount'],
        );
        if (!['bid', 'disrupt', 'withdraw'].includes(action.type)) fail();
        if (action.type !== 'withdraw') {
          integer(action.amount, 1);
          if (
            action.amount > before.money ||
            !['A', 'B'].includes(action.group) ||
            (action.type === 'disrupt' &&
              action.amount >
                Math.floor(before.money * common.disruptionMaxMoneyRatio))
          )
            fail();
        }
        const resolved = room.resolvedActions[actionCursor++];
        keys(resolved, [
          'playerId',
          'action',
          'actionIndex',
          'actualCost',
          'marketEquivalent',
          'scoringEquivalent',
        ]);
        if (
          resolved.playerId !== turn.playerId ||
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
          (resolved.actualCost ||
            resolved.marketEquivalent !== null ||
            resolved.scoringEquivalent !== null)
        )
          fail();
      }
      if (turn.actions.length === 2) {
        const [a, b] = turn.actions;
        if (
          !a ||
          !b ||
          a.type === 'withdraw' ||
          b.type === 'withdraw' ||
          a.type !== b.type ||
          a.group === b.group ||
          !before.items.some(
            (item) =>
              item.itemId ===
              (a.type === 'bid' ? 'more_options' : 'more_options_question'),
          ) ||
          (a.type === 'bid' &&
            a.amount + b.amount > Math.floor(before.money * 0.5))
        )
          fail();
      }
    }
    if (actionCursor !== room.resolvedActions.length) fail();
    const market = room.resolvedActions.filter(
      (action) => action.marketEquivalent !== null,
    );
    if (!market.length) {
      if (room.baseline !== null) fail();
    } else {
      keys(room.baseline, [
        'participantCount',
        'totalMarketEquivalent',
        'meanMarketBid',
        'floorConstant',
        'target',
      ]);
      if (room.baseline!.participantCount !== market.length) fail();
      Object.values(room.baseline!).forEach((value) => number(value));
      const total = market.reduce(
        (sum, action) => sum + action.marketEquivalent!,
        0,
      );
      near(room.baseline!.totalMarketEquivalent, total);
      near(
        room.baseline!.meanMarketBid,
        Math.round((total / market.length + Number.EPSILON) * 1e4) / 1e4,
      );
      near(
        room.baseline!.floorConstant,
        Math.round(
          (rules.floorStartingMoney * common.targetConstantRatio +
            Number.EPSILON) *
            1e4,
        ) / 1e4,
      );
      near(
        room.baseline!.target,
        Math.round(
          (common.baselineMeanMultiplier * room.baseline!.meanMarketBid +
            room.baseline!.floorConstant +
            Number.EPSILON) *
            1e4,
        ) / 1e4,
      );
    }
    array(room.aiChoices, 19);
    equal(
      room.aiChoices.map((choice) => choice.playerId),
      active.filter((id) => id !== 'human'),
    );
    for (const choice of room.aiChoices) {
      keys(choice, ['playerId', 'strategy']);
      if (!strategies.includes(choice.strategy)) fail();
    }
    keys(room.roomScoreSummaries, active);
    keys(room.scoreBreakdowns, room.baseline ? active : []);
    array(room.awards, 40);
    array(room.entitlements, 40);
    for (const award of room.awards) {
      keys(award, ['playerId', 'group', 'itemId', 'copies']);
      integer(award.copies, 1);
      if (
        !active.includes(award.playerId) ||
        award.copies > 2 ||
        !room.room.rewards.some(
          (reward) =>
            reward.group === award.group && reward.itemId === award.itemId,
        )
      )
        fail();
    }
    for (const entitlement of room.entitlements) {
      keys(entitlement, ['playerId', 'group', 'sources']);
      array(entitlement.sources, 20);
      if (
        !active.includes(entitlement.playerId) ||
        !['A', 'B'].includes(entitlement.group) ||
        !entitlement.sources.length
      )
        fail();
      entitlement.sources.forEach((source) => text(source));
    }
    for (const placements of [
      room.cooperationPlacements,
      room.highPricePlacements,
    ]) {
      array(placements, 40);
      for (const placement of placements) {
        keys(placement, ['playerId', 'group', 'actionType']);
        if (
          !room.turns.some(
            (turn) =>
              turn.playerId === placement.playerId &&
              turn.actions.some(
                (action) =>
                  action.type !== 'withdraw' &&
                  action.type === placement.actionType &&
                  action.group === placement.group,
              ),
          )
        )
          fail();
      }
    }
    array(room.transcendenceRedemptions, 40);
    for (const redemption of room.transcendenceRedemptions) {
      keys(redemption, ['playerId', 'group', 'slotType']);
      if (
        !active.includes(redemption.playerId) ||
        !['A', 'B'].includes(redemption.group) ||
        !['highest', 'cooperation'].includes(redemption.slotType)
      )
        fail();
    }
    for (const after of room.players) {
      const before = room.playersBefore.find(
          (player) => player.id === after.id,
        )!,
        prior = roster.get(after.id)!;
      equal(before.items, prior.items);
      near(before.score, prior.score);
      if (
        before.characterId !== prior.characterId ||
        (ordinal > 0 &&
          before.characterFloorStartingMoney !==
            prior.characterFloorStartingMoney)
      )
        fail();
      const resetBase =
        ordinal === 0 ? before.characterFloorStartingMoney! : prior.money;
      near(before.money, resetBase + moneyDelta(room.entryEvents, after.id));
      const summary = room.roomScoreSummaries[after.id]!;
      keys(summary, [
        'initialScore',
        'retroactiveScore',
        'finalScore',
        'retroactiveMultiplier',
      ]);
      Object.values(summary).forEach((value) => number(value));
      for (const value of [
        summary.initialScore,
        summary.retroactiveScore,
        summary.finalScore,
      ])
        validateSurvivalStoredScore(value, decimals);
      const breakdown = room.scoreBreakdowns[after.id];
      if (summary.initialScore !== (breakdown?.score ?? 0)) fail();
      near(
        summary.finalScore,
        round(summary.initialScore + summary.retroactiveScore),
      );
      near(after.score, round(before.score + summary.finalScore));
      if (breakdown) {
        keys(breakdown, [
          'actions',
          'multiplier',
          'cleared',
          'score',
          'triggers',
        ]);
        number(breakdown.multiplier);
        number(breakdown.score);
        if (
          typeof breakdown.cleared !== 'boolean' ||
          (breakdown.cleared && breakdown.score !== 0)
        )
          fail();
        array(breakdown.actions, 2);
        array(breakdown.triggers, 4000);
        if (
          breakdown.actions.length !==
          room.turns.find((turn) => turn.playerId === after.id)!.actions.length
        )
          fail();
        breakdown.actions.forEach((action, i) => {
          keys(action, [
            'playerId',
            'actionIndex',
            'scoringValue',
            'baseScore',
            'additiveScore',
            'subtotal',
          ]);
          if (action.playerId !== after.id || action.actionIndex !== i) fail();
          for (const value of [
            action.baseScore,
            action.additiveScore,
            action.subtotal,
          ])
            number(value);
          if (action.scoringValue !== null) number(action.scoringValue);
        });
        for (const trigger of breakdown.triggers) {
          keys(trigger, ['itemId', 'kind'], ['amount']);
          text(trigger.kind);
          if (!itemIds.has(trigger.itemId)) fail();
          if (trigger.amount !== undefined) number(trigger.amount);
        }
      }
      const cost = room.resolvedActions
        .filter((action) => action.playerId === after.id)
        .reduce((sum, action) => sum + action.actualCost, 0);
      if (cost > before.money) fail();
      near(
        after.money,
        before.money - cost + moneyDelta(room.events, after.id),
      );
      equal(after.items.slice(0, before.items.length), before.items);
      equal(
        after.items.slice(before.items.length).map((item) => item.itemId),
        room.awards
          .filter((award) => award.playerId === after.id)
          .flatMap((award) => Array<string>(award.copies).fill(award.itemId)),
      );
      if (
        after.characterId !== before.characterId ||
        after.characterFloorStartingMoney !== before.characterFloorStartingMoney
      )
        fail();
      roster.set(after.id, after);
    }
    if (ordinal === 4 && log.floors[floorCursor]) {
      const layer = log.floors[floorCursor]!;
      keys(layer, [
        'build',
        'floorIndex',
        'cutLine',
        'activePlayerIds',
        'scores',
        'plan',
        'resolution',
      ]);
      text(layer.build);
      equal(layer.activePlayerIds, active);
      keys(layer.scores, active);
      if (
        layer.floorIndex !== floorCursor ||
        layer.cutLine !== facts.parameters.cutLines[floorCursor]
      )
        fail();
      for (const id of active) {
        const expected = calculateSurvivalFloorScore(
          {
            finalRoomScores: log.rooms
              .slice(index - 4, index + 1)
              .map((record) => record.roomScoreSummaries[id]!.finalScore),
            remainingMoney: roster.get(id)!.money,
            previousSurvivalScore: priorSurvival[id]!,
          },
          rules,
        );
        equal(layer.scores[id], expected);
        cumulative[id] = round(cumulative[id]! + expected.newScore);
        validateSurvivalStoredScore(cumulative[id]!, decimals);
        priorSurvival[id] = expected.survivalScore;
      }
      keys(layer.resolution, ['reason', 'tieBreaks']);
      array(layer.resolution.tieBreaks, 20);
      layer.resolution.tieBreaks.forEach((tie) => {
        keys(tie, ['playerId', 'value']);
        text(tie.playerId);
        number(tie.value);
      });
      const expected = resolveSurvivalPlanFacts(
        active.map((id) => ({
          playerId: id,
          survivalScore: layer.scores[id]!.survivalScore,
        })),
        layer.cutLine,
        rules,
        layer.resolution.tieBreaks,
      );
      equal(layer.plan, expected.plan);
      equal(layer.resolution, {
        reason: expected.reason,
        tieBreaks: expected.tieBreaks,
      });
      for (const elimination of layer.plan.eliminations)
        eliminated[elimination.playerId] = {
          floorIndex: floorCursor,
          reason: elimination.reason,
          score: layer.scores[elimination.playerId]!,
          cumulativeScore: cumulative[elimination.playerId]!,
        };
      active = [...layer.plan.survivorIds];
      terminal = layer.plan.shouldFinish;
      floorCursor += 1;
    }
  }
  if (floorCursor !== log.floors.length)
    fail('生存回放包含没有五房依据的层末记录。');
  if (log.final !== null) {
    if (
      !terminal ||
      !log.rooms.length ||
      log.rooms.length !== log.floors.length * 5
    )
      fail();
    const final = log.final;
    keys(final, [
      'build',
      'players',
      'activePlayerIds',
      'eliminated',
      'cumulativeScores',
      'ranking',
      'championId',
      'reason',
    ]);
    text(final.build);
    players(final.players, rosterIds);
    equal(
      final.players,
      rosterIds.map((id) => roster.get(id)),
    );
    equal(final.activePlayerIds, active);
    equal(final.eliminated, eliminated);
    equal(final.cumulativeScores, cumulative);
    array(final.ranking, 20);
    if (final.ranking.length !== 20) fail();
    equal(
      final.ranking.map((entry) => entry.playerId).sort(),
      [...rosterIds].sort(),
    );
    for (const entry of final.ranking) {
      keys(entry, [
        'playerId',
        'eliminationFloorIndex',
        'finalScore',
        'tieBreaker',
        'rank',
        'status',
        'isChampion',
      ]);
      if (
        entry.eliminationFloorIndex !==
          (eliminated[entry.playerId]?.floorIndex ?? null) ||
        entry.finalScore !== cumulative[entry.playerId]
      )
        fail();
    }
    const expectedRanking = rankSurvivalFacts(
      final.ranking.map(
        ({ playerId, eliminationFloorIndex, finalScore, tieBreaker }) => ({
          playerId,
          eliminationFloorIndex,
          finalScore,
          tieBreaker,
        }),
      ),
      decimals,
    );
    equal(final.ranking, expectedRanking);
    if (
      final.championId !==
        (expectedRanking.find((entry) => entry.isChampion)?.playerId ?? null) ||
      final.reason !== (active.length ? 'survivor_threshold' : 'all_eliminated')
    )
      fail();
  }
  return copySnapshot(log);
}
