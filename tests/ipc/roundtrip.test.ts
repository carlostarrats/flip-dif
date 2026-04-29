import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startIpcServer, type IpcServer } from "../../src/daemon/ipc-server.js";
import { sendRpc, socketPath } from "../../src/ipc/client.js";

let HOME: string;
let server: IpcServer | null = null;

beforeEach(() => {
  HOME = mkdtempSync(join(tmpdir(), "flip-ipc-"));
});

afterEach(async () => {
  if (server) await server.close();
  server = null;
});

describe("IPC roundtrip", () => {
  it("ping returns pong", async () => {
    server = await startIpcServer(socketPath(HOME), async (req) => {
      if (req.method === "ping") return "pong";
      throw new Error("unknown");
    });
    const r = await sendRpc(HOME, { method: "ping" });
    expect(r).toBe("pong");
  });

  it("propagates errors", async () => {
    server = await startIpcServer(socketPath(HOME), async () => {
      throw new Error("nope");
    });
    await expect(sendRpc(HOME, { method: "ping" })).rejects.toThrow(/nope/);
  });
});
