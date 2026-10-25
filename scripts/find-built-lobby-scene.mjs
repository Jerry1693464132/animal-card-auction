import fs from "node:fs";
import path from "node:path";

const BASE = path.join(process.cwd(), "client/cocos");
const ROOTS = [`${BASE}/build/windows/data`, `${BASE}/build/windows/proj/Release/Resources`];

function walk(dir, out = []) {
  let ents;
  try {
    ents = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of ents) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.json$/.test(e.name)) out.push(p);
  }
  return out;
}

for (const root of ROOTS) {
  console.log(`\n########## ${root.replace(BASE + "/", "")} ##########`);
  let found = 0;
  for (const f of walk(root)) {
    let j;
    try {
      j = JSON.parse(fs.readFileSync(f, "utf8"));
    } catch {
      continue;
    }
    let arr = Array.isArray(j) ? j : null;
    if (!arr && j && typeof j.data === "string") {
      try {
        arr = JSON.parse(Buffer.from(j.data, "base64").toString("utf8"));
      } catch {
        continue;
      }
    }
    if (!Array.isArray(arr)) continue;

    const names = arr.filter((x) => x && x.__type__ === "cc.Node").map((n) => n._name);
    if (!names.includes("RoomCodeInput")) continue;

    const eb = arr.filter((x) => x && x.__type__ === "cc.EditBox");
    console.log(`  ${f.replace(root + "/", "")}`);
    console.log(`    entries=${arr.length}  EditBox=${eb.length}  nodes=${names.length}`);
    if (eb.length) {
      for (const e of eb) {
        const ni = e.node && e.node.__id__;
        console.log(`    !! EditBox -> node=${arr[ni] && arr[ni]._name}`);
      }
    }
    found += 1;
  }
  if (!found) console.log("  (未找到含 RoomCodeInput 的场景)");
}
