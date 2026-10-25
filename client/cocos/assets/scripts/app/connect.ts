/**
 * 连游戏服（Steam 桌面版）：本机账号 + 标准 WebSocket 直连。
 * 微信小游戏登录 / 云托管已移除。
 */
import { session } from "./Session";
import { net } from "../net/WsClient";
import { gameServerTarget } from "./serverConfig";

let bootPromise: Promise<void> | null = null;

export async function bootNet(): Promise<void> {
  if (!bootPromise) bootPromise = bootNetOnce();
  return bootPromise;
}

async function bootNetOnce(): Promise<void> {
  const target = gameServerTarget();
  if (target.kind === "none") {
    session.lastError = "未配置服务器地址";
    return;
  }
  session.ensureIdentity();
  net.ensureConnected(session.playerId, session.displayName, target.url, session.avatarUrl);
}
