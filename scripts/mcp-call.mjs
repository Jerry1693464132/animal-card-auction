/**
 * 直连 Funplay Cocos MCP（HTTP JSON-RPC），绕过 Cursor 的 MCP 客户端连接问题。
 *
 * 用法：
 *   node scripts/mcp-call.mjs list
 *   node scripts/mcp-call.mjs call <toolName> '<jsonArgs>'
 */
const URL = "http://127.0.0.1:8765/";
let sessionId = null;
let nextId = 1;

async function rpc(method, params, isNotification = false) {
  const body = { jsonrpc: "2.0", method };
  if (!isNotification) body.id = nextId++;
  if (params !== undefined) body.params = params;

  const headers = {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
  };
  if (sessionId) headers["Mcp-Session-Id"] = sessionId;

  const res = await fetch(URL, { method: "POST", headers, body: JSON.stringify(body) });
  const sid = res.headers.get("mcp-session-id");
  if (sid) sessionId = sid;

  const text = await res.text();
  if (!text) return null;

  // 可能是 SSE 格式：event: message\ndata: {...}
  if (text.includes("data:")) {
    const line = text.split("\n").find((l) => l.startsWith("data:"));
    if (!line) return null;
    return JSON.parse(line.slice(5).trim());
  }
  return JSON.parse(text);
}

async function main() {
  const [, , cmd, toolName, argsRaw] = process.argv;

  const init = await rpc("initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "animal-card-auction-cli", version: "1.0.0" },
  });
  if (init?.result?.serverInfo) {
    console.log("[mcp] connected:", init.result.serverInfo.name, init.result.serverInfo.version);
  }
  await rpc("notifications/initialized", {}, true);

  if (cmd === "list") {
    const r = await rpc("tools/list", {});
    const tools = r?.result?.tools ?? [];
    console.log(`\n[mcp] ${tools.length} tools:`);
    for (const t of tools) {
      console.log(`  - ${t.name}`);
      const d = (t.description ?? "").split("\n")[0].slice(0, 110);
      if (d) console.log(`      ${d}`);
    }
    return;
  }

  if (cmd === "call") {
    if (!toolName) throw new Error("toolName required");
    let args = {};
    if (argsRaw) {
      // 支持 --args-file=<path>，避免 shell 转义地狱
      if (argsRaw.startsWith("--args-file=")) {
        const fs = await import("node:fs");
        const p = argsRaw.slice("--args-file=".length);
        args = JSON.parse(fs.readFileSync(p, "utf8"));
      } else {
        args = JSON.parse(argsRaw);
      }
    }
    const r = await rpc("tools/call", { name: toolName, arguments: args });
    if (r?.error) {
      console.error("[mcp] error:", JSON.stringify(r.error, null, 2));
      process.exit(1);
    }
    for (const c of r?.result?.content ?? []) {
      if (c.type === "text") console.log(c.text);
      else console.log(`[${c.type}]`, JSON.stringify(c).slice(0, 500));
    }
    return;
  }

  console.error("usage: node scripts/mcp-call.mjs list | call <tool> '<json>'");
  process.exit(1);
}

main().catch((e) => {
  console.error("[mcp] fatal:", e.message);
  process.exit(1);
});
