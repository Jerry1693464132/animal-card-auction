import {
  createBombCard,
  createDeck,
  createStarCard,
  findFirstPlayHolder,
  shuffleDeck,
} from "../deck.js";
import { Card, CardKind, HandType, ItemTrigger, ParsedHand, Rank } from "../types.js";
import { formatDrawnCardHint } from "../rank.js";
import {
  ForcedLeadType,
  ItemOffer,
  ItemOfferContext,
  MATCH_TIMING,
  MatchEvent,
  MatchPlayer,
  MatchPlayerFlags,
  MatchState,
  OwnedItem,
  PendingInteraction,
  RpsChoice,
} from "./types.js";

export function defaultFlags(): MatchPlayerFlags {
  return {
    canSeeAllHands: false,
    hasCardCounter: false,
    thinkTimeBonusSec: 0,
    tripleExtraSingle: false,
    fourExtraSingle: false,
    maxBomb: false,
    instantWinReady: false,
    hideHandFromOthers: false,
    hideFromSkills: false,
    knowBombCounts: false,
    overloadTurnsLeft: 0,
  };
}

export function consumeItem(player: MatchPlayer, itemId: string): OwnedItem | null {
  const owned = player.items.find(
    (i) => i.def.id === itemId && i.remainingUses > 0,
  );
  if (!owned) return null;
  owned.remainingUses -= 1;
  if (owned.remainingUses <= 0) {
    player.items = player.items.filter((i) => i.instanceId !== owned.instanceId);
  }
  return owned;
}

export function hasItem(player: MatchPlayer, itemId: string): boolean {
  return player.items.some((i) => i.def.id === itemId && i.remainingUses > 0);
}

/** 防过载等被动加在思考窗上的毫秒数 */
export function thinkBonusMs(player: MatchPlayer | undefined | null): number {
  return Math.max(0, (player?.flags.thinkTimeBonusSec ?? 0) * 1000);
}

function applyPassiveItemFlags(player: MatchPlayer, itemId: string): void {
  switch (itemId) {
    case "legendary_god_eye":
      player.flags.canSeeAllHands = true;
      break;
    case "epic_memory":
      player.flags.hasCardCounter = true;
      break;
    case "rare_anti_overload":
      player.flags.thinkTimeBonusSec += 3;
      break;
    case "epic_triple_plus_one":
      player.flags.tripleExtraSingle = true;
      break;
    case "epic_four_plus_three":
      player.flags.fourExtraSingle = true;
      break;
    case "epic_max_bomb":
      player.flags.maxBomb = true;
      break;
    case "rare_instant_win":
      player.flags.instantWinReady = true;
      break;
    case "rare_smoke":
      player.flags.hideHandFromOthers = true;
      player.flags.hideFromSkills = true;
      break;
    case "rare_small_insight":
      player.flags.knowBombCounts = true;
      break;
    default:
      break;
  }
}

function isJoker(card: Card): boolean {
  return card.rank === Rank.SmallJoker || card.rank === Rank.BigJoker;
}

function collectJokersInto(state: MatchState, player: MatchPlayer): void {
  const taken: Card[] = [];
  for (const p of state.players.values()) {
    const kept: Card[] = [];
    for (const card of p.hand) {
      if (isJoker(card)) taken.push(card);
      else kept.push(card);
    }
    p.hand = kept;
  }
  player.hand.push(...taken);
}

/** 点数越大越靠前；星牌最高，炸弹牌视为炸弹（低于王、高于 2），先手牌最低 */
export function cardPointPower(card: Card): number {
  if (card.kind === CardKind.FirstPlay) return -1;
  if (card.kind === CardKind.Star) return Rank.BigJoker + 1;
  if (card.kind === CardKind.BombCard) return Rank.Two + 0.5;
  return card.rank ?? 0;
}

function takeHighestCards(hand: Card[], n: number): Card[] {
  return [...hand]
    .sort((a, b) => cardPointPower(b) - cardPointPower(a))
    .slice(0, n);
}

/** 小洞察：王炸 + 炸弹牌（不含四张炸弹牌型） */
export function countHandBombs(hand: Card[]): number {
  const hasSmall = hand.some((c) => c.rank === Rank.SmallJoker);
  const hasBig = hand.some((c) => c.rank === Rank.BigJoker);
  let total = hasSmall && hasBig ? 1 : 0;
  for (const card of hand) {
    if (card.kind === CardKind.BombCard) total += 1;
  }
  return total;
}

export function completeForceTradeReturn(
  state: MatchState,
  playerId: string,
  cardId: string | null,
): { ok: true } | { ok: false; error: string } {
  const pending = state.pending;
  if (!pending || pending.kind !== "force_trade") {
    return { ok: false, error: "No force trade pending" };
  }
  if (pending.playerId !== playerId) {
    return { ok: false, error: "Not your force trade" };
  }
  const player = state.players.get(playerId);
  const target = state.players.get(pending.targetId);
  if (!player || !target) return { ok: false, error: "Unknown player" };

  let idx = cardId ? player.hand.findIndex((c) => c.id === cardId) : -1;
  if (idx < 0) {
    if (player.hand.length === 0) return { ok: false, error: "Empty hand" };
    idx = Math.floor(state.rng() * player.hand.length);
  }
  const [given] = player.hand.splice(idx, 1);
  target.hand.push(given);
  consumeItem(player, "legendary_force_trade");
  state.pending = null;
  return { ok: true };
}

export const RPS_CHOICES: readonly RpsChoice[] = [
  "rock",
  "paper",
  "scissors",
];

export function rpsWinner(
  a: RpsChoice,
  b: RpsChoice,
): "a" | "b" | "draw" {
  if (a === b) return "draw";
  if (
    (a === "rock" && b === "scissors") ||
    (a === "scissors" && b === "paper") ||
    (a === "paper" && b === "rock")
  ) {
    return "a";
  }
  return "b";
}

export function randomRpsChoice(rng: () => number): RpsChoice {
  const i = Math.min(
    RPS_CHOICES.length - 1,
    Math.floor(rng() * RPS_CHOICES.length),
  );
  return RPS_CHOICES[i]!;
}

export function beginRpsPicking(
  state: MatchState,
  challengerId: string,
  targetId: string,
  now: number,
  events: MatchEvent[],
): void {
  const bonus = Math.max(
    thinkBonusMs(state.players.get(challengerId)),
    thinkBonusMs(state.players.get(targetId)),
  );
  state.pending = {
    kind: "rps",
    phase: "picking",
    challengerId,
    targetId,
    challengerChoice: null,
    targetChoice: null,
    expiresAt: now + MATCH_TIMING.rpsMs + bonus,
  };
  state.turnExpiresAt = null;
  events.push({
    type: "pending",
    kind: "rps",
    expiresAt: state.pending.expiresAt,
  });
}

const GAME_START_FLAG_ITEMS = [
  "legendary_god_eye",
  "epic_memory",
  "rare_anti_overload",
  "epic_triple_plus_one",
  "epic_four_plus_three",
  "rare_smoke",
  "rare_small_insight",
  "epic_max_bomb",
] as const;

const GAME_START_CARD_ITEMS = [
  "epic_star",
  "legendary_wild_king",
  "epic_bomb",
  "legendary_bomb_king",
] as const;

function isBonusItemCard(card: Card): boolean {
  return card.kind === CardKind.Star || card.kind === CardKind.BombCard;
}

function eachOwnedStartItem(
  player: MatchPlayer,
  itemIds: readonly string[],
  fn: (itemId: string) => void,
): void {
  const allow = new Set(itemIds);
  for (const owned of player.items) {
    if (owned.remainingUses <= 0 || !allow.has(owned.def.id)) continue;
    fn(owned.def.id);
  }
}

function grantStartBonusCards(player: MatchPlayer, itemId: string): void {
  switch (itemId) {
    case "epic_star":
      player.hand.push(createStarCard());
      break;
    case "legendary_wild_king":
      player.hand.push(createStarCard(), createStarCard());
      break;
    case "epic_bomb":
      player.hand.push(createBombCard());
      break;
    case "legendary_bomb_king":
      player.hand.push(createBombCard(), createBombCard());
      break;
    default:
      break;
  }
}

/** 换一下：只换普通手牌，星牌与炸弹牌留在原主手里 */
export function swapOrdinaryHands(a: MatchPlayer, b: MatchPlayer): void {
  const aKeep = a.hand.filter(isBonusItemCard);
  const aSwap = a.hand.filter((c) => !isBonusItemCard(c));
  const bKeep = b.hand.filter(isBonusItemCard);
  const bSwap = b.hand.filter((c) => !isBonusItemCard(c));
  a.hand = [...aKeep, ...bSwap];
  b.hand = [...bKeep, ...aSwap];
}

function emitGameStartItem(
  events: MatchEvent[],
  playerId: string,
  itemId: string,
): void {
  events.push({ type: "game_start_item", playerId, itemId });
}

/** 开局自动生效 + 可选打开「换一下」窗口。被动卡留在道具栏，便于查看说明。 */
export function applyGameStartItems(
  state: MatchState,
  now: number,
  options?: { skipSwap?: boolean },
): MatchEvent[] {
  const events: MatchEvent[] = [];
  const players = [...state.players.values()].sort((a, b) => a.seat - b.seat);

  const sourcePassives = players
    .flatMap((p) => p.items)
    .filter(
      (i) =>
        i.def.trigger === ItemTrigger.GameStart &&
        i.def.id !== "epic_copy" &&
        i.def.id !== "legendary_collect_jokers",
    );
  for (const player of players) {
    const copy = player.items.find(
      (i) => i.def.id === "epic_copy" && i.remainingUses > 0,
    );
    if (!copy) continue;
    const ownedIds = new Set(player.items.map((i) => i.def.id));
    const pool = sourcePassives.filter((i) => !ownedIds.has(i.def.id));
    if (pool.length > 0) {
      const pick = pool[Math.floor(state.rng() * pool.length)]!;
      player.items.push({
        instanceId: `copy-${pick.def.id}-${state.rng().toString(36).slice(2, 8)}`,
        def: pick.def,
        remainingUses: pick.def.maxUses,
      });
    }
    emitGameStartItem(events, player.id, "epic_copy");
  }

  for (const player of players) {
    if (!hasItem(player, "rare_head_start")) continue;
    for (const p of players) {
      const kept = [];
      for (const card of p.hand) {
        if (card.kind === CardKind.FirstPlay) state.discard.push(card);
        else kept.push(card);
      }
      p.hand = kept;
    }
    state.turnSeat = player.seat;
    emitGameStartItem(events, player.id, "rare_head_start");
    break;
  }

  if (!events.some((e) => e.type === "game_start_item" && e.itemId === "rare_head_start")) {
    const hands = players.map((p) => p.hand);
    state.turnSeat = findFirstPlayHolder(hands) ?? 0;
  }

  for (const player of players) {
    eachOwnedStartItem(player, GAME_START_FLAG_ITEMS, (itemId) => {
      applyPassiveItemFlags(player, itemId);
      emitGameStartItem(events, player.id, itemId);
    });

    if (hasItem(player, "rare_instant_win")) {
      player.flags.instantWinReady = true;
    }
  }

  for (const player of players) {
    eachOwnedStartItem(player, GAME_START_CARD_ITEMS, (itemId) => {
      grantStartBonusCards(player, itemId);
      emitGameStartItem(events, player.id, itemId);
    });
  }

  for (const player of players) {
    if (!hasItem(player, "legendary_collect_jokers")) continue;
    collectJokersInto(state, player);
    emitGameStartItem(events, player.id, "legendary_collect_jokers");
    break;
  }

  // 换一下：开局自动打开 10s 决策窗（多人时按座位优先一个）
  if (!options?.skipSwap) {
    events.push(...openOpeningSwapHands(state, now));
  }

  return events;
}

/** 加倍窗结束后再弹「换一下」 */
export function openOpeningSwapHands(state: MatchState, now: number): MatchEvent[] {
  const events: MatchEvent[] = [];
  const players = [...state.players.values()].sort((a, b) => a.seat - b.seat);
  for (const player of players) {
    if (!hasItem(player, "legendary_swap_hands")) continue;
    state.pending = {
      kind: "swap_hands",
      playerId: player.id,
      expiresAt: now + MATCH_TIMING.swapHandsMs + thinkBonusMs(player),
    };
    state.turnExpiresAt = null;
    emitGameStartItem(events, player.id, "legendary_swap_hands");
    events.push({
      type: "pending",
      kind: "swap_hands",
      expiresAt: state.pending.expiresAt,
    });
    break;
  }
  return events;
}

export interface UseItemPayload {
  targetPlayerId?: string;
  /** 猜拳 */
  rps?: RpsChoice;
  /** 操控强制牌型 */
  forcedType?: ForcedLeadType;
  /** 强易交还的牌 */
  cardId?: string;
  /** 点「使用」后进入选目标/牌型，刷新选择倒计时 */
  confirmUse?: boolean;
}

function openPending(
  state: MatchState,
  pending: PendingInteraction,
  events: MatchEvent[],
): void {
  state.pending = pending;
  state.turnExpiresAt = null;
  events.push({
    type: "pending",
    kind: pending.kind,
    expiresAt: pending.expiresAt,
  });
}

export function isCurrentItemOffer(
  pending: PendingInteraction | null,
  playerId: string,
  itemId: string,
): boolean {
  return (
    pending?.kind === "offer_item" &&
    pending.playerId === playerId &&
    pending.itemId === itemId
  );
}

function afterPlayContext(
  pending: PendingInteraction | null,
): Extract<ItemOfferContext, { reason: "after_play" }> | null {
  if (pending?.kind === "offer_item" && pending.context.reason === "after_play") {
    return pending.context;
  }
  return null;
}

function onLeadContext(
  pending: PendingInteraction | null,
): Extract<ItemOfferContext, { reason: "on_lead" }> | null {
  if (pending?.kind === "offer_item" && pending.context.reason === "on_lead") {
    return pending.context;
  }
  return null;
}

function turnOfferKey(playerId: string, itemId: string): string {
  return `${playerId}:${itemId}`;
}

function othersWithHand(
  state: MatchState,
  playerId: string,
  minExclusive: number,
): MatchPlayer[] {
  return [...state.players.values()].filter(
    (p) => p.id !== playerId && p.finishRank === null && p.hand.length > minExclusive,
  );
}

function hasNormalThree(player: MatchPlayer): boolean {
  return player.hand.some((c) => c.kind === CardKind.Normal && c.rank === Rank.Three);
}

function hasNormalRanks(player: MatchPlayer, ranks: readonly Rank[]): boolean {
  return player.hand.some(
    (c) => c.kind === CardKind.Normal && c.rank != null && ranks.includes(c.rank),
  );
}

function rewriteNormalRanks(player: MatchPlayer, from: readonly Rank[], to: Rank): void {
  const set = new Set(from);
  for (const card of player.hand) {
    if (card.kind !== CardKind.Normal || card.rank == null || !set.has(card.rank)) continue;
    card.rank = to;
  }
}

/** 升级：手中第 1–4 张 3 依次改为 K、Q、J、10 */
export const UPGRADE_THREE_RANKS: Rank[] = [
  Rank.King,
  Rank.Queen,
  Rank.Jack,
  Rank.Ten,
];

/** 大升级：全部 3、4 → Q */
export const BIG_UPGRADE_FROM: Rank[] = [Rank.Three, Rank.Four];

/** 超级升级：全部 3、4、5 → K */
export const SUPER_UPGRADE_FROM: Rank[] = [Rank.Three, Rank.Four, Rank.Five];

export function canOfferActiveItem(
  state: MatchState,
  playerId: string,
  itemId: string,
  context: ItemOfferContext,
): boolean {
  const player = state.players.get(playerId);
  if (!player || player.finishRank !== null) return false;
  if (!hasItem(player, itemId)) return false;
  if (context.reason === "turn" && state.turnOfferSkipped.has(turnOfferKey(playerId, itemId))) {
    return false;
  }

  switch (itemId) {
    case "rare_upgrade":
      return context.reason === "turn" && hasNormalThree(player);
    case "epic_big_upgrade":
      return context.reason === "turn" && hasNormalRanks(player, BIG_UPGRADE_FROM);
    case "legendary_super_upgrade":
      return context.reason === "turn" && hasNormalRanks(player, SUPER_UPGRADE_FROM);
    case "rare_brain_overload":
      return context.reason === "turn";
    case "rare_peek":
      return (
        context.reason === "turn" &&
        othersWithHand(state, playerId, 12).some((p) => !p.flags.hideFromSkills)
      );
    case "rare_steal_one":
      return context.reason === "turn" && othersWithHand(state, playerId, 8).length > 0;
    case "legendary_force_trade":
      return context.reason === "turn" && othersWithHand(state, playerId, 10).length > 0;
    case "legendary_discard_nine":
      return context.reason === "turn" && player.hand.length >= 11;
    case "rare_instant_win":
      return context.reason === "turn" && player.hand.length <= 1;
    case "epic_big_trade":
      return (
        context.reason === "turn" &&
        player.hand.length >= 3 &&
        [...state.players.values()].some(
          (p) => p.id !== playerId && p.finishRank === null && p.hand.length >= 3,
        )
      );
    case "rare_bounce":
      return (
        context.reason === "after_play" &&
        !context.wasFollow &&
        context.actorId !== playerId
      );
    case "legendary_bomb_defuser":
      return (
        context.reason === "after_play" &&
        context.wasFollow &&
        context.handType === HandType.Bomb &&
        context.actorId !== playerId
      );
    case "epic_self_follow":
      return context.reason === "after_play" && context.actorId === playerId;
    case "legendary_play_something_else":
      return context.reason === "on_lead" && context.leaderId !== playerId;
    case "epic_control": {
      if (context.reason !== "on_lead" || context.leaderId === playerId) return false;
      const leader = state.players.get(context.leaderId);
      return !!leader && leader.finishRank === null && leader.hand.length > 5;
    }
    case "legendary_extra_round":
      return context.reason === "extra_round" && !state.extraRoundApplied;
    default:
      return false;
  }
}

/** 同一人同一回合：直接胜利最先，大脑过载最后 */
export const TURN_ITEM_ORDER = [
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
] as const;

/** 出牌后对其他人：打回先于拆弹（同窗互斥，顺序仍锁定） */
export const AFTER_PLAY_OTHER_ITEM_ORDER = [
  "rare_bounce",
  "legendary_bomb_defuser",
] as const;

/** 有人领出时对其他人：玩点别的先于操控 */
export const ON_LEAD_ITEM_ORDER = [
  "legendary_play_something_else",
  "epic_control",
] as const;

/** 从 fromSeat 的下一家起逆时针，最后才轮到 fromSeat 本人 */
export function playersFromSeat(state: MatchState, fromSeat: number): MatchPlayer[] {
  const n = state.players.size;
  const out: MatchPlayer[] = [];
  for (let i = 1; i <= n; i += 1) {
    const seat = (fromSeat + i) % n;
    for (const p of state.players.values()) {
      if (p.seat === seat && p.finishRank !== null) continue;
      if (p.seat === seat) out.push(p);
    }
  }
  return out;
}

export function collectTurnItemOffers(state: MatchState, playerId: string): ItemOffer[] {
  const player = state.players.get(playerId);
  if (!player || player.finishRank !== null) return [];
  const context: ItemOfferContext = { reason: "turn" };
  const offers: ItemOffer[] = [];
  const seen = new Set<string>();
  for (const id of TURN_ITEM_ORDER) {
    if (seen.has(id)) continue;
    if (!canOfferActiveItem(state, playerId, id, context)) continue;
    seen.add(id);
    offers.push({ playerId, itemId: id, context });
  }
  return offers;
}

export function collectAfterPlayOffers(
  state: MatchState,
  actorId: string,
  handType: HandType,
  wasFollow: boolean,
  previousTable: ParsedHand | null,
  previousLeaderId: string | null,
): ItemOffer[] {
  const actor = state.players.get(actorId);
  if (!actor) return [];
  const context: ItemOfferContext = {
    reason: "after_play",
    actorId,
    handType,
    wasFollow,
    previousTable,
    previousLeaderId,
  };
  const offers: ItemOffer[] = [];
  for (const other of playersFromSeat(state, actor.seat)) {
    if (other.id === actorId) continue;
    for (const itemId of AFTER_PLAY_OTHER_ITEM_ORDER) {
      if (canOfferActiveItem(state, other.id, itemId, context)) {
        offers.push({ playerId: other.id, itemId, context });
      }
    }
  }
  if (canOfferActiveItem(state, actorId, "epic_self_follow", context)) {
    offers.push({ playerId: actorId, itemId: "epic_self_follow", context });
  }
  return offers;
}

export function collectOnLeadOffers(state: MatchState, leaderId: string): ItemOffer[] {
  const leader = state.players.get(leaderId);
  if (!leader || leader.finishRank !== null) return [];
  const context: ItemOfferContext = { reason: "on_lead", leaderId };
  const offers: ItemOffer[] = [];
  for (const other of playersFromSeat(state, leader.seat)) {
    if (other.id === leaderId) continue;
    for (const itemId of ON_LEAD_ITEM_ORDER) {
      if (canOfferActiveItem(state, other.id, itemId, context)) {
        offers.push({ playerId: other.id, itemId, context });
      }
    }
  }
  return offers;
}

export function collectExtraRoundOffers(
  state: MatchState,
  opts?: { fromSeat?: number; afterPlayActorId?: string },
): ItemOffer[] {
  if (state.extraRoundApplied) return [];
  const fromSeat = opts?.fromSeat ?? state.turnSeat;
  const context: ItemOfferContext = {
    reason: "extra_round",
    afterPlayActorId: opts?.afterPlayActorId,
  };
  const offers: ItemOffer[] = [];
  for (const p of playersFromSeat(state, fromSeat)) {
    if (canOfferActiveItem(state, p.id, "legendary_extra_round", context)) {
      offers.push({ playerId: p.id, itemId: "legendary_extra_round", context });
    }
  }
  return offers;
}

export function openNextItemOffer(
  state: MatchState,
  now: number,
  events: MatchEvent[],
): boolean {
  if (state.pending) return false;
  while (state.itemOfferQueue.length > 0) {
    const next = state.itemOfferQueue.shift()!;
    if (!canOfferActiveItem(state, next.playerId, next.itemId, next.context)) continue;
    openPending(
      state,
      {
        kind: "offer_item",
        playerId: next.playerId,
        itemId: next.itemId,
        expiresAt: now + MATCH_TIMING.itemOfferMs + thinkBonusMs(state.players.get(next.playerId)),
        context: next.context,
      },
      events,
    );
    return true;
  }
  return false;
}

export function enqueueItemOffers(
  state: MatchState,
  offers: ItemOffer[],
  now: number,
  events: MatchEvent[],
): boolean {
  if (offers.length) state.itemOfferQueue.push(...offers);
  return openNextItemOffer(state, now, events);
}

export function markTurnOfferSkipped(state: MatchState, playerId: string, itemId: string): void {
  state.turnOfferSkipped.add(turnOfferKey(playerId, itemId));
}

export function clearTurnOfferSkips(state: MatchState): void {
  state.turnOfferSkipped.clear();
}

export function dropQueuedOffers(
  state: MatchState,
  reason: ItemOfferContext["reason"],
): void {
  state.itemOfferQueue = state.itemOfferQueue.filter((o) => o.context.reason !== reason);
}

/** 出牌后反应：打回 / 拆弹 / 自娱自乐 */
export function openAfterPlayWindow(
  state: MatchState,
  actorId: string,
  handType: HandType,
  wasFollow: boolean,
  previousTable: ParsedHand | null,
  previousLeaderId: string | null,
  now: number,
  events: MatchEvent[],
): boolean {
  const offers = collectAfterPlayOffers(
    state,
    actorId,
    handType,
    wasFollow,
    previousTable,
    previousLeaderId,
  );
  return enqueueItemOffers(state, offers, now, events);
}

/** 获得领出权时：玩点别的 / 操控 */
export function openOnLeadWindow(
  state: MatchState,
  leaderId: string,
  now: number,
  events: MatchEvent[],
): boolean {
  return enqueueItemOffers(state, collectOnLeadOffers(state, leaderId), now, events);
}

/** 有人手牌新降到 < 10：加赛询问（未使用前每次都可弹；整局只用一次） */
export function openExtraRoundWindow(
  state: MatchState,
  now: number,
  events: MatchEvent[],
  opts?: { fromSeat?: number; afterPlayActorId?: string },
): boolean {
  return enqueueItemOffers(state, collectExtraRoundOffers(state, opts), now, events);
}

export function applyExtraRoundDeal(state: MatchState): void {
  const second = shuffleDeck(createDeck(state.playerIds.length), state.rng);
  let cursor = 0;
  for (const player of state.players.values()) {
    if (player.finishRank !== null) continue;
    for (let i = 0; i < 10; i += 1) {
      if (cursor >= second.length) break;
      player.hand.push(second[cursor]);
      cursor += 1;
    }
  }
  state.extraRoundApplied = true;
}

/** 主动使用道具（含互动类） */
export function applyInteractiveItem(
  state: MatchState,
  playerId: string,
  itemId: string,
  payload: UseItemPayload = {},
  now: number,
): { ok: true; events: MatchEvent[] } | { ok: false; error: string } {
  const player = state.players.get(playerId);
  if (!player) return { ok: false, error: "Unknown player" };
  if (!hasItem(player, itemId)) return { ok: false, error: "Item not available" };

  const events: MatchEvent[] = [];
  let targetPlayerId: string | undefined;
  let drawnHint: string | undefined;
  const pending = state.pending;
  const offerOk = isCurrentItemOffer(pending, playerId, itemId);
  const afterPlay = afterPlayContext(pending);
  const onLead = onLeadContext(pending);
  const isForceTradeReturn =
    itemId === "legendary_force_trade" && pending?.kind === "force_trade";
  if (!isForceTradeReturn && !offerOk) {
    return { ok: false, error: "Item offer not active" };
  }

  if (
    payload.confirmUse &&
    offerOk &&
    pending?.kind === "offer_item" &&
    (itemId === "rare_steal_one" ||
      itemId === "legendary_force_trade" ||
      itemId === "epic_big_trade" ||
      itemId === "epic_control")
  ) {
    pending.expiresAt = now + MATCH_TIMING.itemChoiceMs + thinkBonusMs(player);
    events.push({
      type: "pending",
      kind: "offer_item",
      expiresAt: pending.expiresAt,
    });
    return { ok: true, events };
  }

  switch (itemId) {
    case "rare_upgrade": {
      consumeItem(player, itemId);
      let n = 0;
      for (const card of player.hand) {
        if (card.kind !== CardKind.Normal || card.rank !== Rank.Three) continue;
        const next = UPGRADE_THREE_RANKS[n];
        if (next === undefined) break;
        card.rank = next;
        n += 1;
      }
      break;
    }
    case "epic_big_upgrade": {
      consumeItem(player, itemId);
      rewriteNormalRanks(player, BIG_UPGRADE_FROM, Rank.Queen);
      break;
    }
    case "legendary_super_upgrade": {
      consumeItem(player, itemId);
      rewriteNormalRanks(player, SUPER_UPGRADE_FROM, Rank.King);
      break;
    }
    case "rare_steal_one": {
      const target = payload.targetPlayerId
        ? state.players.get(payload.targetPlayerId)
        : null;
      if (!target) return { ok: false, error: "Missing targetPlayerId" };
      if (target.hand.length <= 8) {
        return { ok: false, error: "Target hand must be > 8" };
      }
      consumeItem(player, itemId);
      const idx = Math.floor(state.rng() * target.hand.length);
      const [stolen] = target.hand.splice(idx, 1);
      player.hand.push(stolen);
      targetPlayerId = target.id;
      drawnHint = formatDrawnCardHint(stolen.kind, stolen.rank);
      break;
    }
    case "rare_instant_win": {
      if (player.hand.length > 1) {
        return { ok: false, error: "Hand size must be <= 1" };
      }
      consumeItem(player, itemId);
      player.flags.instantWinReady = false;
      break;
    }
    case "rare_peek": {
      const targets = [...state.players.values()]
        .filter(
          (p) =>
            p.id !== playerId &&
            p.hand.length > 12 &&
            !p.flags.hideFromSkills,
        )
        .map((p) => p.id);
      if (targets.length === 0) {
        return { ok: false, error: "No player with hand > 12" };
      }
      consumeItem(player, itemId);
      const expiresAt = now + MATCH_TIMING.peekMs;
      state.peeks.push({ viewerId: playerId, targetIds: targets, expiresAt });
      events.push({ type: "peek", viewerId: playerId, targetIds: targets, expiresAt });
      break;
    }
    case "epic_self_follow": {
      if (!afterPlay || afterPlay.actorId !== playerId) {
        return { ok: false, error: "Self-follow only after your play" };
      }
      consumeItem(player, itemId);
      events.push({ type: "self_follow", playerId });
      break;
    }
    case "rare_bounce": {
      if (!afterPlay || afterPlay.actorId === playerId) {
        return { ok: false, error: "Bounce only right after an opponent play" };
      }
      if (afterPlay.wasFollow) {
        return { ok: false, error: "Bounce only after an opponent lead" };
      }
      consumeItem(player, itemId);
      events.push({
        type: "play_bounced",
        bouncerId: playerId,
        actorId: afterPlay.actorId,
      });
      targetPlayerId = afterPlay.actorId;
      break;
    }
    case "legendary_bomb_defuser": {
      if (!afterPlay || afterPlay.actorId === playerId) {
        return { ok: false, error: "Defuse only after an opponent bomb" };
      }
      if (afterPlay.handType !== HandType.Bomb || !afterPlay.wasFollow) {
        return { ok: false, error: "Not a following bomb" };
      }
      consumeItem(player, itemId);
      events.push({
        type: "bomb_defused",
        defuserId: playerId,
        bomberId: afterPlay.actorId,
      });
      targetPlayerId = afterPlay.actorId;
      break;
    }
    case "legendary_play_something_else": {
      if (!onLead || onLead.leaderId === playerId) {
        return { ok: false, error: "RPS only when someone gains the lead" };
      }
      consumeItem(player, itemId);
      dropQueuedOffers(state, "on_lead");
      beginRpsPicking(state, playerId, onLead.leaderId, now, events);
      targetPlayerId = onLead.leaderId;
      break;
    }
    case "epic_control": {
      if (!onLead || onLead.leaderId === playerId) {
        return { ok: false, error: "Control only when someone gains the lead" };
      }
      const target = state.players.get(onLead.leaderId);
      if (!target || target.hand.length <= 5) {
        return { ok: false, error: "Target must have hand > 5" };
      }
      if (!payload.forcedType) {
        return { ok: false, error: "Missing forcedType (single|pair)" };
      }
      consumeItem(player, itemId);
      dropQueuedOffers(state, "on_lead");
      state.leadRestriction = {
        playerId: onLead.leaderId,
        allowed: payload.forcedType,
        controllerId: playerId,
      };
      events.push({
        type: "control_applied",
        controllerId: playerId,
        targetId: onLead.leaderId,
        allowed: payload.forcedType,
      });
      state.pending = null;
      events.push({ type: "pending_resolved", kind: "offer_item" });
      targetPlayerId = onLead.leaderId;
      break;
    }
    case "legendary_extra_round": {
      if (!pending || pending.kind !== "offer_item" || pending.context.reason !== "extra_round") {
        return { ok: false, error: "Extra round not available now" };
      }
      consumeItem(player, itemId);
      applyExtraRoundDeal(state);
      dropQueuedOffers(state, "extra_round");
      state.pending = null;
      events.push({ type: "extra_round", byPlayerId: playerId });
      events.push({ type: "pending_resolved", kind: "offer_item" });
      break;
    }
    case "legendary_force_trade": {
      if (pending?.kind === "force_trade") {
        if (pending.playerId !== playerId) {
          return { ok: false, error: "Not your force trade" };
        }
        const returned = completeForceTradeReturn(
          state,
          playerId,
          payload.cardId ?? null,
        );
        if (!returned.ok) return returned;
        events.push({ type: "pending_resolved", kind: "force_trade" });
        break;
      }
      const target = payload.targetPlayerId
        ? state.players.get(payload.targetPlayerId)
        : null;
      if (!target || target.id === playerId) {
        return { ok: false, error: "Missing targetPlayerId" };
      }
      if (target.hand.length <= 10) {
        return { ok: false, error: "Target hand must be > 10" };
      }
      const stealIdx = Math.floor(state.rng() * target.hand.length);
      const [stolen] = target.hand.splice(stealIdx, 1);
      player.hand.push(stolen);
      openPending(
        state,
        {
          kind: "force_trade",
          playerId,
          targetId: target.id,
          expiresAt: now + MATCH_TIMING.forceTradeMs + thinkBonusMs(player),
          drawnHint: formatDrawnCardHint(stolen.kind, stolen.rank),
        },
        events,
      );
      targetPlayerId = target.id;
      break;
    }
    case "legendary_discard_nine": {
      if (player.hand.length < 11) {
        return { ok: false, error: "Hand size must be >= 11" };
      }
      consumeItem(player, itemId);
      for (let i = 0; i < 9; i += 1) {
        if (player.hand.length === 0) break;
        const idx = Math.floor(state.rng() * player.hand.length);
        const [dropped] = player.hand.splice(idx, 1);
        state.discard.push(dropped);
      }
      break;
    }
    case "epic_big_trade": {
      const target = payload.targetPlayerId
        ? state.players.get(payload.targetPlayerId)
        : null;
      if (!target || target.id === playerId) {
        return { ok: false, error: "Missing targetPlayerId" };
      }
      if (player.hand.length < 3 || target.hand.length < 3) {
        return { ok: false, error: "Both players need at least 3 cards" };
      }
      consumeItem(player, itemId);
      const mine = takeHighestCards(player.hand, 3);
      const theirs = takeHighestCards(target.hand, 3);
      player.hand = player.hand.filter((c) => !mine.includes(c));
      target.hand = target.hand.filter((c) => !theirs.includes(c));
      player.hand.push(...theirs);
      target.hand.push(...mine);
      targetPlayerId = target.id;
      break;
    }
    case "rare_brain_overload": {
      consumeItem(player, itemId);
      for (const p of state.players.values()) {
        if (p.id === playerId || p.finishRank !== null) continue;
        p.flags.overloadTurnsLeft = 5;
      }
      break;
    }
    default:
      return { ok: false, error: `Item ${itemId} cannot be used this way` };
  }

  const used: { type: "item_used"; playerId: string; itemId: string; targetPlayerId?: string; drawnHint?: string } = {
    type: "item_used",
    playerId,
    itemId,
  };
  if (targetPlayerId) used.targetPlayerId = targetPlayerId;
  if (drawnHint) used.drawnHint = drawnHint;
  events.push(used);
  return { ok: true, events };
}

/** @deprecated 兼容旧名 */
export const applyOnPlayItem = applyInteractiveItem;
