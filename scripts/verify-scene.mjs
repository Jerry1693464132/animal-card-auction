import fs from "node:fs";
import path from "node:path";

const f = path.join(process.cwd(), "client/cocos/assets/scenes/DouDizhuLobby.scene");
const data = JSON.parse(fs.readFileSync(f, "utf8"));

let editbox = 0;
const refs = [];
(function walk(o) {
  if (Array.isArray(o)) return o.forEach(walk);
  if (o && typeof o === "object") {
    if (o.__type__ === "cc.EditBox") editbox += 1;
    for (const [k, v] of Object.entries(o)) {
      if (k === "__id__" && typeof v === "number") refs.push(v);
      else walk(v);
    }
  }
})(data);

const bad = [...new Set(refs.filter((r) => r < 0 || r >= data.length))];
console.log("JSON 解析: OK");
console.log("条目数:", data.length);
console.log("cc.EditBox 剩余:", editbox);
console.log("__id__ 引用总数:", refs.length);
console.log("越界引用:", bad.length ? bad.join(",") : "无");

// 确认 RoomCodeInput 节点还在，且其 _components 已不含 EditBox
const nodeIdx = data.findIndex((o) => o && o.__type__ === "cc.Node" && o._name === "RoomCodeInput");
if (nodeIdx >= 0) {
  const comps = (data[nodeIdx]._components ?? []).map((c) => data[c.__id__]?.__type__);
  console.log(`RoomCodeInput (index=${nodeIdx}) 组件:`, comps.join(", ") || "(无)");
} else {
  console.log("RoomCodeInput 节点: 不存在");
}

// 列出所有 Node 名字，确认场景结构没被破坏
const nodes = data.filter((o) => o && o.__type__ === "cc.Node").map((n) => n._name);
console.log("场景节点数:", nodes.length);
console.log("包含 JoinField 相关:", nodes.filter((n) => /Join|Room/i.test(n)).join(", ") || "(无)");
