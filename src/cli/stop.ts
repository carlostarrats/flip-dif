import { homedir } from "node:os";
import { isRunning, stopDaemon } from "../daemon/lifecycle.js";

export async function run(): Promise<number> {
  const home = process.env.FLIP_HOME ?? homedir();
  if (!(await isRunning(home))) {
    console.log("flip: not running.");
    return 0;
  }
  await stopDaemon(home);
  console.log("flip: stopped.");
  return 0;
}
