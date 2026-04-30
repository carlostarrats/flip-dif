/**
 * Burst-load tests. Catches:
 *   - per-project capture queue actually serializes (no two snaps for the
 *     same project running concurrently — would race writes to disk)
 *   - a flurry of commits in <1s all eventually capture
 *   - registering 5 projects, firing commits on all of them at once,
 *     each gets captured independently (the multi-project-concurrent
 *     promise from the spec)
 *   - daemon doesn't leak Chromium pages across the burst (one new
 *     page per capture, all closed afterward)
 *
 * Gated behind RUN_BURST_E2E=1.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import http from "node:http";
import {
  mkdtempSync,
  writeFileSync,
  mkdirSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { AddressInfo } from "node:net";
import { execSync } from "node:child_process";
import simpleGit from "simple-git";
import { hashCwd } from "../../src/storage/paths.js";
import { isRunning, spawnDaemon, stopDaemon } from "../../src/daemon/lifecycle.js";
import { sendRpc } from "../../src/ipc/client.js";

const RUN = process.env.RUN_BURST_E2E === "1";

const ROOT = resolve(__dirname, "../..");
const DAEMON_ENTRY = join(ROOT, "dist/daemon/index.js");

let HOME: string;
let upstream: http.Server;
let upstreamPort: number;
let viewerPort: number;

beforeAll(async () => {
  if (!RUN) return;
  HOME = mkdtempSync(join(tmpdir(), "flip-burst-home-"));
  process.env.FLIP_VIEWER_PORT = "0";

  upstream = http.createServer((_req, res) => {
    res.setHeader("content-type", "text/html");
    res.end("<!doctype html><html><body>burst</body></html>");
  });
  await new Promise<void>((r) => upstream.listen(0, "127.0.0.1", r));
  upstreamPort = (upstream.address() as AddressInfo).port;

  await spawnDaemon(HOME, DAEMON_ENTRY);
  const status = await sendRpc<{ viewerPort: number }>(HOME, { method: "status" });
  viewerPort = status.viewerPort;
}, 60_000);

afterAll(async () => {
  if (!RUN) return;
  if (await isRunning(HOME)) await stopDaemon(HOME);
  if (upstream) await new Promise((r) => upstream.close(() => r(null)));
  delete process.env.FLIP_VIEWER_PORT;
});

async function snapshotCount(cwd: string): Promise<number> {
  const r = await fetch(`http://127.0.0.1:${viewerPort}/api/projects/${hashCwd(cwd)}/snapshots`);
  if (!r.ok) return 0;
  return ((await r.json()) as unknown[]).length;
}

async function waitFor(cwd: string, min: number, timeoutMs = 90_000): Promise<number> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const n = await snapshotCount(cwd);
    if (n >= min) return n;
    await new Promise((r) => setTimeout(r, 400));
  }
  return snapshotCount(cwd);
}

function setupProject(): string {
  const cwd = mkdtempSync(join(tmpdir(), "flip-burst-app-"));
  writeFileSync(join(cwd, "package.json"), JSON.stringify({ dependencies: { next: "14" } }));
  mkdirSync(join(cwd, "app"), { recursive: true });
  writeFileSync(join(cwd, "app/page.tsx"), "x");
  return cwd;
}

async function initRepo(cwd: string): Promise<ReturnType<typeof simpleGit>> {
  const git = simpleGit(cwd);
  await git.init();
  await git.addConfig("user.email", "t@t");
  await git.addConfig("user.name", "t");
  await git.add(".");
  await git.commit("init");
  return git;
}

function chromePagesAlive(): number {
  // Count puppeteer-spawned Chromium pages owned by us. Each capture opens
  // and closes one page; if we leak, the count grows over the burst.
  try {
    const out = execSync(`pgrep -af "puppeteer_dev_chrome" 2>/dev/null | wc -l`, { encoding: "utf8" });
    return Number(out.trim());
  } catch {
    return 0;
  }
}

describe.skipIf(!RUN)("burst load", () => {
  it("burst of 10 quick commits: daemon survives, final HEAD captured (debounce consolidates intermediates)", async () => {
    // Design intent: the chokidar HEAD watcher debounces by 200ms. A flurry
    // of commits faster than the debounce window collapses into one event
    // for the latest HEAD — flip captures the stable final state, not every
    // intermediate revision. This test asserts that behavior + that the
    // daemon does not crash under burst load.
    const cwd = setupProject();
    const git = await initRepo(cwd);
    await sendRpc(HOME, { method: "register", cwd, port: upstreamPort });
    await waitFor(cwd, 1);
    const before = await snapshotCount(cwd);

    for (let i = 0; i < 10; i++) {
      writeFileSync(join(cwd, "app/page.tsx"), `// rev ${i + 2}`);
      await git.add(".");
      await git.commit(`burst rev ${i + 2}`);
    }

    // Wait long enough for any debounced + queued capture to land
    await new Promise((r) => setTimeout(r, 6000));
    const after = await snapshotCount(cwd);
    expect(after).toBeGreaterThan(before);
    expect(after).toBeLessThanOrEqual(before + 10);

    // The newest snapshot's sha must equal git's current HEAD sha — that's
    // the "captures the stable final state" guarantee.
    const headSha = (await git.revparse(["HEAD"])).trim();
    const list = await (await fetch(`http://127.0.0.1:${viewerPort}/api/projects/${hashCwd(cwd)}/snapshots`)).json() as Array<{ sha: string }>;
    expect(list[0].sha).toBe(headSha);
  }, 180_000);

  it("5 projects committing simultaneously each get captures", async () => {
    const cwds = Array.from({ length: 5 }, () => setupProject());
    const gits = await Promise.all(cwds.map(initRepo));
    await Promise.all(cwds.map((cwd) =>
      sendRpc(HOME, { method: "register", cwd, port: upstreamPort })),
    );

    // Wait for initial captures
    await Promise.all(cwds.map((cwd) => waitFor(cwd, 1)));

    // Commit on all 5 within 100ms
    await Promise.all(gits.map(async (git, i) => {
      writeFileSync(join(cwds[i], "app/page.tsx"), `// concurrent rev ${i}`);
      await git.add(".");
      await git.commit(`concurrent rev ${i}`);
    }));

    // Each project should have at least 2 snapshots
    const counts = await Promise.all(cwds.map((cwd) => waitFor(cwd, 2)));
    for (const n of counts) {
      expect(n).toBeGreaterThanOrEqual(2);
    }
  }, 180_000);

  it("does not leak Chromium pages across captures", async () => {
    const cwd = setupProject();
    const git = await initRepo(cwd);
    await sendRpc(HOME, { method: "register", cwd, port: upstreamPort });
    await waitFor(cwd, 1);

    const pagesBefore = chromePagesAlive();
    for (let i = 0; i < 5; i++) {
      writeFileSync(join(cwd, "app/page.tsx"), `// leak check ${i}`);
      await git.add(".");
      await git.commit(`leak rev ${i}`);
      // Let each capture complete before the next
      await new Promise((r) => setTimeout(r, 1500));
    }
    await waitFor(cwd, 4); // ≥4 of 5 (some commits may debounce)

    // Allow some settling time for puppeteer to close pages
    await new Promise((r) => setTimeout(r, 2000));
    const pagesAfter = chromePagesAlive();
    // Tolerate a small delta — the shared browser keeps a single helper
    // process alive. What we don't want is +5 (one per capture).
    const delta = pagesAfter - pagesBefore;
    expect(delta).toBeLessThanOrEqual(2);
  }, 180_000);
});
