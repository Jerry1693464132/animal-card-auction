import { HandType, ParsedHand } from "./types.js";
import { compareRank } from "./rank.js";

/** 先手牌按最小单张比较，下家可用任意更大单张（或炸弹/火箭）跟。 */
function comparableType(type: HandType): HandType {
  return type === HandType.FirstPlay ? HandType.Single : type;
}

/** 王炸压一切；炸弹压非炸弹；炸弹之间先比张数再比点数；四带二不算炸弹 */
export function canBeat(current: ParsedHand, challenger: ParsedHand): boolean {
  if (challenger.type === HandType.Rocket) {
    return current.type !== HandType.Rocket;
  }
  if (current.type === HandType.Rocket) {
    return false;
  }

  if (challenger.type === HandType.Bomb) {
    if (current.type !== HandType.Bomb) return true;
    if (challenger.length !== current.length) {
      return challenger.length > current.length;
    }
    return compareRank(challenger.mainRank, current.mainRank) > 0;
  }

  if (current.type === HandType.Bomb) {
    return false;
  }

  if (comparableType(challenger.type) !== comparableType(current.type)) return false;
  if (challenger.length !== current.length) return false;
  return compareRank(challenger.mainRank, current.mainRank) > 0;
}

/** 非自由领出时必须跟牌（或炸弹/火箭） */
export function mustFollow(table: ParsedHand | null): boolean {
  return table !== null;
}

export function canPass(table: ParsedHand | null, isFreeLead: boolean): boolean {
  if (isFreeLead || table === null) return false;
  return true;
}

export function handTypeLabel(type: HandType): string {
  const labels: Record<HandType, string> = {
    [HandType.FirstPlay]: "先手",
    [HandType.Single]: "单张",
    [HandType.Pair]: "对子",
    [HandType.Triple]: "三张",
    [HandType.TripleWithSingle]: "三带一",
    [HandType.TripleWithPair]: "三带对",
    [HandType.Straight]: "顺子",
    [HandType.ConsecutivePairs]: "连对",
    [HandType.Airplane]: "飞机",
    [HandType.AirplaneWithSingles]: "飞机带单",
    [HandType.AirplaneWithPairs]: "飞机带对",
    [HandType.FourWithTwoSingles]: "四带二",
    [HandType.FourWithTwoPairs]: "四带两对",
    [HandType.Bomb]: "炸弹",
    [HandType.Rocket]: "火箭",
  };
  return labels[type] ?? type;
}
