import { DAILY_RESTORE_SCORE, INITIAL_SCORE, MODE_SCORE, rankedPlaceDelta } from "./config.js";
import {
  MatchSettlementInput,
  PlayerDelta,
  PlayerScoreProfile,
  ScoreLedgerEntry,
  SettlementResult,
} from "./types.js";

let ledgerSeq = 0;

function nextLedgerId(): string {
  ledgerSeq += 1;
  return `led-${ledgerSeq}-${Math.random().toString(36).slice(2, 8)}`;
}

/** 当前 UTC 日期（YYYY-MM-DD），用于"每日恢复至 0"的跨天判断 */
export function utcDayKey(at: number = Date.now()): string {
  const d = new Date(at);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(
    d.getUTCDate(),
  ).padStart(2, "0")}`;
}

export function createScoreProfile(
  playerId: string,
  initialScore = INITIAL_SCORE,
): PlayerScoreProfile {
  const profile: PlayerScoreProfile = {
    playerId,
    score: initialScore,
    lifetimeGainByMode: {},
    ledger: [],
    nextNegativeRestore: "ad",
    lastDailyRestoreDay: undefined,
  };
  if (initialScore !== 0) {
    profile.ledger.push({
      id: nextLedgerId(),
      playerId,
      matchId: null,
      modeId: null,
      delta: initialScore,
      scoreAfter: initialScore,
      ranked: false,
      reason: "initial",
      createdAt: Date.now(),
    });
  }
  return profile;
}

const LEGACY_INITIAL_SCORE = 100;

/** 把从未打过积分赛的旧创角（100 分）抬到现行初始分。已有对局流水的账号不动。 */
export function migrateLegacyInitialScore(profile: PlayerScoreProfile): boolean {
  if (profile.score !== LEGACY_INITIAL_SCORE) return false;
  if (Object.keys(profile.lifetimeGainByMode).length > 0) return false;
  if (profile.ledger.some((e) => e.reason !== "initial")) return false;
  profile.score = INITIAL_SCORE;
  const initial = profile.ledger.find((e) => e.reason === "initial");
  if (initial) {
    initial.delta = INITIAL_SCORE;
    initial.scoreAfter = INITIAL_SCORE;
  }
  return true;
}

function applyDelta(
  profile: PlayerScoreProfile,
  delta: number,
  opts: {
    matchId: string | null;
    modeId: string | null;
    ranked: boolean;
    reason: ScoreLedgerEntry["reason"];
    at: number;
  },
): ScoreLedgerEntry {
  profile.score += delta;
  const entry: ScoreLedgerEntry = {
    id: nextLedgerId(),
    playerId: profile.playerId,
    matchId: opts.matchId,
    modeId: opts.modeId,
    delta,
    scoreAfter: profile.score,
    ranked: opts.ranked,
    reason: opts.reason,
    createdAt: opts.at,
  };
  profile.ledger.push(entry);

  if (delta > 0 && opts.modeId && opts.ranked && opts.reason === "match") {
    profile.lifetimeGainByMode[opts.modeId] =
      (profile.lifetimeGainByMode[opts.modeId] ?? 0) + delta;
  }

  return entry;
}

/**
 * 个人战积分结算。
 * 娱乐房（ranked=false）不改 score，只返回 0 delta。
 */
export function settleMatchScores(
  profiles: Map<string, PlayerScoreProfile>,
  input: MatchSettlementInput,
): SettlementResult {
  const at = input.at ?? Date.now();
  const config = MODE_SCORE[input.modeId];
  if (!config) {
    throw new Error(`Unknown mode: ${input.modeId}`);
  }

  const ranking = [...input.ranking].sort((a, b) => a.rank - b.rank);
  const n = ranking.length;

  const deltas: PlayerDelta[] = [];
  const entries: ScoreLedgerEntry[] = [];

  for (const { playerId, rank } of ranking) {
    const profile = profiles.get(playerId);
    if (!profile) {
      throw new Error(`Missing score profile: ${playerId}`);
    }

    const scoreBefore = profile.score;
    let delta = 0;

    if (input.ranked) {
      const multiplier = input.scoreMultiplier && input.scoreMultiplier > 0 ? input.scoreMultiplier : 1;
      const personal = input.scoreDoubles?.[playerId] && input.scoreDoubles[playerId]! > 0
        ? input.scoreDoubles[playerId]!
        : 1;
      delta = rankedPlaceDelta(n, rank) * multiplier * personal;
      const entry = applyDelta(profile, delta, {
        matchId: input.matchId,
        modeId: input.modeId,
        ranked: true,
        reason: "match",
        at,
      });
      entries.push(entry);
    }

    deltas.push({
      playerId,
      rank,
      delta,
      scoreBefore,
      scoreAfter: profile.score,
    });
  }

  return { deltas, entries };
}

/**
 * 每周负分抬到 0（仅赦免欠分，正分不动，不计入模式占比）。
 * 产品已改为广告/转发恢复至 9000，此函数不再作为主流程。
 */
export function applyWeeklyNegativeFloor(
  profiles: Iterable<PlayerScoreProfile>,
  at: number = Date.now(),
): ScoreLedgerEntry[] {
  const entries: ScoreLedgerEntry[] = [];
  for (const profile of profiles) {
    if (profile.score >= 0) continue;
    const delta = -profile.score;
    entries.push(
      applyDelta(profile, delta, {
        matchId: null,
        modeId: null,
        ranked: false,
        reason: "weekly_floor",
        at,
      }),
    );
  }
  return entries;
}

export function canEnterMatch(score: number): boolean {
  return score >= 0;
}

/**
 * 每日恢复：负分玩家在 UTC 跨天后首次检查时，把积分拉回 0。
 * Steam 买断制替代微信广告/转发恢复；正分或当天已恢复过则不动。
 * 返回 true 表示本次执行了恢复（可用于通知客户端）。
 */
export function dailyRestoreNegativeScore(
  profile: PlayerScoreProfile,
  at: number = Date.now(),
): boolean {
  if (profile.score >= 0) return false;
  const today = utcDayKey(at);
  if (profile.lastDailyRestoreDay === today) return false;
  profile.lastDailyRestoreDay = today;
  const delta = DAILY_RESTORE_SCORE - profile.score;
  applyDelta(profile, delta, {
    matchId: null,
    modeId: null,
    ranked: false,
    reason: "daily_restore",
    at,
  });
  return true;
}

/**
 * 正分时各模式累计获得占比。
 * score <= 0 时返回空（不展示饼图）。
 */
export function modeGainShare(
  profile: PlayerScoreProfile,
): Array<{ modeId: string; gain: number; ratio: number }> {
  if (profile.score <= 0) return [];
  const entries = Object.entries(profile.lifetimeGainByMode);
  const total = entries.reduce((sum, [, g]) => sum + g, 0);
  if (total <= 0) return [];
  return entries
    .map(([modeId, gain]) => ({
      modeId,
      gain,
      ratio: Number((gain / total).toFixed(4)),
    }))
    .sort((a, b) => b.gain - a.gain);
}

export function resetLedgerSeq(): void {
  ledgerSeq = 0;
}
