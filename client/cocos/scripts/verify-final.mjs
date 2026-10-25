import fs from "node:fs";
import path from "node:path";

const SRC = path.join(process.cwd(), "client/cocos/build/windows/assets/assets/main/index.js");
const DST = path.join(
  process.cwd(),
  "client/cocos/build/windows/proj/Release/Resources/assets/main/index.js",
);

for (const [label, p] of [["build output", SRC], ["Release Resources", DST]]) {
  const src = fs.readFileSync(p, "utf8");
  const st = fs.statSync(p);
  console.log("\n=== " + label);
  console.log("  " + p);
  console.log("  size:", src.length, " mtime:", st.mtime.toISOString());
  console.log("  stripNativeEditBoxes:", src.includes("stripNativeEditBoxes"));
  console.log("  onGlobalKeyDown     :", src.includes("onGlobalKeyDown"));
  console.log("  EditBox string      :", /EditBox/.test(src));
  console.log("  removeComponent     :", src.includes("removeComponent"));
}
