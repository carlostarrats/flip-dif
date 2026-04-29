import { simpleGit } from "simple-git";
import { existsSync } from "node:fs";
import { join } from "node:path";

export function isGitRepo(cwd: string): boolean {
  return existsSync(join(cwd, ".git"));
}

export async function head(cwd: string): Promise<{ sha: string; message: string; timestamp: number }> {
  const git = simpleGit(cwd);
  const log = await git.log({ maxCount: 1 });
  const c = log.latest;
  if (!c) throw new Error(`no commits in ${cwd}`);
  return {
    sha: c.hash,
    message: c.message,
    timestamp: new Date(c.date).getTime(),
  };
}
