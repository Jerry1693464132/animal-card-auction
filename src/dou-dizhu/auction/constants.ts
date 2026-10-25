/** 局内拍卖规则常量（服务端权威） */
export const AUCTION = {
  /** 每人开局拍卖币 */
  stipend: 300,
  /** 道具数量 = 玩家数 × 3 */
  itemCountFormula: (playerCount: number) => playerCount * 3,
  /** 每件底价；第一口加价在此之上 */
  openingBid: 10,
  /** 加价按钮（不含 all-in） */
  raiseAmounts: [1, 5, 10, 20, 30] as const,
  /** 有人加价后，其他玩家按钮冷却（毫秒） */
  raiseCooldownMs: 500,
  /** 本件尚无人出价：流拍等待（毫秒） */
  openIdleMs: 12_000,
  /** 有人出价后无人加价则成交（毫秒） */
  settleIdleMs: 4000,
} as const;

export type RaiseAmount = (typeof AUCTION.raiseAmounts)[number] | "allin";
