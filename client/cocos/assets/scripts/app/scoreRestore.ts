/**
 * 负分恢复（Steam 买断制）：每天一次把负分拉回 0。
 * 服务端在玩家连接/重连时自动检查 UTC 跨天恢复，客户端也可主动触发一次。
 */

import { session } from "./Session";
import { net } from "../net/WsClient";

/** 每日恢复目标分 */
export const DAILY_RESTORE_SCORE = 0;

export function needsScoreRestore(score = session.score): boolean {
  return score < 0;
}

/**
 * 主动请求今日恢复。服务端当天已恢复过会拒绝，返回错误提示。
 */
export async function requestScoreRestore(): Promise<{ ok: boolean; error?: string }> {
  if (!net.send({ type: "restore_score" })) {
    return { ok: false, error: "未连接服务器" };
  }
  return { ok: true };
}
