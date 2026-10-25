import { RaiseAmount } from "../dou-dizhu/auction/constants.js";
import { ForcedLeadType, RpsChoice } from "../dou-dizhu/match/types.js";
import { UseItemPayload } from "../dou-dizhu/match/effects.js";

export const QUICK_CHAT_IDS = [
  "just-this",
  "easy-win",
  "be-friends",
  "cant-afford-wrong",
  "kidding-bro",
] as const;
export type QuickChatId = (typeof QUICK_CHAT_IDS)[number];

export function isQuickChatId(value: unknown): value is QuickChatId {
  return typeof value === "string" && (QUICK_CHAT_IDS as readonly string[]).includes(value);
}

/** 客户端 → 服务端 */
export type ClientMessage =
  | { type: "hello"; playerId: string; displayName?: string; avatarUrl?: string }
  | { type: "create_room"; ranked?: boolean; maxPlayers?: 3 | 4 }
  | { type: "matchmake"; ranked?: boolean; maxPlayers: 3 | 4 }
  | { type: "cancel_matchmake" }
  | { type: "join_room"; roomCode: string }
  | { type: "leave_room" }
  | { type: "start_match" }
  | { type: "continue_play" }
  | { type: "auction_open" }
  | { type: "auction_raise"; raise: RaiseAmount }
  | { type: "skip_auction" }
  | { type: "play"; cardIds: string[] }
  | { type: "pass" }
  | { type: "quick_chat"; phraseId: QuickChatId }
  | { type: "yield_lead" }
  | { type: "use_item"; itemId: string; payload?: UseItemPayload }
  | { type: "decline_item_offer" }
  | { type: "resolve_swap"; targetId: string | null }
  | { type: "resolve_rps"; choice: RpsChoice }
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

/** 服务端 → 客户端 */
export type ServerMessage =
  | { type: "welcome"; playerId: string; displayName: string }
  | { type: "pong"; at: number }
  | { type: "error"; message: string }
  | { type: "room"; room: RoomSnapshot }
  | { type: "matchmaking"; status: "queued" | "cancelled"; maxPlayers: 3 | 4; ranked: boolean; queueSize: number }
  | { type: "match"; view: MatchPlayerView }
  | { type: "events"; events: unknown[] }
  | { type: "score"; score: number; modeShare: Array<{ modeId: string; gain: number; ratio: number }>; dailyRestoreDay: string | null; canMatch: boolean }
  | { type: "avatar"; avatar: AvatarPublicView }
  | { type: "quick_chat"; playerId: string; phraseId: QuickChatId }
  | { type: "settlement"; deltas: Array<{ playerId: string; rank: number; delta: number; scoreAfter: number }> };

export interface RoomSnapshot {
  roomCode: string;
  hostId: string;
  ranked: boolean;
  maxPlayers: number;
  phase: string;
  playerIds: string[];
  playerNames: Record<string, string>;
  /** 当前装备的形象 id（纯外观） */
  playerAvatars: Record<string, string>;
  /** 远程头像 URL（Steam 正式版为 Steam 头像）；无则空串，客户端用剪影 */
  playerPortraitUrls: Record<string, string>;
  continueReady?: string[];
  continueExpiresAt?: number | null;
}

export interface MatchPlayerView {
  public: ReturnType<
    typeof import("../dou-dizhu/match/engine.js").toPublicMatchState
  >;
  auction: ReturnType<
    typeof import("../dou-dizhu/match/engine.js").getAuctionPublic
  >;
  hand: ReturnType<
    typeof import("../dou-dizhu/match/engine.js").getPlayerHand
  >;
  items: Array<{
    id: string;
    name: string;
    remainingUses: number;
    maxUses: number;
    rarity: string;
    description: string;
    trigger: string;
  }>;
  visibleHands: Record<string, unknown[] | null>;
}

export function parseClientMessage(raw: string): ClientMessage | null {
  try {
    const data = JSON.parse(raw) as ClientMessage;
    if (!data || typeof data !== "object" || !("type" in data)) return null;
    return data;
  } catch {
    return null;
  }
}

export type { RaiseAmount, ForcedLeadType, RpsChoice, UseItemPayload };
