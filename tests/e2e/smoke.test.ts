import { describe, it, expect, beforeAll, afterAll } from "vitest";
import http from "node:http";
import {
  mkdtempSync,
  writeFileSync,
  mkdirSync,
} from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import simpleGit, { type SimpleGit } from "simple-git";
import { hashCwd } from "../../src/storage/paths.js";
import { isRunning, spawnDaemon, stopDaemon } from "../../src/daemon/lifecycle.js";
import { sendRpc } from "../../src/ipc/client.js";

const RUN = process.env.RUN_E2E === "1";

const ROOT = resolve(__dirname, "../..");
const DAEMON_ENTRY = join(ROOT, "dist/daemon/index.js");

let HOME: string;
let CWD: string;
let git: SimpleGit;
let upstream: http.Server;
let upstreamPort: number;

async function startApp(): Promise<void> {
  upstream = http.createServer((req, res) => {
    const html = `<html><body><h1>${req.url}</h1></body></html>`;
    res.setHeader("content-type", "text/html");
    res.end(html);
  });
  await new Promise<void>((r) => upstream.listen(0, "127.0.0.1", r));
  upstreamPort = (upstream.address() as AddressInfo).port;
}

beforeAll(async () => {
  if (!RUN) return;
  HOME = mkdtempSync(join(tmpdir(), "flip-e2e-home-"));
  CWD = mkdtempSync(join(tmpdir(), "flip-e2e-app-"));
  process.env.FLIP_VIEWER_PORT = "0";
  await startApp();
  // create a Next.js-flavored app dir
  writeFileSync(join(CWD, "package.json"), JSON.stringify({ dependencies: { next: "14" } }));
  mkdirSync(join(CWD, "app"), { recursive: true });
  writeFileSync(join(CWD, "app/page.tsx"), "export default function P() { return null }");
  git = simpleGit(CWD);
  await git.init();
  await git.addConfig("user.email", "t@t");
  await git.addConfig("user.name", "t");
  await git.add(".");
  await git.commit("init");
  await spawnDaemon(HOME, DAEMON_ENTRY);
}, 60_000);

afterAll(async () => {
  if (!RUN) return;
  if (await isRunning(HOME)) await stopDaemon(HOME);
  if (upstream) await new Promise((r) => upstream.close(() => r(null)));
  delete process.env.FLIP_VIEWER_PORT;
});

describe.skipIf(!RUN)("e2e smoke", () => {
  it("registers a project, watches commits, captures snapshots, exposes API", async () => {
    await sendRpc(HOME, { method: "register", cwd: CWD, port: upstreamPort });
    // wait for initial snap to complete
    let snaps: any[] = [];
    for (let i = 0; i < 60; i++) {
      await new Promise((r) => setTimeout(r, 500));
      const status = await sendRpc<{ viewerPort: number }>(HOME, { method: "status" });
      const r = await fetch(
        `http://127.0.0.1:${status.viewerPort}/api/projects/${hashCwd(CWD)}/snapshots`,
      );
      if (r.ok) {
        snaps = await r.json();
        if (snaps.length > 0) break;
      }
    }
    expect(snaps.length).toBeGreaterThan(0);

    // make a second commit, expect another snapshot
    mkdirSync(join(CWD, "app/dashboard"), { recursive: true });
    writeFileSync(join(CWD, "app/dashboard/page.tsx"), "x");
    await git.add(".");
    await git.commit("add dashboard");

    let two = false;
    for (let i = 0; i < 60; i++) {
      await new Promise((r) => setTimeout(r, 500));
      const status = await sendRpc<{ viewerPort: number }>(HOME, { method: "status" });
      const r = await fetch(
        `http://127.0.0.1:${status.viewerPort}/api/projects/${hashCwd(CWD)}/snapshots`,
      );
      if (r.ok) {
        const list = await r.json();
        if (list.length >= 2) {
          two = true;
          break;
        }
      }
    }
    expect(two).toBe(true);
  }, 90_000);
});
