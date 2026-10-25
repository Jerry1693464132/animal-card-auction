import { CardKind, Rank } from "./types.js";

/** 点数显示名 */
export const RANK_LABELS: Record<Rank, string> = {
  [Rank.FirstPlay]: "先手",
  [Rank.BombCard]: "炸",
  [Rank.Three]: "3",
  [Rank.Four]: "4",
  [Rank.Five]: "5",
  [Rank.Six]: "6",
  [Rank.Seven]: "7",
  [Rank.Eight]: "8",
  [Rank.Nine]: "9",
  [Rank.Ten]: "10",
  [Rank.Jack]: "J",
  [Rank.Queen]: "Q",
  [Rank.King]: "K",
  [Rank.Fourteen]: "14",
  [Rank.Fifteen]: "15",
  [Rank.Sixteen]: "16",
  [Rank.Seventeen]: "17",
  [Rank.Eighteen]: "18",
  [Rank.Nineteen]: "19",
  [Rank.Ace]: "A",
  [Rank.Two]: "2",
  [Rank.SmallJoker]: "小王",
  [Rank.BigJoker]: "大王",
};

/** 强易抽到牌后给使用者看的短描述（不含「你抽到的是」前缀） */
export function formatDrawnCardHint(kind: CardKind | string, rank?: Rank | number): string {
  if (kind === CardKind.Star || kind === "star") return "星牌";
  if (kind === CardKind.BombCard || kind === "bomb_card") return "炸弹牌";
  if (kind === CardKind.FirstPlay || kind === "first_play") return "先手牌";
  if (rank === Rank.SmallJoker) return "小王";
  if (rank === Rank.BigJoker) return "大王";
  const label = rank != null ? RANK_LABELS[rank as Rank] : "";
  return label ? `点数${label}` : "一张牌";
}

/** 可用于顺子/连对/飞机的点数序列（3~A，不含 2 和王） */
export const STRAIGHT_RANKS: Rank[] = [
  Rank.Three,
  Rank.Four,
  Rank.Five,
  Rank.Six,
  Rank.Seven,
  Rank.Eight,
  Rank.Nine,
  Rank.Ten,
  Rank.Jack,
  Rank.Queen,
  Rank.King,
  Rank.Fourteen,
  Rank.Fifteen,
  Rank.Sixteen,
  Rank.Seventeen,
  Rank.Eighteen,
  Rank.Nineteen,
  Rank.Ace,
];

const STRAIGHT_INDEX = new Map(STRAIGHT_RANKS.map((r, i) => [r, i]));

export function isStraightRank(rank: Rank): boolean {
  return STRAIGHT_INDEX.has(rank);
}

export function straightIndex(rank: Rank): number {
  const idx = STRAIGHT_INDEX.get(rank);
  if (idx === undefined) {
    throw new Error(`Rank ${rank} is not valid for straights`);
  }
  return idx;
}

export function compareRank(a: Rank, b: Rank): number {
  return a - b;
}

export function rankFromLabel(label: string): Rank | undefined {
  const entry = Object.entries(RANK_LABELS).find(([, v]) => v === label);
  return entry ? (Number(entry[0]) as Rank) : undefined;
}

/** 常规牌堆中的 19 个点数（不含先手、王） */
export const REGULAR_RANKS: Rank[] = [
  Rank.Three,
  Rank.Four,
  Rank.Five,
  Rank.Six,
  Rank.Seven,
  Rank.Eight,
  Rank.Nine,
  Rank.Ten,
  Rank.Jack,
  Rank.Queen,
  Rank.King,
  Rank.Fourteen,
  Rank.Fifteen,
  Rank.Sixteen,
  Rank.Seventeen,
  Rank.Eighteen,
  Rank.Nineteen,
  Rank.Ace,
  Rank.Two,
];
