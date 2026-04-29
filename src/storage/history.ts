import { existsSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { projectDir } from "./paths.js";
import { listSnapshots } from "./snapshots.js";

export type RolloffResult = { removed: string[]; warned: boolean };

export function applyRolloff(home: string, cwd: string, limit: number): RolloffResult {
  const dir = projectDir(home, cwd);
  const snaps = listSnapshots(home, cwd);
  if (snaps.length <= limit) return { removed: [], warned: false };

  const toRemove = snaps.slice(limit);
  for (const s of toRemove) {
    rmSync(join(dir, "snapshots", s.sha), { recursive: true, force: true });
  }

  const warnFile = join(dir, "warned.json");
  let warned = false;
  if (!existsSync(warnFile)) {
    writeFileSync(warnFile, JSON.stringify({ warnedAt: Date.now() }));
    warned = true;
  }
  return { removed: toRemove.map((s) => s.sha), warned };
}
