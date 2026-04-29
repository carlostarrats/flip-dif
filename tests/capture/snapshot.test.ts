import { describe, it, expect, beforeAll, afterAll } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { PNG } from "pngjs";
import { captureRoute } from "../../src/capture/snapshot.js";
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

describe.skipIf(!RUN)("captureRoute", () => {
  it("captures full page with dimensions", async () => {
    const html = `<html><body data-flip-build-id="z">
      <div style="width:600px;height:2400px;background:#0f0"></div>
    </body></html>`;
    const srv = http.createServer((_req, res) => {
      res.setHeader("content-type", "text/html");
      res.end(html);
    }).listen(0, "127.0.0.1");
    await new Promise((r) => srv.on("listening", r));
    const port = (srv.address() as AddressInfo).port;

    const page = await browser.newPage();
    const r = await captureRoute(page, `http://127.0.0.1:${port}/`, "z");
    await page.close();
    await new Promise((res) => srv.close(() => res(null)));

    expect(r.matched).toBe(true);
    expect(r.height).toBeGreaterThanOrEqual(2400);
    const decoded = PNG.sync.read(r.pngBuffer);
    expect(decoded.width).toBeGreaterThan(0);
    expect(decoded.height).toBeGreaterThan(0);
  }, 30_000);
});
