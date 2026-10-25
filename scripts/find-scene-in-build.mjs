import fs from "node:fs";
import path from "node:path";

const BASE = path.join(process.cwd(), "client/cocos");
const UUID = "2a745731-feb0-4482-b470-f0ccf8a6e7df";

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
    else out.push(p);
  }
  return out;
}

console.log("=== 1) 文件名/UUID 索引里出现该 scene uuid 的位置 ===");
for (const root of [`${BASE}/build/windows/data`, `${BASE}/build/windows/proj/Release/Resources`]) {
  console.log(`\n--- ${root.replace(BASE + "/", "")} ---`);
  const files = walk(root);
  console.log(`  文件总数: ${files.length}`);
  let hits = 0;
  for (const f of files) {
    if (path.basename(f).startsWith(UUID)) {
      const st = fs.statSync(f);
      console.log(`  NAME-MATCH ${f.replace(root + "/", "")}  ${st.size} B  ${st.mtime.toISOString().slice(0, 19)}`);
      hits += 1;
    }
  }
  // 也看 uuid 是否出现在 config.json / index 之类
  for (const f of files) {
    if (!/\.(json|js)$/.test(f)) continue;
    if (path.basename(f).startsWith(UUID)) continue;
    const st = fs.statSync(f);
    if (st.size > 3_000_000) continue;
    let txt;
    try {
      txt = fs.readFileSync(f, "utf8");
    } catch {
      continue;
    }
    if (txt.includes(UUID) && /settings|config|index/.test(path.basename(f))) {
      const i = txt.indexOf(UUID);
      console.log(`  REF ${f.replace(root + "/", "")}  ...${txt.slice(Math.max(0, i - 60), i + 60).replace(/\n/g, " ")}...`);
      hits += 1;
    }
  }
  if (!hits) console.log("  (无匹配)");
}

console.log("\n=== 2) settings.json 里的 launchScene / 场景列表 ===");
const settings = `${BASE}/build/windows/proj/Release/Resources/src/settings.json`;
if (fs.existsSync(settings)) {
  const j = JSON.parse(fs.readFileSync(settings, "utf8"));
  console.log("  launchScene:", j.launch && j.launch.launchScene);
  const scenes = j.scenes || (j.assets && j.assets.scenes) || [];
  for (const s of scenes) console.log("   -", s.url || s.uuid, s.uuid || "");
} else {
  console.log("  MISSING", settings);
}

console.log("\n=== 3) 构建产物目录时间戳 ===");
for (const p of [
  `${BASE}/build/windows/data/assets/main/import/2a/${UUID}.json`,
  `${BASE}/build/windows/data/src/settings.json`,
  `${BASE}/build/windows/assets/assets/main/index.js`,
  `${BASE}/build/windows/proj/Release/Resources/assets/main/index.js`,
]) {
  if (fs.existsSync(p)) {
    const st = fs.statSync(p);
    console.log(`  ${st.size.toString().padStart(10)} B  ${st.mtime.toISOString().slice(0, 19)}  ${p.replace(BASE + "/", "")}`);
  } else {
    console.log(`  MISSING  ${p.replace(BASE + "/", "")}`);
  }
}
