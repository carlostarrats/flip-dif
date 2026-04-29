import { homedir } from "node:os";
import { rmSync } from "node:fs";
import { join } from "node:path";
import readline from "node:readline";
import { flipHome } from "../storage/paths.js";
import { isRunning, stopDaemon } from "../daemon/lifecycle.js";

export async function run(): Promise<number> {
  const home = process.env.FLIP_HOME ?? homedir();
  const answer = await prompt("Delete all snapshot history? (y/N) ");
  if (answer.trim().toLowerCase() !== "y") return 0;
  if (await isRunning(home)) {
    await stopDaemon(home);
  }
  rmSync(join(flipHome(home), "projects"), { recursive: true, force: true });
  console.log("flip: cleared.");
  return 0;
}

function prompt(q: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(q, (a) => {
      rl.close();
      resolve(a);
    });
  });
}
