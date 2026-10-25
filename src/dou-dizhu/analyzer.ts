import {
  Card,
  CardKind,
  HandType,
  ParsedHand,
  Rank,
} from "./types.js";
import { isStraightRank, straightIndex, STRAIGHT_RANKS } from "./rank.js";

export type AnalyzeResult = ParsedHand | null;

function cardBaseRank(card: Card): Rank | null {
  if (card.kind === CardKind.FirstPlay) return Rank.FirstPlay;
  if (card.kind === CardKind.BombCard) return Rank.BombCard;
  if (card.kind === CardKind.Star) return null;
  return card.rank ?? null;
}

function countByRank(ranks: Rank[]): Map<Rank, number> {
  const m = new Map<Rank, number>();
  for (const r of ranks) m.set(r, (m.get(r) ?? 0) + 1);
  return m;
}

function parsed(
  type: HandType,
  mainRank: Rank,
  length: number,
  cards: Card[],
): ParsedHand {
  return { type, mainRank, length, cards };
}

export interface AnalyzeOptions {
  tripleExtraSingle?: boolean;
  fourExtraSingle?: boolean;
}

/** 在已解析出的点数序列上尝试识别牌型 */
function tryParseFixed(
  ranks: Rank[],
  cards: Card[],
  options: AnalyzeOptions = {},
): ParsedHand | null {
  const n = ranks.length;
  if (n === 0) return null;

  const counts = countByRank(ranks);
  const entries = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0]);

  // 先手牌：仅单张
  if (n === 1 && ranks[0] === Rank.FirstPlay) {
    return parsed(HandType.FirstPlay, Rank.FirstPlay, 1, cards);
  }
  if (ranks.some((r) => r === Rank.FirstPlay)) return null;

  // 火箭（大小王）；王炸仍是全场最大
  if (
    n === 2 &&
    counts.get(Rank.SmallJoker) === 1 &&
    counts.get(Rank.BigJoker) === 1
  ) {
    return parsed(HandType.Rocket, Rank.BigJoker, 1, cards);
  }

  // 炸弹：4 张及以上同点（四人场每点 5 张，加赛后可更多）；length = 张数
  if (entries.length === 1 && n >= 4) {
    return parsed(HandType.Bomb, entries[0][0], n, cards);
  }

  // 单 / 对 / 三
  if (n === 1) return parsed(HandType.Single, ranks[0], 1, cards);
  if (n === 2 && entries.length === 1 && entries[0][1] === 2) {
    return parsed(HandType.Pair, entries[0][0], 1, cards);
  }
  if (n === 3 && entries.length === 1 && entries[0][1] === 3) {
    return parsed(HandType.Triple, entries[0][0], 1, cards);
  }

  // 三带一
  if (n === 4) {
    const triple = entries.find(([, c]) => c === 3);
    const single = entries.find(([, c]) => c === 1);
    if (triple && single) {
      return parsed(HandType.TripleWithSingle, triple[0], 1, cards);
    }
  }

  // 三带对
  if (n === 5) {
    const triple = entries.find(([, c]) => c === 3);
    const pair = entries.find(([, c]) => c === 2);
    if (triple && pair && entries.length === 2) {
      return parsed(HandType.TripleWithPair, triple[0], 1, cards);
    }
  }

  // 三带两个一（道具）：三张 + 两张单
  if (options.tripleExtraSingle && n === 5) {
    const triple = entries.find(([, c]) => c === 3);
    if (triple) {
      const rest = entries.filter(([r]) => r !== triple[0]);
      const restCount = rest.reduce((s, [, c]) => s + c, 0);
      if (restCount === 2) {
        return parsed(HandType.TripleWithSingle, triple[0], 1, cards);
      }
    }
  }

  // 四带二单
  if (n === 6) {
    const four = entries.find(([, c]) => c === 4);
    if (four) {
      const rest = entries.filter(([r]) => r !== four[0]);
      const restCount = rest.reduce((s, [, c]) => s + c, 0);
      if (restCount === 2 && rest.every(([, c]) => c === 1 || c === 2)) {
        // 两张单（可同点也可不同点）；若 rest 是一对也算四带二单
        return parsed(HandType.FourWithTwoSingles, four[0], 1, cards);
      }
    }
  }

  // 四带三（道具）：四带二再多一张单
  if (options.fourExtraSingle && n === 7) {
    const four = entries.find(([, c]) => c === 4);
    if (four) {
      const rest = entries.filter(([r]) => r !== four[0]);
      const restCount = rest.reduce((s, [, c]) => s + c, 0);
      if (restCount === 3) {
        return parsed(HandType.FourWithTwoSingles, four[0], 1, cards);
      }
    }
  }

  // 四带两对
  if (n === 8) {
    const four = entries.find(([, c]) => c === 4);
    const pairs = entries.filter(([, c]) => c === 2);
    if (four && pairs.length === 2 && entries.length === 3) {
      return parsed(HandType.FourWithTwoPairs, four[0], 1, cards);
    }
  }

  // 顺子：5+，每点 1 张，连续且均在 3~A
  if (n >= 5 && entries.every(([, c]) => c === 1)) {
    if (ranks.every(isStraightRank)) {
      const idxs = ranks.map(straightIndex).sort((a, b) => a - b);
      let ok = true;
      for (let i = 1; i < idxs.length; i += 1) {
        if (idxs[i] !== idxs[i - 1] + 1) {
          ok = false;
          break;
        }
      }
      if (ok) {
        const top = STRAIGHT_RANKS[idxs[idxs.length - 1]];
        return parsed(HandType.Straight, top, n, cards);
      }
    }
  }

  // 连对：3+ 对，连续
  if (n >= 6 && n % 2 === 0) {
    const pairEntries = entries.filter(([, c]) => c === 2);
    if (pairEntries.length === n / 2 && pairEntries.length >= 3) {
      if (pairEntries.every(([r]) => isStraightRank(r))) {
        const idxs = pairEntries.map(([r]) => straightIndex(r)).sort((a, b) => a - b);
        let ok = true;
        for (let i = 1; i < idxs.length; i += 1) {
          if (idxs[i] !== idxs[i - 1] + 1) {
            ok = false;
            break;
          }
        }
        if (ok) {
          const top = STRAIGHT_RANKS[idxs[idxs.length - 1]];
          return parsed(HandType.ConsecutivePairs, top, pairEntries.length, cards);
        }
      }
    }
  }

  // 飞机（纯）/ 飞机带单 / 飞机带对
  const triples = entries.filter(([, c]) => c === 3).map(([r]) => r);
  if (triples.length >= 2 && triples.every(isStraightRank)) {
    const idxs = triples.map(straightIndex).sort((a, b) => a - b);
    // 找最长连续三张段；简化：要求全部连续
    let contiguous = true;
    for (let i = 1; i < idxs.length; i += 1) {
      if (idxs[i] !== idxs[i - 1] + 1) {
        contiguous = false;
        break;
      }
    }
    if (contiguous) {
      const wings = n - triples.length * 3;
      const top = STRAIGHT_RANKS[idxs[idxs.length - 1]];
      const len = triples.length;

      if (wings === 0) {
        return parsed(HandType.Airplane, top, len, cards);
      }

      // 飞机带单：每组带 1 张
      if (wings === len) {
        // 翅膀不能是炸弹拆出的复杂情况：允许任意剩余牌
        return parsed(HandType.AirplaneWithSingles, top, len, cards);
      }

      // 飞机带对：每组带一对
      if (wings === len * 2) {
        const nonTriple = entries.filter(([, c]) => c !== 3);
        if (
          nonTriple.length === len &&
          nonTriple.every(([, c]) => c === 2)
        ) {
          return parsed(HandType.AirplaneWithPairs, top, len, cards);
        }
      }
    }
  }

  return null;
}

/** 为星牌枚举点数赋值后解析 */
function assignStarsAndParse(
  cards: Card[],
  options: AnalyzeOptions = {},
): ParsedHand | null {
  const starIdx: number[] = [];
  const fixed: (Rank | null)[] = cards.map((c, i) => {
    if (c.kind === CardKind.Star) {
      starIdx.push(i);
      return null;
    }
    return cardBaseRank(c);
  });

  if (fixed.some((r, i) => r === null && cards[i].kind !== CardKind.Star)) {
    return null;
  }

  if (starIdx.length === 0) {
    return tryParseFixed(fixed as Rank[], cards, options);
  }

  // 候选点数：顺子可用点 + 2 + 王（火箭场景）
  const candidates: Rank[] = [
    ...STRAIGHT_RANKS,
    Rank.Two,
    Rank.SmallJoker,
    Rank.BigJoker,
  ];

  let best: ParsedHand | null = null;

  function dfs(k: number, current: Rank[]): void {
    if (k === starIdx.length) {
      const ranks = fixed.map((r, i) => {
        const starPos = starIdx.indexOf(i);
        return starPos >= 0 ? current[starPos] : (r as Rank);
      });
      const result = tryParseFixed(ranks, cards, options);
      if (result && (!best || prefer(result, best))) best = result;
      return;
    }
    for (const rank of candidates) {
      current.push(rank);
      dfs(k + 1, current);
      current.pop();
    }
  }

  dfs(0, []);
  return best;
}

/** 多解时偏好更「标准」的牌型（炸弹/火箭优先于四带二等） */
function prefer(a: ParsedHand, b: ParsedHand): boolean {
  const priority = (t: HandType): number => {
    switch (t) {
      case HandType.Rocket:
        return 100;
      case HandType.Bomb:
        return 90;
      case HandType.Straight:
      case HandType.ConsecutivePairs:
      case HandType.Airplane:
      case HandType.AirplaneWithSingles:
      case HandType.AirplaneWithPairs:
        return 50;
      default:
        return 10;
    }
  };
  const pa = priority(a.type);
  const pb = priority(b.type);
  if (pa !== pb) return pa > pb;
  if (a.type === HandType.Bomb && a.length !== b.length) return a.length > b.length;
  return a.mainRank > b.mainRank;
}

export function analyzeHand(
  cards: Card[],
  options: AnalyzeOptions = {},
): AnalyzeResult {
  if (!cards.length) return null;
  const bombCards = cards.filter((c) => c.kind === CardKind.BombCard);
  if (bombCards.length) {
    // 炸弹牌只能单出，单张即为最小炸弹（比四张 3 小）
    if (cards.length !== 1) return null;
    return parsed(HandType.Bomb, Rank.BombCard, 1, cards);
  }
  return assignStarsAndParse(cards, options);
}

/** 积分赛倍率：四张及以上同点炸弹、王炸各 ×2。单张炸弹牌太常见，不加倍。 */
export function doublesScoreMultiplier(hand: ParsedHand): boolean {
  if (hand.type === HandType.Rocket) return true;
  return hand.type === HandType.Bomb && hand.length >= 4;
}

export function isValidPlay(cards: Card[]): boolean {
  return analyzeHand(cards) !== null;
}

/** 两手牌是否可视为同一次出牌（牌型可解析） */
export function canPlayTogether(cards: Card[]): boolean {
  return isValidPlay(cards);
}
