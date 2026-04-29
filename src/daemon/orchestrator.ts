import type { Page } from "puppeteer";
import type { BrowserHandle } from "../capture/browser.js";
import { captureRoute, type CaptureResult } from "../capture/snapshot.js";
import { changedFiles } from "../git/diff.js";
import { head, isGitRepo } from "../git/repo.js";
import { detectFramework } from "../detect/framework.js";
import { filesToRoutes } from "../detect/routes.js";
import {
  writeSnapshot,
  listSnapshots,
} from "../storage/snapshots.js";
import { applyRolloff } from "../storage/history.js";
import { loadConfig } from "../storage/config.js";
import { registerProject, getProject } from "../storage/projects.js";
import { log } from "../log/index.js";

export type Capturer = (page: Page, url: string, sha: string) => Promise<CaptureResult>;

export type SnapDeps = {
  home: string;
  cwd: string;
  url: string;
  browser: BrowserHandle;
  capturer?: Capturer;
  setBuildId?: (sha: string) => void;
};

export async function snapCommit(
  deps: SnapDeps,
): Promise<{ sha: string; routes: string[]; warned: boolean; matched: boolean[] }> {
  const cap = deps.capturer ?? captureRoute;
  const fw = detectFramework(deps.cwd);

  let sha: string;
  let message: string;
  let timestamp: number;
  let files: string[];
  let routes: string[];

  if (isGitRepo(deps.cwd)) {
    const h = await head(deps.cwd);
    sha = h.sha;
    message = h.message;
    timestamp = h.timestamp;
    const prior = listSnapshots(deps.home, deps.cwd);
    const fromSha = prior.length > 0 ? prior[0].sha : null;
    if (fromSha === sha) {
      return { sha, routes: [], warned: false, matched: [] };
    }
    files = await changedFiles(deps.cwd, fromSha, sha);
    routes = filesToRoutes(fw, files);
    if (routes.length === 0 && prior.length === 0) {
      routes = defaultRoutes(fw);
    }
  } else {
    sha = `manual-${Date.now()}`;
    message = "manual snapshot";
    timestamp = Date.now();
    routes = defaultRoutes(fw);
  }

  if (deps.setBuildId) deps.setBuildId(sha);

  const captures: Array<{
    route: string;
    pngBuffer: Buffer;
    width: number;
    height: number;
  }> = [];
  const matched: boolean[] = [];

  for (const route of routes) {
    const page = await deps.browser.newPage();
    try {
      const url = joinUrl(deps.url, route);
      const r = await cap(page, url, sha);
      captures.push({
        route,
        pngBuffer: r.pngBuffer,
        width: r.width,
        height: r.height,
      });
      matched.push(r.matched);
      if (!r.matched) log(deps.home, `[${deps.cwd}] build-id miss for ${route} @ ${sha}`);
    } catch (e) {
      log(deps.home, `[${deps.cwd}] capture failed ${route}: ${(e as Error).message}`);
    } finally {
      await page.close().catch(() => undefined);
    }
  }

  if (captures.length > 0) {
    writeSnapshot(deps.home, deps.cwd, { sha, message, timestamp }, captures);
    const cfg = loadConfig(deps.home);
    const r = applyRolloff(deps.home, deps.cwd, cfg.historyLimit);
    const existing = getProject(deps.home, deps.cwd);
    if (existing) {
      registerProject(deps.home, deps.cwd, { ...existing, lastSeen: timestamp });
    }
    return { sha, routes, warned: r.warned, matched };
  }
  return { sha, routes, warned: false, matched };
}

function defaultRoutes(fw: ReturnType<typeof detectFramework>): string[] {
  if (fw.kind === "vite") return ["/"];
  if (fw.kind === "plain") return ["/"];
  return ["/"];
}

function joinUrl(base: string, route: string): string {
  const b = base.replace(/\/$/, "");
  if (route === "/" || route === "") return b + "/";
  return b + (route.startsWith("/") ? route : "/" + route);
}
