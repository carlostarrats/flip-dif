import { describe, it, expect } from "vitest";
import { launchBrowser } from "../../src/capture/browser.js";

const RUN = process.env.RUN_PUPPETEER === "1";

describe.skipIf(!RUN)("browser", () => {
  it("launches and closes", async () => {
    const b = await launchBrowser();
    const p = await b.newPage();
    await p.goto("about:blank");
    await b.close();
    expect(true).toBe(true);
  }, 30_000);
});
