import { ClientMessage, ServerMessage } from "./Protocol";

type MessageHandler = (msg: ServerMessage) => void;
type StatusHandler = () => void;

/** 断线重连退避基数 / 上限，以及心跳间隔 */
const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 15000;
const KEEPALIVE_INTERVAL_MS = 25000;

/** 与标准 WebSocket readyState 对齐（0=连接中 1=已连接 2=关闭中 3=已关闭） */
const CONNECTING = 0;
const OPEN = 1;
const CLOSED = 3;

/**
 * 权威逻辑在服务端；本类只发意图、收快照。
 * Steam 桌面版：标准 WebSocket + hello 登录（无微信云托管）。
 */
export class WsClient {
  private ws: WebSocket | null = null;
  private handlers: MessageHandler[] = [];
  private statusHandlers: StatusHandler[] = [];
  private url = "ws://127.0.0.1:8787/ws";
  private auth: {
    kind: "hello";
    playerId: string;
    displayName: string;
    avatarUrl?: string;
  } | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private keepaliveTimer: ReturnType<typeof setInterval> | null = null;
  private welcomeTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempts = 0;
  welcomed = false;

  onMessage(handler: MessageHandler): () => void {
    this.handlers.push(handler);
    return () => {
      this.handlers = this.handlers.filter((h) => h !== handler);
    };
  }

  onStatus(handler: StatusHandler): () => void {
    this.statusHandlers.push(handler);
    return () => {
      this.statusHandlers = this.statusHandlers.filter((h) => h !== handler);
    };
  }

  get connected(): boolean {
    return !!this.ws && this.ws.readyState === OPEN;
  }

  get statusText(): string {
    if (!this.ws) return "未连接";
    if (this.ws.readyState === CONNECTING) return "连接中…";
    if (this.ws.readyState === OPEN) {
      return this.welcomed ? "已连接" : "已连接，等待欢迎…";
    }
    return "未连接";
  }

  private emitStatus(): void {
    for (const h of this.statusHandlers) h();
  }

  /** 连接并在 open 后自动 hello（可重复调用，已连接则只补 hello） */
  ensureConnected(
    playerId: string,
    displayName: string,
    url = "ws://127.0.0.1:8787/ws",
    avatarUrl = "",
  ): void {
    this.auth = { kind: "hello", playerId, displayName, avatarUrl };
    this.connect(url);
  }

  private connect(url: string): void {
    this.url = url;
    if (this.connected) {
      this.sendAuth();
      this.emitStatus();
      return;
    }
    if (this.ws && this.ws.readyState === CONNECTING) {
      this.emitStatus();
      return;
    }
    this.close();
    this.welcomed = false;
    const ws = new WebSocket(this.url);
    this.ws = ws;
    this.emitStatus();
    ws.onopen = () => {
      this.reconnectAttempts = 0;
      this.startKeepalive();
      this.sendAuth();
      this.emitStatus();
    };
    ws.onclose = () => this.handleClosed();
    ws.onerror = () => this.emitStatus();
    ws.onmessage = (ev) => this.handleData(String(ev.data));
  }

  private handleClosed(): void {
    this.welcomed = false;
    this.stopKeepalive();
    this.clearWelcomeTimeout();
    this.scheduleReconnect();
    this.emitStatus();
  }

  /** auth 发出后若 6s 内没收到 welcome，打印诊断并按断线重连 */
  private armWelcomeTimeout(): void {
    this.clearWelcomeTimeout();
    this.welcomeTimer = setTimeout(() => {
      this.welcomeTimer = null;
      if (this.welcomed) return;
      console.error(
        "[WsClient] 6s 未收到 welcome",
        {
          connected: this.connected,
          welcomed: this.welcomed,
          authKind: this.auth?.kind,
        },
      );
      this.stopKeepalive();
      this.scheduleReconnect();
      this.emitStatus();
    }, 6000);
  }

  private clearWelcomeTimeout(): void {
    if (this.welcomeTimer) {
      clearTimeout(this.welcomeTimer);
      this.welcomeTimer = null;
    }
  }

  private handleData(data: string): void {
    try {
      const msg = JSON.parse(data) as ServerMessage;
      console.log("[WsClient] 收到消息", msg.type);
      if (msg.type === "welcome") {
        this.welcomed = true;
        console.log("[WsClient] 收到 welcome", msg.playerId, msg.displayName);
        this.clearWelcomeTimeout();
        this.auth = {
          kind: "hello",
          playerId: msg.playerId,
          displayName: msg.displayName,
          avatarUrl: this.auth?.avatarUrl ?? "",
        };
      } else if (msg.type === "error") {
        console.error("[WsClient] 服务器 error", (msg as { message?: string }).message);
      }
      this.emitStatus();
      for (const h of this.handlers) h(msg);
    } catch (err) {
      console.error("[WsClient] 收到无法解析的消息", data, err);
    }
  }

  /** 断线后指数退避重连 */
  private scheduleReconnect(): void {
    if (!this.auth) return;
    if (this.reconnectTimer) return;
    const delay = Math.min(
      RECONNECT_BASE_MS * 2 ** this.reconnectAttempts,
      RECONNECT_MAX_MS,
    );
    this.reconnectAttempts += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect(this.url);
    }, delay);
  }

  /** 空闲心跳：防止运营商 NAT 掐掉长连接 */
  private startKeepalive(): void {
    this.stopKeepalive();
    this.keepaliveTimer = setInterval(() => {
      this.send({ type: "ping" });
    }, KEEPALIVE_INTERVAL_MS);
  }

  private stopKeepalive(): void {
    if (this.keepaliveTimer) {
      clearInterval(this.keepaliveTimer);
      this.keepaliveTimer = null;
    }
  }

  private sendAuth(): void {
    if (!this.auth || !this.connected) {
      console.log("[WsClient] sendAuth 跳过", {
        auth: !!this.auth,
        connected: this.connected,
      });
      return;
    }
    this.armWelcomeTimeout();
    this.send({
      type: "hello",
      playerId: this.auth.playerId,
      displayName: this.auth.displayName,
      ...(this.auth.avatarUrl ? { avatarUrl: this.auth.avatarUrl } : {}),
    });
  }

  close(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.stopKeepalive();
    this.clearWelcomeTimeout();
    if (this.ws) {
      this.ws.onopen = null;
      this.ws.onclose = null;
      this.ws.onerror = null;
      this.ws.onmessage = null;
      this.ws.close();
      this.ws = null;
    }
    this.welcomed = false;
  }

  send(msg: ClientMessage): boolean {
    if (!this.connected || !this.ws) return false;
    this.ws.send(JSON.stringify(msg));
    return true;
  }

  /** 更新昵称/头像后同步到服务端（同一 playerId 再 hello） */
  syncDisplayName(playerId: string, displayName: string, avatarUrl = ""): void {
    if (!playerId || !displayName) return;
    const nextUrl = avatarUrl || this.auth?.avatarUrl || "";
    if (
      this.auth?.kind === "hello" &&
      this.auth.displayName === displayName &&
      (this.auth.avatarUrl || "") === nextUrl
    ) {
      this.auth.playerId = playerId;
      return;
    }
    if (this.auth) {
      this.auth.displayName = displayName;
      this.auth.avatarUrl = nextUrl;
    }
    this.send({
      type: "hello",
      playerId,
      displayName,
      ...(nextUrl ? { avatarUrl: nextUrl } : {}),
    });
  }
}

export const net = new WsClient();
