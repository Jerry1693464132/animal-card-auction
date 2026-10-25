import { ItemDefinition } from "../types.js";
import { LANDLORD_ITEM_POOL, rollUniqueItems } from "../items/pool.js";
import { AUCTION, RaiseAmount } from "./constants.js";
import {
  AuctionActionResult,
  AuctionButton,
  AuctionEvent,
  AuctionLot,
  AuctionPhase,
  AuctionPublicState,
  AuctionState,
} from "./types.js";

void LANDLORD_ITEM_POOL;

export function createAuctionLots(
  count: number,
  rng: () => number = Math.random,
): AuctionLot[] {
  const items = rollUniqueItems(count, rng);
  return items.map((item, index) => ({
    index,
    item,
    revealed: index === 0,
    winnerId: null,
    finalPrice: null,
    passed: false,
  }));
}

export function createAuction(
  playerIds: string[],
  now: number = Date.now(),
  rng: () => number = Math.random,
): AuctionState {
  const count = AUCTION.itemCountFormula(playerIds.length);
  const lots = createAuctionLots(count, rng);
  const players = new Map(
    playerIds.map((id) => [
      id,
      { id, balance: AUCTION.stipend, inventory: [] as ItemDefinition[] },
    ]),
  );

  return {
    phase: AuctionPhase.Bidding,
    playerIds: [...playerIds],
    players,
    lots,
    currentLotIndex: 0,
    currentPrice: AUCTION.openingBid,
    leadingPlayerId: null,
    lockedAmount: 0,
    bids: [],
    lastBidAt: now,
    lotOpenedAt: now,
    cooldownUntil: new Map(),
    createdAt: now,
  };
}

function currentLot(state: AuctionState): AuctionLot | null {
  if (state.currentLotIndex < 0 || state.currentLotIndex >= state.lots.length) {
    return null;
  }
  return state.lots[state.currentLotIndex];
}

function unlockLeader(state: AuctionState): void {
  if (!state.leadingPlayerId || state.lockedAmount <= 0) {
    state.leadingPlayerId = null;
    state.lockedAmount = 0;
    return;
  }
  const leader = state.players.get(state.leadingPlayerId);
  if (leader) leader.balance += state.lockedAmount;
  state.leadingPlayerId = null;
  state.lockedAmount = 0;
}

function lockBid(state: AuctionState, playerId: string, price: number): void {
  unlockLeader(state);
  const player = state.players.get(playerId)!;
  player.balance -= price;
  state.leadingPlayerId = playerId;
  state.lockedAmount = price;
  state.currentPrice = price;
}

function setRaiseCooldowns(state: AuctionState, bidderId: string, now: number): void {
  state.cooldownUntil.clear();
  for (const id of state.playerIds) {
    if (id === bidderId) continue;
    state.cooldownUntil.set(id, now + AUCTION.raiseCooldownMs);
  }
}

function advanceToNextLot(state: AuctionState, now: number): AuctionEvent {
  state.currentLotIndex += 1;
  state.currentPrice = AUCTION.openingBid;
  state.leadingPlayerId = null;
  state.lockedAmount = 0;
  state.bids = [];
  state.cooldownUntil.clear();

  if (state.currentLotIndex >= state.lots.length) {
    state.phase = AuctionPhase.Finished;
    return { type: "auction_finished" };
  }

  const lot = state.lots[state.currentLotIndex];
  lot.revealed = true;
  state.phase = AuctionPhase.Bidding;
  state.lastBidAt = now;
  state.lotOpenedAt = now;
  return { type: "opened", lotIndex: lot.index, itemId: lot.item.id };
}

function settleCurrentLot(state: AuctionState): AuctionEvent {
  const lot = currentLot(state)!;
  if (state.leadingPlayerId && state.lockedAmount > 0) {
    const winner = state.players.get(state.leadingPlayerId)!;
    // 锁定金额已从余额扣除，成交时转入库存
    winner.inventory.push(lot.item);
    lot.winnerId = winner.id;
    lot.finalPrice = state.lockedAmount;
    lot.passed = false;
    const price = state.lockedAmount;
    const winnerId = winner.id;
    const itemId = lot.item.id;
    state.lockedAmount = 0;
    state.leadingPlayerId = null;
    return {
      type: "lot_sold",
      lotIndex: lot.index,
      winnerId,
      price,
      itemId,
    };
  }

  lot.passed = true;
  lot.winnerId = null;
  lot.finalPrice = null;
  return {
    type: "lot_passed",
    lotIndex: lot.index,
    itemId: lot.item.id,
  };
}

export function placeOpeningBid(
  _state: AuctionState,
  _playerId: string,
  _now: number = Date.now(),
): AuctionActionResult {
  return { ok: false, error: "Opening bid removed; raise from floor 10" };
}

export function placeRaise(
  state: AuctionState,
  playerId: string,
  raise: RaiseAmount,
  now: number = Date.now(),
): AuctionActionResult {
  if (state.phase !== AuctionPhase.Bidding) {
    return { ok: false, error: "Not in bidding phase" };
  }
  const player = state.players.get(playerId);
  if (!player) return { ok: false, error: "Unknown player" };
  if (state.leadingPlayerId === playerId) {
    return { ok: false, error: "Leading bidder cannot raise own bid" };
  }

  const cd = state.cooldownUntil.get(playerId) ?? 0;
  if (now < cd) {
    return { ok: false, error: "Raise cooldown active" };
  }

  let nextPrice: number;
  let raiseTag: number | "allin";
  if (raise === "allin") {
    nextPrice = player.balance;
    if (nextPrice <= state.currentPrice) {
      return { ok: false, error: "All-in must exceed current price" };
    }
    raiseTag = "allin";
  } else {
    const amount = typeof raise === "number" ? raise : Number(raise);
    if (!(AUCTION.raiseAmounts as readonly number[]).includes(amount)) {
      return { ok: false, error: "Invalid raise" };
    }
    nextPrice = state.currentPrice + amount;
    if (player.balance < nextPrice) {
      return { ok: false, error: "Insufficient balance" };
    }
    raiseTag = amount as Exclude<RaiseAmount, "allin">;
  }

  lockBid(state, playerId, nextPrice);
  state.lastBidAt = now;
  setRaiseCooldowns(state, playerId, now);
  state.bids.push({ playerId, price: nextPrice, raise: raiseTag, at: now });

  return {
    ok: true,
    state,
    event: { type: "bid", playerId, price: nextPrice, raise: raiseTag },
  };
}

/**
 * 尚无人出价用 openIdleMs（首轮 12s 流拍）；已有领先者用 settleIdleMs（4s 成交）。
 */
export function lotIdleMs(state: AuctionState): number {
  if (!state.leadingPlayerId && state.bids.length === 0) {
    return AUCTION.openIdleMs;
  }
  return AUCTION.settleIdleMs;
}

/**
 * 推进拍卖：首轮满 12s 无人出价则流拍；有人出价后满 4s 无人加价则成交。
 */
export function tickAuction(
  state: AuctionState,
  now: number = Date.now(),
): AuctionActionResult {
  if (state.phase === AuctionPhase.Finished) {
    return { ok: false, error: "Auction finished" };
  }
  if (state.phase !== AuctionPhase.Bidding) {
    return { ok: false, error: "Nothing to tick" };
  }

  if (now - state.lastBidAt < lotIdleMs(state)) {
    return { ok: false, error: "Not ready to settle" };
  }

  return forceSettleLot(state, now);
}

/**
 * 强制结算当前拍品；返回结算事件，并推进到下一件。
 */
export function forceSettleLot(
  state: AuctionState,
  now: number = Date.now(),
): AuctionActionResult {
  if (
    state.phase !== AuctionPhase.Bidding &&
    state.phase !== AuctionPhase.SettledLot
  ) {
    return { ok: false, error: "Cannot settle in this phase" };
  }

  if (state.currentLotIndex >= state.lots.length) {
    state.phase = AuctionPhase.Finished;
    return { ok: true, state, event: { type: "auction_finished" } };
  }

  const settleEvent = settleCurrentLot(state);
  state.phase = AuctionPhase.SettledLot;
  state.cooldownUntil.clear();
  advanceToNextLot(state, now);
  return { ok: true, state, event: settleEvent };
}

/** 本件尚无人出价时，把流拍倒计时拨回满 12 秒（进场景/重连用）。 */
export function refreshLotIdleClock(
  state: AuctionState,
  now: number = Date.now(),
): void {
  if (state.phase !== AuctionPhase.Bidding) return;
  if (state.leadingPlayerId || state.bids.length > 0) return;
  state.lastBidAt = now;
  state.lotOpenedAt = now;
}

export function settleCountdownMs(state: AuctionState, now: number): number {
  if (state.phase !== AuctionPhase.Bidding) {
    return 0;
  }
  return Math.max(0, lotIdleMs(state) - (now - state.lastBidAt));
}

export function buttonCooldownMs(
  state: AuctionState,
  playerId: string,
  now: number,
): number {
  const until = state.cooldownUntil.get(playerId) ?? 0;
  return Math.max(0, until - now);
}

export function availableButtons(
  state: AuctionState,
  playerId: string,
  now: number,
): AuctionButton[] {
  const player = state.players.get(playerId);
  if (!player) return [];

  if (state.phase !== AuctionPhase.Bidding) return [];
  if (state.leadingPlayerId === playerId) return [];
  if (buttonCooldownMs(state, playerId, now) > 0) return [];

  const buttons: AuctionButton[] = [];
  for (const amount of AUCTION.raiseAmounts) {
    const nextPrice = state.currentPrice + amount;
    if (player.balance >= nextPrice) {
      buttons.push({ kind: "raise", amount, nextPrice });
    }
  }
  if (player.balance > state.currentPrice) {
    buttons.push({ kind: "allin", nextPrice: player.balance });
  }
  return buttons;
}

export function toPublicAuctionState(
  state: AuctionState,
  now: number = Date.now(),
): AuctionPublicState {
  const lot = currentLot(state);
  const balances: Record<string, number> = {};
  const inventoryCounts: Record<string, number> = {};
  for (const [id, p] of state.players) {
    balances[id] = p.balance;
    inventoryCounts[id] = p.inventory.length;
  }

  return {
    phase: state.phase,
    currentLotIndex: state.currentLotIndex,
    totalLots: state.lots.length,
    currentItem: lot && lot.revealed ? lot.item : null,
    currentPrice: state.currentPrice,
    leadingPlayerId: state.leadingPlayerId,
    settleInMs: settleCountdownMs(state, now),
    balances,
    inventoryCounts,
  };
}
