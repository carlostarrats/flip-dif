import http, { IncomingMessage, ServerResponse } from "node:http";
import { URL } from "node:url";
import zlib from "node:zlib";
import { rewriteBodyTag } from "./html-rewrite.js";

export interface InjectionProxy {
  url: string;
  setBuildId(sha: string): void;
  stop(): Promise<void>;
}

export async function startInjectionProxy(opts: {
  targetUrl: string;
  listenPort?: number;
}): Promise<InjectionProxy> {
  let buildId = "";
  const target = new URL(opts.targetUrl);
  const targetPort = Number(target.port) || (target.protocol === "https:" ? 443 : 80);
  const targetHost = target.hostname;

  const server = http.createServer((req, res) => proxy(req, res, targetHost, targetPort, () => buildId));
  await new Promise<void>((resolve) =>
    server.listen(opts.listenPort ?? 0, "127.0.0.1", () => resolve()),
  );
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;

  return {
    url: `http://127.0.0.1:${port}`,
    setBuildId(sha: string) {
      buildId = sha;
    },
    stop: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

function proxy(
  req: IncomingMessage,
  res: ServerResponse,
  host: string,
  port: number,
  getBuildId: () => string,
): void {
  const headers = { ...req.headers };
  delete headers["host"];
  delete headers["accept-encoding"];

  const upstreamReq = http.request(
    {
      host,
      port,
      method: req.method,
      path: req.url,
      headers: { ...headers, host: `${host}:${port}` },
    },
    (upstreamRes) => {
      const ct = String(upstreamRes.headers["content-type"] ?? "");
      const isHtml = ct.includes("text/html");
      const enc = String(upstreamRes.headers["content-encoding"] ?? "").toLowerCase();

      if (!isHtml) {
        res.writeHead(upstreamRes.statusCode ?? 200, upstreamRes.headers);
        upstreamRes.pipe(res);
        return;
      }

      const chunks: Buffer[] = [];
      let stream: NodeJS.ReadableStream = upstreamRes;
      if (enc === "gzip") stream = upstreamRes.pipe(zlib.createGunzip());
      else if (enc === "deflate") stream = upstreamRes.pipe(zlib.createInflate());
      else if (enc === "br") stream = upstreamRes.pipe(zlib.createBrotliDecompress());

      stream.on("data", (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
      stream.on("end", () => {
        const html = Buffer.concat(chunks).toString("utf8");
        const rewritten = rewriteBodyTag(html, getBuildId());
        const body = Buffer.from(rewritten, "utf8");
        const outHeaders = { ...upstreamRes.headers };
        delete outHeaders["content-encoding"];
        outHeaders["content-length"] = String(body.length);
        res.writeHead(upstreamRes.statusCode ?? 200, outHeaders);
        res.end(body);
      });
      stream.on("error", () => {
        res.writeHead(502).end();
      });
    },
  );

  upstreamReq.on("error", () => {
    res.writeHead(502).end();
  });

  req.pipe(upstreamReq);
}
