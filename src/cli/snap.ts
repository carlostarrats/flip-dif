import { homedir } from "node:os";
import { isRunning } from "../daemon/lifecycle.js";
import { sendRpc } from "../ipc/client.js";

export async function run(): Promise<number> {
  const home = process.env.FLIP_HOME ?? homedir();
  if (!(await isRunning(home))) {
    console.log("flip: daemon not running. Run 'flip start' first.");
    return 1;
  }
  try {
    await sendRpc(home, { method: "snap", cwd: process.cwd() });
    return 0;
  } catch (e) {
    console.log(`flip: ${(e as Error).message}`);
    return 1;
  }
}
