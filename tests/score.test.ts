import { describe, expect, it, beforeEach } from "vitest";
import {
  applyWeeklyNegativeFloor,
  createScoreProfile,
  dailyRestoreNegativeScore,
  modeGainShare,
  rankedPlaceDelta,
  resetLedgerSeq,
  migrateLegacyInitialScore,
  settleMatchScores,
  utcDayKey,
  createRoom,
  joinRoom,
  startRoomMatch,
  ensureProfiles,
  settleRoomMatch,
  markContinuePlay,
  continuePlayFull,
  leaveRoom,
  skipAuctionAndDeal,
  MatchPhase,
} from "../src/index.js";

describe("createScoreProfile", () => {
  it("starts new accounts at 4000", () => {
    expect(createScoreProfile("x").score).toBe(4000);
  });

  it("bumps unused legacy 100-score accounts to 4000", () => {
    const unused = createScoreProfile("old", 100);
    expect(migrateLegacyInitialScore(unused)).toBe(true);
    expect(unused.score).toBe(4000);
    expect(unused.ledger[0]?.delta).toBe(4000);

    const played = createScoreProfile("p", 100);
    played.ledger.push({
      id: "m1",
      playerId: "p",
      matchId: "m",
      modeId: "dou_dizhu",
      delta: -15,
      scoreAfter: 85,
      ranked: true,
      reason: "match",
      createdAt: 1,
    });
    played.score = 85;
    expect(migrateLegacyInitialScore(played)).toBe(false);
    expect(played.score).toBe(85);
  });
});

describe("rankedPlaceDelta", () => {
  it("3-player base deltas", () => {
    expect(rankedPlaceDelta(3, 1)).toBe(500);
    expect(rankedPlaceDelta(3, 2)).toBe(-188);
    expect(rankedPlaceDelta(3, 3)).toBe(-188);
  });

  it("4-player base deltas", () => {
    expect(rankedPlaceDelta(4, 1)).toBe(500);
    expect(rankedPlaceDelta(4, 2)).toBe(500);
    expect(rankedPlaceDelta(4, 3)).toBe(-375);
    expect(rankedPlaceDelta(4, 4)).toBe(-375);
  });
});

describe("settleMatchScores", () => {
  beforeEach(() => resetLedgerSeq());

  it("3-player ranked: +500 / -188 / -188", () => {
    const profiles = new Map([
      ["a", createScoreProfile("a", 100)],
      ["b", createScoreProfile("b", 100)],
      ["c", createScoreProfile("c", 100)],
    ]);

    const result = settleMatchScores(profiles, {
      matchId: "m3",
      modeId: "dou_dizhu",
      ranked: true,
      durationSec: 120,
      ranking: [
        { playerId: "a", rank: 1 },
        { playerId: "b", rank: 2 },
        { playerId: "c", rank: 3 },
      ],
      at: 1,
    });

    expect(result.deltas.map((d) => [d.playerId, d.delta, d.scoreAfter])).toEqual([
      ["a", 500, 600],
      ["b", -188, -88],
      ["c", -188, -88],
    ]);
    expect(profiles.get("a")!.lifetimeGainByMode.dou_dizhu).toBe(500);
    expect(profiles.get("b")!.lifetimeGainByMode.dou_dizhu).toBeUndefined();
  });

  it("4-player ranked: +500 / +500 / -375 / -375", () => {
    const profiles = new Map([
      ["a", createScoreProfile("a", 100)],
      ["b", createScoreProfile("b", 100)],
      ["c", createScoreProfile("c", 100)],
      ["d", createScoreProfile("d", 100)],
    ]);

    const result = settleMatchScores(profiles, {
      matchId: "m4",
      modeId: "dou_dizhu",
      ranked: true,
      durationSec: 900,
      ranking: [
        { playerId: "a", rank: 1 },
        { playerId: "b", rank: 2 },
        { playerId: "c", rank: 3 },
        { playerId: "d", rank: 4 },
      ],
      at: 1,
    });

    expect(result.deltas.map((d) => d.delta)).toEqual([500, 500, -375, -375]);
    expect(profiles.get("a")!.score).toBe(600);
    expect(profiles.get("b")!.score).toBe(600);
    expect(profiles.get("c")!.score).toBe(-275);
    expect(profiles.get("d")!.lifetimeGainByMode.dou_dizhu).toBeUndefined();
  });

  it("casual room does not change score", () => {
    const profiles = new Map([["a", createScoreProfile("a", 100)]]);
    const result = settleMatchScores(profiles, {
      matchId: "m2",
      modeId: "dou_dizhu",
      ranked: false,
      durationSec: 900,
      ranking: [{ playerId: "a", rank: 1 }],
    });
    expect(result.deltas[0].delta).toBe(0);
    expect(profiles.get("a")!.score).toBe(100);
  });

  it("negative score still uses full fixed delta", () => {
    const profiles = new Map([
      ["a", createScoreProfile("a", -50)],
      ["b", createScoreProfile("b", -50)],
      ["c", createScoreProfile("c", -50)],
    ]);
    const result = settleMatchScores(profiles, {
      matchId: "m-neg",
      modeId: "dou_dizhu",
      ranked: true,
      durationSec: 60,
      ranking: [
        { playerId: "a", rank: 1 },
        { playerId: "b", rank: 2 },
        { playerId: "c", rank: 3 },
      ],
    });
    expect(result.deltas[0].delta).toBe(500);
    expect(result.deltas[1].delta).toBe(-188);
    expect(profiles.get("a")!.score).toBe(450);
  });

  it("score multiplier scales ranked deltas", () => {
    const profiles = new Map([
      ["a", createScoreProfile("a", 100)],
      ["b", createScoreProfile("b", 100)],
      ["c", createScoreProfile("c", 100)],
    ]);
    const result = settleMatchScores(profiles, {
      matchId: "m-bomb",
      modeId: "dou_dizhu",
      ranked: true,
      durationSec: 60,
      scoreMultiplier: 4,
      ranking: [
        { playerId: "a", rank: 1 },
        { playerId: "b", rank: 2 },
        { playerId: "c", rank: 3 },
      ],
    });
    expect(result.deltas.map((d) => d.delta)).toEqual([2000, -752, -752]);
    expect(profiles.get("a")!.score).toBe(2100);
  });

  it("personal super double stacks with bomb multiplier", () => {
    const profiles = new Map([
      ["a", createScoreProfile("a", 100)],
      ["b", createScoreProfile("b", 100)],
      ["c", createScoreProfile("c", 100)],
    ]);
    const result = settleMatchScores(profiles, {
      matchId: "m-super",
      modeId: "dou_dizhu",
      ranked: true,
      durationSec: 60,
      scoreMultiplier: 2,
      scoreDoubles: { a: 4, b: 1, c: 2 },
      ranking: [
        { playerId: "a", rank: 1 },
        { playerId: "b", rank: 2 },
        { playerId: "c", rank: 3 },
      ],
    });
    expect(result.deltas.map((d) => d.delta)).toEqual([4000, -376, -752]);
  });

  it("weekly floor lifts negatives to zero without mode gain", () => {
    const a = createScoreProfile("a", -30);
    const b = createScoreProfile("b", 50);
    const entries = applyWeeklyNegativeFloor([a, b], 99);
    expect(a.score).toBe(0);
    expect(b.score).toBe(50);
    expect(entries).toHaveLength(1);
    expect(entries[0].reason).toBe("weekly_floor");
    expect(modeGainShare(a)).toEqual([]);
  });

  it("hides pie when score <= 0", () => {
    const p = createScoreProfile("a", 0);
    p.lifetimeGainByMode.dou_dizhu = 10;
    expect(modeGainShare(p)).toEqual([]);
  });

  it("daily restore lifts negative score to 0 once per UTC day", () => {
    const p = createScoreProfile("a", -40);
    // 同一天第二次调用不再恢复
    expect(dailyRestoreNegativeScore(p, 1_700_000_000_000)).toBe(true);
    expect(p.score).toBe(0);
    expect(p.lastDailyRestoreDay).toBe(utcDayKey(1_700_000_000_000));
    expect(dailyRestoreNegativeScore(p, 1_700_100_000_000)).toBe(false);
  });

  it("daily restore re-arms after UTC day rollover", () => {
    const p = createScoreProfile("a", -25);
    const day1 = Date.UTC(2026, 8, 17, 12); // 2026-09-17
    expect(dailyRestoreNegativeScore(p, day1)).toBe(true);
    expect(p.score).toBe(0);
    p.score = -25;
    const day2 = Date.UTC(2026, 8, 18, 1); // 2026-09-18
    expect(dailyRestoreNegativeScore(p, day2)).toBe(true);
    expect(p.score).toBe(0);
  });

  it("rejects restore when score is not negative", () => {
    const p = createScoreProfile("a", 0);
    expect(dailyRestoreNegativeScore(p)).toBe(false);
  });
});

describe("room + match settlement", () => {
  beforeEach(() => resetLedgerSeq());

  it("ranked 3-player room settles +500 / -188 / -188", () => {
    const room = createRoom({
      roomCode: "ABCD",
      hostId: "a",
      ranked: true,
      maxPlayers: 3,
    });
    expect(joinRoom(room, "b")).toBeNull();
    expect(joinRoom(room, "c")).toBeNull();
    expect(startRoomMatch(room, 0, () => 0.5)).toBeNull();

    const match = room.match!;
    skipAuctionAndDeal(match, 0);
    match.pending = null;
    match.players.get("a")!.finishRank = 1;
    match.players.get("b")!.finishRank = 2;
    match.players.get("c")!.finishRank = 3;
    match.phase = MatchPhase.Finished;
    match.finishedAt = 60_000;

    const profiles = new Map<string, ReturnType<typeof createScoreProfile>>();
    ensureProfiles(["a", "b", "c"], profiles, 100);

    const settlement = settleRoomMatch(room, profiles, 60_000);
    expect(settlement).not.toBeNull();
    expect(room.phase).toBe("lobby");
    expect(settlement!.deltas.map((d) => d.delta)).toEqual([500, -188, -188]);
    expect(profiles.get("a")!.score).toBe(600);
    expect(room.continueExpiresAt).toBe(76_000);
    expect(markContinuePlay(room, "a")).toBeNull();
    expect(markContinuePlay(room, "b")).toBeNull();
    expect(continuePlayFull(room)).toBe(false);
    expect(markContinuePlay(room, "c")).toBeNull();
    expect(continuePlayFull(room)).toBe(true);
    expect(startRoomMatch(room, 76_000, () => 0.5)).toBeNull();
    expect(room.phase).toBe("in_match");
    expect(room.continueReady).toEqual([]);
  });

  it("leave during continue drops that vote", () => {
    const room = createRoom({
      roomCode: "LEAVE",
      hostId: "a",
      ranked: false,
      maxPlayers: 3,
    });
    expect(joinRoom(room, "b")).toBeNull();
    expect(joinRoom(room, "c")).toBeNull();
    room.phase = "lobby";
    room.lastSettlement = { deltas: [], entries: [] };
    expect(markContinuePlay(room, "a")).toBeNull();
    expect(markContinuePlay(room, "b")).toBeNull();
    expect(leaveRoom(room, "b")).toBeNull();
    expect(room.continueReady).toEqual(["a"]);
    expect(continuePlayFull(room)).toBe(false);
  });
});
