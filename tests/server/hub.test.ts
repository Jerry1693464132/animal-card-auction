import { describe, expect, it, beforeEach } from "vitest";
import { GameHub } from "../../src/server/hub.js";
import { ServerMessage } from "../../src/server/protocol.js";
import { MatchPhase } from "../../src/index.js";
import { createScoreProfile } from "../../src/score/engine.js";
import { emptySnapshot, MemoryScoreStore } from "../../src/score/store.js";

describe("GameHub", () => {
  const inbox = new Map<string, ServerMessage[]>();
  let hub: GameHub;

  function messages(playerId: string) {
    return inbox.get(playerId) ?? [];
  }

  function lastOf<T extends ServerMessage["type"]>(
    playerId: string,
    type: T,
  ): Extract<ServerMessage, { type: T }> | null {
    const list = messages(playerId).filter((m) => m.type === type);
    return (list[list.length - 1] as Extract<ServerMessage, { type: T }>) ?? null;
  }

  beforeEach(() => {
    inbox.clear();
    hub = new GameHub((playerId, message) => {
      const list = inbox.get(playerId) ?? [];
      list.push(message);
      inbox.set(playerId, list);
    });
    hub.setDisplayName("a", "Alice");
    hub.setDisplayName("b", "Bob");
  });

  it("creates and joins room then starts match", () => {
    expect(hub.createRoomFor("a", true, 2).ok).toBe(true);
    const roomMsg = lastOf("a", "room");
    expect(roomMsg?.room.hostId).toBe("a");
    expect(roomMsg?.room.ranked).toBe(true);
    expect(roomMsg?.room.maxPlayers).toBe(2);

    const code = roomMsg!.room.roomCode;
    expect(hub.joinRoomFor("b", code).ok).toBe(true);
    expect(hub.startMatch("b").ok).toBe(false);
    expect(hub.startMatch("a").ok).toBe(true);
    expect(lastOf("a", "match")).not.toBeNull();
    expect(lastOf("b", "match")).not.toBeNull();
  });

  it("broadcasts portrait urls in the room snapshot", () => {
    hub.setPortraitUrl("a", "https://example.com/avatars/alice.jpg");
    expect(hub.createRoomFor("a", true, 3).ok).toBe(true);
    expect(lastOf("a", "room")?.room.playerPortraitUrls.a).toBe(
      "https://example.com/avatars/alice.jpg",
    );
    hub.setPortraitUrl("b", "javascript:alert(1)");
    const code = lastOf("a", "room")!.room.roomCode;
    expect(hub.joinRoomFor("b", code).ok).toBe(true);
    expect(lastOf("a", "room")?.room.playerPortraitUrls.b).toBe("");
    hub.setPortraitUrl("b", "https://example.com/avatars/bob.jpg");
    expect(lastOf("a", "room")?.room.playerPortraitUrls.b).toBe(
      "https://example.com/avatars/bob.jpg",
    );
  });

  it("host can skip auction and deal private hands", () => {
    hub.createRoomFor("a", false, 2);
    const code = lastOf("a", "room")!.room.roomCode;
    hub.joinRoomFor("b", code);
    hub.startMatch("a", 0);
    expect(hub.skipAuction("a", 0).ok).toBe(true);

    const view = lastOf("a", "match")!.view;
    expect(view.public.phase).toBe(MatchPhase.Playing);
    expect(view.hand.length).toBeGreaterThan(0);
    expect(view.auction).toBeNull();
    expect(view.public.scores?.a).toBe(4000);
    expect(view.public.scores?.b).toBe(4000);
  });

  it("forwards auction bid events and shows spendable balance", () => {
    hub.createRoomFor("a", false, 2);
    const code = lastOf("a", "room")!.room.roomCode;
    hub.joinRoomFor("b", code);
    hub.startMatch("a", 0);
    inbox.set("a", []);
    expect(hub.auctionRaise("a", 10, 100).ok).toBe(true);
    const ev = lastOf("a", "events");
    expect(ev?.events.some((e) => (e as { type: string }).type === "bid")).toBe(true);
    const view = lastOf("a", "match")!.view;
    expect(view.auction?.currentPrice).toBe(20);
    expect(view.auction?.balances.a).toBe(280);
  });

  it("broadcasts validated quick chat and rate limits each player", () => {
    hub.createRoomFor("a", false, 2);
    const code = lastOf("a", "room")!.room.roomCode;
    hub.joinRoomFor("b", code);
    hub.startMatch("a", 0);
    hub.skipAuction("a", 0);
    inbox.set("a", []);
    inbox.set("b", []);

    expect(hub.quickChat("a", "be-friends", 1000).ok).toBe(true);
    expect(lastOf("a", "quick_chat")).toMatchObject({
      playerId: "a",
      phraseId: "be-friends",
    });
    expect(lastOf("b", "quick_chat")).toMatchObject({
      playerId: "a",
      phraseId: "be-friends",
    });
    expect(hub.quickChat("a", "just-this", 5999).ok).toBe(false);
    expect(hub.quickChat("a", "just-this", 6000).ok).toBe(true);
    expect(hub.quickChat("a", "invalid" as never, 11000).ok).toBe(false);
  });

  it("rejects second room membership", () => {
    hub.createRoomFor("a", false, 2);
    expect(hub.createRoomFor("a", false, 2).ok).toBe(false);
  });

  it("resyncs room and match after reconnect", () => {
    hub.createRoomFor("a", false, 2);
    const code = lastOf("a", "room")!.room.roomCode;
    hub.joinRoomFor("b", code);
    hub.startMatch("a", 0);
    hub.skipAuction("a", 0);
    inbox.set("a", []);

    hub.resyncPlayer("a", 1);
    expect(lastOf("a", "score")).not.toBeNull();
    expect(lastOf("a", "room")?.room.roomCode).toBe(code);
    expect(lastOf("a", "match")?.view.public.phase).toBe(MatchPhase.Playing);
  });

  it("matchmakes three players into a full room and starts", () => {
    hub.setDisplayName("c", "Cara");
    expect(hub.matchmake("a", 3, true).ok).toBe(true);
    expect(lastOf("a", "matchmaking")?.status).toBe("queued");
    expect(lastOf("a", "matchmaking")?.queueSize).toBe(1);
    expect(hub.matchmake("b", 3, true).ok).toBe(true);
    expect(lastOf("a", "matchmaking")?.queueSize).toBe(2);
    expect(lastOf("b", "matchmaking")?.queueSize).toBe(2);
    expect(hub.matchmake("c", 3, true).ok).toBe(true);
    expect(lastOf("a", "room")?.room.maxPlayers).toBe(3);
    expect(lastOf("a", "room")?.room.playerIds).toHaveLength(3);
    expect(lastOf("a", "match")).not.toBeNull();
    expect(lastOf("b", "match")).not.toBeNull();
    expect(lastOf("c", "match")).not.toBeNull();
  });

  it("broadcasts queue size to everyone waiting", () => {
    hub.setDisplayName("c", "Cara");
    hub.matchmake("a", 3, true);
    hub.matchmake("b", 3, true);
    expect(lastOf("a", "matchmaking")).toMatchObject({
      status: "queued",
      queueSize: 2,
      maxPlayers: 3,
    });
    expect(lastOf("b", "matchmaking")).toMatchObject({
      status: "queued",
      queueSize: 2,
      maxPlayers: 3,
    });
    hub.cancelMatchmake("b");
    expect(lastOf("b", "matchmaking")?.status).toBe("cancelled");
    expect(lastOf("a", "matchmaking")?.queueSize).toBe(1);
  });

  it("resyncs matchmaking queue after reconnect", () => {
    hub.matchmake("a", 3, true);
    inbox.set("a", []);
    hub.resyncPlayer("a");
    expect(lastOf("a", "matchmaking")).toMatchObject({
      status: "queued",
      queueSize: 1,
      maxPlayers: 3,
    });
  });

  it("keeps 3-player and 4-player match queues separate", () => {
    hub.setDisplayName("c", "Cara");
    hub.matchmake("a", 3, true);
    hub.matchmake("b", 4, true);
    expect(lastOf("a", "matchmaking")?.queueSize).toBe(1);
    expect(lastOf("b", "matchmaking")?.queueSize).toBe(1);
    expect(lastOf("a", "room")).toBeNull();
  });

  it("blocks matchmake when score is negative until daily restore", () => {
    const store = new MemoryScoreStore();
    const snap = emptySnapshot();
    snap.profiles.set("neg", createScoreProfile("neg", -12));
    snap.names.set("neg", "Neg");
    store.save(snap);
    const local = new Map<string, ServerMessage[]>();
    const localHub = new GameHub((playerId, message) => {
      const list = local.get(playerId) ?? [];
      list.push(message);
      local.set(playerId, list);
    }, { store });

    expect(localHub.matchmake("neg", 3, true).ok).toBe(false);
    expect(localHub.createRoomFor("neg", true, 3).ok).toBe(false);
    // 首次恢复成功：负分回 0
    expect(localHub.restoreScoreFor("neg").ok).toBe(true);
    let scoreMsg = [...(local.get("neg") ?? [])].reverse().find((m) => m.type === "score");
    expect(scoreMsg && scoreMsg.type === "score" ? scoreMsg.score : null).toBe(0);
    expect(scoreMsg && scoreMsg.type === "score" ? scoreMsg.dailyRestoreDay : null).toBe(null);
    expect(localHub.matchmake("neg", 3, true).ok).toBe(true);

    // 再次负分：同一天（lastDailyRestoreDay === today）恢复被拒绝
    const reloaded = store.load();
    reloaded.profiles.get("neg")!.score = -30;
    store.save(reloaded);
    const sameDayHub = new GameHub((playerId, message) => {
      const list = local.get(playerId) ?? [];
      list.push(message);
      local.set(playerId, list);
    }, { store });
    expect(sameDayHub.restoreScoreFor("neg").ok).toBe(false);

    // 模拟跨天：清掉 lastDailyRestoreDay 后可再次恢复
    const nextDay = store.load();
    nextDay.profiles.get("neg")!.lastDailyRestoreDay = undefined;
    store.save(nextDay);
    const nextDayHub = new GameHub((playerId, message) => {
      const list = local.get(playerId) ?? [];
      list.push(message);
      local.set(playerId, list);
    }, { store });
    expect(nextDayHub.restoreScoreFor("neg").ok).toBe(true);
    scoreMsg = [...(local.get("neg") ?? [])].reverse().find((m) => m.type === "score");
    expect(scoreMsg && scoreMsg.type === "score" ? scoreMsg.score : null).toBe(0);
    expect(nextDayHub.matchmake("neg", 3, true).ok).toBe(true);
  });
});
