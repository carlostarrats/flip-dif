import { EventEmitter } from "node:events";
import chokidar, { type FSWatcher } from "chokidar";
import { join } from "node:path";
import { head } from "./repo.js";

export interface HeadWatcher extends EventEmitter {
  on(event: "head", listener: (sha: string) => void): this;
  emit(event: "head", sha: string): boolean;
  stop(): Promise<void>;
}

export async function watchHead(cwd: string): Promise<HeadWatcher> {
  const emitter = new EventEmitter() as HeadWatcher;
  const watcher: FSWatcher = chokidar.watch(
    [join(cwd, ".git/HEAD"), join(cwd, ".git/refs/heads")],
    { ignoreInitial: true, persistent: true, depth: 4 },
  );
  let lastSha: string | null = null;
  let timer: NodeJS.Timeout | null = null;

  const fire = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(async () => {
      try {
        const h = await head(cwd);
        if (h.sha !== lastSha) {
          lastSha = h.sha;
          emitter.emit("head", h.sha);
        }
      } catch {
        /* repo not ready yet — ignore */
      }
    }, 200);
  };

  watcher.on("all", fire);

  emitter.stop = async () => {
    if (timer) clearTimeout(timer);
    await watcher.close();
  };
  return emitter;
}
