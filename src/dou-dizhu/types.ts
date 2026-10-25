/** 花色：三人场每点 4 张（四花色）；四人场每点 5 张，第 5 张复用黑桃立绘 */
export enum Suit {
  Spade = "S",
  Heart = "H",
  Club = "C",
  Diamond = "D",
}

/**
 * 点数序列（数值用于比较大小）：
 * 先手牌(0) < 炸弹牌(1) < 3 < 4 < ... < K(13) < 14 < ... < 19 < A(20) < 2(21) < 小王(22) < 大王(23)
 */
export enum Rank {
  FirstPlay = 0,
  /** 炸弹牌：单出即最小炸弹，比四张 3 小 */
  BombCard = 1,
  Three = 3,
  Four = 4,
  Five = 5,
  Six = 6,
  Seven = 7,
  Eight = 8,
  Nine = 9,
  Ten = 10,
  Jack = 11,
  Queen = 12,
  King = 13,
  Fourteen = 14,
  Fifteen = 15,
  Sixteen = 16,
  Seventeen = 17,
  Eighteen = 18,
  Nineteen = 19,
  Ace = 20,
  Two = 21,
  SmallJoker = 22,
  BigJoker = 23,
}

export enum CardKind {
  Normal = "normal",
  FirstPlay = "first_play",
  Star = "star",
  BombCard = "bomb_card",
}

export enum HandType {
  FirstPlay = "first_play",
  Single = "single",
  Pair = "pair",
  Triple = "triple",
  TripleWithSingle = "triple_with_single",
  TripleWithPair = "triple_with_pair",
  Straight = "straight",
  ConsecutivePairs = "consecutive_pairs",
  Airplane = "airplane",
  AirplaneWithSingles = "airplane_with_singles",
  AirplaneWithPairs = "airplane_with_pairs",
  FourWithTwoSingles = "four_with_two_singles",
  FourWithTwoPairs = "four_with_two_pairs",
  Bomb = "bomb",
  Rocket = "rocket",
}

export interface Card {
  id: string;
  kind: CardKind;
  rank?: Rank;
  suit?: Suit;
}

export interface ParsedHand {
  type: HandType;
  mainRank: Rank;
  length: number;
  cards: Card[];
}

export enum ItemRarity {
  Legendary = "legendary",
  Epic = "epic",
  Rare = "rare",
}

export enum ItemTrigger {
  GameStart = "game_start",
  OnPlay = "on_play",
  OnLead = "on_lead",
  OnOpponentBomb = "on_opponent_bomb",
  OnFirstBelowTen = "on_first_below_ten",
  OnOwnTurn = "on_own_turn",
}

export interface ItemDefinition {
  id: string;
  name: string;
  rarity: ItemRarity;
  weight: number;
  color: string;
  description: string;
  trigger: ItemTrigger;
  maxUses: number;
}

export const DOU_DIZHU = {
  playerCount: 4,
  /** 三人场：19 点×4 + 王 + 先手 + 星 + 炸 */
  deckSize3: 81,
  /** 四人场：19 点×5 + 王 + 先手 + 星 + 炸 */
  deckSize4: 100,
  straightMinRank: Rank.Three,
  straightMaxRank: Rank.Ace,
  straightMinLength: 5,
  consecutivePairsMinPairs: 3,
  airplaneMinGroups: 2,
  minBombRank: Rank.Three,
} as const;
