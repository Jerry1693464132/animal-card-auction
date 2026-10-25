import fs from "node:fs";
import path from "node:path";

const F = path.join(
  process.cwd(),
  "client/cocos/build/windows/proj/Release/Resources/assets/main/import/2a/2a745731-feb0-4482-b470-f0ccf8a6e7df.json",
);
const txt = fs.readFileSync(F, "utf8");
for (const k of ["RoomCodeInput", "BtnSubmitJoin", "PanelJoin", "BtnMatch", "PanelSeats", "cc.EditBox", "EditBox"]) {
  const n = (txt.match(new RegExp(k.replace(".", "\\."), "g")) || []).length;
  console.log(`  ${k.padEnd(16)} x${n}`);
}
const top = JSON.parse(txt);
// 节点名在实例数组里（第 4 项），直接扫
const names = [];
(function walk(o) {
  if (Array.isArray(o)) {
    if (typeof o[1] === "string" && typeof o[0] === "number" && o.length >= 4) names.push(o[1]);
    o.forEach(walk);
  } else if (o && typeof o === "object") Object.values(o).forEach(walk);
})(top);
console.log("\n识别到的节点名:", [...new Set(names)].join(", "));
