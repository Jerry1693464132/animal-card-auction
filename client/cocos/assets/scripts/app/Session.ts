import { MatchPlayerView, RoomSnapshot, SettlementDelta } from "../net/Protocol";
import { sys } from "cc";
import { DEFAULT_AVATAR_ID } from "./avatars";

// 沿用 party-cards 前缀，确保升级后仍能恢复本机 playerId 和昵称。
const ID_KEY = "party-cards.playerId";
const NAME_KEY = "party-cards.displayName";
const AUTH_KEY = "party-cards.authKind";
const AVATAR_URL_KEY = "party-cards.avatarUrl";

export type AuthKind = "local";

function readKey(key: string): string {
  try {
    return sys.localStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
}

function writeKey(key: string, value: string): void {
  try {
    sys.localStorage.setItem(key, value);
  } catch {
    // preview 无存储时仍可本局游玩
  }
}

/** 桌面/浏览器：每个标签页独立账号（避免多开串号）。 */
type TabStore = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
};

function tabScopedStorage(): TabStore | null {
  try {
    const store = (globalThis as { sessionStorage?: TabStore }).sessionStorage;
    return store ?? null;
  } catch {
    return null;
  }
}

function identityGet(key: string): string {
  const tab = tabScopedStorage();
  if (tab) {
    try {
      return tab.getItem(key) ?? "";
    } catch {
      return "";
    }
  }
  return readKey(key);
}

function identitySet(key: string, value: string): void {
  const tab = tabScopedStorage();
  if (tab) {
    try {
      tab.setItem(key, value);
      return;
    } catch {
      // 回退本机持久存储
    }
  }
  writeKey(key, value);
}

function newPlayerId(): string {
  const n = Math.floor(Math.random() * 1_000_000)
    .toString(36)
    .padStart(5, "0");
  return `u${n}`.slice(0, 32);
}

/** 进程内会话。桌面版每个标签页独立 playerId（sessionStorage）；Steam 正式版可换 SteamID */
export class Session {
  playerId = "";
  displayName = "";
  score = 0;
  room: RoomSnapshot | null = null;
  matchView: MatchPlayerView | null = null;
  lastSettlement: SettlementDelta[] | null = null;
  matchmakingText = "";
  lastError = "";
  lastEventText = "";
  authKind: AuthKind = "local";
  /** 头像 URL（Steam 正式版为 Steam 头像；开发期为空） */
  avatarUrl = "";
  /** 服务端下发的下次每日恢复 UTC 日期（YYYY-MM-DD），负分时非空 */
  dailyRestoreDay: string | null = null;
  equippedAvatar = DEFAULT_AVATAR_ID;
  unlockedAvatars: string[] = [DEFAULT_AVATAR_ID];

  applyScore(score: number): void {
    this.score = score;
  }

  applyAvatar(equipped: string, unlocked: string[]): void {
    this.equippedAvatar = equipped || DEFAULT_AVATAR_ID;
    this.unlockedAvatars = unlocked.length ? [...unlocked] : [DEFAULT_AVATAR_ID];
  }

  isAvatarUnlocked(id: string): boolean {
    return this.unlockedAvatars.includes(id);
  }

  /** 读本地账号（桌面版始终造本机账号） */
  loadSavedIdentity(): void {
    if (this.playerId) return;
    const savedId = identityGet(ID_KEY);
    const savedName = identityGet(NAME_KEY);
    const savedKind = identityGet(AUTH_KEY);
    if (savedKind === "local") this.authKind = savedKind;
    if (savedId) {
      this.playerId = savedId;
      this.displayName = savedName || `玩家${savedId.slice(1, 6)}`;
    }
    this.avatarUrl = readKey(AVATAR_URL_KEY);
  }

  /** 桌面版直接造本机账号（无微信登录） */
  prepareIdentity(): void {
    this.ensureIdentity();
  }

  ensureIdentity(): void {
    this.loadSavedIdentity();
    if (this.playerId) return;
    this.authKind = "local";
    this.playerId = newPlayerId();
    this.displayName = `玩家${this.playerId.slice(1, 6)}`;
    this.persistIdentity();
  }

  rememberIdentity(playerId: string, displayName: string, kind?: AuthKind): void {
    this.playerId = playerId;
    const incoming = (displayName || "").trim();
    const generic = !incoming || /^玩家[0-9a-z]+$/i.test(incoming);
    const keepLocalName =
      generic &&
      !!this.displayName &&
      !/^玩家[0-9a-z]+$/i.test(this.displayName);
    if (incoming && !keepLocalName) this.displayName = incoming;
    else if (!this.displayName) this.displayName = incoming || playerId;
    if (kind) this.authKind = kind;
    this.persistIdentity();
  }

  setDisplayName(displayName: string): void {
    this.prepareIdentity();
    const name = displayName.replace(/[\r\n\t]/g, " ").trim().slice(0, 16);
    this.displayName = name || this.displayName;
    this.persistIdentity();
  }

  persistIdentity(): void {
    if (!this.playerId) return;
    identitySet(ID_KEY, this.playerId);
    identitySet(NAME_KEY, this.displayName);
    identitySet(AUTH_KEY, this.authKind);
    if (this.avatarUrl) writeKey(AVATAR_URL_KEY, this.avatarUrl);
  }

  applyRemoteProfile(nickName: string, avatarUrl: string): void {
    if (nickName.trim()) this.displayName = nickName.replace(/[\r\n\t]/g, " ").trim().slice(0, 16);
    if (avatarUrl.trim()) this.avatarUrl = avatarUrl.trim();
    this.persistIdentity();
  }

  playerName(id: string): string {
    if (id === this.playerId) return this.displayName || id;
    return this.room?.playerNames[id] ?? id;
  }

  playerPortraitUrl(id: string): string {
    if (id === this.playerId && this.avatarUrl) return this.avatarUrl;
    return this.room?.playerPortraitUrls?.[id] ?? "";
  }

  isHost(): boolean {
    return !!this.room && this.room.hostId === this.playerId;
  }

  setMatchView(view: MatchPlayerView | null): void {
    this.matchView = view;
    if (view?.public?.phase !== "finished") this.lastSettlement = null;
  }

  /** 离开房间回选场大厅：清本地对局，避免大厅误进房间页或再跳拍卖。 */
  clearMatch(): void {
    this.room = null;
    this.matchView = null;
    this.lastSettlement = null;
    this.lastError = "";
    this.lastEventText = "";
    this.matchmakingText = "";
  }
}

export const session = new Session();

