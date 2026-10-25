import fs from "node:fs";
import path from "node:path";
import { AvatarProfile, normalizeAvatarProfile } from "../avatar/profile.js";
import { PlayerScoreProfile, ScoreLedgerEntry } from "./types.js";

export interface AccountSnapshot {
  profiles: Map<string, PlayerScoreProfile>;
  names: Map<string, string>;
  /** playerId → 形象（纯外观） */
  avatars: Map<string, AvatarProfile>;
  /** playerId → 头像 URL（可下发房间快照） */
  portraits: Map<string, string>;
}

export interface ScoreStore {
  load(): AccountSnapshot;
  save(snapshot: AccountSnapshot): void;
}

export function emptySnapshot(): AccountSnapshot {
  return {
    profiles: new Map(),
    names: new Map(),
    avatars: new Map(),
    portraits: new Map(),
  };
}

export function sanitizePlayerId(raw: string): string | null {
  const id = raw.trim();
  if (!/^[a-zA-Z0-9_-]{1,32}$/.test(id)) return null;
  return id;
}

export function sanitizeDisplayName(raw: string, fallback: string): string {
  const name = raw.replace(/[\r\n\t]/g, " ").trim().slice(0, 16);
  return name || fallback.slice(0, 16);
}

/** 仅允许 http/https 头像地址；非法则空串（保留已存头像） */
export function sanitizePortraitUrl(raw: string | undefined | null): string {
  if (typeof raw !== "string") return "";
  const url = raw.trim().slice(0, 1024);
  if (!url) return "";
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return "";
    if (parsed.username || parsed.password) return "";
    return url;
  } catch {
    return "";
  }
}

interface PersistedFile {
  version: 1;
  savedAt: number;
  names: Record<string, string>;
  profiles: Record<string, PlayerScoreProfile>;
  avatars?: Record<string, AvatarProfile>;
  portraits?: Record<string, string>;
}

function cloneProfile(profile: PlayerScoreProfile): PlayerScoreProfile {
  return {
    playerId: profile.playerId,
    score: profile.score,
    lifetimeGainByMode: { ...profile.lifetimeGainByMode },
    ledger: profile.ledger.map((e) => ({ ...e })),
    nextNegativeRestore: profile.nextNegativeRestore === "share" ? "share" : "ad",
    lastDailyRestoreDay: profile.lastDailyRestoreDay,
  };
}

export function cloneSnapshot(snapshot: AccountSnapshot): AccountSnapshot {
  const profiles = new Map<string, PlayerScoreProfile>();
  for (const [id, profile] of snapshot.profiles) {
    profiles.set(id, cloneProfile(profile));
  }
  const avatars = new Map<string, AvatarProfile>();
  for (const [id, rec] of snapshot.avatars ?? new Map()) {
    avatars.set(id, {
      equipped: rec.equipped,
      unlocked: [...rec.unlocked],
    });
  }
  return {
    profiles,
    names: new Map(snapshot.names),
    avatars,
    portraits: new Map(snapshot.portraits ?? new Map()),
  };
}

function isLedgerEntry(value: unknown): value is ScoreLedgerEntry {
  if (!value || typeof value !== "object") return false;
  const e = value as ScoreLedgerEntry;
  return (
    typeof e.id === "string" &&
    typeof e.playerId === "string" &&
    typeof e.delta === "number" &&
    typeof e.scoreAfter === "number" &&
    typeof e.ranked === "boolean" &&
    typeof e.createdAt === "number"
  );
}

function parseProfile(id: string, raw: unknown): PlayerScoreProfile | null {
  if (!raw || typeof raw !== "object") return null;
  const p = raw as PlayerScoreProfile;
  if (typeof p.score !== "number" || !Number.isFinite(p.score)) return null;
  const lifetime =
    p.lifetimeGainByMode && typeof p.lifetimeGainByMode === "object"
      ? Object.fromEntries(
          Object.entries(p.lifetimeGainByMode).filter(
            (entry): entry is [string, number] => typeof entry[1] === "number",
          ),
        )
      : {};
  const ledger = Array.isArray(p.ledger) ? p.ledger.filter(isLedgerEntry) : [];
  return {
    playerId: id,
    score: p.score,
    lifetimeGainByMode: lifetime,
    ledger,
    nextNegativeRestore: p.nextNegativeRestore === "share" ? "share" : "ad",
    lastDailyRestoreDay:
      typeof p.lastDailyRestoreDay === "string" ? p.lastDailyRestoreDay : undefined,
  };
}

export class MemoryScoreStore implements ScoreStore {
  private snapshot: AccountSnapshot;

  constructor(initial?: AccountSnapshot) {
    this.snapshot = initial ? cloneSnapshot(initial) : emptySnapshot();
  }

  load(): AccountSnapshot {
    return cloneSnapshot(this.snapshot);
  }

  save(snapshot: AccountSnapshot): void {
    this.snapshot = cloneSnapshot(snapshot);
  }
}

export class JsonFileScoreStore implements ScoreStore {
  constructor(private readonly filePath: string) {}

  load(): AccountSnapshot {
    if (!fs.existsSync(this.filePath)) return emptySnapshot();
    try {
      const raw = JSON.parse(fs.readFileSync(this.filePath, "utf8")) as PersistedFile;
      const names = new Map<string, string>();
      for (const [id, name] of Object.entries(raw.names ?? {})) {
        if (typeof name === "string" && sanitizePlayerId(id)) names.set(id, name);
      }
      const profiles = new Map<string, PlayerScoreProfile>();
      for (const [id, value] of Object.entries(raw.profiles ?? {})) {
        if (!sanitizePlayerId(id)) continue;
        const profile = parseProfile(id, value);
        if (profile) profiles.set(id, profile);
      }
      const avatars = new Map<string, AvatarProfile>();
      for (const [id, value] of Object.entries(raw.avatars ?? {})) {
        if (!sanitizePlayerId(id)) continue;
        avatars.set(id, normalizeAvatarProfile(value));
      }
      const portraits = new Map<string, string>();
      for (const [id, url] of Object.entries(raw.portraits ?? {})) {
        if (!sanitizePlayerId(id)) continue;
        const safe = sanitizePortraitUrl(url);
        if (safe) portraits.set(id, safe);
      }
      return { profiles, names, avatars, portraits };
    } catch (err) {
      console.error(`[animal-card-auction] failed to read ${this.filePath}:`, err);
      return emptySnapshot();
    }
  }

  save(snapshot: AccountSnapshot): void {
    const payload: PersistedFile = {
      version: 1,
      savedAt: Date.now(),
      names: Object.fromEntries(snapshot.names),
      profiles: Object.fromEntries(
        [...snapshot.profiles.entries()].map(([id, profile]) => [id, cloneProfile(profile)]),
      ),
      avatars: Object.fromEntries(
        [...(snapshot.avatars ?? new Map()).entries()].map(([id, rec]) => [
          id,
          { equipped: rec.equipped, unlocked: [...rec.unlocked] },
        ]),
      ),
      portraits: Object.fromEntries(snapshot.portraits ?? new Map()),
    };
    const dir = path.dirname(this.filePath);
    fs.mkdirSync(dir, { recursive: true });
    const tmp = `${this.filePath}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(payload, null, 2), "utf8");
    try {
      fs.renameSync(tmp, this.filePath);
    } catch {
      fs.copyFileSync(tmp, this.filePath);
      fs.unlinkSync(tmp);
    }
  }
}
