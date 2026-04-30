/**
 * Framework integration tests. Today every framework test uses minimal
 * synthetic fixtures (one-line package.json + empty page.tsx). Real
 * projects have nested route groups, dynamic segments mixed with
 * static, layouts, not-found.tsx, and so on — places where flip's
 * route detection might misfire.
 *
 * This suite scaffolds a more realistic Next.js App Router structure
 * on disk and asserts that flip captures the right routes when files
 * change.
 *
 * Gated behind RUN_FRAMEWORK_E2E=1.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import http from "node:http";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { AddressInfo } from "node:net";
import simpleGit from "simple-git";
import { hashCwd } from "../../src/storage/paths.js";
import { isRunning, spawnDaemon, stopDaemon } from "../../src/daemon/lifecycle.js";
import { sendRpc } from "../../src/ipc/client.js";
import { listSnapshots } from "../../src/storage/snapshots.js";

const RUN = process.env.RUN_FRAMEWORK_E2E === "1";

const ROOT = resolve(__dirname, "../..");
const DAEMON_ENTRY = join(ROOT, "dist/daemon/index.js");

let HOME: string;
let upstream: http.Server;
let upstreamPort: number;

beforeAll(async () => {
  if (!RUN) return;
  HOME = mkdtempSync(join(tmpdir(), "flip-fw-home-"));
  process.env.FLIP_VIEWER_PORT = "0";

  // Upstream that responds to any path with simple HTML — flip's capture
  // doesn't care about the contents, only whether routes are detected
  // and captures land under the right shas.
  upstream = http.createServer((req, res) => {
    res.setHeader("content-type", "text/html");
    res.end(`<html><body><h1>${req.url}</h1></body></html>`);
  });
  await new Promise<void>((r) => upstream.listen(0, "127.0.0.1", r));
  upstreamPort = (upstream.address() as AddressInfo).port;

  await spawnDaemon(HOME, DAEMON_ENTRY);
}, 60_000);

afterAll(async () => {
  if (!RUN) return;
  if (await isRunning(HOME)) await stopDaemon(HOME);
  if (upstream) await new Promise((r) => upstream.close(() => r(null)));
  delete process.env.FLIP_VIEWER_PORT;
});

async function snaps(cwd: string): Promise<ReturnType<typeof listSnapshots>> {
  return listSnapshots(HOME, cwd);
}

async function waitFor(cwd: string, min: number, timeoutMs = 60_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if ((await snaps(cwd)).length >= min) return;
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error(`timed out waiting for ${min} snapshots`);
}

function writeFiles(cwd: string, files: Record<string, string>): void {
  for (const [path, content] of Object.entries(files)) {
    const full = join(cwd, path);
    mkdirSync(resolve(full, ".."), { recursive: true });
    writeFileSync(full, content);
  }
}

function setupNextApp(): string {
  const cwd = mkdtempSync(join(tmpdir(), "flip-fw-app-"));
  writeFiles(cwd, {
    "package.json": JSON.stringify({
      name: "fixture",
      dependencies: { next: "14.0.0", react: "18.0.0", "react-dom": "18.0.0" },
    }),
    // Realistic Next.js App Router structure with route groups, layouts,
    // dynamic segments, and conventional special files. Tests that flip
    // ignores layout/loading/error files and dynamic segments while
    // catching real page.tsx files.
    "app/layout.tsx": "export default function L({children}){return <html><body>{children}</body></html>}",
    "app/page.tsx": "export default function P(){return null}",
    "app/about/page.tsx": "export default function P(){return null}",
    "app/dashboard/page.tsx": "export default function P(){return null}",
    "app/dashboard/loading.tsx": "export default function L(){return null}",
    "app/dashboard/layout.tsx": "export default function L({children}){return <>{children}</>}",
    "app/(marketing)/pricing/page.tsx": "export default function P(){return null}", // route group
    "app/products/[id]/page.tsx": "export default function P(){return null}",        // dynamic — should skip
    "app/blog/[...slug]/page.tsx": "export default function P(){return null}",       // catch-all — should skip
    "app/not-found.tsx": "export default function NF(){return null}",
    "components/Header.tsx": "export default function H(){return null}",
  });
  return cwd;
}

async function commit(cwd: string, message: string): Promise<void> {
  const git = simpleGit(cwd);
  await git.add(".");
  await git.commit(message);
}

describe.skipIf(!RUN)("realistic Next.js App Router", () => {
  it("initial commit captures only static page routes (skips dynamic + layouts)", async () => {
    const cwd = setupNextApp();
    const git = simpleGit(cwd);
    await git.init();
    await git.addConfig("user.email", "t@t");
    await git.addConfig("user.name", "t");
    await commit(cwd, "init");

    await sendRpc(HOME, { method: "register", cwd, port: upstreamPort });
    await waitFor(cwd, 1);

    const all = await snaps(cwd);
    expect(all.length).toBeGreaterThanOrEqual(1);
    const initialSnap = all[all.length - 1]; // oldest
    const routes = initialSnap.captures.map((c) => c.route).sort();
    // Should include: /, /about, /dashboard, /pricing
    // Should NOT include dynamic [id], [...slug], or non-page files.
    expect(routes).toContain("/");
    expect(routes).toContain("/about");
    expect(routes).toContain("/dashboard");
    expect(routes).toContain("/pricing");
    expect(routes.find((r) => r.includes("[") || r.includes("..."))).toBeUndefined();
  }, 120_000);

  it("changing only a dynamic-route file triggers no capture", async () => {
    const cwd = setupNextApp();
    const git = simpleGit(cwd);
    await git.init();
    await git.addConfig("user.email", "t@t");
    await git.addConfig("user.name", "t");
    await commit(cwd, "init");
    await sendRpc(HOME, { method: "register", cwd, port: upstreamPort });
    await waitFor(cwd, 1);
    const before = (await snaps(cwd)).length;

    // Modify only the dynamic route
    writeFileSync(join(cwd, "app/products/[id]/page.tsx"), "export default function P(){return null}//v2");
    await commit(cwd, "tweak dynamic");

    // Wait a few seconds, expect no new capture (since only dynamic-route files changed)
    await new Promise((r) => setTimeout(r, 6000));
    const after = (await snaps(cwd)).length;
    expect(after).toBe(before);
  }, 90_000);

  it("changing only a layout/loading file produces no route captures", async () => {
    const cwd = setupNextApp();
    const git = simpleGit(cwd);
    await git.init();
    await git.addConfig("user.email", "t@t");
    await git.addConfig("user.name", "t");
    await commit(cwd, "init");
    await sendRpc(HOME, { method: "register", cwd, port: upstreamPort });
    await waitFor(cwd, 1);
    const before = (await snaps(cwd)).length;

    writeFileSync(join(cwd, "app/dashboard/layout.tsx"), "export default function L({children}){return <main>{children}</main>}");
    await commit(cwd, "tweak layout");

    await new Promise((r) => setTimeout(r, 6000));
    expect((await snaps(cwd)).length).toBe(before);
  }, 90_000);

  it("changing a single page.tsx captures only that route", async () => {
    const cwd = setupNextApp();
    const git = simpleGit(cwd);
    await git.init();
    await git.addConfig("user.email", "t@t");
    await git.addConfig("user.name", "t");
    await commit(cwd, "init");
    await sendRpc(HOME, { method: "register", cwd, port: upstreamPort });
    await waitFor(cwd, 1);
    const before = (await snaps(cwd)).length;

    writeFileSync(join(cwd, "app/about/page.tsx"), "export default function P(){return null}//edit");
    await commit(cwd, "tweak about");
    await waitFor(cwd, before + 1);

    // Look up the specific sha rather than relying on timestamp sort —
    // when commits happen within the same second, the newest-first sort
    // can be unstable.
    const newSha = (await git.revparse(["HEAD"])).trim();
    const list = await snaps(cwd);
    const target = list.find((s) => s.sha === newSha);
    expect(target).toBeTruthy();
    const routes = target!.captures.map((c) => c.route);
    expect(routes).toEqual(["/about"]);
  }, 90_000);

  it("route group (parens) still maps to the URL without the group name", async () => {
    const cwd = setupNextApp();
    const git = simpleGit(cwd);
    await git.init();
    await git.addConfig("user.email", "t@t");
    await git.addConfig("user.name", "t");
    await commit(cwd, "init");
    await sendRpc(HOME, { method: "register", cwd, port: upstreamPort });
    await waitFor(cwd, 1);

    const initialSnap = (await snaps(cwd))[0];
    expect(initialSnap.captures.map((c) => c.route)).toContain("/pricing");
    // The "(marketing)" group should NOT appear in any route
    for (const c of initialSnap.captures) {
      expect(c.route.includes("(") || c.route.includes(")")).toBe(false);
    }
  }, 90_000);
});
