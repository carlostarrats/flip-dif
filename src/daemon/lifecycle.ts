import { spawn } from "node:child_process";
import { join } from "node:path";
import http from "node:http";
import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { flipHome } from "../storage/paths.js";
import { sendRpc, socketPath } from "../ipc/client.js";

export const PID = (home: string) => join(flipHome(home), "daemon.pid");

export async function isRunning(home: string): Promise<boolean> {
  if (!existsSync(PID(home))) return false;
  const pid = Number(readFileSync(PID(home), "utf8"));
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export type PortStatus = "free" | "flip" | "other";

/**
 * Probe localhost:42069 to distinguish "free", "flip viewer", or "some
 * other process." Used before spawning to surface useful errors when a
 * stale daemon (often from a different FLIP_HOME) is holding the port.
 */
export function probeViewerPort(port = 42069, timeoutMs = 800): Promise<PortStatus> {
  return new Promise((resolve) => {
    const req = http.get(
      { host: "127.0.0.1", port, path: "/api/projects", timeout: timeoutMs },
      (res) => {
        const ct = String(res.headers["content-type"] ?? "");
        res.resume();
        resolve(ct.includes("application/json") ? "flip" : "other");
      },
    );
    req.on("error", (e: NodeJS.ErrnoException) => {
      resolve(e.code === "ECONNREFUSED" ? "free" : "other");
    });
    req.on("timeout", () => {
      req.destroy();
      resolve("other");
    });
  });
}

export async function spawnDaemon(home: string, daemonEntry: string): Promise<void> {
  mkdirSync(flipHome(home), { recursive: true });

  // Pre-flight: viewer port has to be free, otherwise daemon's bootstrap
  // will fail silently with EADDRINUSE. Skip when the daemon is going to
  // bind a random port (FLIP_VIEWER_PORT=0, used by tests).
  const desiredPort = Number(process.env.FLIP_VIEWER_PORT ?? "42069");
  if (desiredPort > 0) {
    const status = await probeViewerPort(desiredPort);
    if (status === "flip") {
      throw new Error(
        `another flip daemon is already running on localhost:${desiredPort} (likely from a different project directory). Run \`flip stop\` from that directory, or \`flip\` to open the viewer.`,
      );
    }
    if (status === "other") {
      throw new Error(
        `port ${desiredPort} is in use by another process. Run \`lsof -i :${desiredPort}\` to identify it, then free the port and retry.`,
      );
    }
  }

  // Capture stderr so failures surface a real reason instead of "daemon failed to start".
  const child = spawn(process.execPath, [daemonEntry], {
    detached: true,
    stdio: ["ignore", "ignore", "pipe"],
    env: { ...process.env, FLIP_HOME: home },
  });
  child.unref();
  if (!child.pid) throw new Error("failed to spawn daemon");

  let stderr = "";
  child.stderr?.on("data", (chunk) => {
    stderr += chunk.toString("utf8");
  });

  writeFileSync(PID(home), String(child.pid));
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    try {
      await sendRpc(home, { method: "ping" }, 500);
      child.stderr?.removeAllListeners("data");
      child.stderr?.resume(); // let buffered output drain
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  const tail = stderr.trim().split("\n").slice(-3).join("\n").trim();
  throw new Error(
    tail.length > 0
      ? `daemon failed to start: ${tail}`
      : "daemon failed to start (no error captured — check ~/.flip/log)",
  );
}

export async function stopDaemon(home: string): Promise<void> {
  try {
    await sendRpc(home, { method: "shutdown" }, 2000);
  } catch {
    if (existsSync(PID(home))) {
      const pid = Number(readFileSync(PID(home), "utf8"));
      try {
        process.kill(pid, "SIGTERM");
      } catch {
        /* gone */
      }
    }
  }
  rmSync(PID(home), { force: true });
  rmSync(socketPath(home), { force: true });
}
