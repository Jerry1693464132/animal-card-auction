import { MatchPhase, MatchState } from "../dou-dizhu/match/types.js";
import { settleMatchScores } from "./engine.js";
import { PlayerScoreProfile, SettlementResult } from "./types.js";

/**
 * 对局结束后结算斗地主积分。
 * 娱乐房或未结束时返回 null。
 */
export function settleDouDizhuMatch(
  state: MatchState,
  profiles: Map<string, PlayerScoreProfile>,
  at: number = Date.now(),
): SettlementResult | null {
  if (state.phase !== MatchPhase.Finished || state.finishedAt === null) {
    return null;
  }

  const ranking = [...state.players.values()]
    .filter((p) => p.finishRank !== null)
    .map((p) => ({ playerId: p.id, rank: p.finishRank! }))
    .sort((a, b) => a.rank - b.rank);

  const durationSec = Math.max(
    1,
    Math.round((state.finishedAt - state.startedAt) / 1000),
  );

  return settleMatchScores(profiles, {
    matchId: state.matchId,
    modeId: "dou_dizhu",
    ranked: state.ranked,
    ranking,
    durationSec,
    scoreMultiplier: state.scoreMultiplier,
    scoreDoubles: { ...state.scoreDoubles },
    at,
  });
}
