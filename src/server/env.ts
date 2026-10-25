import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** 读取仓库根 .env（不覆盖已有环境变量；密钥勿提交） */
export function loadDotEnv(
  env: NodeJS.ProcessEnv = process.env,
  filePath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../.env"),
): void {
  if (!fs.existsSync(filePath)) return;
  const text = fs.readFileSync(filePath, "utf8");
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    if (env[key] === undefined) env[key] = value;
  }
}
