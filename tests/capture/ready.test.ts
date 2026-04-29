import { describe, it, expect, beforeAll, afterAll } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { waitForReady } from "../../src/capture/ready.js";
import { launchBrowser, type BrowserHandle } from "../../src/capture/browser.js";

const RUN = process.env.RUN_PUPPETEER === "1";

let browser: BrowserHandle;

beforeAll(async () => {
  if (!RUN) return;
  browser = await launchBrowser();
}, 30_000);

afterAll(async () => {
  if (browser) await browser.close();
});

function startServer(handler: http.RequestListener): Promise<{ url: string; close: () => Promise<void> }> {
  return new Promise((resolve) => {
    const s = http.createServer(handler).listen(0, "127.0.0.1", () => {
      const port = (s.address() as AddressInfo).port;
      resolve({
        url: `http://127.0.0.1:${port}/`,
        close: () => new Promise((r) => s.close(() => r())),
      });
    });
  });
}

describe.skipIf(!RUN)("waitForReady", () => {
  it("returns matched=true when build id present", async () => {
    const srv = await startServer((_req, res) => {
      res.setHeader("content-type", "text/html");
      res.end('<html><body data-flip-build-id="abc"><h1>hi</h1></body></html>');
    });
    const page = await browser.newPage();
    const r = await waitForReady(page, srv.url, "abc", { fallbackBufferMs: 50 });
    await page.close();
    await srv.close();
    expect(r.matched).toBe(true);
  }, 30_000);

  it("returns matched=false when marker absent", async () => {
    const srv = await startServer((_req, res) => {
      res.setHeader("content-type", "text/html");
      res.end("<html><body><h1>hi</h1></body></html>");
    });
    const page = await browser.newPage();
    const r = await waitForReady(page, srv.url, "xyz", { fallbackBufferMs: 50 });
    await page.close();
    await srv.close();
    expect(r.matched).toBe(false);
    expect(r.reason).toBe("absent");
  }, 30_000);

  it("rejects on timeout when 200 never arrives", async () => {
    const page = await browser.newPage();
    await expect(
      waitForReady(page, "http://127.0.0.1:1/", "x", { httpTimeoutMs: 200, pollIntervalMs: 50 }),
    ).rejects.toThrow(/timeout/);
    await page.close();
  }, 30_000);
});
