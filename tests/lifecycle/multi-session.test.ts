/**
 * Multi-session lifecycle tests. Today every test starts from a clean
 * ~/.flip/. Real users hit the daemon across multiple sessions:
 *   1. start → capture → stop
 *   2. (optionally upgrade) → start again → assert old captures load
 *   3. project + watcher rehydrate from disk
 *
 * The bugs this catches are the kind we hit during user testing:
 * "stale daemon from a different FLIP_HOME holds port 42069", "git
 * watcher doesn't reattach after restart", "old captures vanish".
 *
 * Gated behind RUN_LIFECYCLE_E2E=1 since it spawns real daemons.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import http from "node:http";
import { mkdtempSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { AddressInfo } from "node:net";
import simpleGit from "simple-git";
import { hashCwd } from "../../src/storage/paths.js";
import { isRunning, spawnDaemon, stopDaemon } from "../../src/daemon/lifecycle.js";
import { sendRpc } from "../../src/ipc/client.js";

const RUN = process.env.RUN_LIFECYCLE_E2E === "1";

const ROOT = resolve(__dirname, "../..");
const DAEMON_ENTRY = join(ROOT, "dist/daemon/index.js");

let HOME: string;
let CWD: string;
let upstream: http.Server;
let upstreamPort: number;
let revision = 1;

beforeAll(async () => {
  if (!RUN) return;
  HOME = mkdtempSync(join(tmpdir(), "flip-life-home-"));
  CWD = mkdtempSync(join(tmpdir(), "flip-life-app-"));
  process.env.FLIP_VIEWER_PORT = "0";

  upstream = http.createServer((_req, res) => {
    res.setHeader("content-type", "text/html");
    res.end(`<!doctype html><html><body style="background:${revision === 1 ? "#1976D2" : "#D32F2F"}">rev ${revision}</body></html>`);
  });
  await new Promise<void>((r) => upstream.listen(0, "127.0.0.1", r));
  upstreamPort = (upstream.address() as AddressInfo).port;

  writeFileSync(join(CWD, "package.json"), JSON.stringify({ dependencies: { next: "14" } }));
  mkdirSync(join(CWD, "app"), { recursive: true });
  writeFileSync(join(CWD, "app/page.tsx"), "x");
  const git = simpleGit(CWD);
  await git.init();
  await git.addConfig("user.email", "t@t");
  await git.addConfig("user.name", "t");
  await git.add(".");
  await git.commit("init");
}, 60_000);

afterAll(async () => {
  if (!RUN) return;
  if (await isRunning(HOME)) await stopDaemon(HOME);
  if (upstream) await new Promise((r) => upstream.close(() => r(null)));
  delete process.env.FLIP_VIEWER_PORT;
});

async function viewerPort(): Promise<number> {
  const status = await sendRpc<{ viewerPort: number }>(HOME, { method: "status" });
  return status.viewerPort;
}

async function snapshotCount(): Promise<number> {
  const port = await viewerPort();
  const r = await fetch(`http://127.0.0.1:${port}/api/projects/${hashCwd(CWD)}/snapshots`);
  if (!r.ok) return 0;
  return ((await r.json()) as unknown[]).length;
}

async function waitForSnapshots(min: number, timeoutMs = 60_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await snapshotCount() >= min) return;
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error(`timed out waiting for ${min} snapshots`);
}

describe.skipIf(!RUN)("multi-session lifecycle", () => {
  it("session 1: start daemon, register project, capture initial commit", async () => {
    await spawnDaemon(HOME, DAEMON_ENTRY);
    expect(await isRunning(HOME)).toBe(true);
    await sendRpc(HOME, { method: "register", cwd: CWD, port: upstreamPort });
    await waitForSnapshots(1);
    expect(await snapshotCount()).toBe(1);
  }, 90_000);

  it("session 1 → stop: daemon cleans up; pid file removed", async () => {
    await stopDaemon(HOME);
    expect(await isRunning(HOME)).toBe(false);
    expect(existsSync(join(HOME, ".flip/daemon.pid"))).toBe(false);
    expect(existsSync(join(HOME, ".flip/daemon.sock"))).toBe(false);
    // captures persist on disk
    expect(existsSync(join(HOME, ".flip/projects", hashCwd(CWD), "snapshots"))).toBe(true);
  }, 30_000);

  it("session 2: restart daemon, rehydrate registry on register, captures still readable", async () => {
    await spawnDaemon(HOME, DAEMON_ENTRY);
    expect(await isRunning(HOME)).toBe(true);
    // Re-register the same cwd — daemon's registry is in-memory, so this is
    // how the user gets their watcher back. Should re-attach watcher and not
    // wipe existing captures.
    const r = await sendRpc<{ alreadyRegistered: boolean; watcherAttached: boolean }>(HOME, {
      method: "register", cwd: CWD, port: upstreamPort,
    });
    // Fresh daemon, so this is a fresh registration, not "alreadyRegistered".
    expect(r.alreadyRegistered).toBe(false);
    expect(r.watcherAttached).toBe(true);
    // The 1 capture from session 1 should still be there.
    expect(await snapshotCount()).toBeGreaterThanOrEqual(1);
  }, 30_000);

  it("session 2: new commit fires watcher, capture lands without re-register", async () => {
    revision = 2;
    const before = await snapshotCount();
    const git = simpleGit(CWD);
    writeFileSync(join(CWD, "app/page.tsx"), "y");
    await git.add(".");
    await git.commit("rev 2");
    await waitForSnapshots(before + 1);
    expect(await snapshotCount()).toBe(before + 1);
  }, 60_000);

  it("session 2: re-registering the same cwd is idempotent (no duplicate watcher / capture)", async () => {
    const before = await snapshotCount();
    const r = await sendRpc<{ alreadyRegistered: boolean }>(HOME, {
      method: "register", cwd: CWD, port: upstreamPort,
    });
    expect(r.alreadyRegistered).toBe(true);
    // Wait a moment to let any spurious snap settle, then assert no new capture.
    await new Promise((r) => setTimeout(r, 1500));
    expect(await snapshotCount()).toBe(before);
  }, 30_000);

});
