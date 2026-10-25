import { analyzeHand, AnalyzeOptions } from "../analyzer.js";
import { canBeat } from "../comparator.js";
import { STRAIGHT_RANKS } from "../rank.js";
import { Card, CardKind, HandType, ParsedHand, Rank } from "../types.js";
import { MatchPlayer, MatchState } from "./types.js";

const ANALYZE_OPTS = (player: MatchPlayer): AnalyzeOptions => ({
  tripleExtraSingle: player.flags.tripleExtraSingle,
  fourExtraSingle: player.flags.fourExtraSingle,
});

function rankKey(card: Card): number {
  if (card.kind === CardKind.FirstPlay) return Rank.FirstPlay;
  if (card.kind === CardKind.BombCard) return Rank.BombCard;
  if (card.kind === CardKind.Star) return 1000;
  return card.rank ?? 99;
}

function sortByRank(cards: Card[]): Card[] {
  return [...cards].sort((a, b) => rankKey(a) - rankKey(b) || a.id.localeCompare(b.id));
}

function remainingWithout(hand: Card[], used: Card[]): Card[] {
  const ids = new Set(used.map((c) => c.id));
  return hand.filter((c) => !ids.has(c.id));
}

function ofRank(hand: Card[], rank: Rank): Card[] {
  return hand.filter((c) => c.kind === CardKind.Normal && c.rank === rank);
}

function starsOf(hand: Card[]): Card[] {
  return hand.filter((c) => c.kind === CardKind.Star);
}

/** 先用该点普通牌，不够再用星牌。 */
function takeRank(hand: Card[], rank: Rank, n: number): Card[] | null {
  const have = ofRank(hand, rank);
  const stars = starsOf(hand);
  if (have.length + stars.length < n) return null;
  const fromRank = have.slice(0, Math.min(n, have.length));
  return [...fromRank, ...stars.slice(0, n - fromRank.length)];
}

function takeSmallest(hand: Card[], n: number, exclude: Card[] = []): Card[] | null {
  const pool = sortByRank(
    remainingWithout(hand, exclude).filter(
      (c) => c.kind !== CardKind.BombCard && c.kind !== CardKind.FirstPlay,
    ),
  );
  if (pool.length < n) return null;
  return pool.slice(0, n);
}

function takeSmallestPair(hand: Card[], exclude: Card[] = []): Card[] | null {
  const pool = remainingWithout(hand, exclude);
  for (const rank of rankedNormals(pool)) {
    const pair = takeRank(pool, rank, 2);
    if (pair) return pair;
  }
  return null;
}

function rankedNormals(hand: Card[]): Rank[] {
  const ranks = new Set<Rank>();
  for (const card of hand) {
    if (card.kind === CardKind.Normal && card.rank != null) ranks.add(card.rank);
  }
  return [...ranks].sort((a, b) => a - b);
}

function countNormalRank(hand: Card[], rank: Rank): number {
  return ofRank(hand, rank).length;
}

function tryParse(
  player: MatchPlayer,
  cards: Card[],
  table: ParsedHand | null,
  forbid: HandType | null,
): ParsedHand | null {
  if (!cards.length) return null;
  const parsed = analyzeHand(cards, ANALYZE_OPTS(player));
  if (!parsed) return null;
  if (forbid && parsed.type === forbid) return null;
  if (table && !canBeat(table, parsed)) return null;
  return parsed;
}

export function pickManagedLeadCardIds(
  state: MatchState,
  player: MatchPlayer,
): string[] | null {
  const forbid = state.bounceForbidType;
  const allowed =
    state.leadRestriction?.playerId === player.id
      ? state.leadRestriction.allowed
      : null;

  const tryCards = (cards: Card[]): string[] | null => {
    const parsed = tryParse(player, cards, null, forbid);
    if (!parsed) return null;
    if (allowed === "single") {
      if (parsed.type !== HandType.Single && parsed.type !== HandType.FirstPlay) return null;
    }
    if (allowed === "pair" && parsed.type !== HandType.Pair) return null;
    return cards.map((c) => c.id);
  };

  if (allowed === "pair") {
    const pair = takeSmallestPair(player.hand);
    return pair ? tryCards(pair) : null;
  }
  if (allowed === "single") {
    for (const card of sortByRank(player.hand)) {
      const ids = tryCards([card]);
      if (ids) return ids;
    }
    return null;
  }

  const first = player.hand.find((c) => c.kind === CardKind.FirstPlay);
  if (first) return tryCards([first]) ?? [first.id];

  const minRank = rankedNormals(player.hand)[0];
  if (minRank == null) {
    const bomb = player.hand.find((c) => c.kind === CardKind.BombCard);
    if (bomb) return tryCards([bomb]);
    const star = player.hand.find((c) => c.kind === CardKind.Star);
    return star ? tryCards([star]) : null;
  }

  const group = ofRank(player.hand, minRank);
  const n = group.length;

  if (n === 1) return tryCards(group);
  if (n === 2) return tryCards(group) ?? tryCards([group[0]!]);
  if (n >= 4) {
    const bomb = tryCards(group);
    if (bomb) return bomb;
  }

  const triple = group.slice(0, 3);
  const leftover = remainingWithout(player.hand, triple);
  const singletonRank = rankedNormals(leftover).find((rank) => ofRank(leftover, rank).length === 1);
  if (singletonRank != null) {
    const kicker = ofRank(leftover, singletonRank)[0];
    if (kicker) {
      const withSingle = tryCards([...triple, kicker]);
      if (withSingle) return withSingle;
    }
  }
  const star = leftover.find((c) => c.kind === CardKind.Star);
  if (star) {
    const withStar = tryCards([...triple, star]);
    if (withStar) return withStar;
  }
  const pair = takeSmallestPair(player.hand, triple);
  if (pair) {
    const withPair = tryCards([...triple, ...pair]);
    if (withPair) return withPair;
  }
  return tryCards(triple) ?? tryCards([group[0]!]);
}

type FollowCandidate = { cards: Card[]; parsed: ParsedHand; bombish: boolean };

function consider(
  player: MatchPlayer,
  table: ParsedHand,
  forbid: HandType | null,
  cards: Card[] | null,
  into: FollowCandidate[],
): void {
  if (!cards) return;
  const parsed = tryParse(player, cards, table, forbid);
  if (!parsed) return;
  const bombish = parsed.type === HandType.Bomb || parsed.type === HandType.Rocket;
  into.push({ cards, parsed, bombish });
}

function pickBestFollow(cands: FollowCandidate[]): string[] | null {
  if (!cands.length) return null;
  cands.sort((a, b) => {
    if (a.bombish !== b.bombish) return a.bombish ? 1 : -1;
    if (a.parsed.mainRank !== b.parsed.mainRank) return a.parsed.mainRank - b.parsed.mainRank;
    if (a.parsed.length !== b.parsed.length) return a.parsed.length - b.parsed.length;
    const sa = a.cards.reduce((s, c) => s + rankKey(c), 0);
    const sb = b.cards.reduce((s, c) => s + rankKey(c), 0);
    return sa - sb;
  });
  return cands[0]!.cards.map((c) => c.id);
}

function addSameTypeFollows(
  player: MatchPlayer,
  table: ParsedHand,
  forbid: HandType | null,
  into: FollowCandidate[],
): void {
  const hand = player.hand;
  const type = table.type === HandType.FirstPlay ? HandType.Single : table.type;
  const beatRank = table.mainRank;
  const len = table.length;

  const ranksAbove = rankedNormals(hand).filter((r) => r > beatRank);

  if (type === HandType.Single) {
    for (const card of sortByRank(hand)) {
      if (card.kind === CardKind.BombCard) continue;
      consider(player, table, forbid, [card], into);
    }
    return;
  }

  if (type === HandType.Pair) {
    for (const rank of ranksAbove) consider(player, table, forbid, takeRank(hand, rank, 2), into);
    return;
  }

  if (type === HandType.Triple) {
    for (const rank of ranksAbove) consider(player, table, forbid, takeRank(hand, rank, 3), into);
    return;
  }

  if (type === HandType.TripleWithSingle) {
    for (const rank of ranksAbove) {
      const trip = takeRank(hand, rank, 3);
      if (!trip) continue;
      const kicker = takeSmallest(hand, 1, trip);
      consider(player, table, forbid, kicker ? [...trip, ...kicker] : null, into);
    }
    return;
  }

  if (type === HandType.TripleWithPair) {
    for (const rank of ranksAbove) {
      const trip = takeRank(hand, rank, 3);
      if (!trip) continue;
      const pair = takeSmallestPair(hand, trip);
      consider(player, table, forbid, pair ? [...trip, ...pair] : null, into);
    }
    return;
  }

  if (type === HandType.Straight) {
    addStraightFollow(player, table, forbid, 1, len, into);
    return;
  }

  if (type === HandType.ConsecutivePairs) {
    addStraightFollow(player, table, forbid, 2, len, into);
    return;
  }

  if (type === HandType.Airplane) {
    addAirplaneFollow(player, table, forbid, 0, into);
    return;
  }

  if (type === HandType.AirplaneWithSingles) {
    addAirplaneFollow(player, table, forbid, 1, into);
    return;
  }

  if (type === HandType.AirplaneWithPairs) {
    addAirplaneFollow(player, table, forbid, 2, into);
    return;
  }

  if (type === HandType.FourWithTwoSingles) {
    for (const rank of ranksAbove) {
      const four = takeRank(hand, rank, 4);
      if (!four) continue;
      const kick = takeSmallest(hand, 2, four);
      consider(player, table, forbid, kick ? [...four, ...kick] : null, into);
    }
    return;
  }

  if (type === HandType.FourWithTwoPairs) {
    for (const rank of ranksAbove) {
      const four = takeRank(hand, rank, 4);
      if (!four) continue;
      const p1 = takeSmallestPair(hand, four);
      if (!p1) continue;
      const p2 = takeSmallestPair(hand, [...four, ...p1]);
      consider(player, table, forbid, p2 ? [...four, ...p1, ...p2] : null, into);
    }
  }
}

function addStraightFollow(
  player: MatchPlayer,
  table: ParsedHand,
  forbid: HandType | null,
  perRank: 1 | 2,
  groups: number,
  into: FollowCandidate[],
): void {
  const hand = player.hand;
  for (let start = 0; start + groups <= STRAIGHT_RANKS.length; start += 1) {
    const window = STRAIGHT_RANKS.slice(start, start + groups);
    const top = window[window.length - 1]!;
    if (top <= table.mainRank) continue;
    const taken: Card[] = [];
    let ok = true;
    let rest = hand;
    for (const rank of window) {
      const chunk = takeRank(rest, rank, perRank);
      if (!chunk) {
        ok = false;
        break;
      }
      taken.push(...chunk);
      rest = remainingWithout(rest, chunk);
    }
    if (ok) consider(player, table, forbid, taken, into);
  }
}

function addAirplaneFollow(
  player: MatchPlayer,
  table: ParsedHand,
  forbid: HandType | null,
  wingKind: 0 | 1 | 2,
  into: FollowCandidate[],
): void {
  const hand = player.hand;
  const groups = table.length;
  for (let start = 0; start + groups <= STRAIGHT_RANKS.length; start += 1) {
    const window = STRAIGHT_RANKS.slice(start, start + groups);
    const top = window[window.length - 1]!;
    if (top <= table.mainRank) continue;
    const taken: Card[] = [];
    let rest = hand;
    let ok = true;
    for (const rank of window) {
      const chunk = takeRank(rest, rank, 3);
      if (!chunk) {
        ok = false;
        break;
      }
      taken.push(...chunk);
      rest = remainingWithout(rest, chunk);
    }
    if (!ok) continue;
    if (wingKind === 1) {
      const wings = takeSmallest(rest, groups);
      if (!wings) continue;
      taken.push(...wings);
    } else if (wingKind === 2) {
      const wings: Card[] = [];
      let pool = rest;
      for (let i = 0; i < groups; i += 1) {
        const pair = takeSmallestPair(pool);
        if (!pair) {
          ok = false;
          break;
        }
        wings.push(...pair);
        pool = remainingWithout(pool, pair);
      }
      if (!ok) continue;
      taken.push(...wings);
    }
    consider(player, table, forbid, taken, into);
  }
}

function addBombsAndRocket(
  player: MatchPlayer,
  table: ParsedHand,
  forbid: HandType | null,
  into: FollowCandidate[],
): void {
  if (player.flags.maxBomb && table.type === HandType.Bomb) {
    // 只能王炸压
  } else {
    for (const card of player.hand) {
      if (card.kind === CardKind.BombCard) consider(player, table, forbid, [card], into);
    }
    for (const rank of rankedNormals(player.hand)) {
      const natural = countNormalRank(player.hand, rank);
      for (let size = 4; size <= natural; size += 1) {
        consider(player, table, forbid, ofRank(player.hand, rank).slice(0, size), into);
      }
    }
  }
  const small = player.hand.find((c) => c.rank === Rank.SmallJoker);
  const big = player.hand.find((c) => c.rank === Rank.BigJoker);
  if (small && big) consider(player, table, forbid, [small, big], into);
}

/** 跟牌：能压桌面的最小合法牌；没有则 null（应过牌）。 */
export function pickAutoFollowCardIds(
  state: MatchState,
  player: MatchPlayer,
): string[] | null {
  const table = state.tableHand;
  if (!table) return null;
  const forbid = state.bounceForbidType;
  const cands: FollowCandidate[] = [];
  addSameTypeFollows(player, table, forbid, cands);
  const nonBomb = cands.filter((c) => !c.bombish);
  if (nonBomb.length) return pickBestFollow(nonBomb);
  addBombsAndRocket(player, table, forbid, cands);
  return pickBestFollow(cands);
}
