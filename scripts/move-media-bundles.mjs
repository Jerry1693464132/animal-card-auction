import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const assets = path.join(root, "client", "cocos", "assets");

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function writeBundleMeta(dir, bundleName, priority) {
  const metaPath = `${dir}.meta`;
  const existing = fs.existsSync(metaPath) ? JSON.parse(fs.readFileSync(metaPath, "utf8")) : null;
  const uuid = existing?.uuid ?? randomUUID();
  const meta = {
    ver: "1.2.0",
    importer: "directory",
    imported: true,
    uuid,
    files: [],
    subMetas: {},
    userData: {
      isBundle: true,
      bundleName,
      priority,
    },
  };
  fs.writeFileSync(metaPath, `${JSON.stringify(meta, null, 2)}\n`, "utf8");
}

function moveTree(fromDir, toDir) {
  if (!fs.existsSync(fromDir)) return false;
  ensureDir(path.dirname(toDir));
  if (fs.existsSync(toDir)) {
    fs.rmSync(toDir, { recursive: true, force: true });
  }
  fs.renameSync(fromDir, toDir);
  const fromMeta = `${fromDir}.meta`;
  const toMeta = `${toDir}.meta`;
  if (fs.existsSync(fromMeta)) fs.rmSync(fromMeta, { force: true });
  if (fs.existsSync(toMeta)) fs.rmSync(toMeta, { force: true });
  return true;
}

const moves = [
  ["resources/sfx", "sfx", 7],
  ["resources/music", "music", 6],
];

for (const [relFrom, bundleName, priority] of moves) {
  const fromDir = path.join(assets, ...relFrom.split("/"));
  const toDir = path.join(assets, bundleName);
  const moved = moveTree(fromDir, toDir);
  writeBundleMeta(toDir, bundleName, priority);
  console.log(moved ? `moved ${relFrom} -> ${bundleName}` : `configured existing ${bundleName}`);
}
