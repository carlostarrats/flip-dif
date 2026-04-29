import type { IncomingMessage, ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync, statSync, createReadStream, readFileSync } from "node:fs";
import { join } from "node:path";
import { listProjects, getProject, type ProjectMeta } from "../storage/projects.js";
import { listSnapshots } from "../storage/snapshots.js";
import { generateDiff } from "../diff/pixelmatch.js";
import { hashCwd, projectDir } from "../storage/paths.js";

type Notifications = {
  pending: Array<{ cwd: string; kind: string; message: string }>;
};

const NOTIF: Notifications = { pending: [] };

export function pushNotification(cwd: string, kind: string, message: string): void {
  if (NOTIF.pending.find((n) => n.cwd === cwd && n.kind === kind)) return;
  NOTIF.pending.push({ cwd, kind, message });
}

function dismiss(cwd: string): void {
  NOTIF.pending = NOTIF.pending.filter((n) => n.cwd !== cwd);
}

function json(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(payload);
}

export async function handleApi(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  home: string,
): Promise<boolean> {
  const path = url.pathname;

  if (path === "/api/projects") {
    const projects = listProjects(home).map((p) => annotate(home, p));
    json(res, 200, projects);
    return true;
  }

  const projMatch = path.match(/^\/api\/projects\/([a-f0-9]{12})\/snapshots$/);
  if (projMatch) {
    const hashed = projMatch[1];
    const proj = listProjects(home).find((p) => hashCwd(p.cwd) === hashed);
    if (!proj) {
      json(res, 404, { error: "not found" });
      return true;
    }
    const snaps = listSnapshots(home, proj.cwd);
    json(res, 200, snaps);
    return true;
  }

  if (path === "/api/notifications") {
    json(res, 200, NOTIF.pending);
    return true;
  }

  if (path === "/api/notifications/dismiss" && req.method === "POST") {
    const body = await readBody(req);
    try {
      const { cwd } = JSON.parse(body || "{}");
      if (cwd) dismiss(cwd);
      json(res, 200, { ok: true });
    } catch {
      json(res, 400, { error: "bad body" });
    }
    return true;
  }

  if (path === "/api/diff") {
    const cwdHash = url.searchParams.get("cwd");
    const fromSha = url.searchParams.get("from");
    const toSha = url.searchParams.get("to");
    const route = url.searchParams.get("route");
    if (!cwdHash || !fromSha || !toSha || !route) {
      json(res, 400, { error: "missing params" });
      return true;
    }
    const proj = listProjects(home).find((p) => hashCwd(p.cwd) === cwdHash);
    if (!proj) {
      json(res, 404, { error: "not found" });
      return true;
    }
    try {
      const r = await generateDiff({
        home,
        cwd: proj.cwd,
        fromSha,
        toSha,
        route,
      });
      const buf = readFileSync(r.pngPath);
      res.writeHead(200, {
        "content-type": "image/png",
        "cache-control": "no-store",
      });
      res.end(buf);
    } catch (e) {
      json(res, 500, { error: (e as Error).message });
    }
    return true;
  }

  // /snapshots/<cwdHash>/<sha>/<file>.png
  const snapMatch = path.match(/^\/snapshots\/([a-f0-9]{12})\/([a-zA-Z0-9_-]+)\/(.+\.png)$/);
  if (snapMatch) {
    const [, cwdHash, sha, file] = snapMatch;
    const proj = listProjects(home).find((p) => hashCwd(p.cwd) === cwdHash);
    if (!proj) {
      json(res, 404, { error: "not found" });
      return true;
    }
    const filePath = join(projectDir(home, proj.cwd), "snapshots", sha, file);
    if (!existsSync(filePath)) {
      json(res, 404, { error: "not found" });
      return true;
    }
    const stat = statSync(filePath);
    res.writeHead(200, {
      "content-type": "image/png",
      "content-length": String(stat.size),
      "cache-control": "no-store",
    });
    createReadStream(filePath).pipe(res);
    return true;
  }

  return false;
}

function annotate(home: string, p: ProjectMeta) {
  const snaps = listSnapshots(home, p.cwd);
  return {
    ...p,
    hashedCwd: hashCwd(p.cwd),
    snapshotCount: snaps.length,
  };
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let buf = "";
    req.on("data", (c) => (buf += c.toString("utf8")));
    req.on("end", () => resolve(buf));
    req.on("error", reject);
  });
}

// Avoid unused import warning when readFile not used directly
void readFile;
