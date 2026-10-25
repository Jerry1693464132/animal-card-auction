import { analyzeHand, doublesScoreMultiplier } from "../analyzer.js";
import {
  createAuction,
  placeOpeningBid as auctionOpen,
  placeRaise as auctionRaise,
  tickAuction as auctionTick,
  toPublicAuctionState,
} from "../auction/engine.js";
import { RaiseAmount } from "../auction/constants.js";
import { AuctionPhase, AuctionPublicState } from "../auction/types.js";
import { canBeat, canPass } from "../comparator.js";
import { createDeck, dealCards } from "../deck.js";
import { RANK_LABELS } from "../rank.js";
import { Card, CardKind, HandType, Rank } from "../types.js";
import {
  applyGameStartItems,
  applyInteractiveItem,
  beginRpsPicking,
  clearTurnOfferSkips,
  collectOnLeadOffers,
  collectTurnItemOffers,
  completeForceTradeReturn,
  countHandBombs,
  defaultFlags,
  dropQueuedOffers,
  enqueueItemOffers,
  markTurnOfferSkipped,
  openAfterPlayWindow,
  openExtraRoundWindow,
  openNextItemOffer,
  openOpeningSwapHands,
  randomRpsChoice,
  rpsWinner,
  swapOrdinaryHands,
  thinkBonusMs,
  UseItemPayload,
} from "./effects.js";
import {
  ItemOffer,
  ItemOfferContext,
  MATCH_TIMING,
  MatchActionResult,
  MatchEvent,
  MatchPhase,
  MatchPlayer,
  MatchPublicState,
  MatchState,
  OwnedItem,
  PendingInteraction,
  RpsChoice,
  ScoreDoubleChoice,
  scoreDoubleFactor,
} from "./types.js";
import { pickAutoFollowCardIds, pickManagedLeadCardIds } from "./autoplay.js";

let instanceCounter = 0;

function nextInstanceId(itemId: string): string {
  instanceCounter += 1;
  return `${itemId}-${instanceCounter}-${Math.random().toString(36).slice(2, 8)}`;
}

function playerBySeat(state: MatchState, seat: number): MatchPlayer | null {
  for (const p of state.players.values()) {
    if (p.seat === seat) return p;
  }
  return null;
}

function activePlayers(state: MatchState): MatchPlayer[] {
  return [...state.players.values()]
    .filter((p) => p.finishRank === null)
    .sort((a, b) => a.seat - b.seat);
}

function isFreeLead(state: MatchState): boolean {
  return state.tableHand === null;
}

function turnPlayer(state: MatchState): MatchPlayer | null {
  return playerBySeat(state, state.turnSeat);
}

function cardThinkKey(card: Card): number {
  if (card.kind === CardKind.FirstPlay) return -1;
  // 超时领出优先出普通最小牌，不先打出炸弹牌
  if (card.kind === CardKind.BombCard) return 1000;
  return card.rank ?? 99;
}

function armTurnClock(state: MatchState, now: number): void {
  if (state.phase !== MatchPhase.Playing || state.pending) {
    state.turnExpiresAt = null;
    return;
  }
  const turn = turnPlayer(state);
  if (!turn || turn.finishRank !== null) {
    state.turnExpiresAt = null;
    return;
  }
  const overloaded = turn.flags.overloadTurnsLeft > 0;
  state.turnExpiresAt = overloaded
    ? now + MATCH_TIMING.overloadTurnMs
    : now + MATCH_TIMING.turnMs + thinkBonusMs(turn);
}

function preparePlayerTurn(
  state: MatchState,
  player: MatchPlayer,
  now: number,
  events: MatchEvent[],
  opts: { freeLead: boolean; includeOnLead: boolean },
): void {
  if (state.phase !== MatchPhase.Playing || player.finishRank !== null) return;
  state.turnSeat = player.seat;
  clearTurnOfferSkips(state);
  events.push({
    type: "turn",
    playerId: player.id,
    freeLead: opts.freeLead,
  });
  const offers: ItemOffer[] = [];
  if (opts.includeOnLead && opts.freeLead) {
    offers.push(...collectOnLeadOffers(state, player.id));
  }
  offers.push(...collectTurnItemOffers(state, player.id));
  enqueueItemOffers(state, offers, now, events);
  armTurnClock(state, now);
}

function resumeAfterItemOffer(
  state: MatchState,
  context: ItemOfferContext,
  now: number,
  events: MatchEvent[],
): void {
  if (state.pending) return;
  if (openNextItemOffer(state, now, events)) {
    armTurnClock(state, now);
    return;
  }
  if (context.reason === "after_play") {
    const actor = state.players.get(context.actorId);
    if (actor) {
      maybeExtraRound(state, now, events, {
        fromSeat: actor.seat,
        afterPlayActorId: actor.id,
      });
      if (state.pending) {
        armTurnClock(state, now);
        return;
      }
      advanceTurnAfterPlay(state, actor, events, now);
    } else {
      armTurnClock(state, now);
    }
    return;
  }
  if (context.reason === "on_lead") {
    const leader = state.players.get(context.leaderId);
    if (leader && leader.finishRank === null) {
      preparePlayerTurn(state, leader, now, events, {
        freeLead: true,
        includeOnLead: false,
      });
    } else {
      armTurnClock(state, now);
    }
    return;
  }
  if (context.reason === "extra_round" && context.afterPlayActorId) {
    const actor = state.players.get(context.afterPlayActorId);
    if (actor) advanceTurnAfterPlay(state, actor, events, now);
    else armTurnClock(state, now);
    return;
  }
  armTurnClock(state, now);
}

function closeItemOffer(
  state: MatchState,
  offer: Extract<PendingInteraction, { kind: "offer_item" }>,
  accepted: boolean,
  now: number,
  events: MatchEvent[],
): void {
  if (offer.context.reason === "turn") {
    markTurnOfferSkipped(state, offer.playerId, offer.itemId);
  }
  if (state.pending?.kind === "offer_item" && state.pending.itemId === offer.itemId) {
    state.pending = null;
    events.push({ type: "pending_resolved", kind: "offer_item" });
  }
  if (accepted && offer.context.reason === "turn") {
    state.itemOfferQueue = state.itemOfferQueue.filter(
      (o) => !(o.playerId === offer.playerId && o.context.reason === "turn"),
    );
    enqueueItemOffers(
      state,
      collectTurnItemOffers(state, offer.playerId),
      now,
      events,
    );
  }
  resumeAfterItemOffer(state, offer.context, now, events);
}

export function declineItemOffer(
  state: MatchState,
  playerId: string,
  now: number = Date.now(),
): MatchActionResult {
  const pending = state.pending;
  if (!pending || pending.kind !== "offer_item") {
    return { ok: false, error: "No item offer pending" };
  }
  if (pending.playerId !== playerId) {
    return { ok: false, error: "Not your item offer" };
  }
  const events: MatchEvent[] = [];
  closeItemOffer(state, pending, false, now, events);
  return { ok: true, state, events };
}

const AUTOPLAY_MAX_STEPS = 48;

function autoPlayOne(state: MatchState, now: number): MatchEvent[] | null {
  if (state.phase !== MatchPhase.Playing) return null;
  const pending = state.pending;
  if (pending) {
    if (pending.kind === "offer_item" && state.autoPlay.has(pending.playerId)) {
      const result = declineItemOffer(state, pending.playerId, now);
      return result.ok ? result.events : null;
    }
    if (pending.kind === "swap_hands" && state.autoPlay.has(pending.playerId)) {
      const result = resolveSwapHands(state, pending.playerId, null, now);
      return result.ok ? result.events : null;
    }
    if (pending.kind === "force_trade" && state.autoPlay.has(pending.playerId)) {
      completeForceTradeReturn(state, pending.playerId, null);
      const events: MatchEvent[] = [
        { type: "pending_resolved", kind: "force_trade" },
        {
          type: "item_used",
          playerId: pending.playerId,
          itemId: "legendary_force_trade",
        },
      ];
      const turn = turnPlayer(state);
      if (turn) openNextItemOffer(state, now, events);
      armTurnClock(state, now);
      return events;
    }
    if (pending.kind === "score_double") {
      for (const id of state.playerIds) {
        if (state.autoPlay.has(id) && pending.choices[id] == null) {
          const result = resolveScoreDouble(state, id, "none", now);
          return result.ok ? result.events : null;
        }
      }
      return null;
    }
    if (pending.kind === "rps" && pending.phase === "picking") {
      const ids = [pending.challengerId, pending.targetId];
      for (const id of ids) {
        if (!state.autoPlay.has(id)) continue;
        const chosen = id === pending.challengerId ? pending.challengerChoice : pending.targetChoice;
        if (chosen) continue;
        const result = resolveRps(state, id, randomRpsChoice(state.rng), now);
        return result.ok ? result.events : null;
      }
    }
    if (pending.kind === "afk_host" && state.autoPlay.has(pending.playerId)) {
      const result = resolveAfkHost(state, pending.playerId, true, now);
      return result.ok ? result.events : null;
    }
    return null;
  }

  const turn = turnPlayer(state);
  if (!turn || turn.finishRank !== null || !state.autoPlay.has(turn.id)) return null;

  if (isFreeLead(state)) {
    if (state.leadRestriction?.playerId === turn.id) {
      const ids = pickManagedLeadCardIds(state, turn) ?? pickAutoLeadCardIds(state, turn);
      if (ids) {
        const played = playCards(state, turn.id, ids, now);
        return played.ok ? played.events : null;
      }
      const yielded = yieldControlledLead(state, turn.id, now);
      return yielded.ok ? yielded.events : null;
    }
    const ids = pickManagedLeadCardIds(state, turn);
    if (!ids) {
      if (state.bounceForbidType && state.lastBouncerId) {
        const events: MatchEvent[] = [];
        if (!giveLeadToBouncer(state, now, events)) return null;
        return events;
      }
      return null;
    }
    const played = playCards(state, turn.id, ids, now);
    return played.ok ? played.events : null;
  }

  const follow = pickAutoFollowCardIds(state, turn);
  if (follow) {
    const played = playCards(state, turn.id, follow, now);
    if (played.ok) return played.events;
  }
  const passed = passTurn(state, turn.id, now);
  return passed.ok ? passed.events : null;
}

/** 托管玩家立刻处理当前该他做的技能/出牌决策。 */
export function applyAutoPlay(
  state: MatchState,
  now: number = Date.now(),
): MatchEvent[] {
  const events: MatchEvent[] = [];
  for (let i = 0; i < AUTOPLAY_MAX_STEPS; i += 1) {
    const step = autoPlayOne(state, now);
    if (!step || step.length === 0) break;
    events.push(...step);
    if (state.phase === MatchPhase.Finished) break;
  }
  return events;
}

export function setMatchAutoPlay(
  state: MatchState,
  playerId: string,
  enabled: boolean,
  now: number = Date.now(),
): MatchActionResult {
  if (!state.players.has(playerId)) {
    return { ok: false, error: "Unknown player" };
  }
  const was = state.autoPlay.has(playerId);
  if (enabled) state.autoPlay.add(playerId);
  else state.autoPlay.delete(playerId);
  const events: MatchEvent[] = [];
  if (was !== enabled) {
    events.push({ type: "auto_play_changed", playerId, enabled });
  }
  if (enabled) events.push(...applyAutoPlay(state, now));
  return { ok: true, state, events };
}

/** 测试/调试：清空当前询问窗，给指定玩家打开本回合主动技能询问 */
export function armTurnWithItemOffers(
  state: MatchState,
  playerId: string,
  now: number = Date.now(),
): MatchActionResult {
  const player = state.players.get(playerId);
  if (!player) return { ok: false, error: "Unknown player" };
  state.pending = null;
  state.itemOfferQueue = [];
  const events: MatchEvent[] = [];
  preparePlayerTurn(state, player, now, events, {
    freeLead: isFreeLead(state),
    includeOnLead: false,
  });
  return { ok: true, state, events };
}

function pickAutoLeadCardIds(state: MatchState, player: MatchPlayer): string[] | null {
  const allowed =
    state.leadRestriction?.playerId === player.id
      ? state.leadRestriction.allowed
      : null;
  const forbid = state.bounceForbidType;
  const sorted = [...player.hand].sort((a, b) => cardThinkKey(a) - cardThinkKey(b));

  const tryHand = (cards: Card[]): boolean => {
    const parsed = analyzeHand(cards, {
      tripleExtraSingle: player.flags.tripleExtraSingle,
      fourExtraSingle: player.flags.fourExtraSingle,
    });
    if (!parsed) return false;
    if (forbid && parsed.type === forbid) return false;
    if (allowed === "single") {
      return parsed.type === HandType.Single || parsed.type === HandType.FirstPlay;
    }
    if (allowed === "pair") return parsed.type === HandType.Pair;
    return true;
  };

  if (allowed === "pair") {
    const byRank = new Map<number, Card[]>();
    for (const card of sorted) {
      const key = card.rank ?? -1;
      const list = byRank.get(key) ?? [];
      list.push(card);
      byRank.set(key, list);
    }
    for (const group of byRank.values()) {
      if (group.length < 2) continue;
      const pair = group.slice(0, 2);
      if (tryHand(pair)) return pair.map((c) => c.id);
    }
    return null;
  }

  for (const card of sorted) {
    if (tryHand([card])) return [card.id];
  }
  if (!forbid) return null;

  const byRank = new Map<number, Card[]>();
  for (const card of sorted) {
    if (card.kind !== CardKind.Normal && card.kind !== CardKind.Star) continue;
    const key = card.rank ?? -1;
    const list = byRank.get(key) ?? [];
    list.push(card);
    byRank.set(key, list);
  }
  for (const size of [2, 3, 4, 5, 6, 7, 8]) {
    for (const group of byRank.values()) {
      if (group.length < size) continue;
      const cards = group.slice(0, size);
      if (tryHand(cards)) return cards.map((c) => c.id);
    }
  }
  const small = player.hand.find((c) => c.rank === Rank.SmallJoker);
  const big = player.hand.find((c) => c.rank === Rank.BigJoker);
  if (small && big && tryHand([small, big])) return [small.id, big.id];
  return null;
}

function giveLeadToBouncer(
  state: MatchState,
  now: number,
  events: MatchEvent[],
): boolean {
  const bouncer = state.lastBouncerId ? state.players.get(state.lastBouncerId) : null;
  state.bounceForbidType = null;
  state.lastBouncerId = null;
  state.tableHand = null;
  state.tableLeaderId = null;
  state.passStreak = 0;
  if (!bouncer || bouncer.finishRank !== null) return false;
  events.push({ type: "new_lead", playerId: bouncer.id });
  preparePlayerTurn(state, bouncer, now, events, {
    freeLead: true,
    includeOnLead: true,
  });
  return true;
}

function nextActiveSeat(state: MatchState, fromSeat: number): number {
  const n = state.playerIds.length;
  // 座位号沿桌面逆时针递增
  for (let i = 1; i <= n; i += 1) {
    const seat = (fromSeat + i) % n;
    const p = playerBySeat(state, seat);
    if (p && p.finishRank === null) return seat;
  }
  return fromSeat;
}

function shuffleInPlace<T>(items: T[], rng: () => number): void {
  for (let i = items.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = items[i]!;
    items[i] = items[j]!;
    items[j] = tmp;
  }
}

/** 先手为 0 号位，其余人随机坐 1…n−1（逆时针）。 */
function assignCounterclockwiseSeats(state: MatchState): void {
  const leader = turnPlayer(state);
  const leaderId = leader?.id ?? state.playerIds[0];
  if (!leaderId) return;
  const others = state.playerIds.filter((id) => id !== leaderId);
  shuffleInPlace(others, state.rng);
  const seated = [leaderId, ...others];
  seated.forEach((id, seat) => {
    const player = state.players.get(id);
    if (player) player.seat = seat;
  });
  state.turnSeat = 0;
}

function transferAuctionItems(state: MatchState): void {
  const auction = state.auction;
  if (!auction) return;
  for (const [id, ap] of auction.players) {
    const mp = state.players.get(id);
    if (!mp) continue;
    for (const def of ap.inventory) {
      mp.items.push({
        instanceId: nextInstanceId(def.id),
        def,
        remainingUses: def.maxUses,
      });
    }
  }
}

function dealIntoHands(state: MatchState): MatchEvent[] {
  const events: MatchEvent[] = [];
  const { hands } = dealCards(
    createDeck(state.playerIds.length),
    state.playerIds.length,
    state.rng,
  );
  const handSizes: Record<string, number> = {};
  for (let i = 0; i < state.playerIds.length; i += 1) {
    const id = state.playerIds[i];
    const player = state.players.get(id)!;
    player.hand = hands[i];
    handSizes[id] = hands[i].length;
  }
  events.push({ type: "dealt", handSizes });
  return events;
}

function beginPlaying(state: MatchState, now: number): MatchEvent[] {
  const events: MatchEvent[] = [];
  state.phase = MatchPhase.Dealing;
  transferAuctionItems(state);
  state.auction = null;
  events.push({ type: "auction_finished" });
  events.push(...dealIntoHands(state));
  events.push(...applyGameStartItems(state, now, { skipSwap: true }));
  assignCounterclockwiseSeats(state);
  state.phase = MatchPhase.Playing;
  openScoreDoubleWindow(state, now, events);
  return events;
}

function openingDoubleBonusMs(state: MatchState): number {
  let bonus = 0;
  for (const p of state.players.values()) {
    bonus = Math.max(bonus, thinkBonusMs(p));
  }
  return bonus;
}

function openScoreDoubleWindow(state: MatchState, now: number, events: MatchEvent[]): void {
  const choices: Record<string, ScoreDoubleChoice | null> = {};
  for (const id of state.playerIds) choices[id] = null;
  const expiresAt = now + MATCH_TIMING.scoreDoubleMs + openingDoubleBonusMs(state);
  state.pending = { kind: "score_double", expiresAt, choices };
  state.turnExpiresAt = null;
  events.push({ type: "pending", kind: "score_double", expiresAt });
}

function scoreDoubleWindowComplete(
  pending: Extract<PendingInteraction, { kind: "score_double" }>,
): boolean {
  return statePlayerIdsChosen(pending);
}

function statePlayerIdsChosen(
  pending: Extract<PendingInteraction, { kind: "score_double" }>,
): boolean {
  return Object.values(pending.choices).every((c) => c != null);
}

function finishScoreDoubleWindow(
  state: MatchState,
  now: number,
  events: MatchEvent[],
): void {
  const pending = state.pending;
  if (pending?.kind !== "score_double") return;
  for (const id of state.playerIds) {
    const choice = pending.choices[id] ?? "none";
    if (pending.choices[id] == null) {
      events.push({ type: "score_double_chosen", playerId: id, choice });
    }
    pending.choices[id] = choice;
    state.scoreDoubles[id] = scoreDoubleFactor(choice);
  }
  state.pending = null;
  events.push({ type: "pending_resolved", kind: "score_double" });
  events.push(...openOpeningSwapHands(state, now));
  if (state.pending) return;
  const turn = turnPlayer(state);
  if (turn) {
    preparePlayerTurn(state, turn, now, events, {
      freeLead: isFreeLead(state),
      includeOnLead: true,
    });
  } else {
    armTurnClock(state, now);
  }
}

export function resolveScoreDouble(
  state: MatchState,
  playerId: string,
  choice: ScoreDoubleChoice,
  now: number = Date.now(),
): MatchActionResult {
  const pending = state.pending;
  if (!pending || pending.kind !== "score_double") {
    return { ok: false, error: "No double pending" };
  }
  if (!state.playerIds.includes(playerId)) {
    return { ok: false, error: "Not in match" };
  }
  if (choice !== "none" && choice !== "double" && choice !== "super") {
    return { ok: false, error: "Invalid double choice" };
  }
  if (pending.choices[playerId] != null) {
    return { ok: true, state, events: [] };
  }
  pending.choices[playerId] = choice;
  const events: MatchEvent[] = [{ type: "score_double_chosen", playerId, choice }];
  if (scoreDoubleWindowComplete(pending)) {
    finishScoreDoubleWindow(state, now, events);
  }
  return { ok: true, state, events };
}

/** 测试用：开局加倍窗全部视为不加倍并进入技能/出牌 */
export function skipOpeningDoubles(
  state: MatchState,
  now: number = Date.now(),
): MatchActionResult {
  if (state.pending?.kind !== "score_double") {
    return { ok: true, state, events: [] };
  }
  for (const id of state.playerIds) {
    if (state.pending.choices[id] == null) state.pending.choices[id] = "none";
  }
  const events: MatchEvent[] = [];
  finishScoreDoubleWindow(state, now, events);
  return { ok: true, state, events };
}

export function createMatch(
  playerIds: string[],
  now: number = Date.now(),
  rng: () => number = Math.random,
  options?: { matchId?: string; ranked?: boolean },
): MatchState {
  const players = new Map<string, MatchPlayer>();
  playerIds.forEach((id, seat) => {
    players.set(id, {
      id,
      seat,
      hand: [],
      items: [],
      flags: defaultFlags(),
      finishRank: null,
    });
  });

  return {
    matchId: options?.matchId ?? `match-${now}`,
    ranked: options?.ranked ?? false,
    phase: MatchPhase.Auction,
    playerIds: [...playerIds],
    players,
    auction: createAuction(playerIds, now, rng),
    discard: [],
    tableHand: null,
    tableLeaderId: null,
    passStreak: 0,
    turnSeat: 0,
    finishCount: 0,
    belowTenSeen: new Set(),
    extraRoundApplied: false,
    pending: null,
    itemOfferQueue: [],
    turnOfferSkipped: new Set(),
    leadRestriction: null,
    bounceForbidType: null,
    lastBouncerId: null,
    peeks: [],
    turnExpiresAt: null,
    autoPlay: new Set<string>(),
    startedAt: now,
    finishedAt: null,
    scoreMultiplier: 1,
    scoreDoubles: Object.fromEntries(playerIds.map((id) => [id, 1])),
    rng,
  };
}

function afterAuctionTick(
  state: MatchState,
  now: number,
  auctionEvents: unknown[],
): MatchActionResult {
  const events: MatchEvent[] = [...(auctionEvents as MatchEvent[])];
  if (state.auction && state.auction.phase === AuctionPhase.Finished) {
    events.push(...beginPlaying(state, now));
  }
  return { ok: true, state, events };
}

export function matchPlaceOpeningBid(
  state: MatchState,
  playerId: string,
  now: number = Date.now(),
): MatchActionResult {
  if (state.phase !== MatchPhase.Auction || !state.auction) {
    return { ok: false, error: "Not in auction" };
  }
  const result = auctionOpen(state.auction, playerId, now);
  if (!result.ok) return { ok: false, error: result.error };
  return afterAuctionTick(state, now, [result.event]);
}

export function matchPlaceRaise(
  state: MatchState,
  playerId: string,
  raise: RaiseAmount,
  now: number = Date.now(),
): MatchActionResult {
  if (state.phase !== MatchPhase.Auction || !state.auction) {
    return { ok: false, error: "Not in auction" };
  }
  const result = auctionRaise(state.auction, playerId, raise, now);
  if (!result.ok) return { ok: false, error: result.error };
  return afterAuctionTick(state, now, [result.event]);
}

export function matchTickAuction(
  state: MatchState,
  now: number = Date.now(),
): MatchActionResult {
  if (state.phase !== MatchPhase.Auction || !state.auction) {
    return { ok: false, error: "Not in auction" };
  }
  const result = auctionTick(state.auction, now);
  if (!result.ok) return { ok: false, error: result.error };
  return afterAuctionTick(state, now, [result.event]);
}

export function skipAuctionAndDeal(
  state: MatchState,
  now: number = Date.now(),
): MatchActionResult {
  if (state.phase !== MatchPhase.Auction) {
    return { ok: false, error: "Not in auction" };
  }
  const events = beginPlaying(state, now);
  return { ok: true, state, events };
}

function removeCardsFromHand(player: MatchPlayer, cardIds: string[]): Card[] | null {
  const selected: Card[] = [];
  const remaining = [...player.hand];
  for (const id of cardIds) {
    const idx = remaining.findIndex((c) => c.id === id);
    if (idx < 0) return null;
    selected.push(remaining.splice(idx, 1)[0]);
  }
  player.hand = remaining;
  return selected;
}

function matchShouldEnd(state: MatchState): boolean {
  const n = state.playerIds.length;
  const remaining = activePlayers(state);
  if (remaining.length <= 1) return true;
  // 三人场只争第 1；四人场前两名出完后其余并列，不必打完
  if (n === 3 && state.finishCount >= 1) return true;
  if (n >= 4 && state.finishCount >= 2) return true;
  return false;
}

function assignRemainingRanks(state: MatchState, events: MatchEvent[]): void {
  for (const last of activePlayers(state)) {
    state.finishCount += 1;
    last.finishRank = state.finishCount;
    events.push({
      type: "player_finished",
      playerId: last.id,
      rank: last.finishRank,
    });
  }
}

function markFinished(
  state: MatchState,
  player: MatchPlayer,
  events: MatchEvent[],
  now: number,
): boolean {
  if (player.finishRank !== null) return state.finishedAt !== null;
  state.finishCount += 1;
  player.finishRank = state.finishCount;
  events.push({
    type: "player_finished",
    playerId: player.id,
    rank: player.finishRank,
  });

  if (!matchShouldEnd(state)) return false;
  assignRemainingRanks(state, events);
  finishMatch(state, events, now);
  return true;
}

function finishMatch(
  state: MatchState,
  events: MatchEvent[],
  now: number,
): void {
  state.phase = MatchPhase.Finished;
  state.finishedAt = now;
  state.turnExpiresAt = null;
  state.pending = null;
  state.itemOfferQueue = [];
  state.autoPlay.clear();
  const ranking = [...state.players.values()]
    .filter((p) => p.finishRank !== null)
    .map((p) => ({ playerId: p.id, rank: p.finishRank! }))
    .sort((a, b) => a.rank - b.rank);
  const durationSec = Math.max(1, Math.round((now - state.startedAt) / 1000));
  events.push({
    type: "match_finished",
    matchId: state.matchId,
    ranked: state.ranked,
    ranking,
    durationSec,
  });
}

function advanceTurnAfterPlay(
  state: MatchState,
  actor: MatchPlayer,
  events: MatchEvent[],
  now: number,
  opts?: { keepTurn?: boolean },
): void {
  if (opts?.keepTurn) {
    preparePlayerTurn(state, actor, now, events, {
      freeLead: false,
      includeOnLead: false,
    });
    return;
  }

  if (actor.finishRank !== null) {
    // 出完后领出权归下一活跃玩家，清空桌面
    state.tableHand = null;
    state.tableLeaderId = null;
    state.passStreak = 0;
    if (state.phase === MatchPhase.Finished) return;
    state.turnSeat = nextActiveSeat(state, actor.seat);
    const next = turnPlayer(state);
    if (next) {
      events.push({ type: "new_lead", playerId: next.id });
      preparePlayerTurn(state, next, now, events, {
        freeLead: true,
        includeOnLead: true,
      });
    }
    return;
  }

  state.turnSeat = nextActiveSeat(state, actor.seat);
  const next = turnPlayer(state);
  if (next) {
    preparePlayerTurn(state, next, now, events, {
      freeLead: false,
      includeOnLead: false,
    });
  } else {
    armTurnClock(state, now);
  }
}

function maybeExtraRound(
  state: MatchState,
  now: number,
  events: MatchEvent[],
  opts?: { fromSeat?: number; afterPlayActorId?: string },
): void {
  if (state.phase === MatchPhase.Finished || state.extraRoundApplied) return;
  for (const p of state.players.values()) {
    if (p.finishRank !== null || p.hand.length >= 10) {
      state.belowTenSeen.delete(p.id);
    }
  }
  let newlyBelow = false;
  for (const p of state.players.values()) {
    if (p.finishRank !== null || p.hand.length >= 10) continue;
    if (state.belowTenSeen.has(p.id)) continue;
    state.belowTenSeen.add(p.id);
    newlyBelow = true;
  }
  if (!newlyBelow) return;
  openExtraRoundWindow(state, now, events, opts);
}

export function playCards(
  state: MatchState,
  playerId: string,
  cardIds: string[],
  now: number = Date.now(),
): MatchActionResult {
  if (state.phase !== MatchPhase.Playing) {
    return { ok: false, error: "Not playing" };
  }
  if (state.pending) {
    return { ok: false, error: "Interaction pending" };
  }
  const player = state.players.get(playerId);
  if (!player || player.finishRank !== null) {
    return { ok: false, error: "Unknown or finished player" };
  }
  if (turnPlayer(state)?.id !== playerId) {
    return { ok: false, error: "Not your turn" };
  }

  const free = isFreeLead(state);
  const previousTable = state.tableHand;
  const previousLeaderId = state.tableLeaderId;

  // 临时取出牌验证，失败再还原——先复制手牌
  const handBackup = [...player.hand];
  const selected = removeCardsFromHand(player, cardIds);
  if (!selected) {
    player.hand = handBackup;
    return { ok: false, error: "Cards not in hand" };
  }

  const parsed = analyzeHand(selected, {
    tripleExtraSingle: player.flags.tripleExtraSingle,
    fourExtraSingle: player.flags.fourExtraSingle,
  });
  if (!parsed) {
    player.hand = handBackup;
    return { ok: false, error: "Invalid hand" };
  }

  // 领出限制
  if (free && state.leadRestriction?.playerId === playerId) {
    const allowed = state.leadRestriction.allowed;
    const okType =
      (allowed === "single" && parsed.type === HandType.Single) ||
      (allowed === "pair" && parsed.type === HandType.Pair);
    if (!okType) {
      player.hand = handBackup;
      return { ok: false, error: `Lead restricted to ${allowed}` };
    }
    state.leadRestriction = null;
  }

  // 打回禁止牌型
  if (state.bounceForbidType && parsed.type === state.bounceForbidType) {
    player.hand = handBackup;
    return { ok: false, error: "Bounce forbids this hand type" };
  }

  if (!free) {
    const leader =
      state.tableLeaderId ? state.players.get(state.tableLeaderId) : null;
    if (
      leader?.flags.maxBomb &&
      state.tableHand?.type === HandType.Bomb &&
      parsed.type === HandType.Bomb
    ) {
      player.hand = handBackup;
      return { ok: false, error: "Max bomb can only be beaten by rocket" };
    }
    if (!state.tableHand || !canBeat(state.tableHand, parsed)) {
      player.hand = handBackup;
      return { ok: false, error: "Cannot beat table" };
    }
  }

  // 成功出牌
  if (player.flags.overloadTurnsLeft > 0) {
    player.flags.overloadTurnsLeft -= 1;
  }
  state.bounceForbidType = null;
  state.lastBouncerId = null;
  state.discard.push(...selected);
  state.tableHand = parsed;
  state.tableLeaderId = playerId;
  state.passStreak = 0;
  if (doublesScoreMultiplier(parsed)) {
    state.scoreMultiplier *= 2;
  }

  const events: MatchEvent[] = [
    {
      type: "played",
      playerId,
      cardIds: selected.map((c) => c.id),
      handType: parsed.type,
      mainRank: parsed.mainRank,
      handSize: player.hand.length,
    },
  ];

  if (player.hand.length === 0 && markFinished(state, player, events, now)) {
    return { ok: true, state, events };
  }

  const opened = openAfterPlayWindow(
    state,
    playerId,
    parsed.type,
    !free,
    previousTable,
    previousLeaderId,
    now,
    events,
  );

  if (!opened && !state.pending && state.phase === MatchPhase.Playing) {
    maybeExtraRound(state, now, events, {
      fromSeat: player.seat,
      afterPlayActorId: player.id,
    });
    if (!state.pending) {
      advanceTurnAfterPlay(state, player, events, now);
    }
  }
  armTurnClock(state, now);

  return { ok: true, state, events };
}

export function passTurn(
  state: MatchState,
  playerId: string,
  now: number = Date.now(),
): MatchActionResult {
  if (state.phase !== MatchPhase.Playing) {
    return { ok: false, error: "Not playing" };
  }
  if (state.pending) {
    return { ok: false, error: "Interaction pending" };
  }
  const player = state.players.get(playerId);
  if (!player || player.finishRank !== null) {
    return { ok: false, error: "Unknown or finished player" };
  }
  if (turnPlayer(state)?.id !== playerId) {
    return { ok: false, error: "Not your turn" };
  }
  if (!canPass(state.tableHand, isFreeLead(state))) {
    return { ok: false, error: "Cannot pass on free lead" };
  }

  if (player.flags.overloadTurnsLeft > 0) {
    player.flags.overloadTurnsLeft -= 1;
  }

  const events: MatchEvent[] = [{ type: "passed", playerId }];
  state.passStreak += 1;

  const actives = activePlayers(state);
  // 除领出者外所有人过牌 → 新领出
  const others = actives.filter((p) => p.id !== state.tableLeaderId).length;
  if (state.passStreak >= others && state.tableLeaderId) {
    const leader = state.players.get(state.tableLeaderId);
    state.tableHand = null;
    state.passStreak = 0;
    if (leader && leader.finishRank === null) {
      state.tableLeaderId = null;
      events.push({ type: "new_lead", playerId: leader.id });
      preparePlayerTurn(state, leader, now, events, {
        freeLead: true,
        includeOnLead: true,
      });
    } else {
      state.tableLeaderId = null;
      state.turnSeat = nextActiveSeat(state, player.seat);
      const next = turnPlayer(state);
      if (next) {
        events.push({ type: "new_lead", playerId: next.id });
        preparePlayerTurn(state, next, now, events, {
          freeLead: true,
          includeOnLead: true,
        });
      } else {
        armTurnClock(state, now);
      }
    }
  } else {
    state.turnSeat = nextActiveSeat(state, player.seat);
    const next = turnPlayer(state);
    if (next) {
      preparePlayerTurn(state, next, now, events, {
        freeLead: false,
        includeOnLead: false,
      });
    } else {
      armTurnClock(state, now);
    }
  }

  return { ok: true, state, events };
}

/** 被操控的领出者把出牌权交给操控者 */
export function yieldControlledLead(
  state: MatchState,
  playerId: string,
  now: number = Date.now(),
): MatchActionResult {
  if (state.phase !== MatchPhase.Playing) {
    return { ok: false, error: "Not playing" };
  }
  if (state.pending) {
    return { ok: false, error: "Interaction pending" };
  }
  const player = state.players.get(playerId);
  if (!player || player.finishRank !== null) {
    return { ok: false, error: "Unknown or finished player" };
  }
  if (turnPlayer(state)?.id !== playerId) {
    return { ok: false, error: "Not your turn" };
  }
  const restriction = state.leadRestriction;
  if (!restriction || restriction.playerId !== playerId || !isFreeLead(state)) {
    return { ok: false, error: "Not under control" };
  }
  const controller = state.players.get(restriction.controllerId);
  if (!controller || controller.finishRank !== null) {
    return { ok: false, error: "Controller unavailable" };
  }

  state.leadRestriction = null;
  state.tableHand = null;
  state.tableLeaderId = null;
  state.passStreak = 0;
  const events: MatchEvent[] = [
    { type: "control_yielded", playerId, controllerId: controller.id },
    { type: "new_lead", playerId: controller.id },
  ];
  preparePlayerTurn(state, controller, now, events, {
    freeLead: true,
    includeOnLead: false,
  });
  return { ok: true, state, events };
}

export function resolveSwapHands(
  state: MatchState,
  playerId: string,
  targetId: string | null,
  now: number = Date.now(),
): MatchActionResult {
  const pending = state.pending;
  if (!pending || pending.kind !== "swap_hands") {
    return { ok: false, error: "No swap pending" };
  }
  if (pending.playerId !== playerId) {
    return { ok: false, error: "Not your swap window" };
  }

  const events: MatchEvent[] = [];
  if (targetId) {
    const a = state.players.get(playerId);
    const b = state.players.get(targetId);
    if (!a || !b) return { ok: false, error: "Unknown target" };
    swapOrdinaryHands(a, b);
    events.push({ type: "hands_swapped", playerId, targetId });
  }

  state.pending = null;
  events.push({ type: "pending_resolved", kind: "swap_hands" });

  const turn = turnPlayer(state);
  if (turn) {
    preparePlayerTurn(state, turn, now, events, {
      freeLead: isFreeLead(state),
      includeOnLead: true,
    });
  } else {
    armTurnClock(state, now);
  }
  return { ok: true, state, events };
}

export function resolveRps(
  state: MatchState,
  playerId: string,
  choice: RpsChoice,
  now: number = Date.now(),
): MatchActionResult {
  const pending = state.pending;
  if (!pending || pending.kind !== "rps") {
    return { ok: false, error: "No rps pending" };
  }
  if (pending.phase === "reveal") {
    return { ok: false, error: "RPS already revealed" };
  }
  if (playerId !== pending.targetId && playerId !== pending.challengerId) {
    return { ok: false, error: "Not in this rps" };
  }
  const already =
    playerId === pending.challengerId
      ? pending.challengerChoice
      : pending.targetChoice;
  if (already) {
    return { ok: false, error: "Already chosen" };
  }

  if (playerId === pending.challengerId) {
    pending.challengerChoice = choice;
  } else {
    pending.targetChoice = choice;
  }

  const events: MatchEvent[] = [];
  if (pending.challengerChoice && pending.targetChoice) {
    enterRpsReveal(pending, now, events);
  }
  return { ok: true, state, events };
}

function enterRpsReveal(
  pending: Extract<PendingInteraction, { kind: "rps" }>,
  now: number,
  events: MatchEvent[],
): void {
  pending.phase = "reveal";
  pending.expiresAt = now + MATCH_TIMING.rpsRevealMs;
  events.push({
    type: "rps_reveal",
    challengerId: pending.challengerId,
    targetId: pending.targetId,
    challengerChoice: pending.challengerChoice!,
    targetChoice: pending.targetChoice!,
  });
}

function fillMissingRpsChoices(
  state: MatchState,
  pending: Extract<PendingInteraction, { kind: "rps" }>,
): void {
  if (!pending.challengerChoice) {
    pending.challengerChoice = randomRpsChoice(state.rng);
  }
  if (!pending.targetChoice) {
    pending.targetChoice = randomRpsChoice(state.rng);
  }
}

function settleRpsReveal(
  state: MatchState,
  pending: Extract<PendingInteraction, { kind: "rps" }>,
  now: number,
  events: MatchEvent[],
): void {
  const challengerChoice = pending.challengerChoice!;
  const targetChoice = pending.targetChoice!;
  const result = rpsWinner(challengerChoice, targetChoice);
  let winnerId: string | null = null;
  if (result === "a") winnerId = pending.challengerId;
  else if (result === "b") winnerId = pending.targetId;

  events.push({
    type: "rps_result",
    challengerId: pending.challengerId,
    targetId: pending.targetId,
    winnerId,
    challengerChoice,
    targetChoice,
  });

  if (result === "draw") {
    beginRpsPicking(state, pending.challengerId, pending.targetId, now, events);
    return;
  }

  state.pending = null;
  events.push({ type: "pending_resolved", kind: "rps" });
  const leader = state.players.get(winnerId!);
  if (leader && leader.finishRank === null) {
    state.tableHand = null;
    state.tableLeaderId = null;
    state.passStreak = 0;
    events.push({ type: "new_lead", playerId: leader.id });
    preparePlayerTurn(state, leader, now, events, {
      freeLead: true,
      includeOnLead: false,
    });
  } else {
    armTurnClock(state, now);
  }
}

function publicPending(
  pending: PendingInteraction | null,
  viewerId?: string,
): PendingInteraction | null {
  if (!pending) return pending;
  if (pending.kind === "force_trade" && viewerId !== pending.playerId) {
    return {
      kind: "force_trade",
      playerId: pending.playerId,
      targetId: pending.targetId,
      expiresAt: pending.expiresAt,
    };
  }
  if (pending.kind !== "rps" && pending.kind !== "score_double") return pending;
  if (pending.kind === "score_double") {
    const choices: Record<string, ScoreDoubleChoice | null> = {};
    for (const [id, choice] of Object.entries(pending.choices)) {
      choices[id] = viewerId === id ? choice : null;
    }
    return { ...pending, choices };
  }
  if (pending.phase === "reveal") return { ...pending };
  return {
    ...pending,
    challengerChoice:
      viewerId === pending.challengerId ? pending.challengerChoice : null,
    targetChoice: viewerId === pending.targetId ? pending.targetChoice : null,
  };
}

function handleAfterPlayItemSideEffects(
  state: MatchState,
  events: MatchEvent[],
  now: number,
): boolean {
  const lastInteractive = [...events].reverse().find(
    (e) =>
      e.type === "self_follow" ||
      e.type === "play_bounced" ||
      e.type === "bomb_defused",
  );
  const offer = state.pending?.kind === "offer_item" ? state.pending : null;
  const ctx =
    offer?.context.reason === "after_play" ? offer.context : null;
  if (!lastInteractive || !ctx) {
    return false;
  }

  dropQueuedOffers(state, "after_play");

  if (lastInteractive.type === "self_follow") {
    state.pending = null;
    events.push({ type: "pending_resolved", kind: "offer_item" });
    const actor = state.players.get(ctx.actorId);
    if (actor) {
      state.turnSeat = actor.seat;
      events.push({ type: "turn", playerId: actor.id, freeLead: false });
    }
    armTurnClock(state, now);
    return true;
  }

  if (lastInteractive.type === "play_bounced") {
    const actor = state.players.get(ctx.actorId)!;
    const played = state.tableHand?.cards ?? [];
    for (const card of played) {
      const idx = state.discard.findIndex((c) => c.id === card.id);
      if (idx >= 0) state.discard.splice(idx, 1);
      actor.hand.push(card);
    }
    state.bounceForbidType = ctx.handType;
    state.lastBouncerId = lastInteractive.bouncerId;
    state.tableHand = ctx.previousTable;
    state.tableLeaderId = ctx.previousLeaderId;
    state.pending = null;
    events.push({ type: "pending_resolved", kind: "offer_item" });
    state.turnSeat = actor.seat;
    events.push({
      type: "turn",
      playerId: actor.id,
      freeLead: state.tableHand === null,
    });
    if (isFreeLead(state) && !pickAutoLeadCardIds(state, actor)) {
      giveLeadToBouncer(state, now, events);
      return true;
    }
    armTurnClock(state, now);
    return true;
  }

  if (lastInteractive.type === "bomb_defused") {
    state.tableHand = null;
    state.tableLeaderId = null;
    state.passStreak = 0;
    state.pending = null;
    events.push({ type: "pending_resolved", kind: "offer_item" });
    const defuser = state.players.get(lastInteractive.defuserId);
    if (defuser && defuser.finishRank === null) {
      events.push({ type: "new_lead", playerId: defuser.id });
      preparePlayerTurn(state, defuser, now, events, {
        freeLead: true,
        includeOnLead: true,
      });
    } else {
      armTurnClock(state, now);
    }
    return true;
  }
  return false;
}

export function useMatchItem(
  state: MatchState,
  playerId: string,
  itemId: string,
  payload: UseItemPayload = {},
  now: number = Date.now(),
): MatchActionResult {
  if (state.phase !== MatchPhase.Playing && state.phase !== MatchPhase.Dealing) {
    return { ok: false, error: "Cannot use item now" };
  }

  const offer =
    state.pending?.kind === "offer_item" ? state.pending : null;
  const result = applyInteractiveItem(state, playerId, itemId, payload, now);
  if (!result.ok) return { ok: false, error: result.error };

  const events = [...result.events];
  const afterPlayHandled = handleAfterPlayItemSideEffects(state, events, now);

  if (itemId === "rare_instant_win") {
    const player = state.players.get(playerId)!;
    player.hand = [];
    if (state.pending?.kind === "offer_item") {
      markTurnOfferSkipped(state, playerId, itemId);
      state.pending = null;
      events.push({ type: "pending_resolved", kind: "offer_item" });
    }
    state.itemOfferQueue = state.itemOfferQueue.filter(
      (o) => !(o.playerId === playerId && o.context.reason === "turn"),
    );
    if (markFinished(state, player, events, now)) {
      return { ok: true, state, events };
    }
    maybeExtraRound(state, now, events, {
      fromSeat: player.seat,
      afterPlayActorId: player.id,
    });
    if (!state.pending) {
      advanceTurnAfterPlay(state, player, events, now);
    }
    return { ok: true, state, events };
  }

  maybeExtraRound(state, now, events);

  if (!afterPlayHandled && offer && offer.itemId === itemId) {
    if (state.pending?.kind === "rps" || state.pending?.kind === "force_trade") {
      // 技能进入第二步窗口
    } else if (
      payload.confirmUse &&
      state.pending?.kind === "offer_item" &&
      state.pending.itemId === itemId
    ) {
      // 点了使用，仍在选目标 / 选牌型
    } else {
      closeItemOffer(state, offer, true, now, events);
    }
  }

  if (!state.pending) {
    openNextItemOffer(state, now, events);
  }
  if (!state.pending && state.turnExpiresAt === null) {
    armTurnClock(state, now);
  }

  return { ok: true, state, events };
}

export function tickMatch(
  state: MatchState,
  now: number = Date.now(),
): MatchActionResult {
  if (state.phase !== MatchPhase.Playing && state.phase !== MatchPhase.Dealing) {
    return { ok: false, error: "Nothing to tick" };
  }

  const events: MatchEvent[] = [];

  // 清理过期 peek
  state.peeks = state.peeks.filter((p) => p.expiresAt > now);

  const autoEvents = applyAutoPlay(state, now);
  if (autoEvents.length) {
    return { ok: true, state, events: autoEvents };
  }

  const pending = state.pending;
  if (pending && pending.expiresAt <= now) {
    if (pending.kind === "force_trade") {
      completeForceTradeReturn(state, pending.playerId, null);
      events.push({ type: "pending_resolved", kind: "force_trade" });
      events.push({
        type: "item_used",
        playerId: pending.playerId,
        itemId: "legendary_force_trade",
      });
      const turn = turnPlayer(state);
      if (turn) {
        openNextItemOffer(state, now, events);
      }
      armTurnClock(state, now);
      return { ok: true, state, events };
    }

    if (pending.kind === "offer_item") {
      closeItemOffer(state, pending, false, now, events);
      return { ok: true, state, events };
    }

    if (pending.kind === "rps") {
      if (pending.phase !== "reveal") {
        fillMissingRpsChoices(state, pending);
        enterRpsReveal(pending, now, events);
        return { ok: true, state, events };
      }
      settleRpsReveal(state, pending, now, events);
      return { ok: true, state, events };
    }

    if (pending.kind === "score_double") {
      finishScoreDoubleWindow(state, now, events);
      return { ok: true, state, events };
    }

    if (pending.kind === "afk_host") {
      return resolveAfkHost(state, pending.playerId, true, now);
    }

    const kind = pending.kind;
    state.pending = null;
    events.push({ type: "pending_resolved", kind });

    if (kind === "swap_hands") {
      const turn = turnPlayer(state);
      if (turn) {
        preparePlayerTurn(state, turn, now, events, {
          freeLead: isFreeLead(state),
          includeOnLead: true,
        });
      } else {
        armTurnClock(state, now);
      }
    } else {
      armTurnClock(state, now);
    }
    return { ok: true, state, events };
  }

  if (
    !pending &&
    state.phase === MatchPhase.Playing &&
    state.turnExpiresAt !== null &&
    state.turnExpiresAt <= now
  ) {
    return openAfkHostPrompt(state, now);
  }

  return { ok: false, error: "Nothing expired" };
}

function openAfkHostPrompt(state: MatchState, now: number): MatchActionResult {
  const turn = turnPlayer(state);
  if (!turn) return { ok: false, error: "Nothing expired" };
  if (state.autoPlay.has(turn.id)) return timeoutCurrentTurn(state, now);
  const expiresAt = now + MATCH_TIMING.afkHostMs + thinkBonusMs(turn);
  state.pending = { kind: "afk_host", playerId: turn.id, expiresAt };
  state.turnExpiresAt = null;
  return {
    ok: true,
    state,
    events: [
      { type: "afk_host", playerId: turn.id },
      { type: "pending", kind: "afk_host", expiresAt },
    ],
  };
}

/** 挂机确认：host=true 进入托管并立刻代打；false 本回合按超时处理且不进托管。 */
export function resolveAfkHost(
  state: MatchState,
  playerId: string,
  host: boolean,
  now: number = Date.now(),
): MatchActionResult {
  const pending = state.pending;
  if (!pending || pending.kind !== "afk_host") {
    return { ok: false, error: "No afk prompt pending" };
  }
  if (pending.playerId !== playerId) {
    return { ok: false, error: "Not your afk prompt" };
  }
  state.pending = null;
  const events: MatchEvent[] = [{ type: "pending_resolved", kind: "afk_host" }];
  if (host) {
    const hosted = setMatchAutoPlay(state, playerId, true, now);
    if (!hosted.ok) return hosted;
    events.push(...hosted.events);
    return { ok: true, state, events };
  }
  const timed = timeoutCurrentTurn(state, now);
  if (!timed.ok) return timed;
  events.push(...timed.events);
  return { ok: true, state, events };
}

function timeoutCurrentTurn(state: MatchState, now: number): MatchActionResult {
  const turn = turnPlayer(state);
  if (!turn) return { ok: false, error: "Nothing expired" };

  if (isFreeLead(state)) {
    if (state.leadRestriction?.playerId === turn.id) {
      const ids = pickAutoLeadCardIds(state, turn);
      if (ids) {
        const played = playCards(state, turn.id, ids, now);
        if (!played.ok) return played;
        return {
          ok: true,
          state,
          events: [
            { type: "turn_timeout", playerId: turn.id, action: "lead" },
            ...played.events,
          ],
        };
      }
      const yielded = yieldControlledLead(state, turn.id, now);
      if (!yielded.ok) return yielded;
      return {
        ok: true,
        state,
        events: [
          { type: "turn_timeout", playerId: turn.id, action: "yield" },
          ...yielded.events,
        ],
      };
    }
    const ids = pickAutoLeadCardIds(state, turn);
    if (!ids) {
      if (state.bounceForbidType && state.lastBouncerId) {
        const events: MatchEvent[] = [
          { type: "turn_timeout", playerId: turn.id, action: "yield" },
        ];
        if (!giveLeadToBouncer(state, now, events)) {
          return { ok: false, error: "Nothing expired" };
        }
        return { ok: true, state, events };
      }
      return { ok: false, error: "Nothing expired" };
    }
    const played = playCards(state, turn.id, ids, now);
    if (!played.ok) return played;
    return {
      ok: true,
      state,
      events: [
        { type: "turn_timeout", playerId: turn.id, action: "lead" },
        ...played.events,
      ],
    };
  }

  const passed = passTurn(state, turn.id, now);
  if (!passed.ok) return passed;
  return {
    ok: true,
    state,
    events: [
      { type: "turn_timeout", playerId: turn.id, action: "pass" },
      ...passed.events,
    ],
  };
}

export function getPlayerHand(state: MatchState, playerId: string): Card[] {
  return state.players.get(playerId)?.hand ?? [];
}

export function getVisibleHand(
  state: MatchState,
  viewerId: string,
  targetId: string,
  now: number = Date.now(),
): Card[] | null {
  if (viewerId === targetId) return getPlayerHand(state, targetId);
  if (state.phase === MatchPhase.Finished) {
    return getPlayerHand(state, targetId);
  }
  const target = state.players.get(targetId);
  if (target?.flags.hideFromSkills) return null;
  const viewer = state.players.get(viewerId);
  if (viewer?.flags.canSeeAllHands) {
    return getPlayerHand(state, targetId);
  }
  const peek = state.peeks.find(
    (p) =>
      p.viewerId === viewerId &&
      p.targetIds.includes(targetId) &&
      p.expiresAt > now,
  );
  if (peek) return getPlayerHand(state, targetId);
  return null;
}

function remainingCardId(card: Card): string {
  if (card.kind === CardKind.Star) return "star";
  if (card.kind === CardKind.BombCard) return "bomb";
  if (card.kind === CardKind.FirstPlay) return "first";
  return `r${card.rank ?? Rank.Three}`;
}

const CARD_COUNTER_SLOTS: Array<{ id: string; label: string }> = [
  { id: `r${Rank.BigJoker}`, label: RANK_LABELS[Rank.BigJoker] },
  { id: `r${Rank.SmallJoker}`, label: RANK_LABELS[Rank.SmallJoker] },
  { id: `r${Rank.Two}`, label: RANK_LABELS[Rank.Two] },
  { id: `r${Rank.Ace}`, label: RANK_LABELS[Rank.Ace] },
  { id: `r${Rank.Nineteen}`, label: RANK_LABELS[Rank.Nineteen] },
  { id: `r${Rank.Eighteen}`, label: RANK_LABELS[Rank.Eighteen] },
  { id: `r${Rank.Seventeen}`, label: RANK_LABELS[Rank.Seventeen] },
  { id: `r${Rank.Sixteen}`, label: RANK_LABELS[Rank.Sixteen] },
  { id: `r${Rank.Fifteen}`, label: RANK_LABELS[Rank.Fifteen] },
  { id: `r${Rank.Fourteen}`, label: RANK_LABELS[Rank.Fourteen] },
  { id: `r${Rank.King}`, label: RANK_LABELS[Rank.King] },
  { id: `r${Rank.Queen}`, label: RANK_LABELS[Rank.Queen] },
  { id: `r${Rank.Jack}`, label: RANK_LABELS[Rank.Jack] },
  { id: `r${Rank.Ten}`, label: RANK_LABELS[Rank.Ten] },
  { id: `r${Rank.Nine}`, label: RANK_LABELS[Rank.Nine] },
  { id: `r${Rank.Eight}`, label: RANK_LABELS[Rank.Eight] },
  { id: `r${Rank.Seven}`, label: RANK_LABELS[Rank.Seven] },
  { id: `r${Rank.Six}`, label: RANK_LABELS[Rank.Six] },
  { id: `r${Rank.Five}`, label: RANK_LABELS[Rank.Five] },
  { id: `r${Rank.Four}`, label: RANK_LABELS[Rank.Four] },
  { id: `r${Rank.Three}`, label: RANK_LABELS[Rank.Three] },
  { id: "first", label: RANK_LABELS[Rank.FirstPlay] },
  { id: "star", label: "星" },
  { id: "bomb", label: "炸" },
];

function remainingCardCounter(
  state: MatchState,
): Array<{ id: string; label: string; count: number }> {
  const counts = new Map<string, number>();
  for (const player of state.players.values()) {
    for (const card of player.hand) {
      const id = remainingCardId(card);
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
  }
  return CARD_COUNTER_SLOTS.map((slot) => ({
    id: slot.id,
    label: slot.label,
    count: counts.get(slot.id) ?? 0,
  }));
}

export function toPublicMatchState(
  state: MatchState,
  viewerId?: string,
): MatchPublicState {
  const turn = turnPlayer(state);
  const handCounts: Record<string, number | null> = {};
  for (const [id, p] of state.players) {
    if (state.phase !== MatchPhase.Finished && p.flags.hideHandFromOthers && viewerId !== id) {
      handCounts[id] = null;
    } else {
      handCounts[id] = p.hand.length;
    }
  }
  const ranking = [...state.players.values()]
    .filter((p) => p.finishRank !== null)
    .map((p) => ({ playerId: p.id, rank: p.finishRank! }))
    .sort((a, b) => a.rank - b.rank);

  const viewer = viewerId ? state.players.get(viewerId) : undefined;
  let bombInsight: MatchPublicState["bombInsight"] = null;
  if (viewer?.flags.knowBombCounts) {
    bombInsight = {};
    for (const [id, p] of state.players) {
      if (id === viewerId) continue;
      bombInsight[id] = countHandBombs(p.hand);
    }
  }

  return {
    phase: state.phase,
    turnPlayerId: turn?.id ?? null,
    turnExpiresAt: state.turnExpiresAt,
    freeLead: isFreeLead(state),
    pending: publicPending(state.pending, viewerId),
    leadRestriction: state.leadRestriction,
    table: state.tableHand
      ? {
          playerId: state.tableLeaderId!,
          type: state.tableHand.type,
          mainRank: state.tableHand.mainRank,
          length: state.tableHand.length,
          cardCount: state.tableHand.cards.length,
          cards: state.tableHand.cards.map((c) => ({
            id: c.id,
            kind: c.kind,
            rank: c.rank,
            suit: c.suit,
          })),
        }
      : null,
    handCounts,
    ranking,
    peeks: state.peeks,
    seatOrder: [...state.players.values()]
      .sort((a, b) => a.seat - b.seat)
      .map((p) => p.id),
    bombInsight,
    cardCounter: viewer?.flags.hasCardCounter ? remainingCardCounter(state) : null,
    bounceForbidType: state.bounceForbidType,
    lastBouncerId: state.lastBouncerId,
    overloadTurnsLeft: viewer?.flags.overloadTurnsLeft ?? 0,
    scoreMultiplier: state.scoreMultiplier,
    scoreDoubles: { ...state.scoreDoubles },
    autoPlay: Object.fromEntries(state.playerIds.map((id) => [id, state.autoPlay.has(id)])),
  };
}

export function getAuctionPublic(
  state: MatchState,
  now: number = Date.now(),
): AuctionPublicState | null {
  if (!state.auction) return null;
  return toPublicAuctionState(state.auction, now);
}

export type { OwnedItem, UseItemPayload };
