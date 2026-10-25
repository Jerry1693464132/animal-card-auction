/**
 * 本地排行榜（Steam 桌面版开发期）。
 * 微信好友排行已移除；这里用 localStorage 记录"历史最佳积分"，
 * 排行弹窗展示本机历史战绩。上架 Steam 前可替换为 Steamworks 排行榜。
 */
import { sys } from "cc";

/** localStorage key；沿用 party-cards 前缀以兼容旧排行榜数据。 */
const LOCAL_RANK_KEY = "party-cards:local-rank";

export interface LocalRankEntry {
  name: string;
  score: number;
  at: number;
}

/** 读取本机历史最佳记录（按积分降序） */
export function loadLocalRank(): LocalRankEntry[] {
  try {
    const raw = sys.localStorage.getItem(LOCAL_RANK_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as LocalRankEntry[];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((e) => typeof e?.name === "string" && typeof e?.score === "number")
      .sort((a, b) => b.score - a.score);
  } catch {
    return [];
  }
}

/** 记录一次历史最佳（合并同名玩家取最高分） */
export function recordLocalRank(name: string, score: number): void {
  if (!name || !Number.isFinite(score)) return;
  const list = loadLocalRank();
  const existing = list.find((e) => e.name === name);
  if (existing) {
    existing.score = Math.max(existing.score, score);
    existing.at = Date.now();
  } else {
    list.push({ name, score, at: Date.now() });
  }
  list.sort((a, b) => b.score - a.score);
  const trimmed = list.slice(0, 50);
  try {
    sys.localStorage.setItem(LOCAL_RANK_KEY, JSON.stringify(trimmed));
  } catch {
    // 存储不可用时忽略
  }
}

