import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadDotEnv } from "../../src/server/env.js";

describe("loadDotEnv", () => {
  it("fills missing keys and does not override", () => {
    const file = path.join(os.tmpdir(), `animal-card-auction-env-${Date.now()}.env`);
    fs.writeFileSync(file, "SERVER_SECRET=fromfile\nPORT=8787\n", "utf8");
    const env: NodeJS.ProcessEnv = { SERVER_SECRET: "already" };
    loadDotEnv(env, file);
    expect(env.SERVER_SECRET).toBe("already");
    expect(env.PORT).toBe("8787");
    fs.unlinkSync(file);
  });
});
