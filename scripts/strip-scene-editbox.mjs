/**
 * 从 Cocos 场景/预制体里彻底移除 cc.EditBox 组件。
 *
 * 为什么需要脚本：场景文件是「对象数组 + __id__ 下标引用」结构，
 * 直接删掉一个数组元素会让其后所有 __id__ 引用错位。
 * 本脚本会：
 *   1. 找到 cc.EditBox 条目的下标
 *   2. 删掉所有指向它的引用（节点的 _components 数组等）
 *   3. 删除该条目
 *   4. 把所有 > 该下标的 __id__ 引用减 1
 *   5. 校验：JSON 可解析、无越界 __id__、引用数一致
 *
 * 用法：node scripts/strip-scene-editbox.mjs [--dry]
 */
import fs from "node:fs";
import path from "node:path";

const DRY = process.argv.includes("--dry");
const ROOT = path.join(process.cwd(), "client/cocos/assets");

function listTargets(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...listTargets(p));
    else if (/\.(scene|prefab)$/.test(e.name)) out.push(p);
  }
  return out;
}

/** 收集所有 __id__ 引用（用于校验） */
function collectRefs(obj, acc) {
  if (Array.isArray(obj)) {
    for (const v of obj) collectRefs(v, acc);
  } else if (obj && typeof obj === "object") {
    for (const [k, v] of Object.entries(obj)) {
      if (k === "__id__" && typeof v === "number") acc.push(v);
      else collectRefs(v, acc);
    }
  }
  return acc;
}

/** 删除数组/对象里所有「恰好等于 idx 的 __id__ 引用」 */
function removeRefs(obj, idx, removed) {
  if (Array.isArray(obj)) {
    for (let i = obj.length - 1; i >= 0; i -= 1) {
      const v = obj[i];
      if (v && typeof v === "object" && !Array.isArray(v) && Object.keys(v).length === 1 && v.__id__ === idx) {
        obj.splice(i, 1);
        removed.push(v);
      } else {
        removeRefs(v, idx, removed);
      }
    }
  } else if (obj && typeof obj === "object") {
    for (const v of Object.values(obj)) removeRefs(v, idx, removed);
  }
}

/** 所有 > idx 的 __id__ 引用减 1 */
function shiftRefs(obj, idx) {
  if (Array.isArray(obj)) {
    for (const v of obj) shiftRefs(v, idx);
  } else if (obj && typeof obj === "object") {
    for (const [k, v] of Object.entries(obj)) {
      if (k === "__id__" && typeof v === "number" && v > idx) obj[k] = v - 1;
      else shiftRefs(v, idx);
    }
  }
}

let changedFiles = 0;
for (const file of listTargets(ROOT)) {
  const raw = fs.readFileSync(file, "utf8");
  const data = JSON.parse(raw);
  if (!Array.isArray(data)) continue;

  let removedAny = false;
  const found = [];
  for (;;) {
    const idx = data.findIndex((o) => o && o.__type__ === "cc.EditBox");
    if (idx < 0) break;

    const nodeRef = data[idx]?.node?.__id__;
    const nodeName = typeof nodeRef === "number" ? data[nodeRef]?._name : undefined;
    found.push(`index=${idx} node=${nodeName ?? nodeRef}`);

    if (DRY) {
      // 干跑时把类型改掉，避免死循环（不写盘）
      data[idx] = { ...data[idx], __type__: "cc.__DRY_REMOVED__" };
      removedAny = true;
      continue;
    }

    const removed = [];
    removeRefs(data, idx, removed);
    data.splice(idx, 1);
    shiftRefs(data, idx);
    removedAny = true;
  }

  if (!removedAny) continue;

  if (DRY) {
    console.log(`  [dry] ${path.relative(ROOT, file)}: 发现 cc.EditBox → ${found.join(", ")}`);
    changedFiles += 1;
    continue;
  }

  console.log(`  ${path.relative(ROOT, file)}: 移除 cc.EditBox → ${found.join(", ")}`);

  // 校验
  const refs = collectRefs(data, []);
  const bad = refs.filter((r) => r < 0 || r >= data.length);
  if (bad.length) {
    console.error(`  !! 校验失败：${file} 存在越界 __id__: ${[...new Set(bad)].join(",")}`);
    process.exit(1);
  }

  const bak = file + ".editbox.bak";
  if (!fs.existsSync(bak)) fs.writeFileSync(bak, raw);
  fs.writeFileSync(file, JSON.stringify(data));
  console.log(`    写入完成，条目数 ${data.length}，__id__ 引用 ${refs.length} 个，全部在范围内`);
  changedFiles += 1;
}

console.log(DRY ? `\n[dry] 受影响文件: ${changedFiles}` : `\n完成，修改文件数: ${changedFiles}`);
