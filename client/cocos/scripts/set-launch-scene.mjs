import fs from "node:fs";
import path from "node:path";

const p = path.join(
  process.cwd(),
  "client/cocos/build/windows/proj/Release/Resources/src/settings.json",
);
const backup = p + ".bak";
if (!fs.existsSync(backup)) fs.copyFileSync(p, backup);

const raw = fs.readFileSync(p, "utf8");
const j = JSON.parse(raw);
console.log("before launchScene:", j.launch.launchScene);

const target = process.argv[2] || "DouDizhuLobby";
j.launch.launchScene = `db://assets/scenes/${target}.scene`;
fs.writeFileSync(p, JSON.stringify(j));
console.log("after  launchScene:", j.launch.launchScene);
