import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, extname, normalize } from "node:path";
import type { ServerResponse } from "node:http";

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
};

export async function serveStatic(
  res: ServerResponse,
  publicDir: string,
  reqPath: string,
): Promise<boolean> {
  const safe = normalize(reqPath).replace(/^(\.\.[/\\])+/, "");
  let file = join(publicDir, safe === "/" ? "index.html" : safe);
  if (!file.startsWith(publicDir)) {
    res.writeHead(403).end();
    return true;
  }
  if (!existsSync(file)) {
    if (existsSync(file + ".html")) file = file + ".html";
    else return false;
  }
  try {
    const data = await readFile(file);
    const ct = TYPES[extname(file)] ?? "application/octet-stream";
    res.writeHead(200, { "content-type": ct, "cache-control": "no-store" });
    res.end(data);
    return true;
  } catch {
    return false;
  }
}
