import type { PlayerAction, PlayerState, RewardGroup } from './types';

export type ItemPool = 'common' | 'boss' | 'curse';
export type ItemRarity = 'normal' | 'rare';

export type CharacterId = 'isaac' | 'lost' | 'azazel' | 'eden' | 'jacob_esau';

export type ItemId =
  | 'moms_knife'
  | 'sacred_heart'
  | 'brimstone'
  | 'moms_heart'
  | 'lucky_foot'
  | 'transcendence'
  | 'short_brimstone'
  | 'pentagram'
  | 'guppys_collar'
  | 'holy_mantle'
  | 'twenty_twenty'
  | 'blood_of_the_martyr'
  | 'steam_sale'
  | 'money_bag'
  | 'poor_charm'
  | 'grab_bag'
  | 'score_charm'
  | 'interest'
  | 'd6'
  | 'wooden_cross'
  | 'more_options'
  | 'more_options_question'
  | 'dark_princes_crown'
  | 'eternal_d6'
  | 'whore_of_babylon'
  | 'guppys_tail';

export interface ItemDefinition {
  id: ItemId;
  name: string;
  pool: ItemPool;
  rarity: ItemRarity;
  effectStacks: boolean;
}

export interface ItemInstance {
  instanceId: string;
  itemId: ItemId;
  acquiredOrder: number;
}

export interface RuntimePlayerState extends PlayerState {
  characterId: CharacterId | null;
  items: ItemInstance[];
  temporaryShields: number;
  persistentShields: number;
  triggeredCollarsThisFloor: string[];
}

export type RoomKind = 'normal' | 'treasure' | 'shop' | 'hidden' | 'boss';

export interface RoomReward {
  group: RewardGroup;
  itemId: ItemId;
  hidden: boolean;
}

export interface GeneratedRoom {
  floorIndex: number;
  roomIndex: number;
  kind: RoomKind;
  rewards: readonly [RoomReward, RoomReward];
}

export interface PlayerTurn {
  playerId: string;
  actions: PlayerAction[];
}

export interface ResolvedAction {
  playerId: string;
  action: PlayerAction;
  actionIndex: number;
  actualCost: number;
  marketEquivalent: number | null;
  scoringEquivalent: number | null;
}

export interface ItemAward {
  playerId: string;
  group: RewardGroup;
  itemId: ItemId;
  copies: number;
}

export interface SettlementEvent {
  type:
    | 'cost'
    | 'score'
    | 'entitlement'
    | 'refund'
    | 'destroy'
    | 'duplicate'
    | 'award'
    | 'money'
    | 'trigger';
  playerId: string;
  message: string;
  amount?: number;
  group?: RewardGroup;
  itemId?: ItemId;
  /** The item causing the event when itemId identifies the affected reward instead. */
  effectItemId?: ItemId;
}
