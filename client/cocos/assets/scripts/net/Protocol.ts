/**
 * 与 src/server/protocol.ts 对齐的客户端消息类型。
 * 只描述 JSON 形状，不引入服务端模块。
 */

export type MaxPlayers = 3 | 4;

export type RaiseAmount = 1 | 5 | 10 | 20 | 30 | "allin";

export const QUICK_CHAT_LINES = [
  { id: "just-this", text: "就这啊" },
  { id: "easy-win", text: "这把随便赢咯" },
  { id: "be-friends", text: "哥们，交个朋友呗" },
  { id: "cant-afford-wrong", text: "错不起，我对了" },
  { id: "kidding-bro", text: "搞笑呢兄弟" },
] as const;
export type QuickChatId = (typeof QUICK_CHAT_LINES)[number]["id"];

export type AuctionPhase = "waiting_open" | "bidding" | "settled_lot" | "finished";

export interface AuctionItemView {
  id: string;
  name: string;
  rarity: string;
  color: string;
  description: string;
}

export interface AuctionPublicView {
  phase: AuctionPhase;
  currentLotIndex: number;
  totalLots: number;
  currentItem: AuctionItemView | null;
  currentPrice: number;
  leadingPlayerId: string | null;
  settleInMs: number;
  balances: Record<string, number>;
  inventoryCounts: Record<string, number>;
}

export interface CardView {
  id: string;
  kind: string;
  rank?: number;
  suit?: string;
}

export interface MatchTableView {
  playerId: string;
  type: string;
  mainRank: number;
  length: number;
  cardCount: number;
  cards?: CardView[];
}

export interface PendingView {
  kind: string;
  expiresAt?: number;
  playerId?: string;
  itemId?: string;
  actorId?: string;
  leaderId?: string;
  challengerId?: string;
  targetId?: string;
  challengerChoice?: string | null;
  targetChoice?: string | null;
  phase?: string;
  holderIds?: string[];
  wasFollow?: boolean;
  handType?: string;
  context?: { reason?: string; actorId?: string; leaderId?: string; wasFollow?: boolean; handType?: string };
  /** 强易抽到的牌，仅抽牌者可见 */
  drawnHint?: string;
  /** 开局加倍窗各人选择；他人为 null */
  choices?: Record<string, string | null>;
}

export interface MatchPublicView {
  phase: string;
  turnPlayerId?: string | null;
  turnExpiresAt?: number | null;
  freeLead?: boolean;
  pending?: PendingView | null;
  leadRestriction?: { playerId: string; allowed: string; controllerId?: string } | null;
  table?: MatchTableView | null;
  handCounts?: Record<string, number | null>;
  /** 当局各玩家段位积分（非拍卖币） */
  scores?: Record<string, number>;
  ranking?: Array<{ playerId: string; rank: number }>;
  /** 座位 0 起逆时针；0 号为本局先手 */
  seatOrder?: string[];
  bombInsight?: Record<string, number> | null;
  /** 仅记忆力持有者可见：场上剩余点数（含星牌、炸弹牌） */
  cardCounter?: Array<{ id: string; label: string; count: number }> | null;
  bounceForbidType?: string | null;
  lastBouncerId?: string | null;
  overloadTurnsLeft?: number;
  /** 积分赛倍率；无炸弹为 1 */
  scoreMultiplier?: number;
  /** 各玩家开局加倍系数 */
  scoreDoubles?: Record<string, number>;
  /** 各玩家是否托管 */
  autoPlay?: Record<string, boolean>;
}

export interface MatchItemView {
  id: string;
  name: string;
  remainingUses: number;
  maxUses?: number;
  rarity: string;
  description?: string;
  trigger?: string;
}

export interface MatchPlayerView {
  public: MatchPublicView;
  auction: AuctionPublicView | null;
  hand: CardView[];
  items: MatchItemView[];
  visibleHands: Record<string, CardView[] | null>;
}

export interface SettlementDelta {
  playerId: string;
  rank: number;
  delta: number;
  scoreAfter: number;
}

export type ClientMessage =
  | { type: "hello"; playerId: string; displayName?: string; avatarUrl?: string }
  | { type: "create_room"; ranked?: boolean; maxPlayers?: MaxPlayers }
  | { type: "matchmake"; ranked?: boolean; maxPlayers: MaxPlayers }
  | { type: "cancel_matchmake" }
  | { type: "join_room"; roomCode: string }
  | { type: "leave_room" }
  | { type: "start_match" }
  | { type: "continue_play" }
  | { type: "auction_open" }
  | { type: "auction_raise"; raise: RaiseAmount }
  | { type: "play"; cardIds: string[] }
  | { type: "pass" }
  | { type: "quick_chat"; phraseId: QuickChatId }
  | { type: "yield_lead" }
  | { type: "use_item"; itemId: string; payload?: unknown }
  | { type: "decline_item_offer" }
  | { type: "resolve_swap"; targetId: string | null }
  | { type: "resolve_rps"; choice: string }
  | { type: "resolve_double"; choice: "none" | "double" | "super" }
  | { type: "set_auto_play"; enabled: boolean }
  | { type: "resolve_afk_host"; host: boolean }
  | { type: "claim_avatar_unlock"; avatarId: string }
  | { type: "equip_avatar"; avatarId: string }
  | { type: "restore_score" }
  | { type: "ping" };

export interface AvatarPublicView {
  equipped: string;
  unlocked: string[];
}

export interface RoomSnapshot {
  roomCode: string;
  hostId: string;
  ranked: boolean;
  maxPlayers: number;
  phase: string;
  playerIds: string[];
  playerNames: Record<string, string>;
  playerAvatars?: Record<string, string>;
  /** 远程头像 URL（Steam 正式版为 Steam 头像）；无则空串 */
  playerPortraitUrls?: Record<string, string>;
  continueReady?: string[];
  continueExpiresAt?: number | null;
}

export type ServerMessage =
  | { type: "welcome"; playerId: string; displayName: string }
  | { type: "pong"; at: number }
  | { type: "error"; message: string }
  | { type: "room"; room: RoomSnapshot }
  | {
      type: "matchmaking";
      status: "queued" | "cancelled";
      maxPlayers: MaxPlayers;
      ranked: boolean;
      queueSize: number;
    }
  | { type: "match"; view: MatchPlayerView }
  | { type: "events"; events: unknown[] }
  | { type: "score"; score: number; modeShare: Array<{ modeId: string; gain: number; ratio: number }>; dailyRestoreDay?: string | null; canMatch?: boolean }
  | { type: "avatar"; avatar: AvatarPublicView }
  | { type: "quick_chat"; playerId: string; phraseId: QuickChatId }
  | { type: "settlement"; deltas: SettlementDelta[] };
