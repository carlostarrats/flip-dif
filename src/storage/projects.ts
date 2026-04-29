import {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  readdirSync,
  rmSync,
} from "node:fs";
import { join } from "node:path";
import { flipHome, projectDir } from "./paths.js";

export type ProjectMeta = {
  cwd: string;
  name: string;
  framework: string;
  lastSeen: number;
  url: string;
};

function metaPath(home: string, cwd: string): string {
  return join(projectDir(home, cwd), "meta.json");
}

export function registerProject(home: string, cwd: string, init: ProjectMeta): void {
  const dir = projectDir(home, cwd);
  mkdirSync(dir, { recursive: true });
  mkdirSync(join(dir, "snapshots"), { recursive: true });
  const file = metaPath(home, cwd);
  let merged: ProjectMeta = init;
  if (existsSync(file)) {
    const existing = JSON.parse(readFileSync(file, "utf8")) as ProjectMeta;
    merged = { ...existing, ...init, name: existing.name };
  }
  writeFileSync(file, JSON.stringify(merged, null, 2));
}

export function getProject(home: string, cwd: string): ProjectMeta | null {
  const file = metaPath(home, cwd);
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, "utf8")) as ProjectMeta;
  } catch {
    return null;
  }
}

export function deleteProject(home: string, cwd: string): boolean {
  const dir = projectDir(home, cwd);
  if (!existsSync(dir)) return false;
  rmSync(dir, { recursive: true, force: true });
  return true;
}

export function listProjects(home: string): ProjectMeta[] {
  const root = join(flipHome(home), "projects");
  if (!existsSync(root)) return [];
  const out: ProjectMeta[] = [];
  for (const entry of readdirSync(root)) {
    const file = join(root, entry, "meta.json");
    if (!existsSync(file)) continue;
    try {
      out.push(JSON.parse(readFileSync(file, "utf8")) as ProjectMeta);
    } catch {
      /* skip */
    }
  }
  return out;
}
