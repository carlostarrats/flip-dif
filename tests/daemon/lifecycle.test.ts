import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { isRunning, spawnDaemon, stopDaemon } from "../../src/daemon/lifecycle.js";
import { sendRpc } from "../../src/ipc/client.js";

let HOME: string;
const ROOT = resolve(__dirname, "../..");
const DAEMON_ENTRY = join(ROOT, "dist/daemon/index.js");

beforeEach(() => {
  HOME = mkdtempSync(join(tmpdir(), "flip-life-"));
  // ensure stale daemons don't leak
  process.env.FLIP_VIEWER_PORT = "0";
});

afterEach(async () => {
  if (await isRunning(HOME)) await stopDaemon(HOME);
  delete process.env.FLIP_VIEWER_PORT;
});

describe("daemon lifecycle", () => {
  it("starts, ping works, stops cleanly", async () => {
    expect(await isRunning(HOME)).toBe(false);
    await spawnDaemon(HOME, DAEMON_ENTRY);
    expect(await isRunning(HOME)).toBe(true);
    const r = await sendRpc(HOME, { method: "ping" });
    expect(r).toBe("pong");
    await stopDaemon(HOME);
    expect(await isRunning(HOME)).toBe(false);
  }, 30_000);
});
