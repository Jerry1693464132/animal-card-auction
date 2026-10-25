export type ScoreReason =
  | "match"
  | "initial"
  | "weekly_floor"
  | "daily_restore"
  | "admin";

export interface ScoreLedgerEntry {
  id: string;
  playerId: string;
  matchId: string | null;
  modeId: string | null;
  delta: number;
  scoreAfter: number;
  ranked: boolean;
  reason: ScoreReason;
  createdAt: number;
}

export interface PlayerScoreProfile {
  playerId: string;
  /** 当前段位分，可为负 */
  score: number;
  /** 各模式累计正分获得（饼图用，只加不减） */
  lifetimeGainByMode: Record<string, number>;
  ledger: ScoreLedgerEntry[];
  /** 下次负分恢复方式：广告与转发交替，默认先广告 */
  nextNegativeRestore: NegativeRestoreVia;
  /** 上次每日恢复的 UTC 日期（YYYY-MM-DD）；负分跨天自动回 0 */
  lastDailyRestoreDay?: string;
}

/** @deprecated 微信时代广告/转发交替恢复；Steam 版改为每日恢复至 0 */
export type NegativeRestoreVia = "ad" | "share";

export interface RankResult {
  playerId: string;
  rank: number;
}

export interface MatchSettlementInput {
  matchId: string;
  modeId: string;
  ranked: boolean;
  ranking: RankResult[];
  /** 对局时长（秒） */
  durationSec: number;
  /** 炸弹/王炸倍率，开局 1 */
  scoreMultiplier?: number;
  /** 各玩家开局加倍系数 */
  scoreDoubles?: Record<string, number>;
  /** 结算时刻 */
  at?: number;
}

export interface PlayerDelta {
  playerId: string;
  rank: number;
  delta: number;
  scoreBefore: number;
  scoreAfter: number;
}

export interface SettlementResult {
  deltas: PlayerDelta[];
  entries: ScoreLedgerEntry[];
}
