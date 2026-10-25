import { describe, expect, it, beforeEach } from "vitest";
import {
  ALL_LANDLORD_ITEMS,
  CardKind,
  MatchPhase,
  Rank,
  Suit,
  createMatch,
  createNormalCard,
  createBombCard,
  getPlayerHand,
  getVisibleHand,
  matchPlaceRaise,
  matchTickAuction,
  passTurn,
  playCards,
  resetDeckIdCounter,
  resolveScoreDouble,
  skipAuctionAndDeal as skipAuctionAndDealRaw,
  skipOpeningDoubles,
  tickMatch,
  toPublicMatchState,
  armTurnWithItemOffers,
  resolveAfkHost,
  MATCH_TIMING,
} from "../../src/index.js";

function item(id: string) {
  const def = ALL_LANDLORD_ITEMS.find((i) => i.id === id);
  if (!def) throw new Error(id);
  return def;
}

function skipAuctionAndDeal(
  state: ReturnType<typeof createMatch>,
  now?: number,
) {
  const at = now ?? Date.now();
  const result = skipAuctionAndDealRaw(state, at);
  const doubles = skipOpeningDoubles(state, at);
  if (!result.ok) return result;
  return { ok: true as const, state, events: [...result.events, ...doubles.events] };
}

function setTurn(state: ReturnType<typeof createMatch>, playerId: string) {
  state.turnSeat = state.players.get(playerId)!.seat;
}

describe("match flow", () => {
  beforeEach(() => resetDeckIdCounter());

  it("starts in auction and can skip to playing", () => {
    const state = createMatch(["a", "b", "c", "d"], 0, () => 0.42);
    expect(state.phase).toBe(MatchPhase.Auction);
    const result = skipAuctionAndDeal(state);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(state.phase).toBe(MatchPhase.Playing);
    expect(result.events.some((e) => e.type === "dealt")).toBe(true);
    expect(result.events.some((e) => e.type === "turn")).toBe(true);
    const pub = toPublicMatchState(state);
    expect(pub.turnPlayerId).not.toBeNull();
    expect(pub.freeLead).toBe(true);
  });

  it("finishes auction via ticks then deals", () => {
    const state = createMatch(["a", "b"], 0, () => 0.3);
    // 6 lots for 2 players; open+settle each
    let t = 0;
    for (let i = 0; i < 6; i += 1) {
      matchPlaceRaise(state, "a", 1, t);
      t += 4000;
      matchTickAuction(state, t);
      t += 1;
    }
    expect(state.phase).toBe(MatchPhase.Playing);
    expect(state.auction).toBeNull();
  });

  it("raise during auction emits bid event", () => {
    const state = createMatch(["a", "b"], 0, () => 0.3);
    const raised = matchPlaceRaise(state, "a", 10, 100);
    expect(raised.ok).toBe(true);
    if (!raised.ok) return;
    expect(raised.events.some((e) => e.type === "bid")).toBe(true);
  });

  it("play and pass cycle returns lead to leader", () => {
    const state = createMatch(["a", "b"], 0, () => 0.5);
    skipAuctionAndDeal(state);

    const turnId = toPublicMatchState(state).turnPlayerId!;
    const otherId = turnId === "a" ? "b" : "a";
    const hand = getPlayerHand(state, turnId);
    // find a single non-first-play if possible, else any single
    const card =
      hand.find((c) => c.kind !== CardKind.FirstPlay) ?? hand[0];
    const played = playCards(state, turnId, [card.id]);
    expect(played.ok).toBe(true);
    const table = toPublicMatchState(state).table;
    expect(table?.cards?.map((c) => c.id)).toEqual([card.id]);
    expect(played.events).toContainEqual(
      expect.objectContaining({
        type: "played",
        mainRank: table?.mainRank,
      }),
    );

    const passed = passTurn(state, otherId);
    expect(passed.ok).toBe(true);
    if (!passed.ok) return;
    expect(passed.events.some((e) => e.type === "new_lead")).toBe(true);
    expect(toPublicMatchState(state).turnPlayerId).toBe(turnId);
    expect(toPublicMatchState(state).freeLead).toBe(true);
  });

  it("applies head start item and discards first-play card", () => {
    const state = createMatch(["a", "b"], 0, () => 0.2);
    state.players.get("b")!.items.push({
      instanceId: "hs-1",
      def: item("rare_head_start"),
      remainingUses: 1,
    });
    skipAuctionAndDeal(state);
    expect(state.players.get("b")!.seat).toBe(0);
    expect(state.turnSeat).toBe(0);
    const allHands = ["a", "b"].flatMap((id) => getPlayerHand(state, id));
    expect(allHands.every((c) => c.kind !== CardKind.FirstPlay)).toBe(true);
    expect(state.discard.some((c) => c.kind === CardKind.FirstPlay)).toBe(true);
  });

  it("star item grants a star card at game start and stays in the bar", () => {
    const state = createMatch(["a", "b"], 0, () => 0.2);
    state.players.get("a")!.items.push({
      instanceId: "star-1",
      def: item("epic_star"),
      remainingUses: 1,
    });
    skipAuctionAndDeal(state);
    expect(
      getPlayerHand(state, "a").filter((c) => c.kind === CardKind.Star).length,
    ).toBeGreaterThanOrEqual(1);
    expect(state.players.get("a")!.items.some((i) => i.def.id === "epic_star")).toBe(
      true,
    );
    armTurnWithItemOffers(state, "a");
    expect(state.pending?.kind === "offer_item" ? state.pending.itemId : null).not.toBe(
      "epic_star",
    );
  });

  it("rejects play when not your turn", () => {
    const state = createMatch(["a", "b"], 0, () => 0.5);
    skipAuctionAndDeal(state);
    const turnId = toPublicMatchState(state).turnPlayerId!;
    const other = turnId === "a" ? "b" : "a";
    const card = getPlayerHand(state, other)[0];
    const result = playCards(state, other, [card.id]);
    expect(result.ok).toBe(false);
  });

  it("first-play holder leads at seat 0; others shuffle counterclockwise", () => {
    const state = createMatch(["a", "b", "c", "d"], 0, () => 0);
    skipAuctionAndDeal(state);
    const holder = [...state.players.values()].find((p) =>
      p.hand.some((c) => c.kind === CardKind.FirstPlay),
    )!;
    expect(holder.seat).toBe(0);
    expect(state.turnSeat).toBe(0);
    expect(toPublicMatchState(state).turnPlayerId).toBe(holder.id);
    const order = toPublicMatchState(state).seatOrder;
    expect(order).toHaveLength(4);
    expect(order[0]).toBe(holder.id);
    expect(new Set(order).size).toBe(4);
    // rng 恒 0 时其余三人会被打乱，不会保持进房顺序
    const restJoin = ["a", "b", "c", "d"].filter((id) => id !== holder.id);
    expect(order.slice(1)).not.toEqual(restJoin);
  });

  it("next player can follow first-play with a single", () => {
    const state = createMatch(["a", "b", "c"], 0, () => 0.5);
    skipAuctionAndDeal(state);
    const first = toPublicMatchState(state).turnPlayerId!;
    const order = toPublicMatchState(state).seatOrder;
    const nextId = order[1];
    const firstCard = getPlayerHand(state, first).find((c) => c.kind === CardKind.FirstPlay);
    expect(firstCard).toBeTruthy();
    const led = playCards(state, first, [firstCard!.id]);
    expect(led.ok).toBe(true);
    expect(toPublicMatchState(state).table?.type).toBe("first_play");
    expect(toPublicMatchState(state).turnPlayerId).toBe(nextId);
    const follow =
      getPlayerHand(state, nextId).find((c) => c.kind !== CardKind.FirstPlay && (c.rank ?? 0) >= 3) ??
      getPlayerHand(state, nextId)[0];
    const followed = playCards(state, nextId, [follow.id]);
    expect(followed.ok).toBe(true);
    expect(toPublicMatchState(state).table?.type).toBe("single");
  });

  it("next turn walks seats counterclockwise", () => {
    const state = createMatch(["a", "b", "c"], 0, () => 0.5);
    skipAuctionAndDeal(state);
    const first = toPublicMatchState(state).turnPlayerId!;
    const order = toPublicMatchState(state).seatOrder;
    const card =
      getPlayerHand(state, first).find((c) => c.kind !== CardKind.FirstPlay) ??
      getPlayerHand(state, first)[0];
    const played = playCards(state, first, [card.id]);
    expect(played.ok).toBe(true);
    expect(toPublicMatchState(state).turnPlayerId).toBe(order[1]);
  });

  it("arms 15s think clock and auto-passes on follow timeout", () => {
    const state = createMatch(["a", "b"], 0, () => 0.5);
    skipAuctionAndDeal(state, 0);
    const pub0 = toPublicMatchState(state);
    expect(pub0.turnExpiresAt).toBe(MATCH_TIMING.turnMs);
    const turnId = pub0.turnPlayerId!;
    const otherId = turnId === "a" ? "b" : "a";
    const card =
      getPlayerHand(state, turnId).find((c) => c.kind !== CardKind.FirstPlay) ??
      getPlayerHand(state, turnId)[0];
    expect(playCards(state, turnId, [card.id], 100).ok).toBe(true);
    const afterPlay = toPublicMatchState(state);
    expect(afterPlay.turnPlayerId).toBe(otherId);
    expect(afterPlay.freeLead).toBe(false);
    expect(afterPlay.turnExpiresAt).toBe(100 + MATCH_TIMING.turnMs);

    const prompted = tickMatch(state, 100 + MATCH_TIMING.turnMs);
    expect(prompted.ok).toBe(true);
    expect(state.pending?.kind).toBe("afk_host");
    expect(state.pending && "playerId" in state.pending && state.pending.playerId).toBe(otherId);

    const cancelled = resolveAfkHost(state, otherId, false, 100 + MATCH_TIMING.turnMs);
    expect(cancelled.ok).toBe(true);
    if (!cancelled.ok) return;
    expect(
      cancelled.events.some((e) => e.type === "turn_timeout" && e.action === "pass"),
    ).toBe(true);
    expect(cancelled.events.some((e) => e.type === "passed")).toBe(true);
    expect(toPublicMatchState(state).turnPlayerId).toBe(turnId);
    expect(toPublicMatchState(state).freeLead).toBe(true);
    expect(toPublicMatchState(state).autoPlay[otherId]).toBe(false);
  });

  it("auto-leads smallest legal card on free-lead timeout", () => {
    const state = createMatch(["a", "b"], 0, () => 0.5);
    skipAuctionAndDeal(state, 0);
    const turnId = toPublicMatchState(state).turnPlayerId!;
    const before = getPlayerHand(state, turnId).length;
    const prompted = tickMatch(state, MATCH_TIMING.turnMs);
    expect(prompted.ok).toBe(true);
    expect(state.pending?.kind).toBe("afk_host");
    const cancelled = resolveAfkHost(state, turnId, false, MATCH_TIMING.turnMs);
    expect(cancelled.ok).toBe(true);
    if (!cancelled.ok) return;
    expect(
      cancelled.events.some((e) => e.type === "turn_timeout" && e.action === "lead"),
    ).toBe(true);
    expect(cancelled.events.some((e) => e.type === "played")).toBe(true);
    expect(getPlayerHand(state, turnId).length).toBe(before - 1);
    expect(toPublicMatchState(state).table).not.toBeNull();
    expect(toPublicMatchState(state).autoPlay[turnId]).toBe(false);
  });

  it("anti-overload adds 3s to that player's think clock", () => {
    const state = createMatch(["a", "b"], 0, () => 0.2);
    state.players.get("a")!.items.push({
      instanceId: "ao-1",
      def: item("rare_anti_overload"),
      remainingUses: 1,
    });
    skipAuctionAndDeal(state, 0);
    expect(state.players.get("a")!.flags.thinkTimeBonusSec).toBe(3);
    const leader = toPublicMatchState(state).turnPlayerId!;
    if (leader === "a") {
      expect(state.turnExpiresAt).toBe(MATCH_TIMING.turnMs + 3000);
      expect(tickMatch(state, MATCH_TIMING.turnMs).ok).toBe(false);
      const late = tickMatch(state, MATCH_TIMING.turnMs + 3000);
      expect(late.ok).toBe(true);
    } else {
      const card =
        getPlayerHand(state, leader).find((c) => c.kind !== CardKind.FirstPlay) ??
        getPlayerHand(state, leader)[0];
      expect(playCards(state, leader, [card.id], 50).ok).toBe(true);
      expect(toPublicMatchState(state).turnPlayerId).toBe("a");
      expect(state.turnExpiresAt).toBe(50 + MATCH_TIMING.turnMs + 3000);
    }
  });

  it("score multiplier doubles on 4+ bombs and rocket, not on bomb card", () => {
    const state = createMatch(["a", "b", "c"], 0, () => 0.5);
    skipAuctionAndDeal(state);
    state.pending = null;
    const suits = [Suit.Spade, Suit.Heart, Suit.Club, Suit.Diamond];
    const bomb = suits.map((s) => createNormalCard(Rank.Five, s));
    const extra = createNormalCard(Rank.Nine, Suit.Spade);
    state.players.get("a")!.hand = [...bomb, extra];
    setTurn(state, "a");
    expect(playCards(state, "a", bomb.map((c) => c.id), 10).ok).toBe(true);
    expect(state.scoreMultiplier).toBe(2);
    expect(toPublicMatchState(state).scoreMultiplier).toBe(2);

    state.pending = null;
    state.tableHand = null;
    state.tableLeaderId = null;
    const rocket = [
      createNormalCard(Rank.SmallJoker),
      createNormalCard(Rank.BigJoker),
    ];
    state.players.get("a")!.hand = [...rocket, extra];
    setTurn(state, "a");
    expect(playCards(state, "a", rocket.map((c) => c.id), 20).ok).toBe(true);
    expect(state.scoreMultiplier).toBe(4);

    state.pending = null;
    state.tableHand = null;
    state.tableLeaderId = null;
    const bombCard = createBombCard();
    state.players.get("a")!.hand = [bombCard, extra];
    setTurn(state, "a");
    expect(playCards(state, "a", [bombCard.id], 30).ok).toBe(true);
    expect(state.scoreMultiplier).toBe(4);
  });

  it("opening double window is before skill/turn and timeout means 不加倍", () => {
    const state = createMatch(["a", "b", "c"], 0, () => 0.5);
    const dealt = skipAuctionAndDealRaw(state, 0);
    expect(dealt.ok).toBe(true);
    expect(state.pending?.kind).toBe("score_double");
    expect(dealt.events.some((e) => e.type === "turn")).toBe(false);
    const timed = tickMatch(state, MATCH_TIMING.scoreDoubleMs);
    expect(timed.ok).toBe(true);
    expect(timed.events.filter((e) => e.type === "score_double_chosen")).toHaveLength(3);
    expect(state.pending?.kind).not.toBe("score_double");
    expect(state.scoreDoubles.a).toBe(1);
    expect(toPublicMatchState(state).turnPlayerId).not.toBeNull();
  });

  it("super double multiplies only that player's score", () => {
    const state = createMatch(["a", "b", "c"], 0, () => 0.5);
    skipAuctionAndDealRaw(state, 0);
    const picked = resolveScoreDouble(state, "a", "super", 1);
    expect(picked.ok).toBe(true);
    expect(picked.events).toContainEqual({
      type: "score_double_chosen",
      playerId: "a",
      choice: "super",
    });
    expect(state.pending?.kind).toBe("score_double");
    expect(resolveScoreDouble(state, "b", "double", 1).ok).toBe(true);
    expect(resolveScoreDouble(state, "c", "none", 1).ok).toBe(true);
    expect(state.pending?.kind).not.toBe("score_double");
    expect(state.scoreDoubles).toEqual({ a: 4, b: 2, c: 1 });
  });

  it("3-player match ends and reveals leftover hands when first player empties", () => {
    const state = createMatch(["a", "b", "c"], 0, () => 0.5);
    skipAuctionAndDeal(state);
    const last = createNormalCard(Rank.Four, Suit.Spade);
    state.players.get("a")!.hand = [last];
    const leftover = [...state.players.get("b")!.hand];
    expect(leftover.length).toBeGreaterThan(0);
    setTurn(state, "a");
    const played = playCards(state, "a", [last.id], 10);
    expect(played.ok).toBe(true);
    expect(state.phase).toBe(MatchPhase.Finished);
    expect(state.players.get("a")!.finishRank).toBe(1);
    const leftoverRanks = ["b", "c"].map((id) => state.players.get(id)!.finishRank).sort();
    expect(leftoverRanks).toEqual([2, 3]);
    expect(getVisibleHand(state, "a", "b", 10)).toEqual(leftover);
    expect(getVisibleHand(state, "c", "b", 10)?.length).toBe(leftover.length);
    expect(toPublicMatchState(state, "a").handCounts["b"]).toBe(leftover.length);
  });

  it("4-player match continues after first empty and ends on second", () => {
    const state = createMatch(["a", "b", "c", "d"], 0, () => 0.42);
    skipAuctionAndDeal(state);
    const first = createNormalCard(Rank.Four, Suit.Spade);
    state.players.get("a")!.hand = [first];
    setTurn(state, "a");
    expect(playCards(state, "a", [first.id], 10).ok).toBe(true);
    expect(state.phase).toBe(MatchPhase.Playing);
    expect(state.players.get("a")!.finishRank).toBe(1);

    state.tableHand = null;
    state.tableLeaderId = null;
    state.pending = null;
    const second = createNormalCard(Rank.Five, Suit.Heart);
    state.players.get("b")!.hand = [second];
    const leftoverC = [...state.players.get("c")!.hand];
    setTurn(state, "b");
    expect(playCards(state, "b", [second.id], 20).ok).toBe(true);
    expect(state.phase).toBe(MatchPhase.Finished);
    expect(state.players.get("b")!.finishRank).toBe(2);
    const leftoverRanks = ["c", "d"].map((id) => state.players.get(id)!.finishRank).sort();
    expect(leftoverRanks).toEqual([3, 4]);
    expect(getVisibleHand(state, "a", "c", 20)).toEqual(leftoverC);
  });
});
