import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer, WebSocket } from "ws";
import { GameHub } from "./hub.js";
import { ClientMessage, parseClientMessage, ServerMessage } from "./protocol.js";
import { JsonFileScoreStore, sanitizePlayerId } from "../score/store.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLIENT_ROOT = path.resolve(__dirname, "../../client/debug");
const DEFAULT_SCORE_FILE = path.resolve(__dirname, "../../data/accounts.json");

interface ClientSession {
  socket: WebSocket;
  playerId: string | null;
}

function send(socket: WebSocket, message: ServerMessage): void {
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(message));
  }
}

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

function serveStatic(
  req: http.IncomingMessage,
  res: http.ServerResponse,
): void {
  const url = new URL(req.url ?? "/", "http://localhost");
  let pathname = decodeURIComponent(url.pathname);
  if (pathname === "/") pathname = "/index.html";

  const filePath = path.normalize(path.join(CLIENT_ROOT, pathname));
  if (!filePath.startsWith(CLIENT_ROOT)) {
    res.writeHead(403).end("Forbidden");
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Not found");
      return;
    }
    const ext = path.extname(filePath);
    res.writeHead(200, {
      "Content-Type": MIME[ext] ?? "application/octet-stream",
      "Cache-Control": "no-store",
    });
    res.end(data);
  });
}

export interface ServerHandle {
  port: number;
  close: () => Promise<void>;
}

export interface GameServerOptions {
  /** WebSocket upgrade path；公网隧道只暴露这一条。 */
  wsPath?: string;
  /** 本地调试默认开启，公网临时隧道应关闭。 */
  serveDebug?: boolean;
}

export function startGameServer(port = 8787, options: GameServerOptions = {}): ServerHandle {
  const wsPath = options.wsPath?.startsWith("/") ? options.wsPath : "/ws";
  const serveDebug = options.serveDebug ?? true;
  const server = http.createServer((req, res) => {
    if (req.url === "/health") {
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      res.end('{"ok":true}');
      return;
    }
    if (!serveDebug) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Not found");
      return;
    }
    if (req.method === "GET" || req.method === "HEAD") {
      serveStatic(req, res);
      return;
    }
    res.writeHead(405).end("Method Not Allowed");
  });

  server.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EADDRINUSE") {
      console.error(
        `[animal-card-auction] 端口 ${port} 已被占用。可先执行: npm run free-port\n` +
          `或换端口: set PORT=8788 && npm run dev`,
      );
      process.exit(1);
    }
    console.error("[animal-card-auction] server error:", err);
    process.exit(1);
  });

  const wss = new WebSocketServer({ noServer: true });
  server.on("upgrade", (req, socket, head) => {
    const pathname = new URL(req.url ?? "/", "http://localhost").pathname;
    if (pathname !== wsPath) {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (client) => {
      wss.emit("connection", client, req);
    });
  });
  const sessions = new Map<WebSocket, ClientSession>();
  const byPlayer = new Map<string, WebSocket>();

  const scoreFile = process.env.SCORE_FILE || DEFAULT_SCORE_FILE;
  const hub = new GameHub(
    (playerId, message) => {
      const socket = byPlayer.get(playerId);
      if (socket) send(socket, message);
    },
    {
      store: new JsonFileScoreStore(scoreFile),
    },
  );

  const tickTimer = setInterval(() => hub.tickAll(Date.now()), 250);

  wss.on("connection", (socket) => {
    const session: ClientSession = { socket, playerId: null };
    sessions.set(socket, session);

    socket.on("message", (data) => {
      const msg = parseClientMessage(String(data));
      if (!msg) {
        send(socket, { type: "error", message: "Invalid message" });
        return;
      }
      handleMessage(session, msg);
    });

    socket.on("close", () => {
      if (session.playerId && byPlayer.get(session.playerId) === socket) {
        byPlayer.delete(session.playerId);
        hub.disconnect(session.playerId);
      }
      sessions.delete(socket);
    });
  });

  function bindPlayer(
    session: ClientSession,
    playerId: string,
    displayName?: string,
    avatarUrl?: string,
  ): void {
    const existing = byPlayer.get(playerId);
    if (existing && existing !== session.socket) {
      send(existing, { type: "error", message: "Logged in elsewhere" });
      existing.close();
    }
    session.playerId = playerId;
    byPlayer.set(playerId, session.socket);
    hub.setDisplayName(playerId, displayName ?? playerId);
    hub.setPortraitUrl(playerId, avatarUrl);
    send(session.socket, {
      type: "welcome",
      playerId,
      displayName: hub.getDisplayName(playerId),
    });
    // 重连：若仍在房间/对局中，补发快照
    hub.resyncPlayer(playerId);
  }

  function requirePlayer(session: ClientSession): string | null {
    if (!session.playerId) {
      send(session.socket, { type: "error", message: "Send hello first" });
      return null;
    }
    return session.playerId;
  }

  function handleResult(
    session: ClientSession,
    result: { ok: true } | { ok: false; error: string },
  ): void {
    if (!result.ok) {
      send(session.socket, { type: "error", message: result.error });
    }
  }

  function handleMessage(session: ClientSession, msg: ClientMessage): void {
    if (msg.type === "hello") {
      if (!msg.playerId || typeof msg.playerId !== "string") {
        send(session.socket, { type: "error", message: "playerId required" });
        return;
      }
      const playerId = sanitizePlayerId(msg.playerId);
      if (!playerId) {
        send(session.socket, { type: "error", message: "Invalid playerId" });
        return;
      }
      bindPlayer(session, playerId, msg.displayName, msg.avatarUrl);
      return;
    }

    if (msg.type === "ping") {
      send(session.socket, { type: "pong", at: Date.now() });
      return;
    }

    const playerId = requirePlayer(session);
    if (!playerId) return;

    switch (msg.type) {
      case "create_room":
        handleResult(
          session,
          hub.createRoomFor(
            playerId,
            msg.ranked ?? false,
            msg.maxPlayers === 3 ? 3 : 4,
          ),
        );
        break;
      case "matchmake":
        handleResult(
          session,
          hub.matchmake(playerId, msg.maxPlayers === 3 ? 3 : 4, msg.ranked ?? true),
        );
        break;
      case "cancel_matchmake":
        handleResult(session, hub.cancelMatchmake(playerId));
        break;
      case "join_room":
        handleResult(session, hub.joinRoomFor(playerId, msg.roomCode));
        break;
      case "leave_room":
        handleResult(session, hub.leaveRoomFor(playerId));
        break;
      case "start_match":
        handleResult(session, hub.startMatch(playerId));
        break;
      case "continue_play":
        handleResult(session, hub.continuePlay(playerId));
        break;
      case "auction_open":
        handleResult(session, hub.auctionOpen(playerId));
        break;
      case "auction_raise":
        handleResult(session, hub.auctionRaise(playerId, msg.raise));
        break;
      case "skip_auction":
        handleResult(session, hub.skipAuction(playerId));
        break;
      case "play":
        handleResult(session, hub.play(playerId, msg.cardIds));
        break;
      case "pass":
        handleResult(session, hub.pass(playerId));
        break;
      case "quick_chat":
        handleResult(session, hub.quickChat(playerId, msg.phraseId));
        break;
      case "yield_lead":
        handleResult(session, hub.yieldLead(playerId));
        break;
      case "use_item":
        handleResult(
          session,
          hub.useItem(playerId, msg.itemId, msg.payload ?? {}),
        );
        break;
      case "decline_item_offer":
        handleResult(session, hub.declineItemOffer(playerId));
        break;
      case "resolve_swap":
        handleResult(session, hub.resolveSwap(playerId, msg.targetId));
        break;
      case "resolve_rps":
        handleResult(session, hub.resolveRpsChoice(playerId, msg.choice));
        break;
      case "resolve_double":
        handleResult(session, hub.resolveScoreDoubleChoice(playerId, msg.choice));
        break;
      case "set_auto_play":
        handleResult(session, hub.setAutoPlay(playerId, msg.enabled));
        break;
      case "resolve_afk_host":
        handleResult(session, hub.resolveAfkHostChoice(playerId, msg.host));
        break;
      case "claim_avatar_unlock":
        handleResult(session, hub.claimAvatarUnlock(playerId, msg.avatarId));
        break;
      case "equip_avatar":
        handleResult(session, hub.equipAvatarFor(playerId, msg.avatarId));
        break;
      case "restore_score":
        handleResult(session, hub.restoreScoreFor(playerId));
        break;
      default:
        send(session.socket, { type: "error", message: "Unknown message type" });
    }
  }

  server.listen(port, () => {
    console.log(
      `[animal-card-auction] http://127.0.0.1:${port}  (${serveDebug ? "debug UI" : "debug UI disabled"})`,
    );
    console.log(`[animal-card-auction] ws://127.0.0.1:${port}${wsPath}  (game protocol)`);
    console.log(`[animal-card-auction] accounts  ${scoreFile}`);
  });

  return {
    port,
    close: () =>
      new Promise((resolve, reject) => {
        clearInterval(tickTimer);
        wss.close();
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}
