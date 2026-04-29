import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { flipHome } from "./paths.js";

export type Config = { historyLimit: number };
export const DEFAULT_CONFIG: Config = { historyLimit: 20 };

export function loadConfig(home: string): Config {
  const file = join(flipHome(home), "config.json");
  if (!existsSync(file)) return { ...DEFAULT_CONFIG };
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8"));
    return { ...DEFAULT_CONFIG, ...parsed };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

export function saveConfig(home: string, cfg: Partial<Config>): void {
  const merged: Config = { ...DEFAULT_CONFIG, ...cfg };
  const dir = flipHome(home);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "config.json"), JSON.stringify(merged, null, 2));
}
