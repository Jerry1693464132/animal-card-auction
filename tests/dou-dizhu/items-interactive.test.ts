import { describe, expect, it, beforeEach } from "vitest";
import {
  ALL_LANDLORD_ITEMS,
  CardKind,
  HandType,
  MATCH_TIMING,
  TURN_ITEM_ORDER,
  armTurnWithItemOffers,
  collectAfterPlayOffers,
  collectExtraRoundOffers,
  collectOnLeadOffers,
  collectTurnItemOffers,
  createMatch,
  createNormalCard,
  createBombCard,
  declineItemOffer,
  getPlayerHand,
  getVisibleHand,
  passTurn,
  playCards,
  resetDeckIdCounter,
  resolveRps,
  resolveSwapHands,
  skipAuctionAndDeal as skipAuctionAndDealRaw,
  skipOpeningDoubles,
  tickMatch,
  toPublicMatchState,
  useMatchItem,
  yieldControlledLead,
  Rank,
  Suit,
} from "../../src/index.js";

function def(id: string) {
  const item = ALL_LANDLORD_ITEMS.find((i) => i.id === id);
  if (!item) throw new Error(id);
  return item;
}

function give(state: ReturnType<typeof createMatch>, playerId: string, itemId: string) {
  state.players.get(playerId)!.items.push({
    instanceId: `${itemId}-t`,
    def: def(itemId),
    remainingUses: def(itemId).maxUses,
  });
}

function skipAuctionAndDeal(state: ReturnType<typeof createMatch>, now = 0) {
  const result = skipAuctionAndDealRaw(state, now);
  skipOpeningDoubles(state, now);
  return result;
}

function skipOffers(state: ReturnType<typeof createMatch>, now = 0) {
  let guard = 0;
  while (state.pending?.kind === "offer_item" && guard < 24) {
    guard += 1;
    const pending = state.pending;
    declineItemOffer(state, pending.playerId, Math.max(now, pending.expiresAt));
  }
}

function setTurn(state: ReturnType<typeof createMatch>, playerId: string, now = 0) {
  armTurnWithItemOffers(state, playerId, now);
}

function offerItemId(state: ReturnType<typeof createMatch>): string | null {
  return state.pending?.kind === "offer_item" ? state.pending.itemId : null;
}

function offerPlayerId(state: ReturnType<typeof createMatch>): string | null {
  return state.pending?.kind === "offer_item" ? state.pending.playerId : null;
}

function setSeats(state: ReturnType<typeof createMatch>, ids: string[]) {
  ids.forEach((id, seat) => {
    const player = state.players.get(id);
    if (player) player.seat = seat;
  });
  state.turnSeat = 0;
}

function giveThrees(
  state: ReturnType<typeof createMatch>,
  playerId: string,
  count: number,
) {
  const suits = [Suit.Spade, Suit.Heart, Suit.Club, Suit.Diamond];
  const player = state.players.get(playerId)!;
  player.hand = player.hand.filter(
    (c) => !(c.kind === CardKind.Normal && c.rank === Rank.Three),
  );
  for (let i = 0; i < count; i += 1) {
    player.hand.push(createNormalCard(Rank.Three, suits[i % suits.length]));
  }
}

describe("interactive items", () => {
  beforeEach(() => resetDeckIdCounter());

  it("swap hands within 10s window", () => {
    const state = createMatch(["a", "b"], 0, () => 0.2);
    give(state, "a", "legendary_swap_hands");
    skipAuctionAndDeal(state, 0);
    expect(state.pending?.kind).toBe("swap_hands");

    const handA = [...getPlayerHand(state, "a")];
    const handB = [...getPlayerHand(state, "b")];
    const ordinary = (c: { kind: string }) =>
      c.kind !== CardKind.Star && c.kind !== CardKind.BombCard;
    const swapped = resolveSwapHands(state, "a", "b");
    expect(swapped.ok).toBe(true);
    expect(getPlayerHand(state, "a").filter(ordinary).map((c) => c.id)).toEqual(
      handB.filter(ordinary).map((c) => c.id),
    );
    expect(getPlayerHand(state, "b").filter(ordinary).map((c) => c.id)).toEqual(
      handA.filter(ordinary).map((c) => c.id),
    );
    expect(state.pending).toBeNull();
  });

  it("swap keeps star and bomb cards with their owners", () => {
    const state = createMatch(["a", "b"], 0, () => 0.2);
    give(state, "a", "legendary_swap_hands");
    give(state, "a", "legendary_wild_king");
    give(state, "b", "epic_bomb");
    skipAuctionAndDeal(state, 0);
    const starsA = getPlayerHand(state, "a").filter((c) => c.kind === CardKind.Star);
    const bombsB = getPlayerHand(state, "b").filter((c) => c.kind === CardKind.BombCard);
    expect(starsA.length).toBeGreaterThanOrEqual(2);
    expect(bombsB.length).toBeGreaterThanOrEqual(1);
    const starIds = starsA.map((c) => c.id);
    const bombIds = bombsB.map((c) => c.id);
    expect(resolveSwapHands(state, "a", "b").ok).toBe(true);
    expect(
      getPlayerHand(state, "a")
        .filter((c) => c.kind === CardKind.Star)
        .map((c) => c.id),
    ).toEqual(starIds);
    expect(
      getPlayerHand(state, "b")
        .filter((c) => c.kind === CardKind.BombCard)
        .map((c) => c.id),
    ).toEqual(bombIds);
  });

  it("swap window expires without swap", () => {
    const state = createMatch(["a", "b"], 0, () => 0.2);
    give(state, "a", "legendary_swap_hands");
    skipAuctionAndDeal(state, 0);
    const ticked = tickMatch(state, MATCH_TIMING.swapHandsMs);
    expect(ticked.ok).toBe(true);
    expect(state.pending).toBeNull();
    expect(toPublicMatchState(state).turnPlayerId).not.toBeNull();
  });

  it("self-follow keeps turn after play", () => {
    const state = createMatch(["a", "b"], 0, () => 0.5);
    give(state, "a", "epic_self_follow");
    skipAuctionAndDeal(state, 0);
    setTurn(state, "a");

    const card = getPlayerHand(state, "a").find((c) => c.kind !== CardKind.FirstPlay)!;
    const played = playCards(state, "a", [card.id], 100);
    expect(played.ok).toBe(true);
    expect(state.pending?.kind).toBe("offer_item");

    const used = useMatchItem(state, "a", "epic_self_follow", {}, 200);
    expect(used.ok).toBe(true);
    expect(state.pending).toBeNull();
    expect(toPublicMatchState(state).turnPlayerId).toBe("a");
    expect(toPublicMatchState(state).freeLead).toBe(false);
  });

  it("bounce returns cards and forbids same type", () => {
    const state = createMatch(["a", "b"], 0, () => 0.5);
    give(state, "b", "rare_bounce");
    skipAuctionAndDeal(state, 0);
    setTurn(state, "a");

    const card = getPlayerHand(state, "a").find((c) => c.kind !== CardKind.FirstPlay)!;
    playCards(state, "a", [card.id], 100);
    expect(offerItemId(state)).toBe("rare_bounce");

    const before = getPlayerHand(state, "a").length;
    const bounced = useMatchItem(state, "b", "rare_bounce", {}, 200);
    expect(bounced.ok).toBe(true);
    expect(getPlayerHand(state, "a").length).toBe(before + 1);
    expect(state.bounceForbidType).toBe(HandType.Single);
    expect(state.lastBouncerId).toBe("b");
    expect(toPublicMatchState(state).turnPlayerId).toBe("a");
    expect(toPublicMatchState(state, "a").bounceForbidType).toBe(HandType.Single);
    expect(toPublicMatchState(state, "a").lastBouncerId).toBe("b");

    // 再出单张应失败
    const another = getPlayerHand(state, "a").find(
      (c) => c.kind !== CardKind.FirstPlay && c.id !== card.id,
    )!;
    const again = playCards(state, "a", [another.id], 300);
    expect(again.ok).toBe(false);
  });

  it("bounce gives the lead to the bouncer when no other type exists", () => {
    const state = createMatch(["a", "b"], 0, () => 0.5);
    give(state, "b", "rare_bounce");
    skipAuctionAndDeal(state, 0);
    setTurn(state, "a");
    const lead = createNormalCard(Rank.Five, Suit.Spade);
    state.players.get("a")!.hand = [
      lead,
      createNormalCard(Rank.Six, Suit.Heart),
      createNormalCard(Rank.Seven, Suit.Club),
      createNormalCard(Rank.Eight, Suit.Diamond),
    ];
    playCards(state, "a", [lead.id], 100);
    expect(useMatchItem(state, "b", "rare_bounce", {}, 200).ok).toBe(true);
    expect(state.bounceForbidType).toBeNull();
    expect(toPublicMatchState(state).turnPlayerId).toBe("b");
    expect(toPublicMatchState(state).freeLead).toBe(true);
  });

  it("bounce still allows a different hand type", () => {
    const state = createMatch(["a", "b"], 0, () => 0.5);
    give(state, "b", "rare_bounce");
    skipAuctionAndDeal(state, 0);
    setTurn(state, "a");
    const lead = createNormalCard(Rank.Five, Suit.Spade);
    const pair = [
      createNormalCard(Rank.Nine, Suit.Heart),
      createNormalCard(Rank.Nine, Suit.Club),
    ];
    state.players.get("a")!.hand = [lead, ...pair];
    playCards(state, "a", [lead.id], 100);
    expect(useMatchItem(state, "b", "rare_bounce", {}, 200).ok).toBe(true);
    expect(state.bounceForbidType).toBe(HandType.Single);
    const played = playCards(
      state,
      "a",
      pair.map((c) => c.id),
      300,
    );
    expect(played.ok).toBe(true);
  });

  it("bomb defuser discards the bomb and gives the defuser a free lead", () => {
    const state = createMatch(["a", "b"], 0, () => 0.5);
    give(state, "a", "legendary_bomb_defuser");
    skipAuctionAndDeal(state, 0);
    setTurn(state, "a");

    const single = createNormalCard(Rank.Five, Suit.Spade);
    state.players.get("a")!.hand = [single, createNormalCard(Rank.Six, Suit.Heart)];
    const bombs = [Suit.Spade, Suit.Heart, Suit.Club, Suit.Diamond].map((s) =>
      createNormalCard(Rank.Three, s),
    );
    state.players.get("b")!.hand = [...bombs, createNormalCard(Rank.Seven, Suit.Spade)];

    playCards(state, "a", [single.id], 100);
    if (state.pending) tickMatch(state, 100 + MATCH_TIMING.reactionMs);

    setTurn(state, "b");
    playCards(
      state,
      "b",
      bombs.map((c) => c.id),
      200,
    );
    expect(state.pending?.kind).toBe("offer_item");

    const defused = useMatchItem(state, "a", "legendary_bomb_defuser", {}, 300);
    expect(defused.ok).toBe(true);
    expect(state.tableHand).toBeNull();
    expect(toPublicMatchState(state).turnPlayerId).toBe("a");
    expect(toPublicMatchState(state).freeLead).toBe(true);
    expect(
      getPlayerHand(state, "b").every((c) => c.rank !== Rank.Three),
    ).toBe(true);
  });

  it("rps challenge can steal lead", () => {
    const state = createMatch(["a", "b"], 0, () => 0.5);
    give(state, "b", "legendary_play_something_else");
    skipAuctionAndDeal(state, 0);
    setTurn(state, "a");

    const card = getPlayerHand(state, "a").find((c) => c.kind !== CardKind.FirstPlay)!;
    playCards(state, "a", [card.id], 100);
    skipOffers(state, 100 + MATCH_TIMING.reactionMs);
    // b 过牌 → a 获得领出
    passTurn(state, "b", 200);
    expect(offerItemId(state)).toBeTruthy();

    const challenge = useMatchItem(
      state,
      "b",
      "legendary_play_something_else",
      {},
      300,
    );
    expect(challenge.ok).toBe(true);
    expect(state.pending?.kind).toBe("rps");
    if (state.pending?.kind !== "rps") throw new Error("expected rps");
    expect(state.pending.phase).toBe("picking");
    expect(state.pending.challengerChoice).toBeNull();
    expect(state.pending.targetChoice).toBeNull();

    const pickChallenger = resolveRps(state, "b", "rock", 400);
    expect(pickChallenger.ok).toBe(true);
    expect(toPublicMatchState(state, "a").pending).toMatchObject({
      kind: "rps",
      phase: "picking",
      challengerChoice: null,
      targetChoice: null,
    });
    expect(toPublicMatchState(state, "b").pending).toMatchObject({
      challengerChoice: "rock",
      targetChoice: null,
    });

    const pickTarget = resolveRps(state, "a", "scissors", 500);
    expect(pickTarget.ok).toBe(true);
    expect(state.pending?.kind).toBe("rps");
    if (state.pending?.kind !== "rps") throw new Error("expected rps");
    expect(state.pending.phase).toBe("reveal");
    expect(toPublicMatchState(state, "a").pending).toMatchObject({
      phase: "reveal",
      challengerChoice: "rock",
      targetChoice: "scissors",
    });
    expect(toPublicMatchState(state).turnPlayerId).not.toBe("b");

    const afterReveal = tickMatch(state, 500 + MATCH_TIMING.rpsRevealMs);
    expect(afterReveal.ok).toBe(true);
    expect(toPublicMatchState(state).turnPlayerId).toBe("b");
  });

  it("rps draw rematches until there is a winner", () => {
    const state = createMatch(["a", "b"], 0, () => 0.5);
    give(state, "b", "legendary_play_something_else");
    skipAuctionAndDeal(state, 0);
    setTurn(state, "a");

    const card = getPlayerHand(state, "a").find((c) => c.kind !== CardKind.FirstPlay)!;
    playCards(state, "a", [card.id], 100);
    skipOffers(state, 100 + MATCH_TIMING.reactionMs);
    passTurn(state, "b", 200);

    useMatchItem(state, "b", "legendary_play_something_else", {}, 300);
    resolveRps(state, "b", "paper", 400);
    resolveRps(state, "a", "paper", 500);
    expect(state.pending?.kind).toBe("rps");
    if (state.pending?.kind !== "rps") throw new Error("expected rps");
    expect(state.pending.phase).toBe("reveal");

    tickMatch(state, 500 + MATCH_TIMING.rpsRevealMs);
    expect(state.pending?.kind).toBe("rps");
    if (state.pending?.kind !== "rps") throw new Error("expected rps");
    expect(state.pending.phase).toBe("picking");
    expect(state.pending.challengerChoice).toBeNull();
    expect(state.pending.targetChoice).toBeNull();

    resolveRps(state, "b", "scissors", 600);
    resolveRps(state, "a", "paper", 700);
    tickMatch(state, 700 + MATCH_TIMING.rpsRevealMs);
    expect(toPublicMatchState(state).turnPlayerId).toBe("b");
  });

  it("rps timeout assigns a random gesture then reveals", () => {
    const state = createMatch(["a", "b"], 0, () => 0.5);
    give(state, "b", "legendary_play_something_else");
    skipAuctionAndDeal(state, 0);
    setTurn(state, "a");

    const card = getPlayerHand(state, "a").find((c) => c.kind !== CardKind.FirstPlay)!;
    playCards(state, "a", [card.id], 100);
    skipOffers(state, 100 + MATCH_TIMING.reactionMs);
    passTurn(state, "b", 200);

    useMatchItem(state, "b", "legendary_play_something_else", {}, 300);
    resolveRps(state, "b", "rock", 400);
    const timed = tickMatch(state, 400 + MATCH_TIMING.rpsMs);
    expect(timed.ok).toBe(true);
    expect(state.pending?.kind).toBe("rps");
    if (state.pending?.kind !== "rps") throw new Error("expected rps");
    expect(state.pending.phase).toBe("reveal");
    expect(state.pending.challengerChoice).toBe("rock");
    expect(state.pending.targetChoice).toBe("paper");
  });

  it("control forces single or pair on lead", () => {
    const state = createMatch(["a", "b"], 0, () => 0.5);
    give(state, "b", "epic_control");
    skipAuctionAndDeal(state, 0);
    setTurn(state, "a");

    // 保证 a 手牌 > 5
    expect(getPlayerHand(state, "a").length).toBeGreaterThan(5);

    const card = getPlayerHand(state, "a").find((c) => c.kind !== CardKind.FirstPlay)!;
    playCards(state, "a", [card.id], 100);
    skipOffers(state, 100 + MATCH_TIMING.reactionMs);
    passTurn(state, "b", 200);
    expect(offerItemId(state)).toBeTruthy();

    const ctrl = useMatchItem(
      state,
      "b",
      "epic_control",
      { forcedType: "pair" },
      300,
    );
    expect(ctrl.ok).toBe(true);
    expect(state.leadRestriction?.allowed).toBe("pair");
    expect(state.leadRestriction?.controllerId).toBe("b");
    expect(toPublicMatchState(state, "a").leadRestriction?.controllerId).toBe("b");

    const single = getPlayerHand(state, "a").find((c) => c.kind !== CardKind.FirstPlay)!;
    expect(playCards(state, "a", [single.id], 350).ok).toBe(false);

    const yielded = yieldControlledLead(state, "a", 400);
    expect(yielded.ok).toBe(true);
    expect(state.leadRestriction).toBeNull();
    expect(toPublicMatchState(state, "a").turnPlayerId).toBe("b");
    expect(toPublicMatchState(state, "a").freeLead).toBe(true);
  });

  it("control timeout without the forced type yields the lead", () => {
    const state = createMatch(["a", "b"], 0, () => 0.5);
    give(state, "b", "epic_control");
    skipAuctionAndDeal(state, 0);
    setTurn(state, "a");
    const card = getPlayerHand(state, "a").find((c) => c.kind !== CardKind.FirstPlay)!;
    playCards(state, "a", [card.id], 100);
    skipOffers(state, 100 + MATCH_TIMING.reactionMs);
    passTurn(state, "b", 200);
    expect(
      useMatchItem(state, "b", "epic_control", { forcedType: "pair" }, 300).ok,
    ).toBe(true);
    state.players.get("a")!.hand = [
      createNormalCard(Rank.Three, Suit.Spade),
      createNormalCard(Rank.Four, Suit.Heart),
      createNormalCard(Rank.Five, Suit.Club),
      createNormalCard(Rank.Six, Suit.Diamond),
      createNormalCard(Rank.Seven, Suit.Spade),
      createNormalCard(Rank.Eight, Suit.Heart),
    ];
    const until = state.turnExpiresAt;
    expect(until).toBeTruthy();
    const prompted = tickMatch(state, until!);
    expect(prompted.ok).toBe(true);
    expect(state.pending?.kind).toBe("afk_host");
    const ticked = tickMatch(state, until! + MATCH_TIMING.afkHostMs);
    expect(ticked.ok).toBe(true);
    expect(state.leadRestriction).toBeNull();
    expect(toPublicMatchState(state, "a").turnPlayerId).toBe("b");
  });

  it("extra round deals 10 cards each", () => {
    const state = createMatch(["a", "b"], 0, () => 0.4);
    give(state, "a", "legendary_extra_round");
    skipAuctionAndDeal(state, 0);
    setTurn(state, "a");

    // 人为把手牌压到 < 10 并触发
    state.players.get("a")!.hand = state.players.get("a")!.hand.slice(0, 5);
    const beforeB = getPlayerHand(state, "b").length;

    const card = getPlayerHand(state, "a")[0];
    playCards(state, "a", [card.id], 100);
    expect(offerItemId(state)).toBe("legendary_extra_round");

    const used = useMatchItem(state, "a", "legendary_extra_round", {}, 200);
    expect(used.ok).toBe(true);
    expect(state.extraRoundApplied).toBe(true);
    expect(getPlayerHand(state, "b").length).toBe(beforeB + 10);
  });

  it("extra round can be offered again if skipped until a new player drops below 10", () => {
    const state = createMatch(["a", "b"], 0, () => 0.4);
    give(state, "a", "legendary_extra_round");
    skipAuctionAndDeal(state, 0);
    setTurn(state, "a");

    state.players.get("a")!.hand = state.players.get("a")!.hand.slice(0, 5);
    expect(playCards(state, "a", [getPlayerHand(state, "a")[0].id], 100).ok).toBe(true);
    expect(offerItemId(state)).toBe("legendary_extra_round");
    declineItemOffer(state, "a", 200);
    expect(offerItemId(state)).toBeNull();

    state.tableHand = null;
    state.tableLeaderId = null;
    setTurn(state, "a", 300);
    expect(playCards(state, "a", [getPlayerHand(state, "a")[0].id], 300).ok).toBe(true);
    expect(offerItemId(state)).not.toBe("legendary_extra_round");
    skipOffers(state, 300 + MATCH_TIMING.reactionMs);

    state.players.get("b")!.hand = state.players.get("b")!.hand.slice(0, 5);
    state.tableHand = null;
    state.tableLeaderId = null;
    setTurn(state, "b", 400);
    expect(playCards(state, "b", [getPlayerHand(state, "b")[0].id], 400).ok).toBe(true);
    expect(offerItemId(state)).toBe("legendary_extra_round");
  });

  it("extra round does not offer again after it has been used", () => {
    const state = createMatch(["a", "b"], 0, () => 0.4);
    give(state, "a", "legendary_extra_round");
    skipAuctionAndDeal(state, 0);
    setTurn(state, "a");

    state.players.get("a")!.hand = state.players.get("a")!.hand.slice(0, 5);
    playCards(state, "a", [getPlayerHand(state, "a")[0].id], 100);
    useMatchItem(state, "a", "legendary_extra_round", {}, 200);
    expect(state.extraRoundApplied).toBe(true);

    state.players.get("b")!.hand = state.players.get("b")!.hand.slice(0, 5);
    setTurn(state, "b", 300);
    playCards(state, "b", [getPlayerHand(state, "b")[0].id], 300);
    expect(offerItemId(state)).not.toBe("legendary_extra_round");
  });

  it("peek reveals hands > 12 for 25s", () => {
    const state = createMatch(["a", "b"], 0, () => 0.5);
    give(state, "a", "rare_peek");
    skipAuctionAndDeal(state, 0);
    setTurn(state, "a");

    // 确保 b 手牌 > 12
    expect(getPlayerHand(state, "b").length).toBeGreaterThan(12);
    const peek = useMatchItem(state, "a", "rare_peek", {}, 100);
    expect(peek.ok).toBe(true);
    expect(getVisibleHand(state, "a", "b", 100)).not.toBeNull();
    expect(getVisibleHand(state, "a", "b", 100 + MATCH_TIMING.peekMs)).toBeNull();
  });

  it("collects both jokers at game start", () => {
    const state = createMatch(["a", "b"], 0, () => 0.4);
    give(state, "a", "legendary_collect_jokers");
    skipAuctionAndDeal(state, 0);
    const jokers = getPlayerHand(state, "a").filter(
      (c) => c.rank === Rank.SmallJoker || c.rank === Rank.BigJoker,
    );
    expect(jokers).toHaveLength(2);
    expect(
      getPlayerHand(state, "b").some(
        (c) => c.rank === Rank.SmallJoker || c.rank === Rank.BigJoker,
      ),
    ).toBe(false);
  });

  it("discard nine when hand >= 11", () => {
    const state = createMatch(["a", "b"], 0, () => 0.5);
    give(state, "a", "legendary_discard_nine");
    skipAuctionAndDeal(state, 0);
    setTurn(state, "a");
    const before = getPlayerHand(state, "a").length;
    expect(before).toBeGreaterThanOrEqual(11);
    const used = useMatchItem(state, "a", "legendary_discard_nine", {}, 100);
    expect(used.ok).toBe(true);
    expect(getPlayerHand(state, "a").length).toBe(before - 9);
  });

  it("force trade steals then returns a chosen card", () => {
    const state = createMatch(["a", "b"], 0, () => 0.5);
    give(state, "a", "legendary_force_trade");
    skipAuctionAndDeal(state, 0);
    setTurn(state, "a");
    expect(getPlayerHand(state, "b").length).toBeGreaterThan(10);
    const beforeA = getPlayerHand(state, "a").length;
    const beforeB = getPlayerHand(state, "b").length;
    const stolen = useMatchItem(
      state,
      "a",
      "legendary_force_trade",
      { targetPlayerId: "b" },
      100,
    );
    expect(stolen.ok).toBe(true);
    expect(state.pending?.kind).toBe("force_trade");
    if (state.pending && state.pending.kind === "force_trade") {
      expect(state.pending.drawnHint).toMatch(/点数|王|星牌|炸弹牌|先手牌/);
      expect(state.pending.expiresAt - 100).toBe(MATCH_TIMING.forceTradeMs);
    }
    const seenByA = toPublicMatchState(state, "a").pending;
    const seenByB = toPublicMatchState(state, "b").pending;
    expect(seenByA && seenByA.kind === "force_trade" && seenByA.drawnHint).toBeTruthy();
    expect(seenByB && seenByB.kind === "force_trade" ? seenByB.drawnHint : "x").toBeUndefined();
    expect(getPlayerHand(state, "a").length).toBe(beforeA + 1);
    expect(getPlayerHand(state, "b").length).toBe(beforeB - 1);

    const giveBack = getPlayerHand(state, "a")[0]!;
    const returned = useMatchItem(
      state,
      "a",
      "legendary_force_trade",
      { cardId: giveBack.id },
      200,
    );
    expect(returned.ok).toBe(true);
    expect(state.pending).toBeNull();
    expect(getPlayerHand(state, "a").length).toBe(beforeA);
    expect(getPlayerHand(state, "b").length).toBe(beforeB);
  });

  it("big trade swaps three highest cards", () => {
    const state = createMatch(["a", "b"], 0, () => 0.5);
    give(state, "a", "epic_big_trade");
    skipAuctionAndDeal(state, 0);
    setTurn(state, "a");
    const used = useMatchItem(
      state,
      "a",
      "epic_big_trade",
      { targetPlayerId: "b" },
      100,
    );
    expect(used.ok).toBe(true);
    expect(getPlayerHand(state, "a").length).toBeGreaterThan(0);
    expect(getPlayerHand(state, "b").length).toBeGreaterThan(0);
  });

  it("smoke hides hand count and blocks peek", () => {
    const state = createMatch(["a", "b"], 0, () => 0.5);
    give(state, "b", "rare_smoke");
    give(state, "a", "rare_peek");
    skipAuctionAndDeal(state, 0);
    setTurn(state, "a");
    expect(toPublicMatchState(state, "a").handCounts.b).toBeNull();
    expect(toPublicMatchState(state, "b").handCounts.b).not.toBeNull();
    const peek = useMatchItem(state, "a", "rare_peek", {}, 100);
    expect(peek.ok).toBe(false);
    expect(getVisibleHand(state, "a", "b", 100)).toBeNull();
  });

  it("brain overload sets 4s clocks for others", () => {
    const state = createMatch(["a", "b"], 0, () => 0.5);
    give(state, "a", "rare_brain_overload");
    skipAuctionAndDeal(state, 0);
    setTurn(state, "a");
    const used = useMatchItem(state, "a", "rare_brain_overload", {}, 1000);
    expect(used.ok).toBe(true);
    expect(state.players.get("b")!.flags.overloadTurnsLeft).toBe(5);
    expect(state.players.get("a")!.flags.overloadTurnsLeft).toBe(0);
  });

  it("overload is per opponent and does not stack anti-overload", () => {
    const state = createMatch(["a", "b"], 0, () => 0.5);
    give(state, "a", "rare_brain_overload");
    give(state, "b", "rare_anti_overload");
    skipAuctionAndDeal(state, 0);
    setTurn(state, "a");
    useMatchItem(state, "a", "rare_brain_overload", {}, 1000);
    const card = getPlayerHand(state, "a").find((c) => c.kind !== CardKind.FirstPlay)!;
    const playAt = 2000;
    const played = playCards(state, "a", [card.id], playAt);
    expect(played.ok).toBe(true);
    expect(state.players.get("b")!.flags.overloadTurnsLeft).toBe(5);
    let clockAt = playAt;
    if (state.pending) {
      clockAt = playAt + MATCH_TIMING.reactionMs;
      tickMatch(state, clockAt);
    }
    expect(toPublicMatchState(state).turnPlayerId).toBe("b");
    expect(state.turnExpiresAt).toBe(clockAt + MATCH_TIMING.overloadTurnMs);
    const passed = passTurn(state, "b", clockAt + 1);
    expect(passed.ok).toBe(true);
    expect(state.players.get("b")!.flags.overloadTurnsLeft).toBe(4);
  });

  it("small insight reports other players bombs", () => {
    const state = createMatch(["a", "b"], 0, () => 0.5);
    give(state, "a", "rare_small_insight");
    skipAuctionAndDeal(state, 0);
    const pub = toPublicMatchState(state, "a");
    expect(pub.bombInsight).not.toBeNull();
    expect(typeof pub.bombInsight?.b).toBe("number");
    expect(toPublicMatchState(state, "b").bombInsight).toBeNull();
  });

  it("four extra flag lets you play four-with-three", () => {
    const state = createMatch(["a", "b"], 0, () => 0.5);
    give(state, "a", "epic_four_plus_three");
    skipAuctionAndDeal(state, 0);
    setTurn(state, "a");
    expect(state.players.get("a")!.flags.fourExtraSingle).toBe(true);
    const cards = [
      createNormalCard(Rank.Ten, Suit.Spade),
      createNormalCard(Rank.Ten, Suit.Heart),
      createNormalCard(Rank.Ten, Suit.Club),
      createNormalCard(Rank.Ten, Suit.Diamond),
      createNormalCard(Rank.Three, Suit.Spade),
      createNormalCard(Rank.Four, Suit.Heart),
      createNormalCard(Rank.Five, Suit.Club),
    ];
    state.players.get("a")!.hand = cards;
    const played = playCards(state, "a", cards.map((c) => c.id), 100);
    expect(played.ok).toBe(true);
  });

  it("copy only clones a passive skill, not an active one", () => {
    const state = createMatch(["a", "b"], 0, () => 0);
    give(state, "a", "epic_copy");
    give(state, "b", "legendary_force_trade");
    skipAuctionAndDeal(state, 0);
    expect(
      state.players.get("a")!.items.some((i) => i.def.id === "legendary_force_trade"),
    ).toBe(false);
    expect(state.players.get("a")!.items.some((i) => i.def.id === "epic_copy")).toBe(
      true,
    );
  });

  it("copy clones a passive and applies its game-start effect", () => {
    const state = createMatch(["a", "b"], 0, () => 0);
    give(state, "a", "epic_copy");
    give(state, "b", "legendary_god_eye");
    skipAuctionAndDeal(state, 0);
    expect(
      state.players.get("a")!.items.some((i) => i.def.id === "legendary_god_eye"),
    ).toBe(true);
    expect(state.players.get("a")!.flags.canSeeAllHands).toBe(true);
  });

  it("copy does not clone a passive the copier already owns", () => {
    const state = createMatch(["a", "b"], 0, () => 0);
    give(state, "a", "epic_copy");
    give(state, "a", "epic_star");
    give(state, "b", "legendary_god_eye");
    skipAuctionAndDeal(state, 0);
    expect(
      state.players.get("a")!.items.filter((i) => i.def.id === "epic_star"),
    ).toHaveLength(1);
    expect(
      state.players.get("a")!.items.some((i) => i.def.id === "legendary_god_eye"),
    ).toBe(true);
    expect(getPlayerHand(state, "a").filter((c) => c.kind === CardKind.Star).length).toBeGreaterThanOrEqual(
      1,
    );
    expect(state.players.get("a")!.flags.canSeeAllHands).toBe(true);
  });

  it("copy does nothing extra when every table passive is already owned", () => {
    const state = createMatch(["a", "b"], 0, () => 0);
    give(state, "a", "epic_copy");
    give(state, "a", "epic_star");
    give(state, "b", "epic_star");
    skipAuctionAndDeal(state, 0);
    expect(
      state.players.get("a")!.items.filter((i) => i.def.id === "epic_star"),
    ).toHaveLength(1);
    expect(getPlayerHand(state, "a").filter((c) => c.kind === CardKind.Star).length).toBeGreaterThanOrEqual(
      1,
    );
  });

  it("anti-overload adds 3s to skill offer, choice, swap and rps windows", () => {
    const swap = createMatch(["a", "b"], 0, () => 0.2);
    give(swap, "a", "legendary_swap_hands");
    give(swap, "a", "rare_anti_overload");
    skipAuctionAndDeal(swap, 0);
    expect(swap.pending?.kind).toBe("swap_hands");
    expect(swap.pending && "expiresAt" in swap.pending ? swap.pending.expiresAt : 0).toBe(
      MATCH_TIMING.swapHandsMs + 3000,
    );
    expect(tickMatch(swap, MATCH_TIMING.swapHandsMs).ok).toBe(false);
    expect(tickMatch(swap, MATCH_TIMING.swapHandsMs + 3000).ok).toBe(true);

    const offer = createMatch(["a", "b"], 0, () => 0.5);
    give(offer, "a", "rare_steal_one");
    give(offer, "a", "rare_anti_overload");
    skipAuctionAndDeal(offer, 0);
    setTurn(offer, "a");
    expect(offerItemId(offer)).toBe("rare_steal_one");
    const offerUntil =
      offer.pending && "expiresAt" in offer.pending ? offer.pending.expiresAt : 0;
    expect(offerUntil).toBe(MATCH_TIMING.itemOfferMs + 3000);
    const confirmed = useMatchItem(offer, "a", "rare_steal_one", { confirmUse: true }, 100);
    expect(confirmed.ok).toBe(true);
    const choiceUntil =
      offer.pending && "expiresAt" in offer.pending ? offer.pending.expiresAt : 0;
    expect(choiceUntil).toBe(100 + MATCH_TIMING.itemChoiceMs + 3000);

    const rps = createMatch(["a", "b"], 0, () => 0.5);
    give(rps, "b", "legendary_play_something_else");
    give(rps, "b", "rare_anti_overload");
    skipAuctionAndDeal(rps, 0);
    setTurn(rps, "a");
    const card = getPlayerHand(rps, "a").find((c) => c.kind !== CardKind.FirstPlay)!;
    playCards(rps, "a", [card.id], 100);
    skipOffers(rps, 100 + MATCH_TIMING.reactionMs);
    passTurn(rps, "b", 200);
    expect(useMatchItem(rps, "b", "legendary_play_something_else", {}, 300).ok).toBe(true);
    expect(rps.pending?.kind).toBe("rps");
    expect(rps.pending && "expiresAt" in rps.pending ? rps.pending.expiresAt : 0).toBe(
      300 + MATCH_TIMING.rpsMs + 3000,
    );
  });

  it("copy does not clone 双王", () => {
    const state = createMatch(["a", "b"], 0, () => 0);
    give(state, "a", "epic_copy");
    give(state, "b", "legendary_collect_jokers");
    skipAuctionAndDeal(state, 0);
    expect(
      state.players.get("a")!.items.some((i) => i.def.id === "legendary_collect_jokers"),
    ).toBe(false);
    expect(state.players.get("a")!.items.some((i) => i.def.id === "epic_copy")).toBe(
      true,
    );
  });

  it("memory card counter counts remaining hands including stars and bombs", () => {
    const state = createMatch(["a", "b"], 0, () => 0.5);
    give(state, "a", "epic_memory");
    give(state, "a", "epic_star");
    give(state, "b", "epic_bomb");
    skipAuctionAndDeal(state, 0);
    expect(toPublicMatchState(state, "b").cardCounter).toBeNull();
    const rows = toPublicMatchState(state, "a").cardCounter;
    expect(rows).not.toBeNull();
    const byId = Object.fromEntries((rows ?? []).map((r) => [r.id, r]));
    expect(byId[`r${Rank.Three}`]?.count).toBe(4);
    expect(byId[`r${Rank.BigJoker}`]?.count).toBe(1);
    expect(byId.star?.count).toBe(2);
    expect(byId.bomb?.count).toBe(2);
    expect(byId.first?.count).toBe(1);
    const holder = ["a", "b"].find((id) =>
      getPlayerHand(state, id).some((c) => c.kind === CardKind.FirstPlay),
    )!;
    const first = getPlayerHand(state, holder).find((c) => c.kind === CardKind.FirstPlay)!;
    setTurn(state, holder);
    skipOffers(state, 100);
    expect(playCards(state, holder, [first.id], 100).ok).toBe(true);
    expect(
      toPublicMatchState(state, "a").cardCounter?.find((r) => r.id === "first")?.count,
    ).toBe(0);
  });

  it("keeps game-start skill cards in inventory after they apply", () => {
    const state = createMatch(["a", "b"], 0, () => 0.5);
    give(state, "a", "legendary_god_eye");
    give(state, "a", "epic_memory");
    give(state, "a", "rare_anti_overload");
    give(state, "b", "legendary_collect_jokers");
    give(state, "b", "rare_head_start");
    skipAuctionAndDeal(state, 0);
    const idsA = state.players.get("a")!.items.map((i) => i.def.id);
    const idsB = state.players.get("b")!.items.map((i) => i.def.id);
    expect(idsA).toEqual(expect.arrayContaining(["legendary_god_eye", "epic_memory", "rare_anti_overload"]));
    expect(idsB).toEqual(expect.arrayContaining(["legendary_collect_jokers", "rare_head_start"]));
    expect(state.players.get("a")!.flags.canSeeAllHands).toBe(true);
    expect(state.players.get("a")!.flags.hasCardCounter).toBe(true);
    expect(state.players.get("a")!.flags.thinkTimeBonusSec).toBe(3);
    const used = useMatchItem(state, "a", "legendary_god_eye", {}, 100);
    expect(used.ok).toBe(false);
  });

  it("max bomb blocks follow bombs but not rocket", () => {
    const state = createMatch(["a", "b"], 0, () => 0.5);
    give(state, "a", "epic_max_bomb");
    skipAuctionAndDeal(state, 0);
    expect(state.players.get("a")!.flags.maxBomb).toBe(true);
    setTurn(state, "a");
    const bombLow = [Suit.Spade, Suit.Heart, Suit.Club, Suit.Diamond].map((s) =>
      createNormalCard(Rank.Three, s),
    );
    const bombHigh = [Suit.Spade, Suit.Heart, Suit.Club, Suit.Diamond].map((s) =>
      createNormalCard(Rank.Ace, s),
    );
    const rocket = [
      createNormalCard(Rank.SmallJoker),
      createNormalCard(Rank.BigJoker),
    ];
    state.players.get("a")!.hand = [
      ...bombLow,
      createNormalCard(Rank.Five, Suit.Spade),
    ];
    state.players.get("b")!.hand = [...bombHigh, ...rocket];
    expect(playCards(state, "a", bombLow.map((c) => c.id), 100).ok).toBe(true);
    if (state.pending) tickMatch(state, 100 + MATCH_TIMING.reactionMs);
    setTurn(state, "b");
    expect(playCards(state, "b", bombHigh.map((c) => c.id), 200).ok).toBe(false);
    expect(playCards(state, "b", rocket.map((c) => c.id), 300).ok).toBe(true);
  });

  it("bounce only after an opponent lead, not a follow", () => {
    const state = createMatch(["a", "b"], 0, () => 0.5);
    give(state, "a", "rare_bounce");
    skipAuctionAndDeal(state, 0);
    setTurn(state, "b");
    const lead = createNormalCard(Rank.Five, Suit.Spade);
    const follow = createNormalCard(Rank.Six, Suit.Heart);
    state.players.get("b")!.hand = [lead, createNormalCard(Rank.Nine, Suit.Club)];
    state.players.get("a")!.hand = [follow, createNormalCard(Rank.Eight, Suit.Diamond)];
    expect(playCards(state, "b", [lead.id], 100).ok).toBe(true);
    if (state.pending) tickMatch(state, 100 + MATCH_TIMING.reactionMs);
    setTurn(state, "a");
    expect(playCards(state, "a", [follow.id], 200).ok).toBe(true);
    expect(offerItemId(state)).not.toBe("rare_bounce");
    const bounced = useMatchItem(state, "a", "rare_bounce", {}, 250);
    expect(bounced.ok).toBe(false);
  });

  it("instant win must be used, it does not auto-finish at 1 card", () => {
    const state = createMatch(["a", "b"], 0, () => 0.5);
    give(state, "a", "rare_instant_win");
    skipAuctionAndDeal(state, 0);
    state.players.get("a")!.hand = [createNormalCard(Rank.Five, Suit.Spade)];
    setTurn(state, "a");
    expect(offerItemId(state)).toBe("rare_instant_win");
    expect(state.players.get("a")!.finishRank).toBeNull();
    const used = useMatchItem(state, "a", "rare_instant_win", {}, 100);
    expect(used.ok).toBe(true);
    expect(state.players.get("a")!.finishRank).toBe(1);
    expect(state.phase).toBe("finished");
    expect(state.pending).toBeNull();
  });

  it("3p instant win ends the match immediately", () => {
    const state = createMatch(["a", "b", "c"], 0, () => 0.5);
    give(state, "a", "rare_instant_win");
    skipAuctionAndDeal(state, 0);
    state.players.get("a")!.hand = [createNormalCard(Rank.Five, Suit.Spade)];
    setTurn(state, "a");
    expect(useMatchItem(state, "a", "rare_instant_win", {}, 100).ok).toBe(true);
    expect(state.phase).toBe("finished");
    expect(state.pending).toBeNull();
    expect(state.players.get("a")!.finishRank).toBe(1);
    expect(state.players.get("b")!.finishRank).not.toBeNull();
    expect(state.players.get("c")!.finishRank).not.toBeNull();
  });

  it("4p first instant win passes the lead to the next player", () => {
    const state = createMatch(["a", "b", "c", "d"], 0, () => 0.5);
    give(state, "a", "rare_instant_win");
    skipAuctionAndDeal(state, 0);
    skipOffers(state, 0);
    setSeats(state, ["a", "b", "c", "d"]);
    state.players.get("a")!.hand = [createNormalCard(Rank.Five, Suit.Spade)];
    setTurn(state, "a");
    expect(useMatchItem(state, "a", "rare_instant_win", {}, 100).ok).toBe(true);
    expect(state.phase).toBe("playing");
    expect(state.pending?.kind === "offer_item" ? state.pending.itemId : null).not.toBe(
      "rare_instant_win",
    );
    expect(state.players.get("a")!.finishRank).toBe(1);
    expect(state.players.get("a")!.hand).toHaveLength(0);
    expect(state.turnSeat).toBe(state.players.get("b")!.seat);
    expect(state.turnExpiresAt).not.toBeNull();
    expect(state.tableHand).toBeNull();
  });

  it("active skill offer times out after 6s and does not consume", () => {
    const state = createMatch(["a", "b"], 0, () => 0.5);
    give(state, "a", "rare_upgrade");
    skipAuctionAndDeal(state, 0);
    giveThrees(state, "a", 1);
    setTurn(state, "a");
    expect(offerItemId(state)).toBe("rare_upgrade");
    const until = state.pending && "expiresAt" in state.pending ? state.pending.expiresAt : 0;
    expect(until - 0).toBe(MATCH_TIMING.itemOfferMs);
    const ticked = tickMatch(state, until);
    expect(ticked.ok).toBe(true);
    expect(state.pending).toBeNull();
    expect(state.players.get("a")!.items.some((i) => i.def.id === "rare_upgrade")).toBe(true);
  });

  it("upgrade turns threes into K Q J 10 by count and leaves fours", () => {
    const state = createMatch(["a", "b"], 0, () => 0.5);
    give(state, "a", "rare_upgrade");
    skipAuctionAndDeal(state, 0);
    const four = createNormalCard(Rank.Four, Suit.Spade);
    const five = createNormalCard(Rank.Five, Suit.Heart);
    state.players.get("a")!.hand = [
      createNormalCard(Rank.Three, Suit.Spade),
      createNormalCard(Rank.Three, Suit.Heart),
      createNormalCard(Rank.Three, Suit.Club),
      createNormalCard(Rank.Three, Suit.Diamond),
      four,
      five,
    ];
    setTurn(state, "a");
    expect(offerItemId(state)).toBe("rare_upgrade");
    expect(useMatchItem(state, "a", "rare_upgrade", {}, 100).ok).toBe(true);
    expect(getPlayerHand(state, "a").map((c) => c.rank)).toEqual([
      Rank.King,
      Rank.Queen,
      Rank.Jack,
      Rank.Ten,
      Rank.Four,
      Rank.Five,
    ]);
  });

  it("upgrade is not offered without a three", () => {
    const state = createMatch(["a", "b"], 0, () => 0.5);
    give(state, "a", "rare_upgrade");
    skipAuctionAndDeal(state, 0);
    state.players.get("a")!.hand = [
      createNormalCard(Rank.Four, Suit.Spade),
      createNormalCard(Rank.Five, Suit.Heart),
      createNormalCard(Rank.Six, Suit.Club),
    ];
    setTurn(state, "a");
    expect(offerItemId(state)).not.toBe("rare_upgrade");
  });

  it("big upgrade turns all threes and fours into queens", () => {
    const state = createMatch(["a", "b"], 0, () => 0.5);
    give(state, "a", "epic_big_upgrade");
    skipAuctionAndDeal(state, 0);
    const five = createNormalCard(Rank.Five, Suit.Heart);
    const six = createNormalCard(Rank.Six, Suit.Club);
    state.players.get("a")!.hand = [
      createNormalCard(Rank.Three, Suit.Spade),
      createNormalCard(Rank.Three, Suit.Heart),
      createNormalCard(Rank.Four, Suit.Club),
      createNormalCard(Rank.Four, Suit.Diamond),
      five,
      six,
    ];
    setTurn(state, "a");
    expect(offerItemId(state)).toBe("epic_big_upgrade");
    expect(useMatchItem(state, "a", "epic_big_upgrade", {}, 100).ok).toBe(true);
    expect(getPlayerHand(state, "a").map((c) => c.rank)).toEqual([
      Rank.Queen,
      Rank.Queen,
      Rank.Queen,
      Rank.Queen,
      Rank.Five,
      Rank.Six,
    ]);
  });

  it("big upgrade is offered with only fours", () => {
    const state = createMatch(["a", "b"], 0, () => 0.5);
    give(state, "a", "epic_big_upgrade");
    skipAuctionAndDeal(state, 0);
    state.players.get("a")!.hand = [
      createNormalCard(Rank.Four, Suit.Spade),
      createNormalCard(Rank.Six, Suit.Heart),
    ];
    setTurn(state, "a");
    expect(offerItemId(state)).toBe("epic_big_upgrade");
  });

  it("big upgrade is not offered without a three or four", () => {
    const state = createMatch(["a", "b"], 0, () => 0.5);
    give(state, "a", "epic_big_upgrade");
    skipAuctionAndDeal(state, 0);
    state.players.get("a")!.hand = [
      createNormalCard(Rank.Five, Suit.Spade),
      createNormalCard(Rank.Six, Suit.Heart),
    ];
    setTurn(state, "a");
    expect(offerItemId(state)).not.toBe("epic_big_upgrade");
  });

  it("super upgrade turns all threes fours and fives into kings", () => {
    const state = createMatch(["a", "b"], 0, () => 0.5);
    give(state, "a", "legendary_super_upgrade");
    skipAuctionAndDeal(state, 0);
    const six = createNormalCard(Rank.Six, Suit.Club);
    state.players.get("a")!.hand = [
      createNormalCard(Rank.Three, Suit.Spade),
      createNormalCard(Rank.Four, Suit.Heart),
      createNormalCard(Rank.Five, Suit.Club),
      createNormalCard(Rank.Five, Suit.Diamond),
      six,
    ];
    setTurn(state, "a");
    expect(offerItemId(state)).toBe("legendary_super_upgrade");
    expect(useMatchItem(state, "a", "legendary_super_upgrade", {}, 100).ok).toBe(true);
    expect(getPlayerHand(state, "a").map((c) => c.rank)).toEqual([
      Rank.King,
      Rank.King,
      Rank.King,
      Rank.King,
      Rank.Six,
    ]);
  });

  it("super upgrade is not offered without a three four or five", () => {
    const state = createMatch(["a", "b"], 0, () => 0.5);
    give(state, "a", "legendary_super_upgrade");
    skipAuctionAndDeal(state, 0);
    state.players.get("a")!.hand = [
      createNormalCard(Rank.Six, Suit.Spade),
      createNormalCard(Rank.Seven, Suit.Heart),
    ];
    setTurn(state, "a");
    expect(offerItemId(state)).not.toBe("legendary_super_upgrade");
  });

  it("confirmUse starts a fresh 6s choice window without consuming", () => {
    const state = createMatch(["a", "b"], 0, () => 0.5);
    give(state, "a", "rare_steal_one");
    skipAuctionAndDeal(state, 0);
    setTurn(state, "a");
    expect(offerItemId(state)).toBe("rare_steal_one");
    const confirmed = useMatchItem(
      state,
      "a",
      "rare_steal_one",
      { confirmUse: true },
      100,
    );
    expect(confirmed.ok).toBe(true);
    expect(offerItemId(state)).toBe("rare_steal_one");
    expect(state.players.get("a")!.items.some((i) => i.def.id === "rare_steal_one")).toBe(true);
    const until = state.pending && "expiresAt" in state.pending ? state.pending.expiresAt : 0;
    expect(until).toBe(100 + MATCH_TIMING.itemChoiceMs);
    const ticked = tickMatch(state, until);
    expect(ticked.ok).toBe(true);
    expect(state.pending).toBeNull();
    expect(state.players.get("a")!.items.some((i) => i.def.id === "rare_steal_one")).toBe(true);
  });

  it("wild king and bomb king grant bonus cards at start and stay in the bar", () => {
    const state = createMatch(["a", "b"], 0, () => 0.5);
    give(state, "a", "legendary_wild_king");
    give(state, "a", "legendary_bomb_king");
    skipAuctionAndDeal(state, 0);
    expect(
      getPlayerHand(state, "a").filter((c) => c.kind === CardKind.Star).length,
    ).toBeGreaterThanOrEqual(2);
    expect(
      getPlayerHand(state, "a").filter((c) => c.kind === CardKind.BombCard).length,
    ).toBeGreaterThanOrEqual(2);
    expect(state.players.get("a")!.items.some((i) => i.def.id === "legendary_wild_king")).toBe(
      true,
    );
    expect(state.players.get("a")!.items.some((i) => i.def.id === "legendary_bomb_king")).toBe(
      true,
    );
    setTurn(state, "a");
    expect(offerItemId(state)).not.toBe("legendary_wild_king");
    expect(offerItemId(state)).not.toBe("legendary_bomb_king");
  });

  it("small insight counts rocket and bomb cards only", () => {
    const state = createMatch(["a", "b"], 0, () => 0.5);
    give(state, "a", "rare_small_insight");
    skipAuctionAndDeal(state, 0);
    const fours = [Suit.Spade, Suit.Heart, Suit.Club, Suit.Diamond].map((s) =>
      createNormalCard(Rank.Three, s),
    );
    state.players.get("b")!.hand = fours;
    expect(toPublicMatchState(state, "a").bombInsight?.b).toBe(0);
    state.players.get("b")!.hand = [...fours, createBombCard()];
    expect(toPublicMatchState(state, "a").bombInsight?.b).toBe(1);
    state.players.get("b")!.hand = [
      createNormalCard(Rank.SmallJoker),
      createNormalCard(Rank.BigJoker),
      createBombCard(),
    ];
    expect(toPublicMatchState(state, "a").bombInsight?.b).toBe(2);
  });
});

describe("item offer priority", () => {
  beforeEach(() => resetDeckIdCounter());

  it("keeps the locked same-player turn order", () => {
    expect([...TURN_ITEM_ORDER]).toEqual([
      "rare_instant_win",
      "rare_upgrade",
      "epic_big_upgrade",
      "legendary_super_upgrade",
      "rare_peek",
      "rare_steal_one",
      "legendary_force_trade",
      "epic_big_trade",
      "legendary_discard_nine",
      "rare_brain_overload",
    ]);
  });

  it("asks one player's turn skills in TURN_ITEM_ORDER", () => {
    const state = createMatch(["a", "b"], 0, () => 0.5);
    give(state, "a", "rare_upgrade");
    give(state, "a", "rare_steal_one");
    give(state, "a", "rare_brain_overload");
    skipAuctionAndDeal(state, 0);
    giveThrees(state, "a", 1);
    setSeats(state, ["a", "b"]);
    expect(collectTurnItemOffers(state, "a").map((o) => o.itemId)).toEqual([
      "rare_upgrade",
      "rare_steal_one",
      "rare_brain_overload",
    ]);
  });

  it("asks after-play skills from next seat, bounce before self-follow", () => {
    const state = createMatch(["a", "b", "c"], 0, () => 0.5);
    give(state, "b", "rare_bounce");
    give(state, "c", "rare_bounce");
    give(state, "a", "epic_self_follow");
    skipAuctionAndDeal(state, 0);
    setSeats(state, ["a", "b", "c"]);
    const offers = collectAfterPlayOffers(state, "a", HandType.Single, false, null, null);
    expect(offers.map((o) => `${o.playerId}:${o.itemId}`)).toEqual([
      "b:rare_bounce",
      "c:rare_bounce",
      "a:epic_self_follow",
    ]);
  });

  it("asks on-lead skills from next seat, rps before control", () => {
    const state = createMatch(["a", "b", "c"], 0, () => 0.5);
    give(state, "b", "legendary_play_something_else");
    give(state, "b", "epic_control");
    give(state, "c", "legendary_play_something_else");
    skipAuctionAndDeal(state, 0);
    setSeats(state, ["a", "b", "c"]);
    expect(getPlayerHand(state, "a").length).toBeGreaterThan(5);
    const offers = collectOnLeadOffers(state, "a");
    expect(offers.map((o) => `${o.playerId}:${o.itemId}`)).toEqual([
      "b:legendary_play_something_else",
      "b:epic_control",
      "c:legendary_play_something_else",
    ]);
  });

  it("asks extra round holders from next seat counterclockwise", () => {
    const state = createMatch(["a", "b", "c"], 0, () => 0.5);
    give(state, "a", "legendary_extra_round");
    give(state, "b", "legendary_extra_round");
    give(state, "c", "legendary_extra_round");
    skipAuctionAndDeal(state, 0);
    setSeats(state, ["a", "b", "c"]);
    const offers = collectExtraRoundOffers(state, { fromSeat: 0 });
    expect(offers.map((o) => o.playerId)).toEqual(["b", "c", "a"]);
  });

  it("asks bounce before extra round after a play", () => {
    const state = createMatch(["a", "b", "c"], 0, () => 0.5);
    give(state, "a", "legendary_extra_round");
    give(state, "b", "rare_bounce");
    skipAuctionAndDeal(state, 0);
    setSeats(state, ["a", "b", "c"]);
    setTurn(state, "a");
    state.players.get("a")!.hand = state.players.get("a")!.hand.slice(0, 5);
    const card = getPlayerHand(state, "a")[0]!;
    expect(playCards(state, "a", [card.id], 100).ok).toBe(true);
    expect(offerItemId(state)).toBe("rare_bounce");
    expect(offerPlayerId(state)).toBe("b");
    expect(declineItemOffer(state, "b", 200).ok).toBe(true);
    expect(offerItemId(state)).toBe("legendary_extra_round");
    expect(offerPlayerId(state)).toBe("a");
  });

  it("drops remaining after-play asks when bounce is used", () => {
    const state = createMatch(["a", "b", "c"], 0, () => 0.5);
    give(state, "b", "rare_bounce");
    give(state, "c", "rare_bounce");
    skipAuctionAndDeal(state, 0);
    setSeats(state, ["a", "b", "c"]);
    setTurn(state, "a");
    const card = getPlayerHand(state, "a").find((c) => c.kind !== CardKind.FirstPlay)!;
    expect(playCards(state, "a", [card.id], 100).ok).toBe(true);
    expect(offerPlayerId(state)).toBe("b");
    expect(useMatchItem(state, "b", "rare_bounce", {}, 200).ok).toBe(true);
    expect(offerItemId(state)).not.toBe("rare_bounce");
  });

  it("keeps the first turn skill's choice window before asking the next skill", () => {
    const state = createMatch(["a", "b"], 0, () => 0.5);
    give(state, "a", "rare_steal_one");
    give(state, "a", "rare_brain_overload");
    skipAuctionAndDeal(state, 0);
    setSeats(state, ["a", "b"]);
    setTurn(state, "a");
    expect(offerItemId(state)).toBe("rare_steal_one");
    const confirmed = useMatchItem(
      state,
      "a",
      "rare_steal_one",
      { confirmUse: true },
      100,
    );
    expect(confirmed.ok).toBe(true);
    expect(offerItemId(state)).toBe("rare_steal_one");
    expect(state.itemOfferQueue.map((o) => o.itemId)).toContain("rare_brain_overload");
    expect(getPlayerHand(state, "b").length).toBeGreaterThan(8);
    const stolen = useMatchItem(
      state,
      "a",
      "rare_steal_one",
      { targetPlayerId: "b" },
      200,
    );
    expect(stolen.ok).toBe(true);
    expect(offerItemId(state)).toBe("rare_brain_overload");
  });

  it("targeted skills record who was hit on item_used", () => {
    const steal = createMatch(["a", "b"], 0, () => 0.5);
    give(steal, "a", "rare_steal_one");
    skipAuctionAndDeal(steal, 0);
    setTurn(steal, "a");
    const stolen = useMatchItem(steal, "a", "rare_steal_one", { targetPlayerId: "b" }, 100);
    expect(stolen.ok).toBe(true);
    expect(stolen.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "item_used",
          playerId: "a",
          itemId: "rare_steal_one",
          targetPlayerId: "b",
          drawnHint: expect.stringMatching(/点数|王|星牌|炸弹牌|先手牌/),
        }),
      ]),
    );

    const trade = createMatch(["a", "b"], 0, () => 0.5);
    give(trade, "a", "epic_big_trade");
    skipAuctionAndDeal(trade, 0);
    setTurn(trade, "a");
    const swapped = useMatchItem(trade, "a", "epic_big_trade", { targetPlayerId: "b" }, 100);
    expect(swapped.ok).toBe(true);
    expect(swapped.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "item_used",
          itemId: "epic_big_trade",
          targetPlayerId: "b",
        }),
      ]),
    );

    const force = createMatch(["a", "b"], 0, () => 0.5);
    give(force, "a", "legendary_force_trade");
    skipAuctionAndDeal(force, 0);
    setTurn(force, "a");
    const yanked = useMatchItem(force, "a", "legendary_force_trade", { targetPlayerId: "b" }, 100);
    expect(yanked.ok).toBe(true);
    expect(yanked.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "item_used",
          itemId: "legendary_force_trade",
          targetPlayerId: "b",
        }),
      ]),
    );

    const overload = createMatch(["a", "b"], 0, () => 0.5);
    give(overload, "a", "rare_brain_overload");
    skipAuctionAndDeal(overload, 0);
    setTurn(overload, "a");
    expect(useMatchItem(overload, "a", "rare_brain_overload", {}, 100).ok).toBe(true);
    expect(toPublicMatchState(overload, "b").overloadTurnsLeft).toBe(5);
    expect(toPublicMatchState(overload, "a").overloadTurnsLeft).toBe(0);
  });
});
