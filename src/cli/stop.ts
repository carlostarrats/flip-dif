import { homedir } from "node:os";
import { existsSync, rmSync } from "node:fs";
import { isRunning, stopDaemon, PID } from "../daemon/lifecycle.js";
import { socketPath } from "../ipc/client.js";

export async function run(): Promise<number> {
  const home = process.env.FLIP_HOME ?? homedir();
  if (!(await isRunning(home))) {
    // Daemon process is gone, but stale pid/socket files may remain (from
    // a kill -9 or a crashed daemon). Clean them so the next start works.
    let cleaned = false;
    if (existsSync(PID(home))) {
      rmSync(PID(home), { force: true });
      cleaned = true;
    }
    if (existsSync(socketPath(home))) {
      rmSync(socketPath(home), { force: true });
      cleaned = true;
    }
    console.log(cleaned ? "flip: not running (cleaned up stale files)." : "flip: not running.");
    return 0;
  }
  await stopDaemon(home);
  console.log("flip: stopped.");
  return 0;
}
