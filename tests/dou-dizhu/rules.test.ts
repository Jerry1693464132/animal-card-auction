import { describe, expect, it, beforeEach } from "vitest";
import {
  analyzeHand,
  createDeck,
  createNormalCard,
  createFirstPlayCard,
  createStarCard,
  createBombCard,
  dealCards,
  expectedHandSizes,
  findFirstPlayHolder,
  resetDeckIdCounter,
  DOU_DIZHU,
  Rank,
  Suit,
  CardKind,
  HandType,
} from "../../src/index.js";

describe("deck", () => {
  beforeEach(() => resetDeckIdCounter());

  it("creates 81 cards for 3 players with star, bomb, and first-play", () => {
    const deck = createDeck(3);
    expect(deck).toHaveLength(DOU_DIZHU.deckSize3);
    expect(deck.filter((c) => c.kind === CardKind.FirstPlay)).toHaveLength(1);
    expect(deck.filter((c) => c.kind === CardKind.Star)).toHaveLength(1);
    expect(deck.filter((c) => c.kind === CardKind.BombCard)).toHaveLength(1);
    expect(deck.filter((c) => c.kind === CardKind.Normal && c.rank === Rank.Three)).toHaveLength(4);
  });

  it("deals 81 cards evenly to 3 players", () => {
    const { hands } = dealCards(createDeck(3), 3);
    expect(hands.map((h) => h.length)).toEqual([27, 27, 27]);
    expect(expectedHandSizes(DOU_DIZHU.deckSize3, 3)).toEqual([27, 27, 27]);
  });

  it("creates 100 cards for 4 players with five of each rank", () => {
    const deck = createDeck(4);
    expect(deck).toHaveLength(DOU_DIZHU.deckSize4);
    expect(deck.filter((c) => c.kind === CardKind.Star)).toHaveLength(1);
    expect(deck.filter((c) => c.kind === CardKind.BombCard)).toHaveLength(1);
    const threes = deck.filter((c) => c.kind === CardKind.Normal && c.rank === Rank.Three);
    expect(threes).toHaveLength(5);
    expect(threes.filter((c) => c.suit === Suit.Spade)).toHaveLength(2);
  });

  it("deals 100 cards evenly to 4 players", () => {
    const { hands } = dealCards(createDeck(4), 4);
    expect(hands.map((h) => h.length)).toEqual([25, 25, 25, 25]);
    expect(expectedHandSizes(DOU_DIZHU.deckSize4, 4)).toEqual([25, 25, 25, 25]);
  });

  it("locates first-play holder", () => {
    const { hands } = dealCards(createDeck(4), 4);
    const idx = findFirstPlayHolder(hands);
    expect(idx).not.toBeNull();
  });
});

function normal(rank: Rank, suit: Suit = Suit.Spade) {
  return createNormalCard(rank, suit);
}

describe("analyzeHand", () => {
  beforeEach(() => resetDeckIdCounter());

  it("first-play must be alone", () => {
    expect(analyzeHand([createFirstPlayCard()])?.type).toBe(HandType.FirstPlay);
    expect(
      analyzeHand([createFirstPlayCard(), normal(Rank.Three)]),
    ).toBeNull();
  });

  it("single / pair / triple", () => {
    expect(analyzeHand([normal(Rank.Ace)])?.type).toBe(HandType.Single);
    expect(
      analyzeHand([normal(Rank.Five, Suit.Spade), normal(Rank.Five, Suit.Heart)])?.type,
    ).toBe(HandType.Pair);
    expect(
      analyzeHand([
        normal(Rank.Seven, Suit.Spade),
        normal(Rank.Seven, Suit.Heart),
        normal(Rank.Seven, Suit.Club),
      ])?.type,
    ).toBe(HandType.Triple);
  });

  it("triple with single and pair", () => {
    const t3 = [
      normal(Rank.Nine, Suit.Spade),
      normal(Rank.Nine, Suit.Heart),
      normal(Rank.Nine, Suit.Club),
      normal(Rank.Two, Suit.Diamond),
    ];
    expect(analyzeHand(t3)?.type).toBe(HandType.TripleWithSingle);

    const t5 = [
      ...t3.slice(0, 3),
      normal(Rank.Four, Suit.Spade),
      normal(Rank.Four, Suit.Heart),
    ];
    expect(analyzeHand(t5)?.type).toBe(HandType.TripleWithPair);
  });

  it("straight 3-7 and extended 14-18", () => {
    const short = [
      Rank.Three,
      Rank.Four,
      Rank.Five,
      Rank.Six,
      Rank.Seven,
    ].map((r, i) =>
      normal(r, [Suit.Spade, Suit.Heart, Suit.Club, Suit.Diamond, Suit.Spade][i]),
    );
    expect(analyzeHand(short)?.type).toBe(HandType.Straight);

    const long = [
      Rank.Fourteen,
      Rank.Fifteen,
      Rank.Sixteen,
      Rank.Seventeen,
      Rank.Eighteen,
    ].map((r, i) =>
      normal(r, [Suit.Spade, Suit.Heart, Suit.Club, Suit.Diamond, Suit.Spade][i]),
    );
    expect(analyzeHand(long)?.type).toBe(HandType.Straight);
  });

  it("rejects straight containing 2 or jokers", () => {
    const withTwo = [
      Rank.Ten,
      Rank.Jack,
      Rank.Queen,
      Rank.King,
      Rank.Two,
    ].map((r) => normal(r));
    expect(analyzeHand(withTwo)).toBeNull();
  });

  it("consecutive pairs J-J Q-Q K-K", () => {
    const cards = [
      Rank.Jack,
      Rank.Jack,
      Rank.Queen,
      Rank.Queen,
      Rank.King,
      Rank.King,
    ].map((r, i) =>
      normal(
        r,
        [Suit.Spade, Suit.Heart, Suit.Club, Suit.Diamond, Suit.Spade, Suit.Heart][i],
      ),
    );
    const parsed = analyzeHand(cards);
    expect(parsed?.type).toBe(HandType.ConsecutivePairs);
    expect(parsed?.length).toBe(3);
  });

  it("airplane 14-14-14 + 15-15-15", () => {
    const cards = [
      ...Array(3).fill(Rank.Fourteen),
      ...Array(3).fill(Rank.Fifteen),
    ].map((r, i) =>
      normal(
        r,
        [Suit.Spade, Suit.Heart, Suit.Club, Suit.Diamond, Suit.Spade, Suit.Heart][i],
      ),
    );
    expect(analyzeHand(cards)?.type).toBe(HandType.Airplane);
  });

  it("bomb order uses rank value", () => {
    const bomb3 = Array(4)
      .fill(Rank.Three)
      .map((r, i) =>
        normal(r, [Suit.Spade, Suit.Heart, Suit.Club, Suit.Diamond][i]),
      );
    const bombA = Array(4)
      .fill(Rank.Ace)
      .map((r, i) =>
        normal(r, [Suit.Spade, Suit.Heart, Suit.Club, Suit.Diamond][i]),
      );
    expect(analyzeHand(bomb3)?.mainRank).toBe(Rank.Three);
    expect(analyzeHand(bombA)?.mainRank).toBe(Rank.Ace);
  });

  it("five of a rank is a bomb (4-player extra copy)", () => {
    const five = Array(5)
      .fill(Rank.Nine)
      .map((r, i) =>
        normal(r, [Suit.Spade, Suit.Heart, Suit.Club, Suit.Diamond, Suit.Spade][i]),
      );
    const parsed = analyzeHand(five);
    expect(parsed?.type).toBe(HandType.Bomb);
    expect(parsed?.length).toBe(5);
  });

  it("rocket recognized", () => {
    const rocket = [normal(Rank.SmallJoker), normal(Rank.BigJoker)];
    expect(analyzeHand(rocket)?.type).toBe(HandType.Rocket);
  });

  it("four-with-two singles is not bomb", () => {
    const cards = [
      ...Array(4)
        .fill(null)
        .map((_, i) =>
          normal(Rank.Ten, [Suit.Spade, Suit.Heart, Suit.Club, Suit.Diamond][i]),
        ),
      normal(Rank.Three),
      normal(Rank.Four, Suit.Heart),
    ];
    expect(analyzeHand(cards)?.type).toBe(HandType.FourWithTwoSingles);
  });

  it("a single bomb card is the smallest bomb and cannot combine", () => {
    const one = analyzeHand([createBombCard()]);
    expect(one?.type).toBe(HandType.Bomb);
    expect(one?.length).toBe(1);
    expect(one?.mainRank).toBe(Rank.BombCard);

    expect(analyzeHand([createBombCard(), createBombCard()])).toBeNull();
    expect(
      analyzeHand([createBombCard(), normal(Rank.Three, Suit.Spade)]),
    ).toBeNull();
    expect(analyzeHand([createBombCard(), createStarCard()])).toBeNull();
  });

  it("5 to 8 of a kind are bombs", () => {
    const suits = [Suit.Spade, Suit.Heart, Suit.Club, Suit.Diamond];
    for (const n of [5, 6, 7, 8]) {
      const cards = Array.from({ length: n }, (_, i) =>
        normal(Rank.Nine, suits[i % 4]),
      );
      const parsed = analyzeHand(cards);
      expect(parsed?.type).toBe(HandType.Bomb);
      expect(parsed?.length).toBe(n);
      expect(parsed?.mainRank).toBe(Rank.Nine);
    }
  });

  it("star card completes pair", () => {
    const cards = [createStarCard(), normal(Rank.Eight, Suit.Spade)];
    expect(analyzeHand(cards)?.type).toBe(HandType.Pair);
  });

  it("triple extra single allows two kickers", () => {
    const cards = [
      normal(Rank.Nine, Suit.Spade),
      normal(Rank.Nine, Suit.Heart),
      normal(Rank.Nine, Suit.Club),
      normal(Rank.Three),
      normal(Rank.Four, Suit.Heart),
    ];
    expect(analyzeHand(cards)).toBeNull();
    expect(analyzeHand(cards, { tripleExtraSingle: true })?.type).toBe(
      HandType.TripleWithSingle,
    );
  });

  it("four extra single allows four-with-three", () => {
    const cards = [
      ...Array(4)
        .fill(null)
        .map((_, i) =>
          normal(Rank.Ten, [Suit.Spade, Suit.Heart, Suit.Club, Suit.Diamond][i]),
        ),
      normal(Rank.Three),
      normal(Rank.Four, Suit.Heart),
      normal(Rank.Five, Suit.Club),
    ];
    expect(analyzeHand(cards)).toBeNull();
    expect(analyzeHand(cards, { fourExtraSingle: true })?.type).toBe(
      HandType.FourWithTwoSingles,
    );
  });
});
