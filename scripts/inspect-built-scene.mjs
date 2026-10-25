import fs from "node:fs";
import path from "node:path";

const BASE = path.join(process.cwd(), "client/cocos");
const files = [
  `${BASE}/build/windows/data/assets/main/import/2a/2a745731-feb0-4482-b470-f0ccf8a6e7df.json`,
  `${BASE}/build/windows/proj/Release/Resources/assets/main/import/2a/2a745731-feb0-4482-b470-f0ccf8a6e7df.json`,
];

for (const f of files) {
  console.log("=== " + f.replace(BASE + "/", "") + " ===");
  if (!fs.existsSync(f)) {
    console.log("  MISSING");
    continue;
  }
  const st = fs.statSync(f);
  console.log(`  size=${st.size}  mtime=${st.mtime.toISOString().slice(0, 19)}`);

  let j;
  try {
    j = JSON.parse(fs.readFileSync(f, "utf8"));
  } catch (e) {
    console.log("  parse fail:", e.message);
    continue;
  }
  // 可能是数组，或 {data: base64}
  let arr = Array.isArray(j) ? j : null;
  if (!arr && j && typeof j.data === "string") {
    try {
      arr = JSON.parse(Buffer.from(j.data, "base64").toString("utf8"));
    } catch (e) {
      console.log("  base64 decode fail:", e.message);
    }
  }
  if (!arr) {
    console.log("  keys:", Object.keys(j).join(","));
    continue;
  }
  console.log("  entries:", arr.length);
  const eb = arr.filter((x) => x && x.__type__ === "cc.EditBox");
  console.log("  cc.EditBox count:", eb.length);
  if (eb.length) {
    for (const e of eb) {
      const nodeRef = e.node && e.node.__id__;
      console.log(`    -> node index=${nodeRef} name=${arr[nodeRef] && arr[nodeRef]._name}`);
    }
  }
  const nodes = arr.filter((x) => x && x.__type__ === "cc.Node").map((n) => n._name);
  console.log("  nodes:", nodes.join(","));
}
