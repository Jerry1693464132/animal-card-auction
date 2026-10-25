import fs from "node:fs";
import path from "node:path";

const F = path.join(
  process.cwd(),
  "client/cocos/build/windows/data/assets/main/import/2a/2a745731-feb0-4482-b470-f0ccf8a6e7df.json",
);
const top = JSON.parse(fs.readFileSync(F, "utf8"));

console.log("top-level length:", top.length);
const typeDefs = top[3];
const instances = top[4];
console.log("typeDefs:", typeDefs.length, "  instances:", instances.length);

console.log("\n--- typeDefs (index -> class) ---");
typeDefs.forEach((d, i) => console.log(`  ${String(i).padStart(2)}  ${d[0]}`));

const ebIdx = typeDefs.findIndex((d) => d[0] === "cc.EditBox");
console.log("\n>>> cc.EditBox type index:", ebIdx);

const byType = {};
for (const inst of instances) {
  if (Array.isArray(inst)) byType[inst[0]] = (byType[inst[0]] || 0) + 1;
}
console.log("\n--- instance count per type ---");
for (const [t, n] of Object.entries(byType)) {
  const nm = (typeDefs[t] && typeDefs[t][0]) || "?";
  const flag = Number(t) === ebIdx ? "   <<< EditBox" : "";
  console.log(`  type ${String(t).padStart(2)}  ${nm.padEnd(28)} x${n}${flag}`);
}

console.log("\n--- instances whose type == cc.EditBox ---");
let found = 0;
instances.forEach((inst, i) => {
  if (Array.isArray(inst) && inst[0] === ebIdx) {
    console.log(`  instances[${i}] =`, JSON.stringify(inst));
    found += 1;
  }
});
console.log(found ? `  >>> 共 ${found} 个 EditBox 实例` : "  (无)");

console.log("\n--- RoomCodeInput 节点 ---");
instances.forEach((inst, i) => {
  if (Array.isArray(inst) && inst[1] === "RoomCodeInput") {
    console.log(`  instances[${i}] =`, JSON.stringify(inst));
    const comps = inst[3];
    if (Array.isArray(comps)) {
      comps.forEach((c) => {
        if (Array.isArray(c) && typeof c[0] === "number") {
          const t = typeDefs[c[0]];
          console.log(`    component ref[0]=${c[0]} -> ${t ? t[0] : "?"}   raw=${JSON.stringify(c)}`);
        }
      });
    }
  }
});

console.log("\n--- instances[15] (RoomCodeInput 里引用的下标) ---");
console.log(" ", JSON.stringify(instances[15]));
if (Array.isArray(instances[15])) {
  console.log("  -> type:", (typeDefs[instances[15][0]] || [])[0]);
}
