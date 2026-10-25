import { ItemDefinition } from "../types.js";
import { RaiseAmount } from "./constants.js";

export enum AuctionPhase {
  /** 等待出价（已废弃；开局即竞价） */
  WaitingOpen = "waiting_open",
  /** 竞价中 */
  Bidding = "bidding",
  /** 本件已成交或流拍，短暂展示后进入下一件 */
  SettledLot = "settled_lot",
  /** 全部拍完 */
  Finished = "finished",
}

export interface AuctionPlayer {
  id: string;
  /** 剩余可用拍卖币（不含已锁定的当前最高价） */
  balance: number;
  /** 本局拍得的道具 */
  inventory: ItemDefinition[];
}

export interface AuctionLot {
  /** 队列下标 0..n-1 */
  index: number;
  item: ItemDefinition;
  /** 是否已对玩家公开（当前正在拍的才公开） */
  revealed: boolean;
  winnerId: string | null;
  finalPrice: number | null;
  /** 流拍（无人出价） */
  passed: boolean;
}

export interface BidRecord {
  playerId: string;
  /** 叫到的总价 */
  price: number;
  /** 相对上一口价的增量 */
  raise: number | "open" | "allin";
  at: number;
}

export interface AuctionPublicState {
  phase: AuctionPhase;
  currentLotIndex: number;
  totalLots: number;
  currentItem: ItemDefinition | null;
  currentPrice: number;
  leadingPlayerId: string | null;
  /** 距自动成交剩余毫秒；尚无出价时为距流拍 */
  settleInMs: number;
  /** 各玩家可见余额 */
  balances: Record<string, number>;
  /** 已拍得数量 */
  inventoryCounts: Record<string, number>;
}

export interface AuctionState {
  phase: AuctionPhase;
  playerIds: string[];
  players: Map<string, AuctionPlayer>;
  lots: AuctionLot[];
  currentLotIndex: number;
  currentPrice: number;
  leadingPlayerId: string | null;
  /** 领先者锁定金额（从 balance 已扣除） */
  lockedAmount: number;
  bids: BidRecord[];
  /** 本件上次出价时间；开拍时为揭示时间 */
  lastBidAt: number;
  /** 开拍时间（本件揭示时） */
  lotOpenedAt: number;
  /** 玩家按钮冷却截止（有人加价后其他人） */
  cooldownUntil: Map<string, number>;
  createdAt: number;
}

export type AuctionEvent =
  | {
      type: "opened";
      lotIndex: number;
      itemId: string;
    }
  | {
      type: "bid";
      playerId: string;
      price: number;
      raise: number | "open" | "allin";
    }
  | {
      type: "lot_sold";
      lotIndex: number;
      winnerId: string;
      price: number;
      itemId: string;
    }
  | {
      type: "lot_passed";
      lotIndex: number;
      itemId: string;
    }
  | { type: "auction_finished" };

export type AuctionActionResult =
  | { ok: true; state: AuctionState; event: AuctionEvent }
  | { ok: false; error: string };

export type AuctionButton =
  | { kind: "open"; price: number }
  | { kind: "raise"; amount: RaiseAmount; nextPrice: number }
  | { kind: "allin"; nextPrice: number };
