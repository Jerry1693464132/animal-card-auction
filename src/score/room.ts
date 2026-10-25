import { createMatch, MatchState } from "../dou-dizhu/match/index.js";
import { settleDouDizhuMatch } from "./bridge.js";
import { createScoreProfile, modeGainShare, utcDayKey } from "./engine.js";
import { INITIAL_SCORE } from "./config.js";
import { PlayerScoreProfile, SettlementResult } from "./types.js";

export type RoomPhase = "lobby" | "in_match" | "closed";

/** 牌桌顶部阶段栏「××获胜」展示，与客户端 WIN_BANNER_MS 对齐 */
export const WIN_BANNER_MS = 6_000;
/** 结算页「继续一起游玩」倒计时（从横幅结束后起算） */
export const CONTINUE_PLAY_MS = 10_000;

export interface RoomOptions {
  roomCode: string;
  hostId: string;
  ranked: boolean;
  maxPlayers?: number;
}

export interface RoomState {
  roomCode: string;
  hostId: string;
  ranked: boolean;
  maxPlayers: number;
  phase: RoomPhase;
  playerIds: string[];
  match: MatchState | null;
  lastSettlement: SettlementResult | null;
  /** 结算后点了「继续一起游玩」的人 */
  continueReady: string[];
  continueExpiresAt: number | null;
}

/**
 * 轻量房间：组队 → 开一局斗地主 → 结束后可结算积分。
 * 不含网络；供后续 WebSocket 层直接调用。
 */
export function createRoom(options: RoomOptions): RoomState {
  return {
    roomCode: options.roomCode,
    hostId: options.hostId,
    ranked: options.ranked,
    maxPlayers: options.maxPlayers ?? 4,
    phase: "lobby",
    playerIds: [options.hostId],
    match: null,
    lastSettlement: null,
    continueReady: [],
    continueExpiresAt: null,
  };
}

export function joinRoom(room: RoomState, playerId: string): string | null {
  if (room.phase !== "lobby") return "Room not in lobby";
  if (room.playerIds.includes(playerId)) return "Already joined";
  if (room.playerIds.length >= room.maxPlayers) return "Room full";
  room.playerIds.push(playerId);
  return null;
}

export function leaveRoom(room: RoomState, playerId: string): string | null {
  if (room.phase !== "lobby") return "Cannot leave during match";
  if (!room.playerIds.includes(playerId)) return "Not in room";
  room.playerIds = room.playerIds.filter((id) => id !== playerId);
  room.continueReady = room.continueReady.filter((id) => id !== playerId);
  if (room.playerIds.length === 0) {
    room.phase = "closed";
    return null;
  }
  if (room.hostId === playerId) {
    room.hostId = room.playerIds[0]!;
  }
  return null;
}

export function startRoomMatch(
  room: RoomState,
  now: number = Date.now(),
  rng: () => number = Math.random,
): string | null {
  if (room.phase !== "lobby") return "Room not in lobby";
  if (room.playerIds.length < 2) return "Need at least 2 players";
  room.match = createMatch(room.playerIds, now, rng, {
    matchId: `${room.roomCode}-${now}`,
    ranked: room.ranked,
  });
  room.phase = "in_match";
  room.lastSettlement = null;
  room.continueReady = [];
  room.continueExpiresAt = null;
  return null;
}

export function ensureProfiles(
  playerIds: string[],
  store: Map<string, PlayerScoreProfile>,
  initialScore = INITIAL_SCORE,
): void {
  for (const id of playerIds) {
    if (!store.has(id)) {
      store.set(id, createScoreProfile(id, initialScore));
    }
  }
}

export function settleRoomMatch(
  room: RoomState,
  profiles: Map<string, PlayerScoreProfile>,
  at: number = Date.now(),
): SettlementResult | null {
  if (!room.match) return null;
  const result = settleDouDizhuMatch(room.match, profiles, at);
  if (result) {
    room.lastSettlement = result;
    room.phase = "lobby";
    room.match = null;
    room.continueReady = [];
    room.continueExpiresAt = at + WIN_BANNER_MS + CONTINUE_PLAY_MS;
  }
  return result;
}

export function markContinuePlay(room: RoomState, playerId: string): string | null {
  if (room.phase !== "lobby") return "Not in lobby";
  if (!room.lastSettlement) return "No settlement";
  if (!room.playerIds.includes(playerId)) return "Not in room";
  if (!room.continueReady.includes(playerId)) room.continueReady.push(playerId);
  return null;
}

export function continuePlayFull(room: RoomState): boolean {
  if (room.playerIds.length !== room.maxPlayers) return false;
  return room.playerIds.every((id) => room.continueReady.includes(id));
}

export function getPlayerScoreView(
  profile: PlayerScoreProfile,
): {
  score: number;
  modeShare: ReturnType<typeof modeGainShare>;
  /** 下次每日恢复的 UTC 日期；负分玩家返回今天（今天已恢复过则明天） */
  dailyRestoreDay: string | null;
  canMatch: boolean;
} {
  const today = utcDayKey();
  const nextRestoreDay =
    profile.score < 0
      ? profile.lastDailyRestoreDay === today
        ? utcDayKey(Date.now() + 86_400_000)
        : today
      : null;
  return {
    score: profile.score,
    modeShare: modeGainShare(profile),
    dailyRestoreDay: nextRestoreDay,
    canMatch: profile.score >= 0,
  };
}
