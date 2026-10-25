import {
  DEFAULT_AVATAR_ID,
  defaultUnlockedIds,
  isKnownAvatarId,
} from "./catalog.js";

export interface AvatarProfile {
  equipped: string;
  unlocked: string[];
}

export function createAvatarProfile(): AvatarProfile {
  const unlocked = defaultUnlockedIds();
  return {
    equipped: unlocked.includes(DEFAULT_AVATAR_ID)
      ? DEFAULT_AVATAR_ID
      : unlocked[0] ?? DEFAULT_AVATAR_ID,
    unlocked: [...unlocked],
  };
}

export function normalizeAvatarProfile(raw: unknown): AvatarProfile {
  const fallback = createAvatarProfile();
  if (!raw || typeof raw !== "object") return fallback;
  const o = raw as Partial<AvatarProfile>;
  const unlocked = Array.isArray(o.unlocked)
    ? [...new Set(o.unlocked.filter((id) => typeof id === "string" && isKnownAvatarId(id)))]
    : [];
  for (const id of defaultUnlockedIds()) {
    if (!unlocked.includes(id)) unlocked.push(id);
  }
  let equipped =
    typeof o.equipped === "string" && unlocked.includes(o.equipped)
      ? o.equipped
      : fallback.equipped;
  if (!unlocked.includes(equipped)) equipped = unlocked[0] ?? DEFAULT_AVATAR_ID;
  return { equipped, unlocked };
}

export function unlockAvatar(
  profile: AvatarProfile,
  avatarId: string,
): { ok: true; profile: AvatarProfile } | { ok: false; error: string } {
  if (!isKnownAvatarId(avatarId)) return { ok: false, error: "Unknown avatar" };
  if (profile.unlocked.includes(avatarId)) {
    return { ok: false, error: "Already unlocked" };
  }
  return {
    ok: true,
    profile: {
      equipped: profile.equipped,
      unlocked: [...profile.unlocked, avatarId],
    },
  };
}

export function equipAvatar(
  profile: AvatarProfile,
  avatarId: string,
): { ok: true; profile: AvatarProfile } | { ok: false; error: string } {
  if (!isKnownAvatarId(avatarId)) return { ok: false, error: "Unknown avatar" };
  if (!profile.unlocked.includes(avatarId)) {
    return { ok: false, error: "Avatar locked" };
  }
  return { ok: true, profile: { ...profile, equipped: avatarId } };
}
