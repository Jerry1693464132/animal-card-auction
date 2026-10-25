/**
 * Free a TCP port on Windows/macOS/Linux (best-effort).
 * Usage: node scripts/free-port.mjs [port]
 */
import { execSync } from "node:child_process";

const port = Number(process.argv[2] ?? process.env.PORT ?? 8787);

function freePort(p) {
  if (process.platform === "win32") {
    try {
      const out = execSync(
        `powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort ${p} -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique"`,
        { encoding: "utf8" },
      );
      const pids = [
        ...new Set(
          out
            .split(/\r?\n/)
            .map((s) => s.trim())
            .filter((s) => /^\d+$/.test(s)),
        ),
      ];
      for (const pid of pids) {
        try {
          execSync(`taskkill /PID ${pid} /F`, { stdio: "ignore" });
          console.log(`[free-port] killed PID ${pid} on :${p}`);
        } catch {
          /* ignore */
        }
      }
      if (pids.length === 0) console.log(`[free-port] :${p} already free`);
    } catch {
      console.log(`[free-port] :${p} already free (or no permission)`);
    }
    return;
  }

  try {
    const out = execSync(`lsof -ti tcp:${p}`, { encoding: "utf8" });
    for (const pid of out.split(/\n/).filter(Boolean)) {
      try {
        execSync(`kill -9 ${pid}`, { stdio: "ignore" });
        console.log(`[free-port] killed PID ${pid} on :${p}`);
      } catch {
        /* ignore */
      }
    }
  } catch {
    console.log(`[free-port] :${p} already free`);
  }
}

freePort(port);
