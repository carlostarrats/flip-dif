import {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  readdirSync,
} from "node:fs";
import { join } from "node:path";
import { projectDir, routeSlug } from "./paths.js";

export type Capture = {
  route: string;
  file: string;
  width: number;
  height: number;
};

export type SnapshotMeta = {
  sha: string;
  message: string;
  timestamp: number;
  captures: Capture[];
};

export function writeSnapshot(
  home: string,
  cwd: string,
  meta: Omit<SnapshotMeta, "captures">,
  captures: Array<{ route: string; pngBuffer: Buffer; width: number; height: number }>,
): void {
  const dir = join(projectDir(home, cwd), "snapshots", meta.sha);
  mkdirSync(dir, { recursive: true });
  const captureMetas: Capture[] = [];
  for (const c of captures) {
    const file = `${routeSlug(c.route)}.png`;
    writeFileSync(join(dir, file), c.pngBuffer);
    captureMetas.push({ route: c.route, file, width: c.width, height: c.height });
  }
  const full: SnapshotMeta = { ...meta, captures: captureMetas };
  writeFileSync(join(dir, "meta.json"), JSON.stringify(full, null, 2));
}

export function readSnapshot(
  home: string,
  cwd: string,
  sha: string,
): SnapshotMeta | null {
  const file = join(projectDir(home, cwd), "snapshots", sha, "meta.json");
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, "utf8")) as SnapshotMeta;
  } catch {
    return null;
  }
}

export function listSnapshots(home: string, cwd: string): SnapshotMeta[] {
  const root = join(projectDir(home, cwd), "snapshots");
  if (!existsSync(root)) return [];
  const out: SnapshotMeta[] = [];
  for (const entry of readdirSync(root)) {
    const meta = readSnapshot(home, cwd, entry);
    if (meta) out.push(meta);
  }
  out.sort((a, b) => b.timestamp - a.timestamp);
  return out;
}
