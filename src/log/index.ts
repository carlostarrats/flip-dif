import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { flipHome } from "../storage/paths.js";

export function log(home: string, line: string): void {
  try {
    const dir = flipHome(home);
    mkdirSync(dir, { recursive: true });
    appendFileSync(join(dir, "log"), `[${new Date().toISOString()}] ${line}\n`);
  } catch {
    /* swallow */
  }
}
