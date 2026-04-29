import { spawn } from "node:child_process";
import { join } from "node:path";
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

export async function spawnDaemon(home: string, daemonEntry: string): Promise<void> {
  mkdirSync(flipHome(home), { recursive: true });
  const child = spawn(process.execPath, [daemonEntry], {
    detached: true,
    stdio: "ignore",
    env: { ...process.env, FLIP_HOME: home },
  });
  child.unref();
  if (!child.pid) throw new Error("failed to spawn daemon");
  writeFileSync(PID(home), String(child.pid));
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    try {
      await sendRpc(home, { method: "ping" }, 500);
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  throw new Error("daemon failed to start");
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
