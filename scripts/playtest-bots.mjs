/**
 * 实机试玩陪玩机器人
 *
 * 作用：补满房间座位（三人场补 2 个、四人场补 3 个），
 *       拍卖时适度出价，进入打牌后开启托管（服务端自动代打）。
 *       这样玩家一个人就能走完 大厅 → 拍卖 → 打牌 → 结算。
 *
 * 用法：
 *   node scripts/playtest-bots.mjs                 # 3 人场，12 秒后自动进匹配队列
 *   set PT_SEATS=4 && node scripts/playtest-bots.mjs
 *   set PT_ROOM=ABCD && node scripts/playtest-bots.mjs   # 加入指定房间码（玩家当房主）
 *   set PT_DELAY=5 && node scripts/playtest-bots.mjs     # 改自动入队等待秒数
 *
 * 注意：先让玩家点「匹配」再让机器人入队，房主才是玩家本人（可跳过拍卖）。
 */
import WebSocket from "ws";

const URL = process.env.PT_URL || "ws://127.0.0.1:8787/ws";
const SEATS = Number(process.env.PT_SEATS || 3);
const DELAY_S = Number(process.env.PT_DELAY || 12);
const ROOM = (process.env.PT_ROOM || "").trim().toUpperCase();
const BID_CHANCE = Number(process.env.PT_BID_CHANCE ?? 0.85);

/** 默认补满其余座位：3 人场补 2 个、4 人场补 3 个。自检时可用 PT_BOTS 覆盖。 */
const BOT_COUNT = Number(process.env.PT_BOTS || Math.max(1, SEATS - 1));
const NAME_POOL = ["陪玩·熊猫", "陪玩·猫头鹰", "陪玩·兔子", "陪玩·后备"];
const bots = NAME_POOL.slice(0, BOT_COUNT).map((name, i) => ({
  id: `pt-bot-${String.fromCharCode(97 + i)}`,
  name,
}));

const t = () => new Date().toTimeString().slice(0, 8);
const log = (...a) => console.log(`[${t()}]`, ...a);

let anyMatchStarted = false;
let exitArmed = false;

function pickRaise(currentPrice) {
  if (currentPrice < 12) return 1;
  if (currentPrice < 20) return 5;
  if (currentPrice < 40) return 10;
  return 1;
}

function startBot(bot) {
  const st = {
    ...bot,
    ws: null,
    phase: null,
    autoOn: false,
    auction: null,
    lotSeen: -1,
    lotAt: 0,
    bidDone: false,
    continueSent: false,
    matchNo: 0,
    queued: false,
  };

  const send = (msg) => {
    if (st.ws && st.ws.readyState === WebSocket.OPEN) {
      st.ws.send(JSON.stringify(msg));
    }
  };
  st.send = send;

  const ws = new WebSocket(URL);
  st.ws = ws;

  ws.on("open", () => {
    log(`${st.name} 已连接 ${URL}`);
    send({ type: "hello", playerId: st.id, displayName: st.name });
  });

  ws.on("message", (raw) => {
    let msg;
    try {
      msg = JSON.parse(String(raw));
    } catch {
      return;
    }
    onMessage(st, msg);
  });

  ws.on("close", () => log(`${st.name} 连接关闭`));
  ws.on("error", (e) => log(`${st.name} 连接错误: ${e.message}`));

  setInterval(() => tickBot(st), 500);
  return st;
}

function onMessage(st, msg) {
  switch (msg.type) {
    case "welcome":
      log(`${st.name} 登录成功 (playerId=${msg.playerId})`);
      break;

    case "error":
      log(`${st.name} 服务端提示: ${msg.message}`);
      break;

    case "matchmaking":
      if (msg.status === "queued") log(`${st.name} 已进入匹配队列（${msg.maxPlayers} 人场，队列 ${msg.queueSize}）`);
      break;

    case "room":
      if (!st.queued && !ROOM) {
        // 匹配失败（如积分不足）时的兜底提示
      }
      break;

    case "match": {
      const pub = msg.view?.public;
      if (!pub) return;
      const prev = st.phase;
      st.phase = pub.phase;
      st.auction = msg.view.auction ?? null;

      if (pub.phase === "auction") {
        if (prev !== "auction") {
          st.matchNo += 1;
          st.autoOn = false;
          st.lotSeen = -1;
          st.bidDone = false;
          st.continueSent = false;
          if (!anyMatchStarted) {
            anyMatchStarted = true;
            log(`>>> 对局开始（${pub.seatOrder.length} 人，拍卖 ${st.auction?.totalLots ?? "?"} 件）`);
          }
          st.send({ type: "set_auto_play", enabled: true });
          st.autoOn = true;
          log(`${st.name} 已开启托管（打牌阶段自动代打）`);
        }
        return;
      }

      if (pub.phase === "playing" && !st.autoOn) {
        st.send({ type: "set_auto_play", enabled: true });
        st.autoOn = true;
        log(`${st.name} 进入打牌阶段，开启托管`);
      }

      if (pub.phase === "finished") {
        const rank = pub.ranking.map((r) => `${r.playerId}#${r.rank}`).join(" ");
        log(`${st.name} 收到结算：${rank || "(无)"}`);
      }
      return;
    }

    case "settlement": {
      const line = msg.deltas
        .map((d) => `${d.playerId} ${d.delta >= 0 ? "+" : ""}${d.delta} → ${d.scoreAfter}`)
        .join("  ");
      log(`${st.name} 积分结算: ${line}`);
      if (!st.continueSent) {
        st.continueSent = true;
        setTimeout(() => {
          st.send({ type: "continue_play" });
          log(`${st.name} 已点「继续一起游玩」`);
        }, 6000);
      }
      return;
    }

    default:
      return;
  }
}

function tickBot(st) {
  // 到点自动入队
  if (!st.queued && !ROOM) {
    st.queued = true;
    setTimeout(() => {
      log(`${st.name} 请求匹配 ${SEATS} 人场`);
      st.send({ type: "matchmake", maxPlayers: SEATS, ranked: true });
    }, DELAY_S * 1000);
  }
  if (!st.queued && ROOM) {
    st.queued = true;
    setTimeout(() => {
      log(`${st.name} 请求加入房间 ${ROOM}`);
      st.send({ type: "join_room", roomCode: ROOM });
    }, 1500);
  }

  const a = st.auction;
  if (st.phase !== "auction" || !a || a.phase !== "bidding") return;
  if (a.currentLotIndex !== st.lotSeen) {
    st.lotSeen = a.currentLotIndex;
    st.lotAt = Date.now();
    st.bidDone = Math.random() > BID_CHANCE;
    const item = a.currentItem?.name ?? "?";
    log(`--- 第 ${a.currentLotIndex + 1}/${a.totalLots} 件：${item}（底价 ${a.currentPrice}）`);
    return;
  }
  if (st.bidDone) return;
  if (a.leadingPlayerId === st.id) {
    st.bidDone = true;
    return;
  }
  if (Date.now() - st.lotAt < 1400) return;
  const bal = a.balances?.[st.id] ?? 0;
  const raise = pickRaise(a.currentPrice);
  if (bal < a.currentPrice + raise) {
    st.bidDone = true;
    return;
  }
  st.bidDone = true;
  st.send({ type: "auction_raise", raise });
  log(`${st.name} 出价 +${raise}（现价 ${a.currentPrice + raise}）`);
}

process.on("SIGINT", () => {
  log("收到中断，退出陪玩机器人");
  process.exit(0);
});

log(`启动 ${bots.length} 个陪玩机器人 → ${URL}`);
log(`座位 ${SEATS} 人场${ROOM ? `，加入房间 ${ROOM}` : `，${DELAY_S} 秒后自动匹配`}`);
bots.forEach(startBot);
