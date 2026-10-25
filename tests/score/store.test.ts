import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { GameHub } from "../../src/server/hub.js";
import { ServerMessage } from "../../src/server/protocol.js";
import {
  JsonFileScoreStore,
  MemoryScoreStore,
  sanitizeDisplayName,
  sanitizePlayerId,
  sanitizePortraitUrl,
} from "../../src/score/store.js";
import { createScoreProfile } from "../../src/score/engine.js";

describe("account id helpers", () => {
  it("accepts stable ids and rejects junk", () => {
    expect(sanitizePlayerId("u123")).toBe("u123");
    expect(sanitizePlayerId("cat_01")).toBe("cat_01");
    expect(sanitizePlayerId("b ad")).toBeNull();
    expect(sanitizePlayerId("a".repeat(33))).toBeNull();
  });

  it("trims display names", () => {
    expect(sanitizeDisplayName("  小熊猫  ", "u1")).toBe("小熊猫");
    expect(sanitizeDisplayName("\n", "u1")).toBe("u1");
  });

  it("keeps only http(s) portrait urls", () => {
    expect(sanitizePortraitUrl("https://thirdwx.qlogo.cn/mmopen/abc.jpg")).toBe(
      "https://thirdwx.qlogo.cn/mmopen/abc.jpg",
    );
    expect(sanitizePortraitUrl("javascript:alert(1)")).toBe("");
    expect(sanitizePortraitUrl("not a url")).toBe("");
  });
});

describe("score stores", () => {
  it("memory store round-trips names and scores", () => {
    const store = new MemoryScoreStore();
    const profile = createScoreProfile("u1", 140);
    store.save({
      profiles: new Map([["u1", profile]]),
      names: new Map([["u1", "阿猫"]]),
      avatars: new Map(),
      portraits: new Map([["u1", "https://thirdwx.qlogo.cn/mmopen/cat.jpg"]]),
    });
    const loaded = store.load();
    expect(loaded.names.get("u1")).toBe("阿猫");
    expect(loaded.portraits.get("u1")).toBe("https://thirdwx.qlogo.cn/mmopen/cat.jpg");
    expect(loaded.profiles.get("u1")?.score).toBe(140);
    expect(loaded.profiles.get("u1")?.nextNegativeRestore).toBe("ad");
    loaded.profiles.get("u1")!.score = 1;
    expect(store.load().profiles.get("u1")?.score).toBe(140);
  });

  it("json file store survives reload", () => {
    const file = path.join(os.tmpdir(), `animal-card-auction-score-${Date.now()}.json`);
    const store = new JsonFileScoreStore(file);
    store.save({
      profiles: new Map([["u9", createScoreProfile("u9", 70)]]),
      names: new Map([["u9", "阿狗"]]),
      avatars: new Map(),
      portraits: new Map([["u9", "https://wx.qlogo.cn/dog.png"]]),
    });
    const loaded = new JsonFileScoreStore(file).load();
    expect(loaded.names.get("u9")).toBe("阿狗");
    expect(loaded.portraits.get("u9")).toBe("https://wx.qlogo.cn/dog.png");
    expect(loaded.profiles.get("u9")?.score).toBe(70);
    fs.unlinkSync(file);
  });

  it("daily restore day round-trips through json file store", () => {
    const file = path.join(os.tmpdir(), `animal-card-auction-daily-${Date.now()}.json`);
    const store = new JsonFileScoreStore(file);
    const profile = createScoreProfile("u7", -30);
    profile.lastDailyRestoreDay = "2026-09-18";
    store.save({
      profiles: new Map([["u7", profile]]),
      names: new Map([["u7", "阿七"]]),
      avatars: new Map(),
      portraits: new Map(),
    });
    const loaded = new JsonFileScoreStore(file).load();
    expect(loaded.profiles.get("u7")?.lastDailyRestoreDay).toBe("2026-09-18");
    expect(loaded.profiles.get("u7")?.score).toBe(-30);
    fs.unlinkSync(file);
  });
});

describe("GameHub account persist", () => {
  it("reloads nickname and starting score from store", () => {
    const store = new MemoryScoreStore();
    const inbox = new Map<string, ServerMessage[]>();
    const send = (playerId: string, message: ServerMessage) => {
      const list = inbox.get(playerId) ?? [];
      list.push(message);
      inbox.set(playerId, list);
    };

    const hub1 = new GameHub(send, { store });
    hub1.setDisplayName("a", "Alice");
    hub1.setPortraitUrl("a", "https://thirdwx.qlogo.cn/mmopen/alice.jpg");
    expect(hub1.getDisplayName("a")).toBe("Alice");

    const hub2 = new GameHub(send, { store });
    expect(hub2.getDisplayName("a")).toBe("Alice");
    expect(hub2.getPortraitUrl("a")).toBe("https://thirdwx.qlogo.cn/mmopen/alice.jpg");
    inbox.clear();
    hub2.resyncPlayer("a");
    const score = [...(inbox.get("a") ?? [])].reverse().find((m) => m.type === "score");
    expect(score && score.type === "score" ? score.score : null).toBe(4000);
  });

  it("migrates unused legacy 100 starting scores on load", () => {
    const store = new MemoryScoreStore({
      profiles: new Map([["a", createScoreProfile("a", 100)]]),
      names: new Map([["a", "Alice"]]),
      avatars: new Map(),
      portraits: new Map(),
    });
    const inbox = new Map<string, ServerMessage[]>();
    const send = (playerId: string, message: ServerMessage) => {
      const list = inbox.get(playerId) ?? [];
      list.push(message);
      inbox.set(playerId, list);
    };
    const hub = new GameHub(send, { store });
    hub.resyncPlayer("a");
    const score = [...(inbox.get("a") ?? [])].reverse().find((m) => m.type === "score");
    expect(score && score.type === "score" ? score.score : null).toBe(4000);
    expect(store.load().profiles.get("a")?.score).toBe(4000);
  });
});
