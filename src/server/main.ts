import { loadDotEnv } from "./env.js";
import { startGameServer } from "./ws-server.js";

loadDotEnv();
const port = Number(process.env.PORT ?? 8787);
const wsPath = process.env.WS_PATH || "/ws";
const serveDebug = !["0", "false", "off"].includes(
  String(process.env.SERVE_DEBUG ?? "true").toLowerCase(),
);
startGameServer(port, { wsPath, serveDebug });
