/**
 * Visual regression suite — pixel-diffs the viewer's home + project pages
 * against approved baselines. Catches taste-level CSS drift that the
 * functional UI tests miss (the "logo too big", "grey bg leaking",
 * "tabs look weird" class of bugs).
 *
 * Gated behind RUN_VISUAL=1.
 *
 * Baselines live at tests/visual/baseline/<name>.png. To re-bless after
 * an intentional design change run UPDATE_BASELINE=1 RUN_VISUAL=1
 * npm test -- tests/visual.
 *
 * Diffs that exceed the threshold get written to tests/visual/diff/.
 *
 * To keep the rendered output deterministic we skip the daemon entirely
 * and seed projects + snapshots straight onto disk with fixed names,
 * shas, and timestamps. The viewer is started in-process with no
 * registry hook, so we exercise the same SPA + API code that real users
 * see.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  mkdtempSync,
  mkdirSync,
  existsSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";
import pixelmatch from "pixelmatch";
import { hashCwd } from "../../src/storage/paths.js";
import { registerProject } from "../../src/storage/projects.js";
import { writeSnapshot } from "../../src/storage/snapshots.js";
import { startViewer, type ViewerHandle } from "../../src/viewer/server.js";
import { launchBrowser } from "../../src/capture/browser.js";

const RUN = process.env.RUN_VISUAL === "1";
const UPDATE = process.env.UPDATE_BASELINE === "1";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const BASELINE_DIR = resolve(__dirname, "baseline");
const DIFF_DIR = resolve(__dirname, "diff");

// Frozen point in time so "Xm ago" labels are stable.
const FROZEN_MS = new Date("2026-04-29T00:05:00Z").getTime();
const TS_5M_AGO = FROZEN_MS - 5 * 60_000;

// Fixed shas (deterministic) so dropdown labels and snapshot dirs render
// identically across runs.
const SHA1 = "1111111111111111111111111111111111111111";
const SHA2 = "2222222222222222222222222222222222222222";
const SHA3 = "3333333333333333333333333333333333333333";

const PROJ_CWD = "/visual-fixture/main-app";

let HOME: string;
let viewer: ViewerHandle;
let viewerUrl: string;
let projHash: string;
let browser: Awaited<ReturnType<typeof launchBrowser>>;

beforeAll(async () => {
  if (!RUN) return;
  mkdirSync(BASELINE_DIR, { recursive: true });
  mkdirSync(DIFF_DIR, { recursive: true });

  HOME = mkdtempSync(join(tmpdir(), "flip-visual-home-"));

  // Solid-color PNGs as fake captures. Doesn't matter what they look like
  // for these tests — we're checking the chrome around them, and the
  // project view is exercised separately at the toolbar level.
  const png = (() => {
    const p = new PNG({ width: 1280, height: 800 });
    for (let y = 0; y < 800; y++) {
      for (let x = 0; x < 1280; x++) {
        const i = (y * 1280 + x) * 4;
        p.data[i] = 91; p.data[i + 1] = 141; p.data[i + 2] = 239; p.data[i + 3] = 255;
      }
    }
    return PNG.sync.write(p);
  })();

  // Main project — newest active tab, three commits with deterministic shas.
  registerProject(HOME, PROJ_CWD, {
    cwd: PROJ_CWD,
    name: "main-app",
    framework: "next-app",
    lastSeen: FROZEN_MS - 60_000, // 1m ago
    url: "http://localhost:3000",
  });
  writeSnapshot(HOME, PROJ_CWD, { sha: SHA3, message: "feat: redesigned hero", timestamp: TS_5M_AGO + 4 * 60_000 }, [
    { route: "/", pngBuffer: png, width: 1280, height: 800 },
  ]);
  writeSnapshot(HOME, PROJ_CWD, { sha: SHA2, message: "feat: bigger dashboard numbers", timestamp: TS_5M_AGO + 2 * 60_000 }, [
    { route: "/", pngBuffer: png, width: 1280, height: 800 },
  ]);
  writeSnapshot(HOME, PROJ_CWD, { sha: SHA1, message: "feat: initial home + dashboard", timestamp: TS_5M_AGO }, [
    { route: "/", pngBuffer: png, width: 1280, height: 800 },
    { route: "/dashboard", pngBuffer: png, width: 1280, height: 800 },
  ]);

  // Two extra projects so home view shows the multi-tab state.
  for (const name of ["project-alpha", "project-beta"]) {
    const cwd = `/visual-fixture/${name}`;
    registerProject(HOME, cwd, {
      cwd, name, framework: "next-app",
      lastSeen: FROZEN_MS - 3 * 60_000,
      url: "http://localhost:3000",
    });
    writeSnapshot(HOME, cwd, { sha: "a".repeat(40), message: `feat: bootstrap ${name}`, timestamp: TS_5M_AGO }, [
      { route: "/", pngBuffer: png, width: 1280, height: 800 },
    ]);
  }

  viewer = await startViewer({ home: HOME, port: 0 });
  viewerUrl = `http://127.0.0.1:${viewer.port}`;
  projHash = hashCwd(PROJ_CWD);
  browser = await launchBrowser();
}, 60_000);

afterAll(async () => {
  if (!RUN) return;
  if (browser) await browser.close();
  if (viewer) await viewer.stop();
});

async function captureClipped(url: string, opts?: { selector?: string }): Promise<Buffer> {
  const page = await browser.newPage();
  await page.setViewport({ width: 1400, height: 900, deviceScaleFactor: 1 });

  // Freeze time-relative labels by overriding Date BEFORE the SPA loads.
  await page.evaluateOnNewDocument(`
    (() => {
      const FROZEN = ${FROZEN_MS};
      const RealDate = Date;
      function FakeDate(...args) {
        if (!(this instanceof FakeDate)) return new RealDate(FROZEN).toString();
        return args.length === 0 ? new RealDate(FROZEN) : new RealDate(...args);
      }
      Object.setPrototypeOf(FakeDate, RealDate);
      Object.setPrototypeOf(FakeDate.prototype, RealDate.prototype);
      FakeDate.now = () => FROZEN;
      FakeDate.parse = RealDate.parse;
      FakeDate.UTC = RealDate.UTC;
      window.Date = FakeDate;
    })();
  `);

  await page.goto(url, { waitUntil: "load" });
  // Disable transitions/animations for stable pixel output.
  await page.addStyleTag({
    content: `*, *::before, *::after { transition: none !important; animation: none !important; }`,
  });
  await new Promise((r) => setTimeout(r, 600));

  const buf = opts?.selector
    ? await (await page.$(opts.selector))!.screenshot({ type: "png" })
    : await page.screenshot({ type: "png" });
  await page.close();
  return Buffer.isBuffer(buf) ? buf : Buffer.from(buf as Uint8Array);
}

function compare(name: string, actual: Buffer): { ok: boolean; diffPixels: number; total: number } {
  const baselinePath = join(BASELINE_DIR, `${name}.png`);
  if (UPDATE || !existsSync(baselinePath)) {
    writeFileSync(baselinePath, actual);
    return { ok: true, diffPixels: 0, total: 0 };
  }
  const a = PNG.sync.read(readFileSync(baselinePath));
  const b = PNG.sync.read(actual);
  if (a.width !== b.width || a.height !== b.height) {
    writeFileSync(join(DIFF_DIR, `${name}-actual.png`), actual);
    throw new Error(
      `dimension mismatch for ${name}: baseline ${a.width}x${a.height}, actual ${b.width}x${b.height}.`,
    );
  }
  const diff = new PNG({ width: a.width, height: a.height });
  const diffPixels = pixelmatch(a.data, b.data, diff.data, a.width, a.height, {
    threshold: 0.1,
    includeAA: false,
  });
  const total = a.width * a.height;
  // Tolerate up to 0.05% drift (covers tiny font-rendering jitter).
  const tolerance = Math.max(20, Math.floor(total * 0.0005));
  if (diffPixels > tolerance) {
    writeFileSync(join(DIFF_DIR, `${name}-actual.png`), actual);
    writeFileSync(join(DIFF_DIR, `${name}-diff.png`), PNG.sync.write(diff));
  }
  return { ok: diffPixels <= tolerance, diffPixels, total };
}

describe.skipIf(!RUN)("viewer visual regression", () => {
  it("home view (3 tabs, deterministic data)", async () => {
    const buf = await captureClipped(`${viewerUrl}/`);
    const r = compare("home", buf);
    if (!r.ok) console.log(`home: ${r.diffPixels} / ${r.total} pixels differ — see tests/visual/diff/`);
    expect(r.ok).toBe(true);
  }, 30_000);

  it("home masthead", async () => {
    const buf = await captureClipped(`${viewerUrl}/`, { selector: ".home-masthead" });
    const r = compare("masthead", buf);
    if (!r.ok) console.log(`masthead: ${r.diffPixels} pixels differ`);
    expect(r.ok).toBe(true);
  }, 30_000);

  it("home left column (about + how-it-works)", async () => {
    const buf = await captureClipped(`${viewerUrl}/`, { selector: ".home-col-left" });
    const r = compare("left-column", buf);
    if (!r.ok) console.log(`left-column: ${r.diffPixels} pixels differ`);
    expect(r.ok).toBe(true);
  }, 30_000);

  it("home right column (tabs + commits + section head)", async () => {
    const buf = await captureClipped(`${viewerUrl}/`, { selector: ".home-col-right" });
    const r = compare("right-column", buf);
    if (!r.ok) console.log(`right-column: ${r.diffPixels} pixels differ`);
    expect(r.ok).toBe(true);
  }, 30_000);

  it("project view: after mode at newest commit", async () => {
    const buf = await captureClipped(`${viewerUrl}/#/project/${projHash}`);
    const r = compare("project-after", buf);
    if (!r.ok) console.log(`project-after: ${r.diffPixels} pixels differ`);
    expect(r.ok).toBe(true);
  }, 30_000);

  it("project toolbar (back + dropdowns + before/after/diff buttons)", async () => {
    const buf = await captureClipped(`${viewerUrl}/#/project/${projHash}`, { selector: ".project-toolbar" });
    const r = compare("project-toolbar", buf);
    if (!r.ok) console.log(`project-toolbar: ${r.diffPixels} pixels differ`);
    expect(r.ok).toBe(true);
  }, 30_000);
});
