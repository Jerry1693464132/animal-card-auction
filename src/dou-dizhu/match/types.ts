import { Card, HandType, ItemDefinition, ParsedHand } from "../types.js";
import { AuctionState } from "../auction/types.js";

export enum MatchPhase {
  Auction = "auction",
  Dealing = "dealing",
  Playing = "playing",
  Finished = "finished",
}

export interface OwnedItem {
  instanceId: string;
  def: ItemDefinition;
  remainingUses: number;
}

export interface MatchPlayerFlags {
  canSeeAllHands: boolean;
  hasCardCounter: boolean;
  thinkTimeBonusSec: number;
  tripleExtraSingle: boolean;
  fourExtraSingle: boolean;
  maxBomb: boolean;
  instantWinReady: boolean;
  hideHandFromOthers: boolean;
  hideFromSkills: boolean;
  knowBombCounts: boolean;
  /** 大脑过载：该玩家还剩几个受 4 秒限制的出牌回合 */
  overloadTurnsLeft: number;
}

export interface MatchPlayer {
  id: string;
  seat: number;
  hand: Card[];
  items: OwnedItem[];
  flags: MatchPlayerFlags;
  finishRank: number | null;
}

export type RpsChoice = "rock" | "paper" | "scissors";

/** 开局加倍：不加倍 ×1，加倍 ×2，超级加倍 ×4 */
export type ScoreDoubleChoice = "none" | "double" | "super";

export function scoreDoubleFactor(choice: ScoreDoubleChoice | null | undefined): number {
  if (choice === "double") return 2;
  if (choice === "super") return 4;
  return 1;
}

/** 操控强制的领出牌型 */
export type ForcedLeadType = "single" | "pair";

/** 主动技能询问窗的触发场景 */
export type ItemOfferContext =
  | { reason: "turn" }
  | {
      reason: "after_play";
      actorId: string;
      handType: HandType;
      wasFollow: boolean;
      previousTable: ParsedHand | null;
      previousLeaderId: string | null;
    }
  | { reason: "on_lead"; leaderId: string }
  | {
      reason: "extra_round";
      /** 出牌反应窗结束后的加赛：问完后按该玩家推进回合 */
      afterPlayActorId?: string;
    };

export interface ItemOffer {
  playerId: string;
  itemId: string;
  context: ItemOfferContext;
}

/**
 * 互动道具待决窗口（同一时间最多一个）。
 * 未解决前禁止普通出牌/过牌。
 */
export type PendingInteraction =
  | {
      kind: "swap_hands";
      playerId: string;
      expiresAt: number;
    }
  | {
      kind: "offer_item";
      playerId: string;
      itemId: string;
      expiresAt: number;
      context: ItemOfferContext;
    }
  | {
      kind: "rps";
      challengerId: string;
      targetId: string;
      challengerChoice: RpsChoice | null;
      targetChoice: RpsChoice | null;
      /** picking：双方同时出拳；reveal：手势亮出，等待自动消失 */
      phase: "picking" | "reveal";
      expiresAt: number;
    }
  | {
      kind: "force_trade";
      playerId: string;
      targetId: string;
      expiresAt: number;
      /** 仅抽牌者可见；对其他人下发时剥掉 */
      drawnHint?: string;
    }
  | {
      kind: "score_double";
      expiresAt: number;
      /** 未选为 null；下发时对他人隐藏 */
      choices: Record<string, ScoreDoubleChoice | null>;
    }
  | {
      kind: "afk_host";
      playerId: string;
      expiresAt: number;
    };

export interface LeadRestriction {
  playerId: string;
  allowed: ForcedLeadType;
  controllerId: string;
}

export interface PeekEffect {
  viewerId: string;
  targetIds: string[];
  expiresAt: number;
}

export interface MatchState {
  /** 对局 id（积分流水用） */
  matchId: string;
  /** 是否积分赛 */
  ranked: boolean;
  phase: MatchPhase;
  playerIds: string[];
  players: Map<string, MatchPlayer>;
  auction: AuctionState | null;
  discard: Card[];
  tableHand: ParsedHand | null;
  tableLeaderId: string | null;
  passStreak: number;
  turnSeat: number;
  finishCount: number;
  /** 当前已计入「手牌 < 10」的玩家（回到 ≥10 后会清除，可再次触发加赛询问） */
  belowTenSeen: Set<string>;
  /** 加赛是否已实际发放过牌（整局仅一次） */
  extraRoundApplied: boolean;
  pending: PendingInteraction | null;
  /** 尚未弹出的主动技能询问（服务端队列，不下发） */
  itemOfferQueue: ItemOffer[];
  /** 本回合已点「不使用」的主动技能，本回合不再询问 */
  turnOfferSkipped: Set<string>;
  /** 操控：下一次该玩家领出时的牌型限制 */
  leadRestriction: LeadRestriction | null;
  /** 打回后：该玩家下一次出牌不得为此牌型 */
  bounceForbidType: HandType | null;
  /** 打回发起者；被打回者若无法改出则领出权交给此人 */
  lastBouncerId: string | null;
  peeks: PeekEffect[];
  /** 当前出牌/过牌截止；有 pending 时为 null */
  turnExpiresAt: number | null;
  /** 托管中的玩家：技能窗不使用，跟牌出最小能压的牌，领出按最小点数张数 */
  autoPlay: Set<string>;
  startedAt: number;
  finishedAt: number | null;
  /** 积分赛倍率，开局 1；每打出四张及以上炸弹或王炸 ×2 */
  scoreMultiplier: number;
  /** 开局加倍系数，默认 1 */
  scoreDoubles: Record<string, number>;
  rng: () => number;
}

export type MatchActionResult =
  | { ok: true; state: MatchState; events: MatchEvent[] }
  | { ok: false; error: string };

export type MatchEvent =
  | { type: "auction_finished" }
  | { type: "dealt"; handSizes: Record<string, number> }
  | { type: "game_start_item"; playerId: string; itemId: string }
  | { type: "pending"; kind: PendingInteraction["kind"]; expiresAt: number }
  | { type: "pending_resolved"; kind: PendingInteraction["kind"] }
  | { type: "score_double_chosen"; playerId: string; choice: ScoreDoubleChoice }
  | { type: "turn"; playerId: string; freeLead: boolean }
  | { type: "turn_timeout"; playerId: string; action: "pass" | "lead" | "yield" }
  | { type: "auto_play_changed"; playerId: string; enabled: boolean }
  | { type: "afk_host"; playerId: string }
  | {
      type: "played";
      playerId: string;
      cardIds: string[];
      handType: string;
      mainRank: number;
      handSize: number;
    }
  | { type: "passed"; playerId: string }
  | { type: "new_lead"; playerId: string }
  | { type: "item_used"; playerId: string; itemId: string; targetPlayerId?: string; drawnHint?: string }
  | {
      type: "hands_swapped";
      playerId: string;
      targetId: string;
    }
  | {
      type: "rps_reveal";
      challengerId: string;
      targetId: string;
      challengerChoice: RpsChoice;
      targetChoice: RpsChoice;
    }
  | {
      type: "rps_result";
      challengerId: string;
      targetId: string;
      winnerId: string | null;
      challengerChoice: RpsChoice;
      targetChoice: RpsChoice;
    }
  | { type: "bomb_defused"; defuserId: string; bomberId: string }
  | { type: "play_bounced"; bouncerId: string; actorId: string }
  | { type: "extra_round"; byPlayerId: string }
  | { type: "peek"; viewerId: string; targetIds: string[]; expiresAt: number }
  | { type: "self_follow"; playerId: string }
  | { type: "control_applied"; controllerId: string; targetId: string; allowed: ForcedLeadType }
  | { type: "control_yielded"; playerId: string; controllerId: string }
  | { type: "player_finished"; playerId: string; rank: number }
  | {
      type: "match_finished";
      matchId: string;
      ranked: boolean;
      ranking: Array<{ playerId: string; rank: number }>;
      durationSec: number;
    };

export interface MatchPublicState {
  phase: MatchPhase;
  turnPlayerId: string | null;
  /** 距出牌超时剩余的绝对时间戳；无回合闹钟时为 null */
  turnExpiresAt: number | null;
  freeLead: boolean;
  pending: PendingInteraction | null;
  leadRestriction: LeadRestriction | null;
  table: {
    playerId: string;
    type: string;
    mainRank: number;
    length: number;
    cardCount: number;
    cards: Card[];
  } | null;
  handCounts: Record<string, number | null>;
  /** 当局各玩家段位积分（非拍卖币）；由大厅在下发时附上 */
  scores?: Record<string, number>;
  ranking: Array<{ playerId: string; rank: number }>;
  peeks: PeekEffect[];
  /** 座位 0 起逆时针一圈的 playerId（0 = 本局先手） */
  seatOrder: string[];
  /** 仅小洞察持有者可见：其他玩家炸弹个数（王炸 + 炸弹牌） */
  bombInsight: Record<string, number> | null;
  /** 仅记忆力持有者可见：各玩家手牌合计仍在场上的点数（含星牌、炸弹牌） */
  cardCounter: Array<{ id: string; label: string; count: number }> | null;
  /** 打回后禁止再出的牌型；无打回约束时为 null */
  bounceForbidType: HandType | null;
  /** 打回发起者；配合 bounceForbidType 给被打回方看提示 */
  lastBouncerId: string | null;
  /** 观看者自己剩余的大脑过载出牌回合；0 表示未中 */
  overloadTurnsLeft: number;
  /** 积分赛倍率：无炸弹为 1，每打出四张及以上炸弹或王炸 ×2 */
  scoreMultiplier: number;
  /** 各玩家开局加倍系数（1 / 2 / 4） */
  scoreDoubles: Record<string, number>;
  /** 各玩家是否托管 */
  autoPlay: Record<string, boolean>;
}

/** 互动窗口与出牌思考时长 */
export const MATCH_TIMING = {
  /** 出牌/过牌思考时间；防过载再加 thinkTimeBonusSec */
  turnMs: 15_000,
  swapHandsMs: 10_000,
  /** 主动技能「是否使用」思考时间；超时视为不使用 */
  itemOfferMs: 6_000,
  /** 点「使用」后选目标 / 选牌型 / 强易交还 */
  itemChoiceMs: 6_000,
  /** @deprecated 等同 itemOfferMs，旧测试超时仍可用 */
  reactionMs: 6_000,
  /** 猜拳双方同时出拳的思考时间；超时系统随机出拳 */
  rpsMs: 6_000,
  /** 双方出拳后，手势在动物旁亮出的时长 */
  rpsRevealMs: 5_000,
  extraRoundMs: 6_000,
  peekMs: 25_000,
  forceTradeMs: 6_000,
  /** 开局加倍 / 不加倍 / 超级加倍；防过载再加 thinkTimeBonusSec（取全场最大） */
  scoreDoubleMs: 10_000,
  /** 大脑过载期间的出牌思考时间 */
  overloadTurnMs: 4_000,
  /** 出牌超时后的挂机确认；超时默认进入托管。防过载再加 thinkTimeBonusSec */
  afkHostMs: 5_000,
} as const;
