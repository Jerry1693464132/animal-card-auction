import {
  getAuctionPublic,
  getPlayerHand,
  getVisibleHand,
  matchPlaceOpeningBid,
  matchPlaceRaise,
  matchTickAuction,
  passTurn,
  playCards,
  yieldControlledLead,
  resolveRps,
  resolveSwapHands,
  resolveScoreDouble,
  skipAuctionAndDeal,
  tickMatch,
  toPublicMatchState,
  useMatchItem,
  declineItemOffer,
  setMatchAutoPlay,
  applyAutoPlay,
  resolveAfkHost,
} from "../dou-dizhu/match/index.js";
import { RaiseAmount } from "../dou-dizhu/auction/constants.js";
import { refreshLotIdleClock } from "../dou-dizhu/auction/engine.js";
import { MatchPhase } from "../dou-dizhu/match/types.js";
import { RpsChoice } from "../dou-dizhu/match/types.js";
import { UseItemPayload } from "../dou-dizhu/match/effects.js";
import { sortItemsActiveFirst } from "../dou-dizhu/items/definitions.js";
import {
  createRoom,
  ensureProfiles,
  getPlayerScoreView,
  joinRoom,
  leaveRoom,
  RoomState,
  settleRoomMatch,
  startRoomMatch,
  markContinuePlay,
  continuePlayFull,
} from "../score/room.js";
import {
  canEnterMatch,
  dailyRestoreNegativeScore,
  migrateLegacyInitialScore,
  PlayerScoreProfile,
  utcDayKey,
} from "../score/index.js";
import { ScoreStore, sanitizeDisplayName, sanitizePlayerId, sanitizePortraitUrl } from "../score/store.js";
import {
  AvatarProfile,
  createAvatarProfile,
  equipAvatar,
  unlockAvatar,
} from "../avatar/index.js";
import {
  isQuickChatId,
  MatchPlayerView,
  QuickChatId,
  RoomSnapshot,
  ServerMessage,
} from "./protocol.js";

export type SendFn = (playerId: string, message: ServerMessage) => void;

export interface GameHubOptions {
  /** 积分与昵称存档；不传则仅内存（测试默认） */
  store?: ScoreStore;
}

function randomRoomCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 6; i += 1) {
    code += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return code;
}

export class GameHub {
  private rooms = new Map<string, RoomState>();
  private playerRoom = new Map<string, string>();
  private names = new Map<string, string>();
  private profiles = new Map<string, PlayerScoreProfile>();
  private avatars = new Map<string, AvatarProfile>();
  /** playerId → 头像 URL */
  private portraits = new Map<string, string>();
  /** key = `${maxPlayers}:${ranked}` */
  private matchQueues = new Map<string, string[]>();
  private playerQueueKey = new Map<string, string>();
  /** 防止快捷对话刷屏；只保存每个玩家最后一次成功发送时间。 */
  private quickChatAt = new Map<string, number>();
  private send: SendFn;
  private store: ScoreStore | null;

  constructor(send: SendFn, options?: GameHubOptions) {
    this.send = send;
    this.store = options?.store ?? null;
    if (this.store) {
      const snap = this.store.load();
      this.profiles = snap.profiles;
      this.names = snap.names;
      this.avatars = snap.avatars ?? new Map();
      this.portraits = snap.portraits ?? new Map();
      let migrated = false;
      for (const profile of this.profiles.values()) {
        if (migrateLegacyInitialScore(profile)) migrated = true;
      }
      if (migrated) this.persistAccounts();
    }
  }

  private persistAccounts(): void {
    this.store?.save({
      profiles: this.profiles,
      names: this.names,
      avatars: this.avatars,
      portraits: this.portraits,
    });
  }

  private ensureAvatar(playerId: string): AvatarProfile {
    let profile = this.avatars.get(playerId);
    if (!profile) {
      profile = createAvatarProfile();
      this.avatars.set(playerId, profile);
    }
    return profile;
  }

  private pushAvatar(playerId: string): void {
    const profile = this.ensureAvatar(playerId);
    this.send(playerId, {
      type: "avatar",
      avatar: {
        equipped: profile.equipped,
        unlocked: [...profile.unlocked],
      },
    });
  }

  getEquippedAvatar(playerId: string): string {
    return this.ensureAvatar(playerId).equipped;
  }

  /**
   * 客户端在激励视频看完（isEnded）后请求解锁。
   * 微信不提供服务端验广告回调；权威解锁仍在服务端记账。
   */
  claimAvatarUnlock(
    playerId: string,
    avatarId: string,
  ): { ok: true } | { ok: false; error: string } {
    const id = sanitizePlayerId(playerId);
    if (!id) return { ok: false, error: "Invalid playerId" };
    const current = this.ensureAvatar(id);
    const result = unlockAvatar(current, avatarId);
    if (!result.ok) return result;
    this.avatars.set(id, result.profile);
    this.persistAccounts();
    this.pushAvatar(id);
    return { ok: true };
  }

  equipAvatarFor(
    playerId: string,
    avatarId: string,
  ): { ok: true } | { ok: false; error: string } {
    const id = sanitizePlayerId(playerId);
    if (!id) return { ok: false, error: "Invalid playerId" };
    const current = this.ensureAvatar(id);
    const result = equipAvatar(current, avatarId);
    if (!result.ok) return result;
    this.avatars.set(id, result.profile);
    this.persistAccounts();
    this.pushAvatar(id);
    const room = this.getPlayerRoom(id);
    if (room) this.broadcastRoom(room);
    return { ok: true };
  }

  /**
   * 每日恢复：负分玩家把积分拉回 0（Steam 买断制，替代微信广告/转发）。
   * 当天已恢复过则返回"明天再试"。
   */
  restoreScoreFor(playerId: string): { ok: true } | { ok: false; error: string } {
    const id = sanitizePlayerId(playerId);
    if (!id) return { ok: false, error: "Invalid playerId" };
    ensureProfiles([id], this.profiles);
    const profile = this.profiles.get(id);
    if (!profile) return { ok: false, error: "Missing score profile" };
    if (profile.score >= 0) return { ok: false, error: "当前积分未为负，无需恢复" };
    const today = utcDayKey();
    if (profile.lastDailyRestoreDay === today) {
      return { ok: false, error: "今日已恢复，明天再来" };
    }
    const restored = dailyRestoreNegativeScore(profile, Date.now());
    if (!restored) return { ok: false, error: "当前积分未为负，无需恢复" };
    this.persistAccounts();
    this.pushScore(id);
    return { ok: true };
  }

  setDisplayName(playerId: string, name: string): void {
    const id = sanitizePlayerId(playerId);
    if (!id) return;
    this.names.set(id, sanitizeDisplayName(name, id));
    ensureProfiles([id], this.profiles);
    this.persistAccounts();
  }

  setPortraitUrl(playerId: string, url: string | undefined): void {
    const id = sanitizePlayerId(playerId);
    if (!id) return;
    const next = sanitizePortraitUrl(url);
    if (!next) return;
    const prev = this.portraits.get(id) ?? "";
    if (prev === next) return;
    this.portraits.set(id, next);
    this.persistAccounts();
    const room = this.getPlayerRoom(id);
    if (room && room.phase !== "closed") this.broadcastRoom(room);
  }

  getPortraitUrl(playerId: string): string {
    return this.portraits.get(playerId) ?? "";
  }

  getDisplayName(playerId: string): string {
    return this.names.get(playerId) ?? playerId;
  }

  private normalizeMaxPlayers(maxPlayers?: number): number {
    if (maxPlayers === 3 || maxPlayers === 4) return maxPlayers;
    if (typeof maxPlayers === "number" && maxPlayers >= 2 && maxPlayers <= 4) {
      return Math.floor(maxPlayers);
    }
    return 4;
  }

  private queueKey(maxPlayers: number, ranked: boolean): string {
    return `${maxPlayers}:${ranked ? 1 : 0}`;
  }

  private parseQueueKey(key: string): { maxPlayers: 3 | 4; ranked: boolean } {
    const [maxRaw, rankedRaw] = key.split(":");
    return {
      maxPlayers: Number(maxRaw) === 3 ? 3 : 4,
      ranked: rankedRaw === "1",
    };
  }

  /** 离队但不发 cancelled，避免重排/顶号时把新连接踢出匹配层。 */
  private leaveQueue(playerId: string): string | null {
    const key = this.playerQueueKey.get(playerId);
    if (!key) return null;
    this.matchQueues.set(
      key,
      (this.matchQueues.get(key) ?? []).filter((id) => id !== playerId),
    );
    this.playerQueueKey.delete(playerId);
    return key;
  }

  private pushQueue(key: string): void {
    const queue = this.matchQueues.get(key) ?? [];
    const { maxPlayers, ranked } = this.parseQueueKey(key);
    for (const id of queue) {
      this.send(id, {
        type: "matchmaking",
        status: "queued",
        maxPlayers,
        ranked,
        queueSize: queue.length,
      });
    }
  }

  private roomSnapshot(room: RoomState): RoomSnapshot {
    const playerNames: Record<string, string> = {};
    const playerAvatars: Record<string, string> = {};
    const playerPortraitUrls: Record<string, string> = {};
    for (const id of room.playerIds) {
      playerNames[id] = this.getDisplayName(id);
      playerAvatars[id] = this.getEquippedAvatar(id);
      playerPortraitUrls[id] = this.getPortraitUrl(id);
    }
    return {
      roomCode: room.roomCode,
      hostId: room.hostId,
      ranked: room.ranked,
      maxPlayers: room.maxPlayers,
      phase: room.phase,
      playerIds: [...room.playerIds],
      playerNames,
      playerAvatars,
      playerPortraitUrls,
      continueReady: [...room.continueReady],
      continueExpiresAt: room.continueExpiresAt,
    };
  }

  private broadcastRoom(room: RoomState): void {
    const snap = this.roomSnapshot(room);
    for (const id of room.playerIds) {
      this.send(id, { type: "room", room: snap });
    }
  }

  private playerScores(ids: string[]): Record<string, number> {
    const scores: Record<string, number> = {};
    for (const id of ids) scores[id] = this.profiles.get(id)?.score ?? 0;
    return scores;
  }

  private matchView(room: RoomState, playerId: string, now: number): MatchPlayerView | null {
    const match = room.match;
    if (!match) return null;
    const player = match.players.get(playerId);
    const visibleHands: Record<string, unknown[] | null> = {};
    for (const otherId of match.playerIds) {
      if (otherId === playerId) continue;
      visibleHands[otherId] = getVisibleHand(match, playerId, otherId, now);
    }
    const pub = toPublicMatchState(match, playerId);
    return {
      public: { ...pub, scores: this.playerScores(room.playerIds) },
      auction: getAuctionPublic(match),
      hand: getPlayerHand(match, playerId),
      items: sortItemsActiveFirst(
        (player?.items ?? []).map((i) => ({
          id: i.def.id,
          name: i.def.name,
          remainingUses: i.remainingUses,
          maxUses: i.def.maxUses,
          rarity: i.def.rarity,
          description: i.def.description,
          trigger: i.def.trigger,
        })),
      ),
      visibleHands,
    };
  }

  private broadcastMatch(room: RoomState, events: unknown[] = [], now = Date.now()): void {
    for (const id of room.playerIds) {
      const view = this.matchView(room, id, now);
      if (view) this.send(id, { type: "match", view });
      if (events.length) this.send(id, { type: "events", events });
    }
  }

  private pushScore(playerId: string): void {
    const profile = this.profiles.get(playerId);
    if (!profile) return;
    const view = getPlayerScoreView(profile);
    this.send(playerId, {
      type: "score",
      score: view.score,
      modeShare: view.modeShare,
      dailyRestoreDay: view.dailyRestoreDay,
      canMatch: view.canMatch,
    });
  }

  private getPlayerRoom(playerId: string): RoomState | null {
    const code = this.playerRoom.get(playerId);
    if (!code) return null;
    return this.rooms.get(code) ?? null;
  }

  createRoomFor(
    playerId: string,
    ranked = false,
    maxPlayers = 4,
  ): { ok: true } | { ok: false; error: string } {
    if (this.playerRoom.has(playerId)) {
      return { ok: false, error: "Already in a room" };
    }
    ensureProfiles([playerId], this.profiles);
    const profile = this.profiles.get(playerId);
    if (profile && !canEnterMatch(profile.score)) {
      return { ok: false, error: "积分不足" };
    }
    this.cancelMatchmake(playerId);
    const seats = this.normalizeMaxPlayers(maxPlayers);
    let code = randomRoomCode();
    while (this.rooms.has(code)) code = randomRoomCode();

    const room = createRoom({
      roomCode: code,
      hostId: playerId,
      ranked,
      maxPlayers: seats,
    });
    this.rooms.set(code, room);
    this.playerRoom.set(playerId, code);
    this.broadcastRoom(room);
    this.pushScore(playerId);
    return { ok: true };
  }

  matchmake(
    playerId: string,
    maxPlayers: 3 | 4,
    ranked = true,
  ): { ok: true } | { ok: false; error: string } {
    if (this.playerRoom.has(playerId)) {
      return { ok: false, error: "Already in a room" };
    }
    ensureProfiles([playerId], this.profiles);
    const profile = this.profiles.get(playerId);
    if (profile && !canEnterMatch(profile.score)) {
      return { ok: false, error: "积分不足" };
    }
    const seats = maxPlayers === 3 ? 3 : 4;
    const key = this.queueKey(seats, ranked);
    const prevKey = this.leaveQueue(playerId);
    if (prevKey && prevKey !== key) this.pushQueue(prevKey);
    const queue = this.matchQueues.get(key) ?? [];
    if (!queue.includes(playerId)) queue.push(playerId);
    this.matchQueues.set(key, queue);
    this.playerQueueKey.set(playerId, key);

    if (queue.length >= seats) {
      const group = queue.splice(0, seats);
      this.matchQueues.set(key, queue);
      for (const id of group) this.playerQueueKey.delete(id);
      this.pushQueue(key);

      let code = randomRoomCode();
      while (this.rooms.has(code)) code = randomRoomCode();
      const room = createRoom({
        roomCode: code,
        hostId: group[0],
        ranked,
        maxPlayers: seats,
      });
      for (let i = 1; i < group.length; i += 1) {
        joinRoom(room, group[i]);
      }
      this.rooms.set(code, room);
      for (const id of group) {
        this.playerRoom.set(id, code);
        this.pushScore(id);
      }
      this.broadcastRoom(room);
      return this.startMatch(group[0]);
    }

    this.pushQueue(key);
    return { ok: true };
  }

  cancelMatchmake(playerId: string): { ok: true } | { ok: false; error: string } {
    const key = this.leaveQueue(playerId);
    if (!key) return { ok: true };
    const { maxPlayers, ranked } = this.parseQueueKey(key);
    this.send(playerId, {
      type: "matchmaking",
      status: "cancelled",
      maxPlayers,
      ranked,
      queueSize: this.matchQueues.get(key)?.length ?? 0,
    });
    this.pushQueue(key);
    return { ok: true };
  }

  joinRoomFor(
    playerId: string,
    roomCode: string,
  ): { ok: true } | { ok: false; error: string } {
    if (this.playerRoom.has(playerId)) {
      return { ok: false, error: "Already in a room" };
    }
    this.cancelMatchmake(playerId);
    const room = this.rooms.get(roomCode.toUpperCase());
    if (!room || room.phase === "closed") {
      return { ok: false, error: "Room not found" };
    }
    const err = joinRoom(room, playerId);
    if (err) return { ok: false, error: err };
    this.playerRoom.set(playerId, room.roomCode);
    ensureProfiles([playerId], this.profiles);
    this.broadcastRoom(room);
    this.pushScore(playerId);
    return { ok: true };
  }

  leaveRoomFor(playerId: string): { ok: true } | { ok: false; error: string } {
    this.cancelMatchmake(playerId);
    const room = this.getPlayerRoom(playerId);
    if (!room) return { ok: false, error: "Not in a room" };
    if (room.phase === "in_match") {
      return { ok: false, error: "Cannot leave during match" };
    }
    const err = leaveRoom(room, playerId);
    if (err) return { ok: false, error: err };
    this.playerRoom.delete(playerId);
    if (room.phase === "closed") {
      this.rooms.delete(room.roomCode);
    } else {
      this.broadcastRoom(room);
    }
    return { ok: true };
  }

  disconnect(playerId: string): void {
    const key = this.leaveQueue(playerId);
    if (key) this.pushQueue(key);
    const room = this.getPlayerRoom(playerId);
    if (!room) return;
    if (room.phase === "lobby") {
      this.leaveRoomFor(playerId);
    }
    // 对局中断线：暂留座位，仅停止推送（重连同 playerId 可恢复）
  }

  /** 重连后补发房间 / 对局 / 积分快照 */
  resyncPlayer(playerId: string, now = Date.now()): void {
    const id = sanitizePlayerId(playerId);
    if (!id) return;
    // Steam 每日恢复：负分跨天自动回 0
    ensureProfiles([id], this.profiles);
    const profile = this.profiles.get(id);
    if (profile && dailyRestoreNegativeScore(profile, now)) {
      this.persistAccounts();
    }
    this.pushScore(id);
    this.pushAvatar(id);
    const queueKey = this.playerQueueKey.get(id);
    if (queueKey) {
      const queue = this.matchQueues.get(queueKey) ?? [];
      const { maxPlayers, ranked } = this.parseQueueKey(queueKey);
      this.send(id, {
        type: "matchmaking",
        status: "queued",
        maxPlayers,
        ranked,
        queueSize: queue.length,
      });
    }
    const room = this.getPlayerRoom(id);
    if (!room || room.phase === "closed") return;
    this.send(id, { type: "room", room: this.roomSnapshot(room) });
    if (room.phase === "in_match" && room.match) {
      if (room.match.phase === MatchPhase.Auction && room.match.auction) {
        refreshLotIdleClock(room.match.auction, now);
      }
      const view = this.matchView(room, id, now);
      if (view) this.send(id, { type: "match", view });
    }
  }

  startMatch(playerId: string, now = Date.now()): { ok: true } | { ok: false; error: string } {
    const room = this.getPlayerRoom(playerId);
    if (!room) return { ok: false, error: "Not in a room" };
    if (room.hostId !== playerId) return { ok: false, error: "Only host can start" };
    if (room.playerIds.length < room.maxPlayers) {
      return { ok: false, error: "Room not full" };
    }
    const err = startRoomMatch(room, now);
    if (err) return { ok: false, error: err };
    this.broadcastRoom(room);
    this.broadcastMatch(room, [], now);
    return { ok: true };
  }

  continuePlay(playerId: string, now = Date.now()): { ok: true } | { ok: false; error: string } {
    const room = this.getPlayerRoom(playerId);
    if (!room) return { ok: false, error: "Not in a room" };
    ensureProfiles([playerId], this.profiles);
    const profile = this.profiles.get(playerId);
    if (room.ranked && profile && !canEnterMatch(profile.score)) {
      return { ok: false, error: "积分不足" };
    }
    const marked = markContinuePlay(room, playerId);
    if (marked) return { ok: false, error: marked };
    if (continuePlayFull(room)) {
      if (room.ranked) {
        for (const id of room.playerIds) {
          const p = this.profiles.get(id);
          if (p && !canEnterMatch(p.score)) {
            return { ok: false, error: "积分不足" };
          }
        }
      }
      const err = startRoomMatch(room, now);
      if (err) return { ok: false, error: err };
      this.broadcastRoom(room);
      this.broadcastMatch(room, [], now);
      return { ok: true };
    }
    this.broadcastRoom(room);
    return { ok: true };
  }

  private requireMatch(playerId: string): RoomState | { error: string } {
    const room = this.getPlayerRoom(playerId);
    if (!room) return { error: "Not in a room" };
    if (!room.match || room.phase !== "in_match") return { error: "No active match" };
    return room;
  }

  private afterMatchAction(
    room: RoomState,
    events: unknown[],
    now: number,
  ): void {
    const match = room.match;
    if (!match) return;

    const allEvents = [...events];
    if (match.phase === MatchPhase.Playing || match.phase === MatchPhase.Dealing) {
      allEvents.push(...applyAutoPlay(match, now));
    }

    if (match.phase === MatchPhase.Finished) {
      this.broadcastMatch(room, allEvents, now);
      const settlement = settleRoomMatch(room, this.profiles, now);
      if (settlement) {
        for (const id of room.playerIds) {
          this.send(id, {
            type: "settlement",
            deltas: settlement.deltas.map((d) => ({
              playerId: d.playerId,
              rank: d.rank,
              delta: d.delta,
              scoreAfter: d.scoreAfter,
            })),
          });
          this.pushScore(id);
        }
        this.persistAccounts();
      }
      this.broadcastRoom(room);
      return;
    }

    this.broadcastMatch(room, allEvents, now);
  }

  private commitMatchIntent(
    room: RoomState,
    playerId: string,
    result: { ok: true; events: unknown[] } | { ok: false; error: string },
    now: number,
  ) {
    if (!result.ok) return { ok: false as const, error: result.error };
    this.afterMatchAction(room, result.events, now);
    return { ok: true as const };
  }

  /** 点托管进入；点屏幕正中「取消托管」退出。 */
  setAutoPlay(playerId: string, enabled: boolean, now = Date.now()) {
    const roomOrErr = this.requireMatch(playerId);
    if ("error" in roomOrErr) return { ok: false as const, error: roomOrErr.error };
    const result = setMatchAutoPlay(roomOrErr.match!, playerId, enabled, now);
    if (!result.ok) return { ok: false as const, error: result.error };
    this.afterMatchAction(roomOrErr, result.events, now);
    return { ok: true as const };
  }

  resolveAfkHostChoice(playerId: string, host: boolean, now = Date.now()) {
    const roomOrErr = this.requireMatch(playerId);
    if ("error" in roomOrErr) return { ok: false as const, error: roomOrErr.error };
    return this.commitMatchIntent(
      roomOrErr,
      playerId,
      resolveAfkHost(roomOrErr.match!, playerId, host, now),
      now,
    );
  }

  auctionOpen(playerId: string, now = Date.now()) {
    const roomOrErr = this.requireMatch(playerId);
    if ("error" in roomOrErr) return { ok: false as const, error: roomOrErr.error };
    const result = matchPlaceOpeningBid(roomOrErr.match!, playerId, now);
    if (!result.ok) return { ok: false as const, error: result.error };
    this.afterMatchAction(roomOrErr, result.events, now);
    return { ok: true as const };
  }

  auctionRaise(playerId: string, raise: RaiseAmount, now = Date.now()) {
    const roomOrErr = this.requireMatch(playerId);
    if ("error" in roomOrErr) return { ok: false as const, error: roomOrErr.error };
    const result = matchPlaceRaise(roomOrErr.match!, playerId, raise, now);
    if (!result.ok) return { ok: false as const, error: result.error };
    this.afterMatchAction(roomOrErr, result.events, now);
    return { ok: true as const };
  }

  skipAuction(playerId: string, now = Date.now()) {
    const roomOrErr = this.requireMatch(playerId);
    if ("error" in roomOrErr) return { ok: false as const, error: roomOrErr.error };
    if (roomOrErr.hostId !== playerId) {
      return { ok: false as const, error: "Only host can skip auction" };
    }
    const result = skipAuctionAndDeal(roomOrErr.match!, now);
    if (!result.ok) return { ok: false as const, error: result.error };
    this.afterMatchAction(roomOrErr, result.events, now);
    return { ok: true as const };
  }

  play(playerId: string, cardIds: string[], now = Date.now()) {
    const roomOrErr = this.requireMatch(playerId);
    if ("error" in roomOrErr) return { ok: false as const, error: roomOrErr.error };
    return this.commitMatchIntent(
      roomOrErr,
      playerId,
      playCards(roomOrErr.match!, playerId, cardIds, now),
      now,
    );
  }

  pass(playerId: string, now = Date.now()) {
    const roomOrErr = this.requireMatch(playerId);
    if ("error" in roomOrErr) return { ok: false as const, error: roomOrErr.error };
    return this.commitMatchIntent(
      roomOrErr,
      playerId,
      passTurn(roomOrErr.match!, playerId, now),
      now,
    );
  }

  quickChat(
    playerId: string,
    phraseId: QuickChatId,
    now = Date.now(),
  ): { ok: true } | { ok: false; error: string } {
    const roomOrErr = this.requireMatch(playerId);
    if ("error" in roomOrErr) return { ok: false, error: roomOrErr.error };
    if (!isQuickChatId(phraseId)) return { ok: false, error: "Invalid quick chat phrase" };
    const phase = roomOrErr.match!.phase;
    if (phase !== MatchPhase.Dealing && phase !== MatchPhase.Playing) {
      return { ok: false, error: "Quick chat unavailable" };
    }
    const lastAt = this.quickChatAt.get(playerId);
    if (lastAt != null && now - lastAt < 5000) {
      return { ok: false, error: "Quick chat too frequent" };
    }
    this.quickChatAt.set(playerId, now);
    for (const id of roomOrErr.playerIds) {
      this.send(id, { type: "quick_chat", playerId, phraseId });
    }
    return { ok: true };
  }

  yieldLead(playerId: string, now = Date.now()) {
    const roomOrErr = this.requireMatch(playerId);
    if ("error" in roomOrErr) return { ok: false as const, error: roomOrErr.error };
    return this.commitMatchIntent(
      roomOrErr,
      playerId,
      yieldControlledLead(roomOrErr.match!, playerId, now),
      now,
    );
  }

  useItem(
    playerId: string,
    itemId: string,
    payload: UseItemPayload = {},
    now = Date.now(),
  ) {
    const roomOrErr = this.requireMatch(playerId);
    if ("error" in roomOrErr) return { ok: false as const, error: roomOrErr.error };
    return this.commitMatchIntent(
      roomOrErr,
      playerId,
      useMatchItem(roomOrErr.match!, playerId, itemId, payload, now),
      now,
    );
  }

  declineItemOffer(playerId: string, now = Date.now()) {
    const roomOrErr = this.requireMatch(playerId);
    if ("error" in roomOrErr) return { ok: false as const, error: roomOrErr.error };
    return this.commitMatchIntent(
      roomOrErr,
      playerId,
      declineItemOffer(roomOrErr.match!, playerId, now),
      now,
    );
  }

  resolveSwap(playerId: string, targetId: string | null, now = Date.now()) {
    const roomOrErr = this.requireMatch(playerId);
    if ("error" in roomOrErr) return { ok: false as const, error: roomOrErr.error };
    return this.commitMatchIntent(
      roomOrErr,
      playerId,
      resolveSwapHands(roomOrErr.match!, playerId, targetId, now),
      now,
    );
  }

  resolveRpsChoice(playerId: string, choice: RpsChoice, now = Date.now()) {
    const roomOrErr = this.requireMatch(playerId);
    if ("error" in roomOrErr) return { ok: false as const, error: roomOrErr.error };
    return this.commitMatchIntent(
      roomOrErr,
      playerId,
      resolveRps(roomOrErr.match!, playerId, choice, now),
      now,
    );
  }

  resolveScoreDoubleChoice(
    playerId: string,
    choice: "none" | "double" | "super",
    now = Date.now(),
  ) {
    const roomOrErr = this.requireMatch(playerId);
    if ("error" in roomOrErr) return { ok: false as const, error: roomOrErr.error };
    return this.commitMatchIntent(
      roomOrErr,
      playerId,
      resolveScoreDouble(roomOrErr.match!, playerId, choice, now),
      now,
    );
  }

  /** 定时推进拍卖成交 / 互动窗口 / 出牌超时 */
  tickAll(now = Date.now()): void {
    for (const room of this.rooms.values()) {
      if (room.phase !== "in_match" || !room.match) continue;
      const match = room.match;

      if (match.phase === MatchPhase.Auction) {
        const result = matchTickAuction(match, now);
        if (result.ok) this.afterMatchAction(room, result.events, now);
        continue;
      }

      if (match.phase === MatchPhase.Playing || match.phase === MatchPhase.Dealing) {
        const result = tickMatch(match, now);
        if (result.ok) this.afterMatchAction(room, result.events, now);
      }
    }
  }
}
