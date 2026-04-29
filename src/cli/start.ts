import { homedir } from "node:os";
import { exec } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { isRunning, spawnDaemon } from "../daemon/lifecycle.js";
import { sendRpc } from "../ipc/client.js";
import { detectFramework } from "../detect/framework.js";
import { resolveDevUrl } from "../detect/url.js";
import { isGitRepo } from "../git/repo.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DAEMON_ENTRY = resolve(__dirname, "../daemon/index.js");

const FRAMEWORK_LABEL: Record<string, string> = {
  next: "Next.js",
  vite: "Vite",
  sveltekit: "SvelteKit",
  astro: "Astro",
  remix: "Remix",
  plain: "static HTML",
};

export async function run(port?: number): Promise<number> {
  const home = process.env.FLIP_HOME ?? homedir();
  const cwd = process.cwd();

  const fw = detectFramework(cwd);
  if (fw.kind === "unknown") {
    console.log("flip: framework not detected. flip works with Next.js, Vite, SvelteKit, Astro, Remix, or plain HTML.");
    return 1;
  }
  const resolved = resolveDevUrl({ port, cwd, home });
  if (!resolved) {
    console.log("flip: pass --port N (or use portless).");
    return 1;
  }

  if (!(await isRunning(home))) {
    try {
      await spawnDaemon(home, DAEMON_ENTRY);
    } catch (e) {
      console.log(`flip: failed to start daemon — ${(e as Error).message}`);
      return 1;
    }
  }

  try {
    await sendRpc(home, { method: "register", cwd, port });
  } catch (e) {
    console.log(`flip: ${(e as Error).message}`);
    return 1;
  }

  openBrowser("http://localhost:42069");

  const label = FRAMEWORK_LABEL[fw.kind] ?? fw.kind;
  const watchTarget = resolved.source === "portless"
    ? resolved.url.replace("http://", "")
    : resolved.url;
  console.log(`flip: detected ${label}`);
  console.log(`flip: watching ${watchTarget}`);
  console.log("flip: viewer at localhost:42069");
  if (isGitRepo(cwd)) {
    console.log("flip: ready. Make a commit to capture your first snapshot.");
  } else {
    console.log("flip: ready. Run 'flip snap' to capture.");
  }
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
