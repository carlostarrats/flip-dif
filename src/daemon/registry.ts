import type { HeadWatcher } from "../git/watcher.js";
import type { ProjectMeta } from "../storage/projects.js";
import type { InjectionProxy } from "../inject/proxy.js";

export interface AsyncQueue {
  enqueue(task: () => Promise<void>): void;
  drain(): Promise<void>;
}

export function makeQueue(): AsyncQueue {
  let chain: Promise<void> = Promise.resolve();
  return {
    enqueue(task) {
      chain = chain.then(() => task()).catch(() => undefined);
    },
    drain() {
      return chain;
    },
  };
}

export type ProjectState = {
  cwd: string;
  meta: ProjectMeta;
  resolvedUrl: string;
  watcher: HeadWatcher | null;
  queue: AsyncQueue;
  proxy: InjectionProxy | null;
};

export class ProjectRegistry {
  private projects = new Map<string, ProjectState>();

  add(state: ProjectState): void {
    this.projects.set(state.cwd, state);
  }

  get(cwd: string): ProjectState | undefined {
    return this.projects.get(cwd);
  }

  list(): ProjectState[] {
    return [...this.projects.values()];
  }

  async remove(cwd: string): Promise<void> {
    const s = this.projects.get(cwd);
    if (!s) return;
    if (s.watcher) await s.watcher.stop();
    if (s.proxy) await s.proxy.stop();
    await s.queue.drain();
    this.projects.delete(cwd);
  }

  async shutdown(): Promise<void> {
    for (const cwd of [...this.projects.keys()]) {
      await this.remove(cwd);
    }
  }
}
