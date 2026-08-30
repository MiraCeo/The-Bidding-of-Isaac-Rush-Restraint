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
  cooperationZoneRadius: number;
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

export interface CooperationPlacement {
  playerId: PlayerId;
  distance: number;
  receivesReward: boolean;
  vacancyReason?: 'disruptor';
}

export interface GroupRewardSettlement {
  group: RewardGroup;
  highestBidderId: PlayerId | null;
  cooperationPopulation: number;
  cooperationSlotCount: number;
  cooperationPlacements: CooperationPlacement[];
  rewardRecipientIds: PlayerId[];
}
