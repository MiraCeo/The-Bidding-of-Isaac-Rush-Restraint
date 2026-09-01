import type { ItemId, ResolvedAction, RoomKind, RuntimePlayerState } from './item-types';
import { getDoubleActionScoreMultiplier } from './characters';
import { getRoomScoreMultiplier } from './room-modifiers';
import { countItem, hasItem } from './runtime';
import type { RandomSource, RulesConfig } from './types';

function roundTo(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function exponentialScore(
  scoringValue: number,
  target: number,
  sigma: number,
  maximum: number,
): number {
  return maximum * Math.exp(-Math.abs(scoringValue - target) / sigma);
}

export interface ActionScoreBreakdown {
  playerId: string;
  actionIndex: number;
  scoringValue: number | null;
  baseScore: number;
  additiveScore: number;
  subtotal: number;
}

export interface TurnScoreBreakdown {
  actions: ActionScoreBreakdown[];
  multiplier: number;
  cleared: boolean;
  score: number;
  triggers: Array<{ itemId: ItemId; kind: string; amount?: number }>;
}

export function calculateTurnScore(
  player: RuntimePlayerState,
  actions: readonly ResolvedAction[],
  target: number,
  highestMarketEquivalent: number,
  floorIndex: number,
  roomKind: RoomKind,
  rules: RulesConfig,
  random: RandomSource,
): TurnScoreBreakdown {
  const floorMoney = rules.floorStartingMoney[floorIndex];
  if (floorMoney === undefined) throw new RangeError(`Unknown floor index: ${floorIndex}`);
  const sigma = floorMoney * rules.scoreSigmaRatio;
  const triggers: TurnScoreBreakdown['triggers'] = [];

  const actionScores = actions.map<ActionScoreBreakdown>((resolved) => {
    if (resolved.scoringEquivalent === null || resolved.action.type === 'withdraw') {
      return {
        playerId: player.id,
        actionIndex: resolved.actionIndex,
        scoringValue: null,
        baseScore: 0,
        additiveScore: 0,
        subtotal: 0,
      };
    }

    let scoringValue = resolved.scoringEquivalent;
    if (resolved.action.type === 'bid' && hasItem(player, 'brimstone')) {
      const adjusted = clamp(target, resolved.action.amount * 0.8, resolved.action.amount * 1.25);
      if (adjusted !== scoringValue) triggers.push({ itemId: 'brimstone', kind: 'scoring_adjustment' });
      scoringValue = adjusted;
    }
    if (resolved.action.type === 'disrupt' && hasItem(player, 'short_brimstone')) {
      const adjusted = clamp(target, scoringValue * 0.85, scoringValue * 1.2);
      if (adjusted !== scoringValue) {
        triggers.push({ itemId: 'short_brimstone', kind: 'scoring_adjustment' });
      }
      scoringValue = adjusted;
    }

    const baseScore = exponentialScore(scoringValue, target, sigma, rules.maximumBaseScore);
    let additiveScore = 0;
    additiveScore += countItem(player, 'score_charm') * 10;
    if (countItem(player, 'score_charm') > 0) {
      triggers.push({ itemId: 'score_charm', kind: 'additive_score', amount: countItem(player, 'score_charm') * 10 });
    }
    additiveScore += countItem(player, 'blood_of_the_martyr') * 20;
    if (countItem(player, 'blood_of_the_martyr') > 0) {
      triggers.push({ itemId: 'blood_of_the_martyr', kind: 'additive_score', amount: countItem(player, 'blood_of_the_martyr') * 20 });
    }
    const poorCharmValue = player.money < floorMoney * 0.3 ? 20 : 5;
    additiveScore += countItem(player, 'poor_charm') * poorCharmValue;
    if (countItem(player, 'poor_charm') > 0) {
      triggers.push({ itemId: 'poor_charm', kind: 'additive_score', amount: countItem(player, 'poor_charm') * poorCharmValue });
    }
    const knifeScore =
      countItem(player, 'moms_knife') *
      exponentialScore(scoringValue, highestMarketEquivalent / 4, sigma, 50);
    additiveScore += knifeScore;
    if (knifeScore > 0) triggers.push({ itemId: 'moms_knife', kind: 'additive_score', amount: knifeScore });

    return {
      playerId: player.id,
      actionIndex: resolved.actionIndex,
      scoringValue,
      baseScore,
      additiveScore,
      subtotal: baseScore + additiveScore,
    };
  });

  let multiplier = getRoomScoreMultiplier(roomKind, rules.roomScoreMultipliers);
  const sacredHeartCount = countItem(player, 'sacred_heart');
  const pentagramCount = countItem(player, 'pentagram');
  const momsHeartCount = countItem(player, 'moms_heart');
  multiplier *= 1.5 ** sacredHeartCount;
  multiplier *= 1.25 ** pentagramCount;
  if (roomKind === 'boss') multiplier *= 2 ** momsHeartCount;
  if (sacredHeartCount > 0) triggers.push({ itemId: 'sacred_heart', kind: 'multiplier_applied' });
  if (pentagramCount > 0) triggers.push({ itemId: 'pentagram', kind: 'multiplier_applied' });
  if (roomKind === 'boss' && momsHeartCount > 0) {
    triggers.push({ itemId: 'moms_heart', kind: 'boss_multiplier_applied' });
  }
  if (actions.length === 2) multiplier *= getDoubleActionScoreMultiplier(player);

  for (let index = 0; index < countItem(player, 'd6'); index += 1) {
    if (random.next() < 1 / 6) {
      multiplier *= 2;
      triggers.push({ itemId: 'd6', kind: 'double_score' });
    }
  }

  let cleared = false;
  for (let index = 0; index < countItem(player, 'eternal_d6'); index += 1) {
    multiplier *= 1.5;
    if (random.next() < 0.25) {
      cleared = true;
      triggers.push({ itemId: 'eternal_d6', kind: 'clear_score' });
    }
  }

  const babylonCount = countItem(player, 'whore_of_babylon');
  if (babylonCount > 0) {
    multiplier *= 1.25 ** babylonCount;
    triggers.push({ itemId: 'whore_of_babylon', kind: 'multiplier_applied' });
    if (
      actions.some(
        (resolved) =>
          resolved.action.type === 'bid' && resolved.action.amount < target,
      )
    ) {
      cleared = true;
      triggers.push({ itemId: 'whore_of_babylon', kind: 'clear_score' });
    }
  }

  const subtotal = actionScores.reduce((sum, action) => sum + action.subtotal, 0);
  return {
    actions: actionScores.map((action) => ({
      ...action,
      baseScore: roundTo(action.baseScore, rules.scoreStorageDecimals),
      additiveScore: roundTo(action.additiveScore, rules.scoreStorageDecimals),
      subtotal: roundTo(action.subtotal, rules.scoreStorageDecimals),
    })),
    multiplier,
    cleared,
    score: cleared ? 0 : roundTo(subtotal * multiplier, rules.scoreStorageDecimals),
    triggers,
  };
}

export function calculateFinalScore(player: RuntimePlayerState): number {
  const crownCount = countItem(player, 'dark_princes_crown');
  if (crownCount === 0) return player.score;
  const otherItems = player.items.length - crownCount;
  const crownMultiplier = Math.max(0.9, 1.4 - otherItems * 0.05);
  return roundTo(player.score * crownMultiplier ** crownCount, 4);
}
