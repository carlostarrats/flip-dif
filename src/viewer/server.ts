import http, { type IncomingMessage, type ServerResponse } from "node:http";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { handleApi } from "./api.js";
import { serveStatic } from "./static.js";

export interface ViewerHandle {
  port: number;
  stop(): Promise<void>;
}

/**
 * Optional hook the daemon passes in so the viewer can ask the live
 * registry to forget about a project (stop watcher, stop proxy, drain
 * queue). Tests omit it; the daemon supplies it.
 */
export type ViewerHooks = {
  unregisterProject?: (cwd: string) => Promise<void>;
};

export async function startViewer(opts: {
  home: string;
  port: number;
  hooks?: ViewerHooks;
}): Promise<ViewerHandle> {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  // dist path: <root>/dist/viewer/server.js → public is <root>/dist/viewer/public
  // also try <root>/src/viewer/public during dev
  const candidates = [
    join(__dirname, "public"),
    join(__dirname, "../../src/viewer/public"),
  ];
  const publicDir = candidates.find((p) => existsSync(p)) ?? candidates[0];

  const server = http.createServer(async (req, res) => {
    try {
      await handle(req, res, opts.home, publicDir, opts.hooks ?? {});
    } catch (e) {
      res.writeHead(500, { "content-type": "text/plain" }).end((e as Error).message);
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(opts.port, () => resolve());
  });
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : opts.port;
  return {
    port,
    stop: () =>
      new Promise((resolve) => {
        server.close(() => resolve());
      }),
  };
}

async function handle(
  req: IncomingMessage,
  res: ServerResponse,
  home: string,
  publicDir: string,
  hooks: ViewerHooks,
): Promise<void> {
  const url = new URL(req.url ?? "/", "http://x");
  if (await handleApi(req, res, url, home, hooks)) return;
  if (await serveStatic(res, publicDir, url.pathname)) return;
  if (await serveStatic(res, publicDir, "/")) return;
  res.writeHead(404, { "content-type": "text/plain" }).end("not found");
}
