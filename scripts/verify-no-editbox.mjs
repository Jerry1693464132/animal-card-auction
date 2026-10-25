import fs from "node:fs";
import path from "node:path";

const BASE = path.join(process.cwd(), "client/cocos");
const FILES = [
  `${BASE}/build/windows/data/assets/main/import/2a/2a745731-feb0-4482-b470-f0ccf8a6e7df.json`,
  `${BASE}/build/windows/proj/Release/Resources/assets/main/import/2a/2a745731-feb0-4482-b470-f0ccf8a6e7df.json`,
];

for (const F of FILES) {
  console.log("\n=== " + path.relative(BASE, F) + " ===");
  if (!fs.existsSync(F)) {
    console.log("  MISSING");
    continue;
  }
  const st = fs.statSync(F);
  console.log(`  size=${st.size} B  mtime=${st.mtime.toISOString().slice(0, 19)}`);

  const top = JSON.parse(fs.readFileSync(F, "utf8"));
  const typeDefs = top[3];
  const instances = top[4];
  const ebIdx = typeDefs.findIndex((d) => d[0] === "cc.EditBox");
  const ebInstances = instances.filter((i) => Array.isArray(i) && i[0] === ebIdx).length;
  console.log(`  typeDefs=${typeDefs.length}  instances=${instances.length}`);
  console.log(`  cc.EditBox type index = ${ebIdx}   instances = ${ebInstances}`);
  console.log(`  >>> ${ebIdx < 0 && ebInstances === 0 ? "PASS: 无 EditBox" : "FAIL: 仍含 EditBox"}`);

  // 确认 RoomCodeInput 节点仍在
  const nodeNames = instances.filter((i) => Array.isArray(i) && i[1] && typeof i[1] === "string").map((i) => i[1]);
  console.log(`  RoomCodeInput 节点存在: ${nodeNames.includes("RoomCodeInput")}`);
}

console.log("\n=== 关键产物时间戳 ===");
for (const p of [
  `${BASE}/build/windows/proj/Release/windows.exe`,
  `${BASE}/build/windows/assets/assets/main/index.js`,
  `${BASE}/build/windows/proj/Release/Resources/assets/main/index.js`,
]) {
  if (fs.existsSync(p)) {
    const s = fs.statSync(p);
    console.log(`  ${s.size.toString().padStart(10)} B  ${s.mtime.toISOString().slice(0, 19)}  ${p.replace(BASE + "/", "")}`);
  } else console.log(`  MISSING  ${p.replace(BASE + "/", "")}`);
}
