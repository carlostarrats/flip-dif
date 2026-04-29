import { homedir } from "node:os";
import { exec } from "node:child_process";
import { isRunning } from "../daemon/lifecycle.js";

export async function run(): Promise<number> {
  const home = process.env.FLIP_HOME ?? homedir();
  if (!(await isRunning(home))) {
    console.log("flip: daemon not running. Run 'flip start' first.");
    return 1;
  }
  openBrowser("http://localhost:42069");
  return 0;
}

function openBrowser(url: string): void {
  const cmd =
    process.platform === "darwin"
      ? `open "${url}"`
      : process.platform === "win32"
        ? `start "" "${url}"`
        : `xdg-open "${url}"`;
  exec(cmd, () => undefined);
}
