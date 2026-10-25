import {
  Card,
  CardKind,
  DOU_DIZHU,
  Rank,
  Suit,
} from "./types.js";
import { REGULAR_RANKS } from "./rank.js";

const SUITS = [Suit.Spade, Suit.Heart, Suit.Club, Suit.Diamond];

/** 三人场每点 4 张；四人场每点 5 张（第 5 张复用黑桃） */
export function copiesPerRank(playerCount: number): number {
  return playerCount >= 4 ? 5 : 4;
}

export function deckSizeForPlayers(playerCount: number): number {
  return playerCount >= 4 ? DOU_DIZHU.deckSize4 : DOU_DIZHU.deckSize3;
}

let idCounter = 0;

function nextId(prefix: string): string {
  idCounter += 1;
  return `${prefix}-${idCounter}-${Math.random().toString(36).slice(2, 10)}`;
}

export function createNormalCard(rank: Rank, suit?: Suit): Card {
  return {
    id: nextId(`N${rank}${suit ?? ""}`),
    kind: CardKind.Normal,
    rank,
    suit,
  };
}

export function createFirstPlayCard(): Card {
  return {
    id: nextId("FP"),
    kind: CardKind.FirstPlay,
    rank: Rank.FirstPlay,
  };
}

export function createStarCard(): Card {
  return { id: nextId("STAR"), kind: CardKind.Star };
}

export function createBombCard(): Card {
  return {
    id: nextId("BOMB"),
    kind: CardKind.BombCard,
    rank: Rank.BombCard,
  };
}

export function createDeck(playerCount: number = 3): Card[] {
  const deck: Card[] = [];
  const copies = copiesPerRank(playerCount);
  const expected = deckSizeForPlayers(playerCount);

  for (const rank of REGULAR_RANKS) {
    for (let i = 0; i < copies; i += 1) {
      deck.push(createNormalCard(rank, SUITS[i % SUITS.length]));
    }
  }

  deck.push({
    id: nextId("SJ"),
    kind: CardKind.Normal,
    rank: Rank.SmallJoker,
  });
  deck.push({
    id: nextId("BJ"),
    kind: CardKind.Normal,
    rank: Rank.BigJoker,
  });
  deck.push(createFirstPlayCard());
  deck.push(createStarCard());
  deck.push(createBombCard());

  if (deck.length !== expected) {
    throw new Error(`Expected ${expected} cards, got ${deck.length}`);
  }

  return deck;
}

export function shuffleDeck(deck: Card[], rng: () => number = Math.random): Card[] {
  const result = [...deck];
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

export function dealCards(
  deck: Card[],
  playerCount: number,
  rng: () => number = Math.random,
): { hands: Card[][]; remainder: Card[] } {
  const shuffled = shuffleDeck(deck, rng);
  const hands: Card[][] = Array.from({ length: playerCount }, () => []);
  shuffled.forEach((card, index) => {
    hands[index % playerCount].push(card);
  });
  return { hands, remainder: [] };
}

export function expectedHandSizes(
  deckSize: number,
  playerCount: number,
): number[] {
  const base = Math.floor(deckSize / playerCount);
  const extra = deckSize % playerCount;
  return Array.from({ length: playerCount }, (_, i) =>
    i < extra ? base + 1 : base,
  );
}

export function findFirstPlayHolder(hands: Card[][]): number | null {
  for (let i = 0; i < hands.length; i += 1) {
    if (hands[i].some((c) => c.kind === CardKind.FirstPlay)) {
      return i;
    }
  }
  return null;
}

export function resetDeckIdCounter(): void {
  idCounter = 0;
}
