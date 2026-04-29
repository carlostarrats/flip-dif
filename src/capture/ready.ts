import http from "node:http";
import type { Page } from "puppeteer";

export type ReadyOpts = {
  httpTimeoutMs?: number;
  pollIntervalMs?: number;
  fallbackBufferMs?: number;
};

export type ReadyResult = { matched: boolean; reason: "matched" | "absent" | "mismatch" };

export async function waitForReady(
  page: Page,
  url: string,
  expectedSha: string,
  opts: ReadyOpts = {},
): Promise<ReadyResult> {
  const httpTimeoutMs = opts.httpTimeoutMs ?? 30_000;
  const pollIntervalMs = opts.pollIntervalMs ?? 250;
  const fallbackBufferMs = opts.fallbackBufferMs ?? 750;

  await waitFor200(url, httpTimeoutMs, pollIntervalMs);
  await page.goto(url, { waitUntil: "load" });

  const buildId = await page.evaluate(
    () => (document.body?.dataset?.flipBuildId as string | undefined) ?? null,
  );

  if (buildId === expectedSha) return { matched: true, reason: "matched" };
  await new Promise((r) => setTimeout(r, fallbackBufferMs));
  return {
    matched: false,
    reason: buildId === null ? "absent" : "mismatch",
  };
}

function waitFor200(url: string, timeoutMs: number, intervalMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const tick = () => {
      const req = http.get(url, (res) => {
        res.resume();
        if (res.statusCode === 200) resolve();
        else retry();
      });
      req.on("error", retry);
      req.setTimeout(intervalMs * 4, () => {
        req.destroy();
        retry();
      });
    };
    const retry = () => {
      if (Date.now() > deadline) reject(new Error("timeout waiting for 200"));
      else setTimeout(tick, intervalMs);
    };
    tick();
  });
}
