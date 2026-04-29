import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import simpleGit, { type SimpleGit } from "simple-git";
import { PNG } from "pngjs";
import { snapCommit, type Capturer } from "../../src/daemon/orchestrator.js";
import { listSnapshots } from "../../src/storage/snapshots.js";
import { registerProject } from "../../src/storage/projects.js";
import type { BrowserHandle } from "../../src/capture/browser.js";

let HOME: string;
let CWD: string;
let git: SimpleGit;

function blank(): Buffer {
  const png = new PNG({ width: 1, height: 1 });
  png.data.fill(0);
  return PNG.sync.write(png);
}

const fakeBrowser: BrowserHandle = {
  newPage: async () => ({ close: async () => undefined } as never),
  close: async () => undefined,
};

const fakeCapturer: Capturer = async () => ({
  pngBuffer: blank(),
  width: 1,
  height: 1,
  matched: true,
});

beforeEach(async () => {
  HOME = mkdtempSync(join(tmpdir(), "flip-orch-"));
  CWD = mkdtempSync(join(tmpdir(), "flip-app-"));
  git = simpleGit(CWD);
  await git.init();
  await git.addConfig("user.email", "t@t");
  await git.addConfig("user.name", "t");
  // mark as next.js app router so route detection works
  writeFileSync(join(CWD, "package.json"), JSON.stringify({ dependencies: { next: "14" } }));
  mkdirSync(join(CWD, "app"), { recursive: true });
  writeFileSync(join(CWD, "app/page.tsx"), "x");
  await git.add(".");
  await git.commit("init");
  registerProject(HOME, CWD, {
    cwd: CWD,
    name: "app",
    framework: "next-app",
    lastSeen: 0,
    url: "http://localhost:3000",
  });
});

describe("snapCommit", () => {
  it("captures the initial commit", async () => {
    const r = await snapCommit({
      home: HOME,
      cwd: CWD,
      url: "http://localhost:3000",
      browser: fakeBrowser,
      capturer: fakeCapturer,
    });
    expect(r.routes).toContain("/");
    const list = listSnapshots(HOME, CWD);
    expect(list.length).toBe(1);
    expect(list[0].captures.length).toBeGreaterThan(0);
  });

  it("only captures routes for files changed in next commit", async () => {
    await snapCommit({
      home: HOME,
      cwd: CWD,
      url: "http://localhost:3000",
      browser: fakeBrowser,
      capturer: fakeCapturer,
    });
    mkdirSync(join(CWD, "app/dashboard"), { recursive: true });
    writeFileSync(join(CWD, "app/dashboard/page.tsx"), "y");
    await git.add(".");
    await git.commit("add dashboard");
    const r2 = await snapCommit({
      home: HOME,
      cwd: CWD,
      url: "http://localhost:3000",
      browser: fakeBrowser,
      capturer: fakeCapturer,
    });
    expect(r2.routes).toEqual(["/dashboard"]);
    expect(listSnapshots(HOME, CWD).length).toBe(2);
  });

  it("calls setBuildId with the commit sha before capture", async () => {
    let captured: string | undefined;
    await snapCommit({
      home: HOME,
      cwd: CWD,
      url: "http://localhost:3000",
      browser: fakeBrowser,
      capturer: fakeCapturer,
      setBuildId: (sha) => {
        captured = sha;
      },
    });
    expect(captured).toMatch(/^[a-f0-9]{40}$/);
  });

  it("no-ops when HEAD unchanged", async () => {
    await snapCommit({ home: HOME, cwd: CWD, url: "http://localhost:3000", browser: fakeBrowser, capturer: fakeCapturer });
    const r2 = await snapCommit({ home: HOME, cwd: CWD, url: "http://localhost:3000", browser: fakeBrowser, capturer: fakeCapturer });
    expect(r2.routes).toEqual([]);
  });
});
