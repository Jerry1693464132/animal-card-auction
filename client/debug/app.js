const $ = (id) => document.getElementById(id);

const state = {
  ws: null,
  playerId: null,
  room: null,
  match: null,
  selected: new Set(),
  score: null,
  skillHit: "",
  skillHitUntil: 0,
};

const defaultWs = () => {
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  const host = location.hostname || "127.0.0.1";
  const port = location.port || "8787";
  return `${proto}//${host}:${port}/ws`;
};

$("wsUrl").value = defaultWs();
const storedId = sessionStorage.getItem("party-cards.playerId");
const storedName = sessionStorage.getItem("party-cards.displayName");
if (storedId) {
  $("playerId").value = storedId;
  $("displayName").value = storedName || `玩家${storedId.slice(1, 6)}`;
} else {
  $("playerId").value = `u${Math.floor(Math.random() * 1_000_000).toString(36).padStart(5, "0")}`.slice(0, 32);
  $("displayName").value = `玩家${$("playerId").value.slice(1, 6)}`;
}

function log(line, cls = "") {
  const el = $("rawLog");
  const t = new Date().toLocaleTimeString();
  el.textContent = `[${t}] ${line}\n` + el.textContent;
}

function setConn(text, mode) {
  const el = $("connStatus");
  el.textContent = text;
  el.className = "status" + (mode ? ` ${mode}` : "");
}

function send(msg) {
  if (!state.ws || state.ws.readyState !== WebSocket.OPEN) {
    log("未连接，无法发送");
    return;
  }
  state.ws.send(JSON.stringify(msg));
  log(`→ ${msg.type} ${JSON.stringify(msg)}`);
}

function cardLabel(card) {
  if (!card) return "?";
  if (card.kind === "first_play") return "先手";
  if (card.kind === "star") return "★星";
  if (card.kind === "bomb_card") return "💣炸";
  const rank = card.rank;
  const map = {
    11: "J",
    12: "Q",
    13: "K",
    20: "A",
    21: "2",
    22: "小王",
    23: "大王",
  };
  const name = map[rank] ?? String(rank);
  const suit = { S: "♠", H: "♥", C: "♣", D: "♦" }[card.suit] ?? "";
  return `${suit}${name}`;
}

function cardClass(card) {
  let c = "card";
  if (state.selected.has(card.id)) c += " selected";
  if (card.kind === "star") c += " star";
  if (card.kind === "bomb_card") c += " bomb";
  if (card.rank === 22 || card.rank === 23) c += " joker";
  return c;
}

function renderHand() {
  const hand = state.match?.hand ?? [];
  const el = $("hand");
  el.innerHTML = "";
  for (const card of hand) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = cardClass(card);
    btn.textContent = cardLabel(card);
    btn.onclick = () => {
      if (state.selected.has(card.id)) state.selected.delete(card.id);
      else state.selected.add(card.id);
      renderHand();
    };
    el.appendChild(btn);
  }
}

function isPassiveSkill(item) {
  return item.trigger === "game_start";
}

function skillBarItems(items) {
  return items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => {
      const pa = isPassiveSkill(a.item) ? 1 : 0;
      const pb = isPassiveSkill(b.item) ? 1 : 0;
      return pa - pb || a.index - b.index;
    })
    .map((entry) => entry.item);
}

function renderItems() {
  const items = skillBarItems(state.match?.items ?? []);
  const el = $("items");
  el.innerHTML = "";
  if (!items.length) {
    el.textContent = "无";
    return;
  }
  for (const item of items) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `item ${item.rarity}`;
    btn.textContent = `${item.name} ×${item.remainingUses}`;
    btn.title = item.description ?? item.name;
    btn.onclick = () => {
      if (item.trigger === "game_start") {
        window.alert(`${item.name}\n\n${item.description ?? "被动技能，开局已生效"}`);
        return;
      }
      const max = Math.max(1, item.maxUses ?? item.remainingUses ?? 1);
      const used = Math.max(0, max - (item.remainingUses ?? 0));
      const status = used <= 0 ? "未使用" : max > 1 ? `已使用 ${used} 次` : "已使用";
      window.alert(`${item.name}\n${status}\n\n${item.description ?? ""}`);
    };
    el.appendChild(btn);
  }
}

const TARGET_OFFER_ITEMS = new Set(["rare_steal_one", "legendary_force_trade", "epic_big_trade"]);
const CHOICE_OFFER_ITEMS = new Set([...TARGET_OFFER_ITEMS, "epic_control"]);
const SEAT_ANIMAL_CN = ["熊猫", "猫头鹰", "狐狸", "兔子"];
const QUICK_CHAT_CN = {
  "just-this": "就这啊",
  "easy-win": "这把随便赢咯",
  "be-friends": "哥们，交个朋友呗",
  "cant-afford-wrong": "错不起，我对了",
  "kidding-bro": "搞笑呢兄弟",
};
const HAND_TYPE_CN = {
  first_play: "先手",
  single: "单张",
  pair: "对子",
  triple: "三张",
  triple_with_single: "三带一",
  triple_with_pair: "三带对",
  straight: "顺子",
  consecutive_pairs: "连对",
  airplane: "飞机",
  airplane_with_singles: "飞机带单",
  airplane_with_pairs: "飞机带对",
  four_with_two_singles: "四带二",
  four_with_two_pairs: "四带两对",
  bomb: "炸弹",
  rocket: "火箭",
};
let pickingOfferTarget = null;

function animalNameForPlayer(playerId) {
  const ids = state.match?.public?.seatOrder ?? state.room?.playerIds ?? [];
  const i = ids.indexOf(playerId);
  if (i < 0) return "";
  return SEAT_ANIMAL_CN[i] ?? "";
}

const ITEM_NAME_CN = {
  legendary_play_something_else: "玩点别的",
  legendary_swap_hands: "换一下",
  legendary_extra_round: "加赛",
  legendary_bomb_defuser: "拆弹专家",
  legendary_force_trade: "强易",
  epic_control: "操控",
  epic_big_trade: "大交易",
  rare_bounce: "打回",
  rare_steal_one: "万一是好牌呢",
  rare_brain_overload: "大脑过载",
};

function skillUsedOnMeLine(events) {
  const me = state.playerId;
  if (!me || !Array.isArray(events)) return "";
  let line = "";
  for (const e of events) {
    if (!e || typeof e !== "object") continue;
    if (e.type === "item_used") {
      if (e.itemId === "rare_steal_one") {
        const card = e.drawnHint || "一张牌";
        const who = animalNameForPlayer(e.playerId) || "有人";
        const target = animalNameForPlayer(e.targetPlayerId) || "对方";
        if (e.playerId === me) line = `你从${target}抽取了${card}`;
        else if (e.targetPlayerId === me) {
          line = `${who}对你使用了技能万一是好牌呢，抽取了你的${card}`;
        }
        continue;
      }
      if (!e.playerId || e.playerId === me) continue;
      if (e.itemId === "epic_control" || e.itemId === "legendary_play_something_else") continue;
      const skill = ITEM_NAME_CN[e.itemId] || "技能";
      const caster = animalNameForPlayer(e.playerId) || "有人";
      if (e.itemId === "rare_brain_overload" || e.itemId === "legendary_extra_round") {
        line = `${caster}对你使用了${skill}`;
        continue;
      }
      if (e.targetPlayerId === me) line = `${caster}对你使用了${skill}`;
    }
    if (e.type === "bomb_defused" && e.bomberId === me) {
      line = `${animalNameForPlayer(e.defuserId) || "有人"}对你使用了拆弹专家`;
    }
    if (e.type === "hands_swapped" && e.targetId === me) {
      line = `${animalNameForPlayer(e.playerId) || "有人"}对你使用了换一下`;
    }
    if (e.type === "extra_round" && e.byPlayerId !== me) {
      line = `${animalNameForPlayer(e.byPlayerId) || "有人"}对你使用了加赛`;
    }
  }
  return line;
}

function eligibleSkillTargets(itemId) {
  const me = state.playerId;
  const pub = state.match?.public;
  const ids = pub?.seatOrder ?? state.room?.playerIds ?? [];
  const finished = new Set((pub?.ranking ?? []).map((r) => r.playerId));
  const counts = pub?.handCounts ?? {};
  const myHand = state.match?.hand?.length ?? 0;
  return ids.filter((id) => {
    if (!id || id === me || finished.has(id)) return false;
    const n = counts[id];
    if (itemId === "rare_steal_one") return n == null || n > 8;
    if (itemId === "legendary_force_trade") return n == null || n > 10;
    if (itemId === "epic_big_trade") return myHand >= 3 && (n == null || n >= 3);
    return true;
  });
}

function renderPending() {
  const pending = state.match?.public?.pending;
  const box = $("pendingBox");
  const actions = $("pendingActions");
  actions.innerHTML = "";
  if (!pending) {
    pickingOfferTarget = null;
    box.textContent = "无";
    return;
  }
  box.textContent = JSON.stringify(pending, null, 2);
  if (pending.expiresAt) {
    const left = Math.max(0, Math.ceil((pending.expiresAt - Date.now()) / 1000));
    box.textContent = `思考剩余 ${left}秒\n` + box.textContent;
  }
  if (pending.kind !== "offer_item" || pending.playerId !== state.playerId) {
    pickingOfferTarget = null;
  } else if (pickingOfferTarget && pickingOfferTarget !== pending.itemId) {
    pickingOfferTarget = null;
  }

  if (pending.kind === "offer_item" && pending.playerId === state.playerId) {
    const needsTarget = TARGET_OFFER_ITEMS.has(pending.itemId);
    const needsChoice = CHOICE_OFFER_ITEMS.has(pending.itemId);
    if (needsTarget && pickingOfferTarget === pending.itemId) {
      for (const id of eligibleSkillTargets(pending.itemId)) {
        const b = document.createElement("button");
        b.textContent = animalNameForPlayer(id);
        b.onclick = () =>
          send({ type: "use_item", itemId: pending.itemId, payload: { targetPlayerId: id } });
        actions.appendChild(b);
      }
    } else if (pending.itemId === "epic_control" && pickingOfferTarget === pending.itemId) {
      for (const [forcedType, text] of [
        ["single", "强制单张"],
        ["pair", "强制对子"],
      ]) {
        const b = document.createElement("button");
        b.textContent = text;
        b.onclick = () =>
          send({ type: "use_item", itemId: pending.itemId, payload: { forcedType } });
        actions.appendChild(b);
      }
    } else {
      const use = document.createElement("button");
      use.textContent = `使用 ${pending.itemId}`;
      use.onclick = () => {
        if (needsChoice) {
          pickingOfferTarget = pending.itemId;
          send({ type: "use_item", itemId: pending.itemId, payload: { confirmUse: true } });
          renderPending();
          return;
        }
        send({ type: "use_item", itemId: pending.itemId, payload: {} });
      };
      actions.appendChild(use);
    }
    const skip = document.createElement("button");
    skip.textContent = "不使用";
    skip.onclick = () => send({ type: "decline_item_offer" });
    actions.appendChild(skip);
  }
  if (pending.kind === "force_trade" && pending.playerId === state.playerId) {
    if (pending.drawnHint) {
      const hint = document.createElement("div");
      hint.textContent = `你抽到的是${pending.drawnHint}`;
      actions.appendChild(hint);
    }
    const ret = document.createElement("button");
    ret.textContent = "交还选中的一张";
    ret.onclick = () => {
      const ids = [...state.selected];
      if (ids.length !== 1) return alert("请先选一张牌交还");
      send({
        type: "use_item",
        itemId: "legendary_force_trade",
        payload: { cardId: ids[0] },
      });
    };
    actions.appendChild(ret);
  }
  if (pending.kind === "swap_hands") {
    const skip = document.createElement("button");
    skip.textContent = "不换";
    skip.onclick = () => send({ type: "resolve_swap", targetId: null });
    actions.appendChild(skip);
    for (const id of state.match?.public?.seatOrder ?? state.room?.playerIds ?? []) {
      if (id === state.playerId) continue;
      const who = animalNameForPlayer(id);
      if (!who) continue;
      const b = document.createElement("button");
      b.textContent = `与${who}换`;
      b.onclick = () => send({ type: "resolve_swap", targetId: id });
      actions.appendChild(b);
    }
  }
  if (pending.kind === "rps") {
    const inDuel =
      pending.challengerId === state.playerId || pending.targetId === state.playerId;
    const mine =
      pending.challengerId === state.playerId
        ? pending.challengerChoice
        : pending.targetId === state.playerId
          ? pending.targetChoice
          : null;
    if (inDuel && pending.phase !== "reveal" && !mine) {
      for (const choice of ["rock", "paper", "scissors"]) {
        const b = document.createElement("button");
        b.textContent = choice === "rock" ? "石头" : choice === "paper" ? "布" : "剪刀";
        b.onclick = () => send({ type: "resolve_rps", choice });
        actions.appendChild(b);
      }
    }
  }
  if (pending.kind === "score_double") {
    const mine = pending.choices?.[state.playerId];
    if (!mine) {
      for (const [choice, text] of [
        ["none", "不加倍"],
        ["double", "加倍"],
        ["super", "超级加倍"],
      ]) {
        const b = document.createElement("button");
        b.textContent = text;
        b.onclick = () => send({ type: "resolve_double", choice });
        actions.appendChild(b);
      }
    }
  }
  if (pending.kind === "afk_host" && pending.playerId === state.playerId) {
    const host = document.createElement("button");
    host.textContent = "进行托管";
    host.onclick = () => send({ type: "resolve_afk_host", host: true });
    actions.appendChild(host);
    const cancel = document.createElement("button");
    cancel.textContent = "取消";
    cancel.onclick = () => send({ type: "resolve_afk_host", host: false });
    actions.appendChild(cancel);
  }
}

function renderMatch() {
  const view = state.match;
  if (!view) {
    $("matchPanel").classList.add("hidden");
    return;
  }
  $("matchPanel").classList.remove("hidden");
  $("matchPublic").textContent = JSON.stringify(view.public, null, 2);
  $("auctionBox").textContent = view.auction
    ? JSON.stringify(view.auction, null, 2)
    : "拍卖已结束或不在拍卖阶段";
  renderHand();
  renderItems();
  renderPending();
  renderTurnClock();
  const pub = view.public;
  const pass = $("btnPass");
  const myTurn = pub?.turnPlayerId === state.playerId && !pub?.pending;
  const restricted =
    myTurn &&
    pub?.freeLead &&
    pub.leadRestriction?.playerId === state.playerId;
  if (pass) {
    pass.hidden = !!(pub?.freeLead && !restricted);
    pass.textContent = restricted ? "移交" : "过牌";
  }
  const autoBtn = $("btnAutoPlay");
  if (autoBtn) {
    const on = !!(pub?.autoPlay && pub.autoPlay[state.playerId]);
    autoBtn.textContent = on ? "取消托管" : "托管";
  }
  if (restricted && pub.leadRestriction) {
    const type = pub.leadRestriction.allowed === "pair" ? "对子" : "单张";
    const caster = animalNameForPlayer(pub.leadRestriction.controllerId) || "有人";
    $("pendingBox").textContent = `${caster}对你使用了操控，请打出${type}牌型或移交领出回合`;
  } else if (myTurn && pub.bounceForbidType) {
    const type = HAND_TYPE_CN[pub.bounceForbidType] || "该牌型";
    const caster = animalNameForPlayer(pub.lastBouncerId) || "有人";
    $("pendingBox").textContent = `${caster}对你使用了打回，请打出不同于${type}的牌型`;
  } else if (
    pub?.pending?.kind === "rps" &&
    pub.pending.targetId === state.playerId &&
    pub.pending.phase !== "reveal"
  ) {
    const caster = animalNameForPlayer(pub.pending.challengerId) || "有人";
    $("pendingBox").textContent = `${caster}对你使用了玩点别的，请出拳`;
  } else if (state.skillHit && Date.now() < state.skillHitUntil) {
    $("pendingBox").textContent = state.skillHit;
  } else if (myTurn && (pub.overloadTurnsLeft ?? 0) > 0) {
    $("pendingBox").textContent = "大脑过载中，思考时间仅 4 秒";
  }
}

function renderTurnClock() {
  const el = $("turnClock");
  if (!el) return;
  const pub = state.match?.public;
  if (!pub || pub.phase !== "playing") {
    el.textContent = "—";
    return;
  }
  const until = pub.pending?.expiresAt ?? pub.turnExpiresAt;
  if (!until) {
    el.textContent = "—";
    return;
  }
  const sec = Math.max(0, (until - Date.now()) / 1000).toFixed(1);
  const who = pub.pending
    ? pub.pending.kind
    : pub.turnPlayerId === state.playerId
      ? "你的回合"
      : `${pub.turnPlayerId} 的回合`;
  el.textContent = `${who} ${sec}s`;
}

function renderRoom() {
  if (!state.room) {
    $("roomInfo").textContent = "尚未进房";
    renderContinueHud();
    return;
  }
  $("roomInfo").textContent = JSON.stringify(state.room, null, 2);
  renderContinueHud();
}

function renderContinueHud() {
  const btn = $("btnContinuePlay");
  if (!btn) return;
  const room = state.room;
  if (!room) {
    btn.textContent = "继续一起游玩";
    return;
  }
  const n = room.maxPlayers === 4 ? 4 : 3;
  const ready = (room.continueReady || []).length;
  btn.textContent = `继续一起游玩 ${ready}/${n}`;
}

function onServer(msg) {
  log(`← ${msg.type}`);
  switch (msg.type) {
    case "welcome":
      state.playerId = msg.playerId;
      $("lobbyPanel").classList.remove("hidden");
      setConn(`已连接 · ${msg.displayName}`, "on");
      break;
    case "room":
      state.room = msg.room;
      renderRoom();
      if (msg.room.phase === "lobby") {
        state.match = null;
        state.selected.clear();
        renderMatch();
      }
      break;
    case "match":
      state.match = msg.view;
      // 清理已不在手牌中的选择
      const ids = new Set((msg.view.hand ?? []).map((c) => c.id));
      for (const id of [...state.selected]) {
        if (!ids.has(id)) state.selected.delete(id);
      }
      renderMatch();
      break;
    case "events":
      $("eventsLog").textContent =
        msg.events.map((e) => JSON.stringify(e)).join("\n") +
        "\n" +
        $("eventsLog").textContent;
      {
        const hit = skillUsedOnMeLine(msg.events);
        if (hit) {
          state.skillHit = hit;
          state.skillHitUntil = Date.now() + 4000;
          renderMatch();
        }
      }
      break;
    case "score":
      state.score = msg;
      $("scoreBadge").textContent = `段位 ${msg.score}`;
      break;
    case "avatar":
      state.avatar = msg.avatar;
      break;
    case "quick_chat": {
      const who = animalNameForPlayer(msg.playerId) || msg.playerId;
      const text = QUICK_CHAT_CN[msg.phraseId] || msg.phraseId;
      $("eventsLog").textContent = `${who}：${text}\n${$("eventsLog").textContent}`;
      break;
    }
    case "settlement":
      $("eventsLog").textContent =
        "SETTLEMENT " +
        JSON.stringify(msg.deltas, null, 2) +
        "\n" +
        $("eventsLog").textContent;
      alert(
        "本局结束\n" +
          msg.deltas
            .map(
              (d) =>
                `第${d.rank}名  ${d.playerId}  ${d.delta > 0 ? "+" : ""}${d.delta}  →  ${d.scoreAfter}`,
            )
            .join("\n"),
      );
      break;
    case "error":
      setConn(`错误: ${msg.message}`, "err");
      log(`ERROR ${msg.message}`);
      break;
    case "pong":
      break;
    default:
      break;
  }
}

$("btnConnect").onclick = () => {
  if (state.ws) {
    state.ws.close();
    state.ws = null;
  }
  const url = $("wsUrl").value.trim();
  const playerId = $("playerId").value.trim();
  const displayName = $("displayName").value.trim();
  if (!playerId) return alert("请填玩家 ID");
  sessionStorage.setItem("party-cards.playerId", playerId);
  sessionStorage.setItem("party-cards.displayName", displayName || playerId);

  setConn("连接中…");
  const ws = new WebSocket(url);
  state.ws = ws;
  ws.onopen = () => {
    setConn("已握手", "on");
    send({ type: "hello", playerId, displayName });
  };
  ws.onmessage = (ev) => {
    try {
      onServer(JSON.parse(ev.data));
    } catch (e) {
      log(`解析失败 ${ev.data}`);
    }
  };
  ws.onclose = () => setConn("已断开", "err");
  ws.onerror = () => setConn("连接失败", "err");
};

$("btnCreate").onclick = () =>
  send({ type: "create_room", ranked: $("ranked").checked, maxPlayers: 4 });
$("btnJoin").onclick = () =>
  send({ type: "join_room", roomCode: $("roomCode").value.trim().toUpperCase() });
$("btnLeave").onclick = () => send({ type: "leave_room" });
$("btnStart").onclick = () => send({ type: "start_match" });
$("btnContinuePlay").onclick = () => send({ type: "continue_play" });
$("btnPlay").onclick = () => {
  const cardIds = [...state.selected];
  if (!cardIds.length) return alert("先选手牌");
  send({ type: "play", cardIds });
};
$("btnPass").onclick = () => {
  const pub = state.match?.public;
  if (
    pub?.freeLead &&
    pub.leadRestriction?.playerId === state.playerId &&
    pub.turnPlayerId === state.playerId
  ) {
    send({ type: "yield_lead" });
    return;
  }
  send({ type: "pass" });
};
$("btnClearSel").onclick = () => {
  state.selected.clear();
  renderHand();
};
$("btnAutoPlay").onclick = () => {
  const on = !!(state.match?.public?.autoPlay && state.match.public.autoPlay[state.playerId]);
  send({ type: "set_auto_play", enabled: !on });
};

document.querySelectorAll("[data-raise]").forEach((btn) => {
  btn.onclick = () => {
    const raise = btn.getAttribute("data-raise");
    send({
      type: "auction_raise",
      raise: raise === "allin" ? "allin" : Number(raise),
    });
  };
});

document.querySelectorAll("[data-quick-chat]").forEach((btn) => {
  btn.onclick = () =>
    send({ type: "quick_chat", phraseId: btn.getAttribute("data-quick-chat") });
});

setInterval(() => {
  renderTurnClock();
  renderContinueHud();
  const pending = state.match?.public?.pending;
  const box = $("pendingBox");
  if (!box || !pending?.expiresAt) return;
  const left = Math.max(0, Math.ceil((pending.expiresAt - Date.now()) / 1000));
  box.textContent = `思考剩余 ${left}秒\n` + JSON.stringify(pending, null, 2);
}, 200);
