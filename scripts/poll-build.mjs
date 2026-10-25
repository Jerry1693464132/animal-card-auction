/**
 * 轮询 Cocos 构建任务状态，直到成功/失败/超时。
 * 用法：node scripts/poll-build.mjs <taskId> [timeoutSec]
 */
const TASK_ID = process.argv[2] || "1790000607341";
const TIMEOUT_S = Number(process.argv[3] || 600);
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
  if (text.includes("data:")) {
    const line = text.split("\n").find((l) => l.startsWith("data:"));
    return line ? JSON.parse(line.slice(5).trim()) : null;
  }
  return JSON.parse(text);
}

const CODE = `const tasks = await Editor.Message.request('builder','query-tasks-info');
const q = (tasks && tasks.queue) || {};
const t = q['${TASK_ID}'];
if (!t) return JSON.stringify({ missing: true, keys: Object.keys(q).slice(-5) });
return JSON.stringify({ id: t.id, state: t.state, stage: t.stage, progress: t.progress, message: (t.message||'').slice(0,600), platform: t.options && t.options.platform });`;

async function queryTask() {
  const r = await rpc("tools/call", {
    name: "execute_javascript",
    arguments: { context: "editor", code: CODE },
  });
  const txt = (r?.result?.content ?? []).map((c) => c.text).join("");
  const m = txt.match(/"data"\s*:\s*"([\s\S]*?)"\s*,\s*"refs"/);
  if (m) return JSON.parse(JSON.parse('"' + m[1].replace(/\\"/g, '\\"') + '"'));
  // fallback: try to find the JSON payload directly
  const i = txt.indexOf("{", txt.indexOf('"data"'));
  if (i >= 0) {
    try {
      return JSON.parse(txt.slice(i).replace(/,\s*"refs"[\s\S]*$/, "").replace(/"\s*\}\s*$/, '" }'));
    } catch {}
  }
  return { raw: txt.slice(0, 500) };
}

async function main() {
  await rpc("initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "poll", version: "1.0.0" },
  });
  await rpc("notifications/initialized", {}, true);

  const t0 = Date.now();
  let last = "";
  for (;;) {
    const st = await queryTask();
    const line = `${st.state ?? "?"} stage=${st.stage ?? "?"} progress=${st.progress ?? "?"}`;
    if (line !== last) {
      console.log(`[poll] ${new Date().toTimeString().slice(0, 8)}  ${line}`);
      last = line;
    }
    if (st.message) console.log(`[poll] message: ${st.message.slice(0, 400)}`);
    if (st.state === "success" || st.state === "failure" || st.missing) {
      console.log(`[poll] FINAL: ${JSON.stringify(st, null, 2)}`);
      process.exit(st.state === "success" ? 0 : 1);
    }
    if ((Date.now() - t0) / 1000 > TIMEOUT_S) {
      console.log("[poll] timeout");
      process.exit(2);
    }
    await new Promise((r) => setTimeout(r, 4000));
  }
}

main().catch((e) => {
  console.error("[poll] fatal:", e.message);
  process.exit(3);
});
