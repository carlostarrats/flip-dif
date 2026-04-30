import { describe, it, expect } from "vitest";
import http from "node:http";
import zlib from "node:zlib";
import type { AddressInfo } from "node:net";
import { startInjectionProxy } from "../../src/inject/proxy.js";

function startUpstream(handler: http.RequestListener): Promise<{ url: string; close: () => Promise<void> }> {
  return new Promise((resolve) => {
    const s = http.createServer(handler).listen(0, "127.0.0.1", () => {
      const port = (s.address() as AddressInfo).port;
      resolve({
        url: `http://127.0.0.1:${port}`,
        close: () => new Promise((r) => s.close(() => r())),
      });
    });
  });
}

describe("injection proxy", () => {
  it("injects build-id into HTML responses", async () => {
    const up = await startUpstream((_req, res) => {
      res.setHeader("content-type", "text/html");
      res.end("<html><body><h1>hi</h1></body></html>");
    });
    const proxy = await startInjectionProxy({ targetUrl: up.url });
    proxy.setBuildId("abc123");
    const body = await (await fetch(proxy.url)).text();
    expect(body).toContain('data-flip-build-id="abc123"');
    await proxy.stop();
    await up.close();
  });

  it("passes non-HTML through untouched", async () => {
    const up = await startUpstream((_req, res) => {
      res.setHeader("content-type", "application/json");
      res.end('{"x":1}');
    });
    const proxy = await startInjectionProxy({ targetUrl: up.url });
    const body = await (await fetch(proxy.url)).text();
    expect(body).toBe('{"x":1}');
    await proxy.stop();
    await up.close();
  });

  it("survives rapid client-side disconnects without leaking sockets", async () => {
    let upstreamReqs = 0;
    const up = await startUpstream((_req, res) => {
      upstreamReqs++;
      // delay response so client has time to abort
      setTimeout(() => {
        res.setHeader("content-type", "text/html");
        res.end("<html><body><h1>x</h1></body></html>");
      }, 20);
    });
    const proxy = await startInjectionProxy({ targetUrl: up.url });

    // 30 quick requests, each aborted after 5ms (before upstream replies)
    for (let i = 0; i < 30; i++) {
      try {
        await fetch(proxy.url + `/r${i}`, { signal: AbortSignal.timeout(5) });
      } catch {
        /* expected */
      }
    }

    // After abort burst, the proxy should still serve a normal request
    const r = await fetch(proxy.url + "/clean", { signal: AbortSignal.timeout(2000) });
    expect(r.status).toBe(200);
    const body = await r.text();
    expect(body).toContain("<h1>x</h1>");

    await proxy.stop();
    await up.close();
    expect(upstreamReqs).toBeGreaterThan(0);
  }, 10_000);

  it("strips transfer-encoding from upstream chunked HTML", async () => {
    // Upstream sends chunked HTML — proxy rewrites body but must NOT keep
    // Transfer-Encoding alongside the new Content-Length (HPE_INVALID_CONTENT_LENGTH).
    const up = await new Promise<{ url: string; close: () => Promise<void> }>((resolve) => {
      const s = http.createServer((_req, res) => {
        res.setHeader("content-type", "text/html");
        res.setHeader("transfer-encoding", "chunked");
        res.write("<html><body><h1>hi</h1></body></html>");
        res.end();
      }).listen(0, "127.0.0.1", () => {
        const port = (s.address() as AddressInfo).port;
        resolve({ url: `http://127.0.0.1:${port}`, close: () => new Promise((r) => s.close(() => r())) });
      });
    });
    const proxy = await startInjectionProxy({ targetUrl: up.url });
    proxy.setBuildId("zz");
    // Use raw http.get so Node's parser surfaces the error directly
    const result = await new Promise<{ status: number; body: string; err?: string }>((resolve) => {
      http.get(proxy.url + "/", (res) => {
        let buf = "";
        res.on("data", (c) => (buf += c.toString("utf8")));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body: buf }));
      }).on("error", (e) => resolve({ status: 0, body: "", err: (e as NodeJS.ErrnoException).code ?? e.message }));
    });
    expect(result.err).toBeUndefined();
    expect(result.status).toBe(200);
    expect(result.body).toContain('data-flip-build-id="zz"');
    await proxy.stop();
    await up.close();
  });

  it("emits Cache-Control: no-store on HTML responses (regression: byte-identical captures)", async () => {
    const up = await startUpstream((_req, res) => {
      res.setHeader("content-type", "text/html");
      res.setHeader("cache-control", "max-age=3600"); // upstream wants caching
      res.end("<html><body><h1>x</h1></body></html>");
    });
    const proxy = await startInjectionProxy({ targetUrl: up.url });
    proxy.setBuildId("xx");
    const r = await fetch(proxy.url + "/");
    expect(r.headers.get("cache-control")).toMatch(/no-store/);
    expect(r.headers.get("pragma")).toBe("no-cache");
    await proxy.stop();
    await up.close();
  });

  it("decodes gzip then injects", async () => {
    const up = await startUpstream((_req, res) => {
      const html = "<html><body><h1>hi</h1></body></html>";
      const gz = zlib.gzipSync(Buffer.from(html, "utf8"));
      res.setHeader("content-type", "text/html");
      res.setHeader("content-encoding", "gzip");
      res.end(gz);
    });
    const proxy = await startInjectionProxy({ targetUrl: up.url });
    proxy.setBuildId("zz");
    const body = await (await fetch(proxy.url)).text();
    expect(body).toContain('data-flip-build-id="zz"');
    await proxy.stop();
    await up.close();
  });
});
