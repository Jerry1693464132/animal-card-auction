import { describe, expect, it } from "vitest";
import {
  AVATAR_CATALOG,
  DEFAULT_AVATAR_ID,
  createAvatarProfile,
  equipAvatar,
  unlockAvatar,
} from "../../src/avatar/index.js";
import { GameHub } from "../../src/server/hub.js";
import { MemoryScoreStore } from "../../src/score/store.js";
import { ServerMessage } from "../../src/server/protocol.js";

describe("avatar profile", () => {
  it("ships only the default panda", () => {
    expect(AVATAR_CATALOG).toHaveLength(1);
    expect(AVATAR_CATALOG[0]?.id).toBe(DEFAULT_AVATAR_ID);
    expect(AVATAR_CATALOG.filter((a) => a.unlock === "ad")).toHaveLength(0);
  });

  it("starts with default animal unlocked", () => {
    const p = createAvatarProfile();
    expect(p.equipped).toBe(DEFAULT_AVATAR_ID);
    expect(p.unlocked).toContain(DEFAULT_AVATAR_ID);
  });

  it("rejects retired animal ids", () => {
    const base = createAvatarProfile();
    expect(unlockAvatar(base, "fox").ok).toBe(false);
    expect(equipAvatar(base, "fox").ok).toBe(false);
  });
});

describe("GameHub avatar", () => {
  it("pushes default panda on room snapshot", () => {
    const store = new MemoryScoreStore();
    const inbox = new Map<string, ServerMessage[]>();
    const hub = new GameHub(
      (playerId, message) => {
        const list = inbox.get(playerId) ?? [];
        list.push(message);
        inbox.set(playerId, list);
      },
      { store },
    );

    hub.setDisplayName("u1", "测");
    expect(hub.claimAvatarUnlock("u1", "fox").ok).toBe(false);
    expect(hub.getEquippedAvatar("u1")).toBe(DEFAULT_AVATAR_ID);
  });

  it("includes equipped avatar in room snapshot", () => {
    const inbox = new Map<string, ServerMessage[]>();
    const hub = new GameHub((playerId, message) => {
      const list = inbox.get(playerId) ?? [];
      list.push(message);
      inbox.set(playerId, list);
    });
    hub.setDisplayName("a", "A");
    hub.createRoomFor("a", false, 3);
    const room = [...(inbox.get("a") ?? [])].reverse().find((m) => m.type === "room");
    expect(room && room.type === "room" ? room.room.playerAvatars.a : null).toBe("panda");
  });
});
