import { describe, expect, it, beforeEach } from "vitest";
import {
  ALL_LANDLORD_ITEMS,
  CardKind,
  HandType,
  MATCH_TIMING,
  Rank,
  Suit,
  armTurnWithItemOffers,
  createMatch,
  createNormalCard,
  getPlayerHand,
  playCards,
  resetDeckIdCounter,
  setMatchAutoPlay,
  skipAuctionAndDeal as skipAuctionAndDealRaw,
  skipOpeningDoubles,
  tickMatch,
  toPublicMatchState,
  resolveAfkHost,
} from "../../src/index.js";

function item(id: string) {
  const def = ALL_LANDLORD_ITEMS.find((i) => i.id === id);
  if (!def) throw new Error(id);
  return def;
}

function skipToPlay(state: ReturnType<typeof createMatch>, now = 0) {
  const dealt = skipAuctionAndDealRaw(state, now);
  const doubles = skipOpeningDoubles(state, now);
  state.pending = null;
  state.itemOfferQueue = [];
  state.extraRoundApplied = true;
  return { dealt, doubles };
}

function setTurn(state: ReturnType<typeof createMatch>, playerId: string) {
  state.turnSeat = state.players.get(playerId)!.seat;
  state.pending = null;
  state.itemOfferQueue = [];
  state.turnExpiresAt = 10_000;
}

describe("autoplay / 托管", () => {
  beforeEach(() => resetDeckIdCounter());

  it("follows with the smallest legal cards instead of passing", () => {
    const state = createMatch(["a", "b"], 0, () => 0.5);
    skipToPlay(state);
    const three = createNormalCard(Rank.Three, Suit.Spade);
    const four = createNormalCard(Rank.Four, Suit.Heart);
    const six = createNormalCard(Rank.Six, Suit.Club);
    const nine = createNormalCard(Rank.Nine, Suit.Diamond);
    const king = createNormalCard(Rank.King, Suit.Spade);
    state.players.get("a")!.hand = [three, king];
    state.players.get("b")!.hand = [four, six, nine];
    setTurn(state, "a");
    expect(playCards(state, "a", [three.id], 10).ok).toBe(true);
    expect(toPublicMatchState(state).turnPlayerId).toBe("b");
    const acted = setMatchAutoPlay(state, "b", true, 20);
    expect(acted.ok).toBe(true);
    expect(acted.ok && acted.events.some((e) => e.type === "played")).toBe(true);
    expect(getPlayerHand(state, "b").map((c) => c.rank)).toEqual([Rank.Six, Rank.Nine]);
    expect(toPublicMatchState(state).table?.mainRank).toBe(Rank.Four);
  });

  it("passes follow when nothing can beat the table", () => {
    const state = createMatch(["a", "b"], 0, () => 0.5);
    skipToPlay(state);
    const pairA = [
      createNormalCard(Rank.Two, Suit.Spade),
      createNormalCard(Rank.Two, Suit.Heart),
    ];
    state.players.get("a")!.hand = [
      ...pairA,
      createNormalCard(Rank.Ace, Suit.Club),
    ];
    state.players.get("b")!.hand = [
      createNormalCard(Rank.Three, Suit.Club),
      createNormalCard(Rank.Four, Suit.Diamond),
      createNormalCard(Rank.Five, Suit.Spade),
    ];
    setTurn(state, "a");
    expect(playCards(state, "a", pairA.map((c) => c.id), 10).ok).toBe(true);
    setMatchAutoPlay(state, "b", true, 20);
    expect(toPublicMatchState(state).turnPlayerId).toBe("a");
    expect(toPublicMatchState(state).freeLead).toBe(true);
    expect(getPlayerHand(state, "b")).toHaveLength(3);
  });

  it("leads a singleton of the smallest rank", () => {
    const state = createMatch(["a", "b"], 0, () => 0.5);
    skipToPlay(state);
    state.players.get("a")!.hand = [
      createNormalCard(Rank.Five, Suit.Spade),
      createNormalCard(Rank.Nine, Suit.Heart),
      createNormalCard(Rank.Nine, Suit.Club),
    ];
    setTurn(state, "a");
    setMatchAutoPlay(state, "a", true, 10);
    expect(toPublicMatchState(state).table?.type).toBe(HandType.Single);
    expect(toPublicMatchState(state).table?.mainRank).toBe(Rank.Five);
  });

  it("leads a pair when the smallest rank has two cards", () => {
    const state = createMatch(["a", "b"], 0, () => 0.5);
    skipToPlay(state);
    state.players.get("a")!.hand = [
      createNormalCard(Rank.Four, Suit.Spade),
      createNormalCard(Rank.Four, Suit.Heart),
      createNormalCard(Rank.King, Suit.Club),
    ];
    setTurn(state, "a");
    setMatchAutoPlay(state, "a", true, 10);
    expect(toPublicMatchState(state).table?.type).toBe(HandType.Pair);
    expect(toPublicMatchState(state).table?.mainRank).toBe(Rank.Four);
  });

  it("leads 三带一 with the smallest kicker when the smallest rank has three", () => {
    const state = createMatch(["a", "b"], 0, () => 0.5);
    skipToPlay(state);
    state.players.get("a")!.hand = [
      createNormalCard(Rank.Three, Suit.Spade),
      createNormalCard(Rank.Three, Suit.Heart),
      createNormalCard(Rank.Three, Suit.Club),
      createNormalCard(Rank.Five, Suit.Diamond),
      createNormalCard(Rank.Queen, Suit.Spade),
    ];
    setTurn(state, "a");
    setMatchAutoPlay(state, "a", true, 10);
    expect(toPublicMatchState(state).table?.type).toBe(HandType.TripleWithSingle);
    expect(toPublicMatchState(state).table?.mainRank).toBe(Rank.Three);
    expect(toPublicMatchState(state).table?.cards.some((c) => c.rank === Rank.Five)).toBe(true);
  });

  it("leads 三带对 when there is no singleton kicker", () => {
    const state = createMatch(["a", "b"], 0, () => 0.5);
    skipToPlay(state);
    state.players.get("a")!.hand = [
      createNormalCard(Rank.Three, Suit.Spade),
      createNormalCard(Rank.Three, Suit.Heart),
      createNormalCard(Rank.Three, Suit.Club),
      createNormalCard(Rank.Six, Suit.Diamond),
      createNormalCard(Rank.Six, Suit.Spade),
    ];
    setTurn(state, "a");
    setMatchAutoPlay(state, "a", true, 10);
    expect(toPublicMatchState(state).table?.type).toBe(HandType.TripleWithPair);
    expect(toPublicMatchState(state).table?.mainRank).toBe(Rank.Three);
  });

  it("leads a naked triple when nothing can be attached", () => {
    const state = createMatch(["a", "b"], 0, () => 0.5);
    skipToPlay(state);
    state.players.get("a")!.hand = [
      createNormalCard(Rank.Four, Suit.Spade),
      createNormalCard(Rank.Four, Suit.Heart),
      createNormalCard(Rank.Four, Suit.Club),
    ];
    setTurn(state, "a");
    setMatchAutoPlay(state, "a", true, 10);
    expect(toPublicMatchState(state).table?.type).toBe(HandType.Triple);
    expect(getPlayerHand(state, "a")).toHaveLength(0);
  });

  it("declines skill thinking windows immediately", () => {
    const state = createMatch(["a", "b"], 0, () => 0.5);
    skipToPlay(state);
    state.players.get("a")!.items.push({
      instanceId: "ov-1",
      def: item("rare_brain_overload"),
      remainingUses: 1,
    });
    state.players.get("a")!.hand = [
      createNormalCard(Rank.Five, Suit.Spade),
      createNormalCard(Rank.Nine, Suit.Heart),
    ];
    const armed = armTurnWithItemOffers(state, "a", 10);
    expect(armed.ok).toBe(true);
    expect(state.pending?.kind).toBe("offer_item");
    setMatchAutoPlay(state, "a", true, 20);
    expect(state.pending?.kind).not.toBe("offer_item");
    expect(toPublicMatchState(state).table?.type).toBe(HandType.Single);
  });

  it("turn timeout opens an afk prompt instead of immediately passing", () => {
    const state = createMatch(["a", "b"], 0, () => 0.5);
    skipToPlay(state, 0);
    const turnId = toPublicMatchState(state).turnPlayerId!;
    const otherId = turnId === "a" ? "b" : "a";
    const card =
      getPlayerHand(state, turnId).find((c) => c.kind !== CardKind.FirstPlay) ??
      getPlayerHand(state, turnId)[0];
    expect(playCards(state, turnId, [card.id], 100).ok).toBe(true);
    const prompted = tickMatch(state, 100 + MATCH_TIMING.turnMs);
    expect(prompted.ok).toBe(true);
    expect(state.pending?.kind).toBe("afk_host");
    expect(toPublicMatchState(state).autoPlay[otherId]).toBe(false);

    const cancelled = resolveAfkHost(state, otherId, false, 200);
    expect(cancelled.ok).toBe(true);
    expect(
      cancelled.ok && cancelled.events.some((e) => e.type === "turn_timeout" && e.action === "pass"),
    ).toBe(true);
    expect(toPublicMatchState(state).autoPlay[otherId]).toBe(false);
    expect(otherId).toBeTruthy();
  });

  it("afk prompt timeout defaults to autoplay", () => {
    const state = createMatch(["a", "b"], 0, () => 0.5);
    skipToPlay(state, 0);
    const turnId = toPublicMatchState(state).turnPlayerId!;
    const otherId = turnId === "a" ? "b" : "a";
    const card =
      getPlayerHand(state, turnId).find((c) => c.kind !== CardKind.FirstPlay) ??
      getPlayerHand(state, turnId)[0];
    expect(playCards(state, turnId, [card.id], 100).ok).toBe(true);
    tickMatch(state, 100 + MATCH_TIMING.turnMs);
    expect(state.pending?.kind).toBe("afk_host");
    const expired = tickMatch(state, 100 + MATCH_TIMING.turnMs + MATCH_TIMING.afkHostMs);
    expect(expired.ok).toBe(true);
    expect(toPublicMatchState(state).autoPlay[otherId]).toBe(true);
  });

  it("choosing 进行托管 on the afk prompt enters autoplay and acts", () => {
    const state = createMatch(["a", "b"], 0, () => 0.5);
    skipToPlay(state);
    const three = createNormalCard(Rank.Three, Suit.Spade);
    const four = createNormalCard(Rank.Four, Suit.Heart);
    const six = createNormalCard(Rank.Six, Suit.Club);
    const king = createNormalCard(Rank.King, Suit.Spade);
    state.players.get("a")!.hand = [three, king];
    state.players.get("b")!.hand = [four, six];
    setTurn(state, "a");
    expect(playCards(state, "a", [three.id], 10).ok).toBe(true);
    tickMatch(state, 10 + MATCH_TIMING.turnMs);
    expect(state.pending?.kind).toBe("afk_host");
    const hosted = resolveAfkHost(state, "b", true, 20);
    expect(hosted.ok).toBe(true);
    expect(toPublicMatchState(state).autoPlay.b).toBe(true);
    expect(getPlayerHand(state, "b").map((c) => c.rank)).toEqual([Rank.Six]);
  });
});
