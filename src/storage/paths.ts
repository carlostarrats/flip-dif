import { createHash } from "node:crypto";
import { join } from "node:path";

export function hashCwd(cwd: string): string {
  return createHash("sha256").update(cwd).digest("hex").slice(0, 12);
}

export function flipHome(home: string): string {
  return join(home, ".flip");
}

export function projectDir(home: string, cwd: string): string {
  return join(flipHome(home), "projects", hashCwd(cwd));
}

export function snapshotDir(_home: string, projDir: string, sha: string): string {
  return join(projDir, "snapshots", sha);
}

export function routeSlug(route: string): string {
  if (route === "/") return "_root";
  return route.replace(/^\//, "").replace(/\//g, "_");
}
