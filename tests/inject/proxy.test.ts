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
