import { socketPath } from "../ipc/client.js";
import { startIpcServer, type IpcServer } from "./ipc-server.js";
import { ProjectRegistry, makeQueue, type ProjectState } from "./registry.js";
import { launchBrowser, type BrowserHandle } from "../capture/browser.js";
import { startViewer, type ViewerHandle } from "../viewer/server.js";
import { startInjectionProxy } from "../inject/proxy.js";
import { detectFramework } from "../detect/framework.js";
import { resolveDevUrl } from "../detect/url.js";
import { isGitRepo } from "../git/repo.js";
import { watchHead } from "../git/watcher.js";
import { snapCommit } from "./orchestrator.js";
import { getProject, registerProject } from "../storage/projects.js";
import { pushNotification } from "../viewer/api.js";
import { log } from "../log/index.js";
import { homedir } from "node:os";
import { basename } from "node:path";
import type { Request } from "../ipc/protocol.js";

const HOME = process.env.FLIP_HOME ?? homedir();
const VIEWER_PORT = Number(process.env.FLIP_VIEWER_PORT ?? "42069");

let browser: BrowserHandle | null = null;
let viewer: ViewerHandle | null = null;
let ipc: IpcServer | null = null;
const registry = new ProjectRegistry();

async function getBrowser(): Promise<BrowserHandle> {
  if (!browser) browser = await launchBrowser();
  return browser;
}

async function registerCwd(cwd: string, port?: number): Promise<{ ok: true; alreadyRegistered: boolean }> {
  const existing = registry.get(cwd);
  if (existing) {
    return { ok: true, alreadyRegistered: true };
  }
  const fw = detectFramework(cwd);
  if (fw.kind === "unknown") {
    throw new Error("framework not detected");
  }
  const resolved = resolveDevUrl({ port, cwd, home: HOME });
  if (!resolved) {
    throw new Error("dev URL not found — pass --port N or use portless");
  }

  const skipProxy = process.env.FLIP_NO_PROXY === "1";
  const proxy = skipProxy
    ? null
    : await startInjectionProxy({ targetUrl: resolved.url }).catch((e) => {
        log(HOME, `[${cwd}] proxy failed: ${(e as Error).message}; falling back to direct`);
        return null;
      });

  const meta = getProject(HOME, cwd) ?? {
    cwd,
    name: basename(cwd),
    framework: fw.kind + ("router" in fw ? `-${fw.router}` : ""),
    lastSeen: 0,
    url: resolved.url,
  };
  registerProject(HOME, cwd, meta);

  const state: ProjectState = {
    cwd,
    meta,
    resolvedUrl: proxy ? proxy.url : resolved.url,
    watcher: null,
    queue: makeQueue(),
    proxy,
  };

  if (isGitRepo(cwd)) {
    const w = await watchHead(cwd);
    w.on("head", () => {
      state.queue.enqueue(async () => {
        await runSnap(state);
      });
    });
    state.watcher = w;
  }
  registry.add(state);

  // initial snap (works whether or not it's a git repo)
  state.queue.enqueue(async () => {
    await runSnap(state);
  });
  return { ok: true, alreadyRegistered: false };
}

async function runSnap(state: ProjectState): Promise<void> {
  try {
    const b = await getBrowser();
    const r = await snapCommit({
      home: HOME,
      cwd: state.cwd,
      url: state.resolvedUrl,
      browser: b,
      setBuildId: state.proxy ? (sha) => state.proxy!.setBuildId(sha) : undefined,
    });
    if (r.warned) {
      pushNotification(
        state.cwd,
        "history-full",
        "flip: history full (20 commits). Oldest snapshots will now roll off automatically.",
      );
      log(HOME, `[${state.cwd}] history full`);
    }
  } catch (e) {
    log(HOME, `[${state.cwd}] snap failed: ${(e as Error).message}`);
  }
}

async function shutdown(): Promise<void> {
  await registry.shutdown();
  if (viewer) await viewer.stop();
  if (browser) await browser.close();
  if (ipc) await ipc.close();
  // give the IPC reply a tick to flush before exiting
  setTimeout(() => process.exit(0), 50);
}

async function bootstrap(): Promise<void> {
  viewer = await startViewer({ home: HOME, port: VIEWER_PORT });
  log(HOME, `viewer listening on ${viewer.port}`);

  ipc = await startIpcServer(socketPath(HOME), async (req: Request) => {
    switch (req.method) {
      case "ping":
        return "pong";
      case "register":
        return await registerCwd(req.cwd, req.port);
      case "snap": {
        const s = registry.get(req.cwd);
        if (!s) throw new Error("project not registered");
        s.queue.enqueue(async () => {
          await runSnap(s);
        });
        return { ok: true };
      }
      case "status":
        return {
          projects: registry.list().map((s) => ({
            cwd: s.cwd,
            url: s.resolvedUrl,
          })),
          viewerPort: viewer?.port,
        };
      case "shutdown":
        // schedule shutdown after this RPC reply flushes
        setImmediate(() => {
          shutdown().catch(() => process.exit(1));
        });
        return { ok: true };
      case "notifications":
      case "dismissNotification":
        return { ok: true };
    }
  });
  log(HOME, `daemon ready, ipc at ${socketPath(HOME)}`);
}

bootstrap().catch((e) => {
  log(HOME, `bootstrap failed: ${(e as Error).message}`);
  process.exit(1);
});
