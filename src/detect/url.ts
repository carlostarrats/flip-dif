import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

export type Resolved = { url: string; source: "port" | "portless" };

export function resolveDevUrl(opts: {
  port: number | undefined;
  cwd: string;
  home: string;
}): Resolved | null {
  if (opts.port) return { url: `http://127.0.0.1:${opts.port}`, source: "port" };
  const manifest = join(opts.home, ".portless/projects.json");
  if (!existsSync(manifest)) return null;
  try {
    const map = JSON.parse(readFileSync(manifest, "utf8")) as Record<string, string>;
    const host = map[opts.cwd];
    if (host) return { url: `http://${host}`, source: "portless" };
  } catch {
    /* ignore */
  }
  return null;
}
