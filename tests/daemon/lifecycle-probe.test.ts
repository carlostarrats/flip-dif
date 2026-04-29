import { describe, it, expect } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { probeViewerPort } from "../../src/daemon/lifecycle.js";

// We don't bind exactly :42069 in tests (would conflict with a real
// daemon). Probe a random port instead.
async function probeOn(port: number) {
  return probeViewerPort(port, 500);
}

describe("probeViewerPort", () => {
  it("returns 'free' when nothing is listening", async () => {
    // pick a port no one's likely on by listening + closing
    const s = http.createServer().listen(0, "127.0.0.1");
    await new Promise((r) => s.on("listening", r));
    const port = (s.address() as AddressInfo).port;
    await new Promise((r) => s.close(() => r(null)));
    expect(await probeOn(port)).toBe("free");
  });

  it("returns 'flip' when the response is JSON (viewer-shaped)", async () => {
    const s = http.createServer((_req, res) => {
      res.setHeader("content-type", "application/json");
      res.end("[]");
    }).listen(0, "127.0.0.1");
    await new Promise((r) => s.on("listening", r));
    const port = (s.address() as AddressInfo).port;
    expect(await probeOn(port)).toBe("flip");
    await new Promise((r) => s.close(() => r(null)));
  });

  it("returns 'other' when the response is not JSON", async () => {
    const s = http.createServer((_req, res) => {
      res.setHeader("content-type", "text/html");
      res.end("<html></html>");
    }).listen(0, "127.0.0.1");
    await new Promise((r) => s.on("listening", r));
    const port = (s.address() as AddressInfo).port;
    expect(await probeOn(port)).toBe("other");
    await new Promise((r) => s.close(() => r(null)));
  });
});
