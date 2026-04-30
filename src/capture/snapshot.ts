import type { Page } from "puppeteer";
import { waitForReady } from "./ready.js";

export type CaptureResult = {
  pngBuffer: Buffer;
  width: number;
  height: number;
  matched: boolean;
};

export async function captureRoute(
  page: Page,
  url: string,
  expectedSha: string,
): Promise<CaptureResult> {
  await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1 });
  // Defense in depth: even if the dev server / proxy emits cacheable headers,
  // Chromium would reuse the previous capture's HTML for the same URL and the
  // new screenshot would be byte-identical to the old one.
  await page.setCacheEnabled(false);
  const ready = await waitForReady(page, url, expectedSha);
  const dims = await page.evaluate(() => ({
    width: document.documentElement.scrollWidth,
    height: document.documentElement.scrollHeight,
  }));
  const raw = await page.screenshot({ fullPage: true, type: "png" });
  const pngBuffer = Buffer.isBuffer(raw) ? raw : Buffer.from(raw as Uint8Array);
  return { pngBuffer, width: dims.width, height: dims.height, matched: ready.matched };
}
