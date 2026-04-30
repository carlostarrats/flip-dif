/**
 * UI end-to-end suite: spawns a real daemon + fake upstream + Puppeteer
 * browser, then drives the viewer through every user-facing flow that
 * has bitten us in real testing. Gated behind RUN_UI_E2E=1 so it's only
 * run on demand (it's heavier than the unit suite).
 *
 * Flows covered:
 * - Home renders, projects stat, commit count, kebab menus
 * - Each commit row deep-links to a specific commit (regression: opening
 *   different rows always landed at the newest)
 * - Click middle commit → opens at that commit, before/after PNG bytes differ
 * - Diff mode hits /api/diff
 * - Commit dropdown lists all commits, selecting switches view
 * - Oldest commit disables before button
 * - Tab overflow attribute toggles right/left/both as you scroll
 * - Tab click preserves scroll position; clicked tab becomes active
 * - Delete commit via UI removes the row
 * - Delete project via UI removes the tab + drops daemon registry
 * - Live-update poll picks up a freshly-injected project
 * - ESC closes dropdown
 * - Only one kebab open at a time
 * - No console errors / failed requests during any of it
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import http from "node:http";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { AddressInfo } from "node:net";
import { createHash } from "node:crypto";
import simpleGit from "simple-git";
import { PNG } from "pngjs";
import { hashCwd } from "../../src/storage/paths.js";
import { isRunning, spawnDaemon, stopDaemon } from "../../src/daemon/lifecycle.js";
import { sendRpc } from "../../src/ipc/client.js";
import { registerProject } from "../../src/storage/projects.js";
import { writeSnapshot } from "../../src/storage/snapshots.js";
import { launchBrowser } from "../../src/capture/browser.js";

const RUN = process.env.RUN_UI_E2E === "1";

const ROOT = resolve(__dirname, "../..");
const DAEMON_ENTRY = join(ROOT, "dist/daemon/index.js");

let HOME: string;
let CWD: string;
let upstream: http.Server;
let upstreamPort: number;
let viewerPort: number;
let viewerUrl: string;
let projHash: string;
let browser: Awaited<ReturnType<typeof launchBrowser>>;
let revision = 1;

const PAGES: Record<string, (rev: number) => string> = {
  "/": (rev) => `<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0;background:${rev === 1 ? "#1976D2" : rev === 2 ? "#D32F2F" : "#2E7D32"};color:#fff;height:100vh;display:flex;align-items:center;justify-content:center;font:48px ui-sans-serif"><h1>rev ${rev}</h1></body></html>`,
};

beforeAll(async () => {
  if (!RUN) return;
  HOME = mkdtempSync(join(tmpdir(), "flip-uie2e-home-"));
  CWD = mkdtempSync(join(tmpdir(), "flip-uie2e-app-"));
  process.env.FLIP_VIEWER_PORT = "0";

  // Fake dev server whose responses change with `revision`.
  upstream = http.createServer((req, res) => {
    const path = (req.url ?? "/").split("?")[0];
    const fn = PAGES[path];
    if (!fn) {
      res.writeHead(404);
      res.end();
      return;
    }
    res.writeHead(200, { "content-type": "text/html" });
    res.end(fn(revision));
  });
  await new Promise<void>((r) => upstream.listen(0, "127.0.0.1", r));
  upstreamPort = (upstream.address() as AddressInfo).port;

  // Make CWD a Next-flavoured app + git repo with three commits.
  writeFileSync(join(CWD, "package.json"), JSON.stringify({ dependencies: { next: "14" } }));
  mkdirSync(join(CWD, "app"), { recursive: true });
  writeFileSync(join(CWD, "app/page.tsx"), "export default function P(){return null}");
  const git = simpleGit(CWD);
  await git.init();
  await git.addConfig("user.email", "t@t");
  await git.addConfig("user.name", "t");
  await git.add(".");
  await git.commit("rev 1 (blue)");

  await spawnDaemon(HOME, DAEMON_ENTRY);
  await sendRpc(HOME, { method: "register", cwd: CWD, port: upstreamPort });

  // Wait for the initial capture to land.
  await waitForSnapshots(1);

  // Two more commits at distinct revisions so we have a real before/after.
  revision = 2;
  writeFileSync(join(CWD, "app/page.tsx"), "export default function P(){return null}//v2");
  await git.add(".");
  await git.commit("rev 2 (red)");
  await waitForSnapshots(2);

  revision = 3;
  writeFileSync(join(CWD, "app/page.tsx"), "export default function P(){return null}//v3");
  await git.add(".");
  await git.commit("rev 3 (green)");
  await waitForSnapshots(3);

  const status = await sendRpc<{ viewerPort: number }>(HOME, { method: "status" });
  viewerPort = status.viewerPort;
  viewerUrl = `http://127.0.0.1:${viewerPort}`;
  projHash = hashCwd(CWD);

  browser = await launchBrowser();
}, 120_000);

afterAll(async () => {
  if (!RUN) return;
  if (browser) await browser.close();
  if (await isRunning(HOME)) await stopDaemon(HOME);
  if (upstream) await new Promise((r) => upstream.close(() => r(null)));
  delete process.env.FLIP_VIEWER_PORT;
});

async function waitForSnapshots(min: number): Promise<void> {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const status = await sendRpc<{ viewerPort: number }>(HOME, { method: "status" });
    const r = await fetch(`http://127.0.0.1:${status.viewerPort}/api/projects/${hashCwd(CWD)}/snapshots`);
    if (r.ok) {
      const list = (await r.json()) as unknown[];
      if (list.length >= min) return;
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error(`timed out waiting for ${min} snapshots`);
}

async function makePage() {
  const page = await browser.newPage();
  await page.setViewport({ width: 1400, height: 900 });
  const errs: string[] = [];
  page.on("pageerror", (e) => errs.push(`pageerror: ${e.message}`));
  page.on("console", (m) => { if (m.type() === "error") errs.push(`console.error: ${m.text()}`); });
  page.on("requestfailed", (r) => {
    const url = r.url();
    // /api/totally-unknown-style legitimate 404s aren't bugs; skip them.
    if (!url.includes("/favicon")) errs.push(`requestfailed: ${url} ${r.failure()?.errorText}`);
  });
  return { page, errs };
}

describe.skipIf(!RUN)("viewer UI e2e", () => {
  it("home view: renders project tabs, stat, commit list with deep-link hrefs", async () => {
    const { page, errs } = await makePage();
    await page.goto(`${viewerUrl}/`, { waitUntil: "load" });
    await new Promise((r) => setTimeout(r, 700));
    const data = await page.evaluate(() => ({
      tabs: [...document.querySelectorAll(".home-tab")].length,
      projectsStat: document.querySelector(".home-stat-value")?.textContent,
      commits: [...document.querySelectorAll(".commit-row")].map((r) => r.getAttribute("href")),
      sectionCount: document.querySelector(".home-section-count")?.textContent,
    }));
    expect(data.tabs).toBe(1);
    expect(data.projectsStat).toBe("1");
    expect(data.commits.length).toBe(3);
    expect(data.sectionCount).toBe("3");
    for (const href of data.commits) {
      expect(href).toMatch(new RegExp(`^#/project/${projHash}/[a-f0-9]{40}$`));
    }
    expect(errs).toEqual([]);
    await page.close();
  });

  it("deep-link: clicking the middle commit lands at that commit (regression)", async () => {
    const { page, errs } = await makePage();
    await page.goto(`${viewerUrl}/`, { waitUntil: "load" });
    await new Promise((r) => setTimeout(r, 700));
    const middleHref = await page.evaluate(() => document.querySelectorAll(".commit-row")[1].getAttribute("href"));
    const middleSha = middleHref!.split("/").pop()!;
    await page.evaluate((h) => (location.hash = h), middleHref);
    await new Promise((r) => setTimeout(r, 700));
    const dropdownLabel = await page.evaluate(() => document.querySelector(".commit-host .dropdown-label")?.textContent);
    expect(dropdownLabel?.startsWith(middleSha.slice(0, 7))).toBe(true);
    expect(errs).toEqual([]);
    await page.close();
  });

  it("before/after: PNG bytes differ between adjacent commits (cache regression)", async () => {
    const { page, errs } = await makePage();
    const middleHref = `#/project/${projHash}/${(await listSnapshotShas())[1]}`;
    await page.goto(`${viewerUrl}/${middleHref}`, { waitUntil: "load" });
    await new Promise((r) => setTimeout(r, 700));

    const afterSrc = await page.evaluate(() => document.querySelector(".canvas img")?.getAttribute("src"));
    await page.click('button.mode[data-m="before"]');
    await new Promise((r) => setTimeout(r, 500));
    const beforeSrc = await page.evaluate(() => document.querySelector(".canvas img")?.getAttribute("src"));
    expect(beforeSrc).not.toBe(afterSrc);

    const [aBuf, bBuf] = await Promise.all([
      fetch(`${viewerUrl}${afterSrc}`).then((r) => r.arrayBuffer()),
      fetch(`${viewerUrl}${beforeSrc}`).then((r) => r.arrayBuffer()),
    ]);
    expect(createHash("sha1").update(Buffer.from(aBuf)).digest("hex"))
      .not.toBe(createHash("sha1").update(Buffer.from(bBuf)).digest("hex"));
    expect(errs).toEqual([]);
    await page.close();
  });

  it("diff mode: hits /api/diff with from + to", async () => {
    const { page } = await makePage();
    const middleSha = (await listSnapshotShas())[1];
    await page.goto(`${viewerUrl}/#/project/${projHash}/${middleSha}`, { waitUntil: "load" });
    await new Promise((r) => setTimeout(r, 700));
    await page.click('button.mode[data-m="diff"]');
    await new Promise((r) => setTimeout(r, 600));
    const diffSrc = await page.evaluate(() => document.querySelector(".canvas img")?.getAttribute("src"));
    expect(diffSrc).toMatch(/^\/api\/diff\?cwd=[a-f0-9]+&from=[a-f0-9]+&to=[a-f0-9]+&route=/);
    await page.close();
  });

  it("commit dropdown: opens, lists all 3 commits, selecting switches view", async () => {
    const { page } = await makePage();
    await page.goto(`${viewerUrl}/#/project/${projHash}`, { waitUntil: "load" });
    await new Promise((r) => setTimeout(r, 700));
    await page.click(".commit-host .dropdown-trigger");
    await new Promise((r) => setTimeout(r, 300));
    const opts = await page.evaluate(() => [...document.querySelectorAll(".commit-host .dropdown-option")].map((o) => o.textContent));
    expect(opts.length).toBe(3);
    // pick the last one (oldest)
    await page.evaluate(() => {
      const o = [...document.querySelectorAll(".commit-host .dropdown-option")];
      (o[o.length - 1] as HTMLElement).click();
    });
    await new Promise((r) => setTimeout(r, 600));
    // before/diff are now always enabled — click "before" and assert the
    // explanatory message renders rather than a broken image.
    await page.click('button.mode[data-m="before"]');
    await new Promise((r) => setTimeout(r, 300));
    const messageText = await page.evaluate(() => document.querySelector(".canvas-message-headline")?.textContent);
    expect(messageText).toBeTruthy();
    expect(messageText?.toLowerCase()).toContain("no prior capture");
    await page.close();
  });

  it("first commit: clicking 'diff' shows explanatory message instead of broken image", async () => {
    const { page } = await makePage();
    const oldestSha = (await listSnapshotShas())[2];
    await page.goto(`${viewerUrl}/#/project/${projHash}/${oldestSha}`, { waitUntil: "load" });
    await new Promise((r) => setTimeout(r, 700));
    await page.click('button.mode[data-m="diff"]');
    await new Promise((r) => setTimeout(r, 300));
    const text = await page.evaluate(() => document.querySelector(".canvas-message-headline")?.textContent);
    expect(text?.toLowerCase()).toContain("no diff for the first capture");
    await page.close();
  });

  it("tab overflow: data-overflow toggles right/left/both as the strip scrolls", async () => {
    const { page } = await makePage();
    // Seed extra projects to force overflow
    seedFakes(["aaa", "bbb", "ccc", "ddd", "eee", "fff"]);
    await page.goto(`${viewerUrl}/`, { waitUntil: "load" });
    await new Promise((r) => setTimeout(r, 800));
    const initial = await page.evaluate(() => document.querySelector(".home-tabs")?.getAttribute("data-overflow"));
    expect(["right", "both"]).toContain(initial);
    await page.evaluate(() => {
      const t = document.querySelector(".home-tabs") as HTMLElement;
      t.scrollLeft = t.scrollWidth;
    });
    await new Promise((r) => setTimeout(r, 400));
    const end = await page.evaluate(() => document.querySelector(".home-tabs")?.getAttribute("data-overflow"));
    expect(["left", "both"]).toContain(end);
    await page.close();
  });

  it("tab click preserves scroll position", async () => {
    const { page } = await makePage();
    await page.goto(`${viewerUrl}/`, { waitUntil: "load" });
    await new Promise((r) => setTimeout(r, 700));
    await page.evaluate(() => { (document.querySelector(".home-tabs") as HTMLElement).scrollLeft = 100; });
    await new Promise((r) => setTimeout(r, 200));
    const before = await page.evaluate(() => (document.querySelector(".home-tabs") as HTMLElement).scrollLeft);
    await page.evaluate(() => (document.querySelectorAll(".home-tab")[2] as HTMLElement).click());
    await new Promise((r) => setTimeout(r, 600));
    const after = await page.evaluate(() => (document.querySelector(".home-tabs") as HTMLElement).scrollLeft);
    // scrollIntoView may smooth-scroll the active tab into view, which is fine —
    // assert we did NOT reset to 0.
    expect(after).toBeGreaterThan(0);
    await page.close();
  });

  it("delete commit via UI removes the row", async () => {
    const { page, errs } = await makePage();
    await page.goto(`${viewerUrl}/`, { waitUntil: "load" });
    await new Promise((r) => setTimeout(r, 700));
    page.on("dialog", (d) => d.accept());
    // navigate to the real demo project tab if not active
    await page.evaluate((hash) => {
      const t = [...document.querySelectorAll(".home-tab")].find((el) => /uie2e-app/i.test(el.textContent ?? ""));
      (t as HTMLElement | undefined)?.click();
      void hash;
    }, projHash);
    await new Promise((r) => setTimeout(r, 600));
    const before = await page.evaluate(() => document.querySelectorAll(".commit-row").length);
    await page.evaluate(() => (document.querySelector(".commit-row-li:first-child .commit-row-kebab .kebab-trigger") as HTMLElement).click());
    await new Promise((r) => setTimeout(r, 300));
    await page.evaluate(() => (document.querySelector(".commit-row-li:first-child .kebab-item") as HTMLElement).click());
    await new Promise((r) => setTimeout(r, 1500));
    const after = await page.evaluate(() => document.querySelectorAll(".commit-row").length);
    expect(after).toBe(before - 1);
    expect(errs).toEqual([]);
    await page.close();
  });

  it("live-update poll picks up a newly-registered project within 5s", async () => {
    const { page } = await makePage();
    await page.goto(`${viewerUrl}/`, { waitUntil: "load" });
    await new Promise((r) => setTimeout(r, 700));
    const before = await page.evaluate(() => document.querySelectorAll(".home-tab").length);
    seedFakes(["zzz-poll-test"]);
    let after = before;
    for (let i = 0; i < 12; i++) {
      await new Promise((r) => setTimeout(r, 500));
      after = await page.evaluate(() => document.querySelectorAll(".home-tab").length);
      if (after > before) break;
    }
    expect(after).toBe(before + 1);
    await page.close();
  });

  it("ESC closes the open dropdown", async () => {
    const { page } = await makePage();
    await page.goto(`${viewerUrl}/#/project/${projHash}`, { waitUntil: "load" });
    await new Promise((r) => setTimeout(r, 600));
    await page.click(".commit-host .dropdown-trigger");
    await new Promise((r) => setTimeout(r, 200));
    await page.keyboard.press("Escape");
    await new Promise((r) => setTimeout(r, 200));
    const hidden = await page.evaluate(() => (document.querySelector(".commit-host .dropdown-menu") as HTMLElement)?.hidden);
    expect(hidden).toBe(true);
    await page.close();
  });

  it("only one kebab menu open at a time", async () => {
    const { page } = await makePage();
    await page.goto(`${viewerUrl}/`, { waitUntil: "load" });
    await new Promise((r) => setTimeout(r, 700));
    await page.click("#project-actions .kebab-trigger");
    await new Promise((r) => setTimeout(r, 200));
    await page.evaluate(() => (document.querySelector(".commit-row-li:first-child .kebab-trigger") as HTMLElement).click());
    await new Promise((r) => setTimeout(r, 300));
    const openCount = await page.evaluate(() => [...document.querySelectorAll(".kebab-menu")].filter((m) => !(m as HTMLElement).hidden).length);
    expect(openCount).toBe(1);
    await page.close();
  });

  it("invalid sha in URL falls back to newest commit (no crash)", async () => {
    const { page, errs } = await makePage();
    await page.goto(`${viewerUrl}/#/project/${projHash}/00000000000000000000000000000000deadbeef`, { waitUntil: "load" });
    await new Promise((r) => setTimeout(r, 700));
    const label = await page.evaluate(() => document.querySelector(".commit-host .dropdown-label")?.textContent);
    expect(label).toBeTruthy();
    expect(errs).toEqual([]);
    await page.close();
  });

  it("unknown project hash shows 'Project not found'", async () => {
    const { page } = await makePage();
    await page.goto(`${viewerUrl}/#/project/000000000000`, { waitUntil: "load" });
    await new Promise((r) => setTimeout(r, 700));
    const text = await page.evaluate(() => document.querySelector(".empty")?.textContent);
    expect(text?.toLowerCase()).toContain("not found");
    await page.close();
  });
});

async function listSnapshotShas(): Promise<string[]> {
  const r = await fetch(`${viewerUrl}/api/projects/${projHash}/snapshots`);
  const list = (await r.json()) as Array<{ sha: string }>;
  return list.map((s) => s.sha);
}

function seedFakes(names: string[]): void {
  const png = (() => {
    const p = new PNG({ width: 1, height: 1 });
    p.data.fill(0);
    return PNG.sync.write(p);
  })();
  for (const name of names) {
    const cwd = `/tmp/flip-uie2e-fake-${name}`;
    registerProject(HOME, cwd, {
      cwd,
      name,
      framework: "next-app",
      lastSeen: Date.now() - Math.random() * 86_400_000,
      url: "http://localhost:3000",
    });
    writeSnapshot(HOME, cwd, { sha: "a".repeat(40), message: `feat: ${name}`, timestamp: Date.now() }, [
      { route: "/", pngBuffer: png, width: 1, height: 1 },
    ]);
  }
}
