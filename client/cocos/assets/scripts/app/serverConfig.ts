import { sys } from "cc";

// 沿用 party-cards 前缀，避免升级后丢失本地服务器地址覆盖。
const SERVER_OVERRIDE_KEY = "party-cards:server-url";
const LOCAL_SERVER_URL = "ws://127.0.0.1:8787/ws";

/**
 * Steam 桌面版：直连游戏服务器。
 * - 开发期：本机 ws://127.0.0.1:8787/ws
 * - 发布期：通过 __PARTY_CARDS_SERVER_URL__ 注入，或本地存储覆盖
 *   （微信云托管 / cloudflared 隧道已移除）
 */

type RuntimeServerConfig = typeof globalThis & {
  __PARTY_CARDS_SERVER_URL__?: string;
};

function validUrl(value: unknown, requireTls: boolean): string {
  if (typeof value !== "string") return "";
  const url = value.trim();
  if (requireTls ? !url.startsWith("wss://") : !/^wss?:\/\//.test(url)) return "";
  return url;
}

export type ServerTarget = { kind: "url"; url: string } | { kind: "none" };

export function gameServerTarget(): ServerTarget {
  // 1) 构建期注入（VPS 发布：wss://你的服务器/ws）
  const injected = (globalThis as RuntimeServerConfig).__PARTY_CARDS_SERVER_URL__;
  if (injected) {
    const url = validUrl(injected, false);
    if (url) return { kind: "url", url };
  }
  // 2) 本地存储覆盖（调试用）
  try {
    const saved = sys.localStorage.getItem(SERVER_OVERRIDE_KEY);
    if (saved) {
      const url = validUrl(saved, false);
      if (url) return { kind: "url", url };
    }
  } catch {
    // 存储不可用时忽略
  }
  // 3) 默认本机开发地址
  return { kind: "url", url: LOCAL_SERVER_URL };
}

export function gameServerUrl(): string | null {
  const target = gameServerTarget();
  if (target.kind === "url") return target.url;
  return null;
}
