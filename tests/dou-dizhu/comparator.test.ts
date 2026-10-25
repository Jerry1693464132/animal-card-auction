import { describe, expect, it, beforeEach } from "vitest";
import {
  analyzeHand,
  canBeat,
  createNormalCard,
  createFirstPlayCard,
  createBombCard,
  resetDeckIdCounter,
  Rank,
  Suit,
  HandType,
} from "../../src/index.js";

describe("canBeat", () => {
  beforeEach(() => resetDeckIdCounter());

  function n(rank: Rank, suit: Suit = Suit.Spade) {
    return createNormalCard(rank, suit);
  }

  function bomb(rank: Rank, count: number) {
    const suits = [Suit.Spade, Suit.Heart, Suit.Club, Suit.Diamond];
    return analyzeHand(
      Array.from({ length: count }, (_, i) => n(rank, suits[i % 4])),
    )!;
  }

  it("same type higher rank wins", () => {
    const low = analyzeHand([n(Rank.Five)])!;
    const high = analyzeHand([n(Rank.King)])!;
    expect(canBeat(low, high)).toBe(true);
    expect(canBeat(high, low)).toBe(false);
  });

  it("bomb beats normal hand", () => {
    const single = analyzeHand([n(Rank.Two)])!;
    const bomb = analyzeHand(Array(4).fill(Rank.Three).map((r, i) =>
      n(r, [Suit.Spade, Suit.Heart, Suit.Club, Suit.Diamond][i]),
    ))!;
    expect(canBeat(single, bomb)).toBe(true);
    expect(canBeat(bomb, single)).toBe(false);
  });

  it("longer bomb beats shorter bomb even with lower rank", () => {
    const fourAces = bomb(Rank.Ace, 4);
    const fiveThrees = bomb(Rank.Three, 5);
    const sixTwos = bomb(Rank.Two, 6);
    expect(fourAces.length).toBe(4);
    expect(fiveThrees.length).toBe(5);
    expect(canBeat(fourAces, fiveThrees)).toBe(true);
    expect(canBeat(fiveThrees, fourAces)).toBe(false);
    expect(canBeat(fiveThrees, sixTwos)).toBe(true);
  });

  it("same-length bombs compare by rank", () => {
    const fourThrees = bomb(Rank.Three, 4);
    const fourAces = bomb(Rank.Ace, 4);
    const fiveThrees = bomb(Rank.Three, 5);
    const fiveAces = bomb(Rank.Ace, 5);
    expect(canBeat(fourThrees, fourAces)).toBe(true);
    expect(canBeat(fourAces, fourThrees)).toBe(false);
    expect(canBeat(fiveThrees, fiveAces)).toBe(true);
    expect(canBeat(fiveAces, fiveThrees)).toBe(false);
  });

  it("rocket still beats an 8-card bomb", () => {
    const rocket = analyzeHand([n(Rank.SmallJoker), n(Rank.BigJoker)])!;
    const eight = bomb(Rank.Ace, 8);
    expect(canBeat(eight, rocket)).toBe(true);
    expect(canBeat(rocket, eight)).toBe(false);
  });

  it("a bomb card is smaller than four 3s and beats normal hands", () => {
    const token = analyzeHand([createBombCard()])!;
    const fourThrees = bomb(Rank.Three, 4);
    const two = analyzeHand([n(Rank.Two)])!;
    expect(token.type).toBe(HandType.Bomb);
    expect(canBeat(two, token)).toBe(true);
    expect(canBeat(token, fourThrees)).toBe(true);
    expect(canBeat(fourThrees, token)).toBe(false);
  });

  it("rocket beats everything except rocket", () => {
    const rocket = analyzeHand([n(Rank.SmallJoker), n(Rank.BigJoker)])!;
    const bombA = analyzeHand(Array(4).fill(Rank.Ace).map((r, i) =>
      n(r, [Suit.Spade, Suit.Heart, Suit.Club, Suit.Diamond][i]),
    ))!;
    expect(canBeat(bombA, rocket)).toBe(true);
    expect(canBeat(rocket, bombA)).toBe(false);
  });

  it("four-with-two cannot beat bomb", () => {
    const f42 = analyzeHand([
      ...Array(4).fill(Rank.King).map((r, i) => n(r, [Suit.Spade, Suit.Heart, Suit.Club, Suit.Diamond][i])),
      n(Rank.Three),
      n(Rank.Four, Suit.Heart),
    ])!;
    expect(f42.type).toBe(HandType.FourWithTwoSingles);
    const bomb = analyzeHand(Array(4).fill(Rank.Three).map((r, i) =>
      n(r, [Suit.Spade, Suit.Heart, Suit.Club, Suit.Diamond][i]),
    ))!;
    expect(canBeat(f42, bomb)).toBe(true);
  });

  it("first-play is the smallest single and can be followed", () => {
    const first = analyzeHand([createFirstPlayCard()])!;
    const three = analyzeHand([n(Rank.Three)])!;
    const pair = analyzeHand([n(Rank.Three), n(Rank.Three, Suit.Heart)])!;
    expect(first.type).toBe(HandType.FirstPlay);
    expect(canBeat(first, three)).toBe(true);
    expect(canBeat(three, first)).toBe(false);
    expect(canBeat(first, pair)).toBe(false);
  });

  it("straight must match length", () => {
    const s5 = analyzeHand([
      Rank.Three,
      Rank.Four,
      Rank.Five,
      Rank.Six,
      Rank.Seven,
    ].map((r) => n(r)))!;
    const s6 = analyzeHand([
      Rank.Three,
      Rank.Four,
      Rank.Five,
      Rank.Six,
      Rank.Seven,
      Rank.Eight,
    ].map((r, i) => n(r, [Suit.Spade, Suit.Heart, Suit.Club, Suit.Diamond, Suit.Spade, Suit.Heart][i])))!;
    expect(canBeat(s5, s6)).toBe(false);
  });
});
