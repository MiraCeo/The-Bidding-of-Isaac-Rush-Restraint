export type PlayerId = string;
export type RewardGroup = 'A' | 'B';

export type PlayerAction =
  | { type: 'bid'; group: RewardGroup; amount: number }
  | { type: 'disrupt'; group: RewardGroup; amount: number }
  | { type: 'withdraw' };

export interface PlayerState {
  id: PlayerId;
  money: number;
  score: number;
  isHuman: boolean;
}

export interface RulesConfig {
  playerCount: number;
  roomsPerFloor: readonly number[];
  floorStartingMoney: readonly number[];
  disruptionMaxMoneyRatio: number;
  disruptionMarketMultiplier: number;
  disruptionScoringMultiplier: number;
  highPriceWinnerRatio: number;
  baselineMeanMultiplier: number;
  targetConstantRatio: number;
  maximumBaseScore: number;
  scoreSigmaRatio: number;
  cooperationZoneRatio: number;
  scoreStorageDecimals: number;
  scoreDisplayDecimals: number;
  roomScoreMultipliers: Readonly<{
    normal: number;
    treasure: number;
    shop: number;
    hidden: number;
    boss: number;
  }>;
}

export interface RandomSource {
  next(): number;
}

export interface SubmittedAction {
  player: PlayerState;
  action: PlayerAction;
}

export interface ActionAmounts {
  actualCost: number;
  marketEquivalent: number | null;
  scoringEquivalent: number | null;
}

export interface MarketBaseline {
  participantCount: number;
  totalMarketEquivalent: number;
  meanMarketBid: number;
  floorConstant: number;
  target: number;
}

export interface BaseScoreResult {
  scoringEquivalent: number | null;
  distance: number | null;
  sigma: number;
  score: number;
}

export interface CooperationPlacement {
  playerId: PlayerId;
  distance: number;
  receivesReward: boolean;
  vacancyReason?: 'disruptor';
}

export interface HighPricePlacement {
  playerId: PlayerId;
  marketEquivalent: number;
  receivesReward: boolean;
  vacancyReason?: 'disruptor';
}

export interface GroupRewardSettlement {
  group: RewardGroup;
  highestBidderId: PlayerId | null;
  highPriceRecipientIds: PlayerId[];
  highPricePlacements: HighPricePlacement[];
  cooperationPopulation: number;
  cooperationSlotCount: number;
  cooperationPlacements: CooperationPlacement[];
  rewardRecipientIds: PlayerId[];
}
