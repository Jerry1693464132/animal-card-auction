import { describe, expect, it } from "vitest";
import {
  AUCTION,
  AuctionPhase,
  availableButtons,
  buttonCooldownMs,
  createAuction,
  createAuctionLots,
  forceSettleLot,
  placeOpeningBid,
  placeRaise,
  refreshLotIdleClock,
  settleCountdownMs,
  tickAuction,
  toPublicAuctionState,
} from "../../src/index.js";

describe("auction setup", () => {
  it("item count is playerCount * 3", () => {
    expect(AUCTION.itemCountFormula(4)).toBe(12);
    expect(AUCTION.itemCountFormula(3)).toBe(9);
  });

  it("creates auction with stipend 300, floor 10, and hidden future lots", () => {
    const state = createAuction(["a", "b", "c", "d"], 1_000);
    expect(state.lots).toHaveLength(12);
    expect([...state.players.values()].every((p) => p.balance === AUCTION.stipend)).toBe(true);
    expect(AUCTION.stipend).toBe(300);
    expect(state.phase).toBe(AuctionPhase.Bidding);
    expect(state.currentPrice).toBe(10);
    expect(state.leadingPlayerId).toBeNull();
    expect(state.lots[0].revealed).toBe(true);
    expect(state.lots.slice(1).every((l) => !l.revealed)).toBe(true);

    const pub = toPublicAuctionState(state);
    expect(pub.currentItem?.id).toBe(state.lots[0].item.id);
    expect(pub.currentPrice).toBe(10);
    expect(pub.totalLots).toBe(12);
  });

  it("does not repeat item ids in one auction", () => {
    const three = createAuction(["a", "b", "c"], 0, () => 0.37);
    const four = createAuction(["a", "b", "c", "d"], 0);
    expect(three.lots).toHaveLength(9);
    expect(four.lots).toHaveLength(12);
    for (const state of [three, four]) {
      const ids = state.lots.map((lot) => lot.item.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it("createAuctionLots respects count", () => {
    expect(createAuctionLots(5, () => 0.1)).toHaveLength(5);
  });
});

describe("bidding flow", () => {
  it("rejects standalone opening bid", () => {
    const state = createAuction(["a", "b"], 0);
    const result = placeOpeningBid(state, "a", 100);
    expect(result.ok).toBe(false);
  });

  it("first raise is on top of floor 10", () => {
    const state = createAuction(["a", "b"], 0);
    const result = placeRaise(state, "a", 10, 100);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(state.currentPrice).toBe(20);
    expect(state.leadingPlayerId).toBe("a");
    expect(state.players.get("a")!.balance).toBe(280);
    const pub = toPublicAuctionState(state, 100);
    expect(pub.balances.a).toBe(280);
    expect(state.phase).toBe(AuctionPhase.Bidding);
  });

  it("other players can raise with +1/+5/+10/+20/+30", () => {
    const state = createAuction(["a", "b", "c"], 0);
    placeRaise(state, "a", 10, 0);
    const r = placeRaise(state, "b", 10, 600);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(state.currentPrice).toBe(30);
    expect(state.leadingPlayerId).toBe("b");
    expect(state.players.get("a")!.balance).toBe(300);
    expect(state.players.get("b")!.balance).toBe(270);
  });

  it("leading bidder cannot raise own bid", () => {
    const state = createAuction(["a", "b"], 0);
    placeRaise(state, "a", 5, 0);
    const r = placeRaise(state, "a", 5, 600);
    expect(r.ok).toBe(false);
  });

  it("applies 0.5s cooldown to other players after raise", () => {
    const state = createAuction(["a", "b", "c"], 0);
    placeRaise(state, "a", 1, 0);
    expect(buttonCooldownMs(state, "b", 100)).toBe(400);
    expect(buttonCooldownMs(state, "a", 100)).toBe(0);

    const blocked = placeRaise(state, "b", 5, 200);
    expect(blocked.ok).toBe(false);

    const ok = placeRaise(state, "b", 5, 500);
    expect(ok.ok).toBe(true);
  });

  it("all-in sets price to full balance", () => {
    const state = createAuction(["a", "b"], 0);
    placeRaise(state, "a", 1, 0);
    const r = placeRaise(state, "b", "allin", 600);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(state.currentPrice).toBe(300);
    expect(state.players.get("b")!.balance).toBe(0);
    expect(state.players.get("a")!.balance).toBe(300);
  });

  it("settles to last bidder after 4s idle", () => {
    const state = createAuction(["a", "b"], 0);
    placeRaise(state, "a", 10, 0);
    placeRaise(state, "b", 20, 600);

    const tooEarly = tickAuction(state, 600 + 3999);
    expect(tooEarly.ok).toBe(false);

    const settled = tickAuction(state, 600 + 4000);
    expect(settled.ok).toBe(true);
    if (!settled.ok) return;
    expect(settled.event.type).toBe("lot_sold");
    if (settled.event.type !== "lot_sold") return;
    expect(settled.event.winnerId).toBe("b");
    expect(settled.event.price).toBe(40);
    expect(state.players.get("b")!.inventory).toHaveLength(1);
    expect(state.currentLotIndex).toBe(1);
    expect(state.phase).toBe(AuctionPhase.Bidding);
    expect(state.currentPrice).toBe(10);
  });

  it("passes lot when nobody raises within 12s", () => {
    const state = createAuction(["a", "b"], 0);
    expect(tickAuction(state, 11_999).ok).toBe(false);
    const settled = tickAuction(state, 12_000);
    expect(settled.ok).toBe(true);
    if (!settled.ok) return;
    expect(settled.event.type).toBe("lot_passed");
    expect(state.lots[0].passed).toBe(true);
    expect(state.currentLotIndex).toBe(1);
  });

  it("idle clock can restart before anyone bids, not after", () => {
    const state = createAuction(["a", "b"], 0);
    refreshLotIdleClock(state, 2500);
    expect(state.lastBidAt).toBe(2500);
    expect(tickAuction(state, 2500 + 11_999).ok).toBe(false);
    expect(tickAuction(state, 2500 + 12_000).ok).toBe(true);

    const state2 = createAuction(["a", "b"], 0);
    placeRaise(state2, "a", 1, 100);
    refreshLotIdleClock(state2, 3000);
    expect(state2.lastBidAt).toBe(100);
  });

  it("public state never reveals next item", () => {
    const state = createAuction(["a", "b", "c", "d"], 0);
    const nextId = state.lots[1].item.id;
    const pub = toPublicAuctionState(state);
    expect(pub.currentItem?.id).not.toBe(nextId);
    expect(JSON.stringify(pub)).not.toContain(nextId);
  });

  it("available buttons are raises from floor, not open", () => {
    const state = createAuction(["a", "b"], 0);
    const start = availableButtons(state, "a", 0);
    expect(start.some((b) => b.kind === "open")).toBe(false);
    expect(start).toContainEqual({ kind: "raise", amount: 1, nextPrice: 11 });
    expect(start).toContainEqual({ kind: "raise", amount: 10, nextPrice: 20 });
    placeRaise(state, "a", 10, 0);
    expect(availableButtons(state, "a", 600)).toEqual([]);
    expect(availableButtons(state, "b", 600).map((b) => b.kind)).toContain("raise");
  });

  it("finishes after all lots", () => {
    const state = createAuction(["a", "b"], 0);
    expect(state.lots).toHaveLength(6);
    for (let i = 0; i < 6; i += 1) {
      const t = i * 10_000;
      placeRaise(state, "a", 1, t);
      const result = forceSettleLot(state, t + 4000);
      expect(result.ok).toBe(true);
    }
    expect(state.phase).toBe(AuctionPhase.Finished);
    expect(state.players.get("a")!.inventory).toHaveLength(6);
    expect(settleCountdownMs(state, 99_000)).toBe(0);
  });
});
