import fs from "node:fs";
import path from "node:path";

const COCOS = path.join(process.cwd(), "client", "cocos");
const ROOTS = [path.join(COCOS, "assets"), path.join(COCOS, "build")];

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
    else if (/\.(scene|prefab|json|js|bin)$/.test(e.name)) out.push(p);
  }
  return out;
}

console.log("=== 扫描 assets + build 中残留的 EditBox ===");
let hits = 0;
for (const root of ROOTS) {
  for (const f of walk(root)) {
    let txt;
    try {
      txt = fs.readFileSync(f, "utf8");
    } catch {
      continue;
    }
    if (txt.includes("cc.EditBox") || /"__type__":"cc\.EditBox"/.test(txt)) {
      const n = (txt.match(/cc\.EditBox/g) || []).length;
      console.log(`  HIT  ${path.relative(COCOS, f)}  x${n}`);
      hits += 1;
    }
  }
}
console.log(hits ? `\n共 ${hits} 个文件仍有 EditBox` : "\n无残留");

console.log("\n=== 场景文件清单（assets/scenes） ===");
const scDir = path.join(COCOS, "assets", "scenes");
for (const e of fs.readdirSync(scDir)) {
  const p = path.join(scDir, e);
  const st = fs.statSync(p);
  console.log(`  ${e.padEnd(24)} ${st.size.toLocaleString().padStart(10)} B  ${st.mtime.toISOString().slice(0, 19)}`);
}
