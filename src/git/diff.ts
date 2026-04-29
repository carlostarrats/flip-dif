import simpleGit from "simple-git";

export async function changedFiles(
  cwd: string,
  fromSha: string | null,
  toSha: string,
): Promise<string[]> {
  const git = simpleGit(cwd);
  if (fromSha === null) {
    const ls = await git.raw(["ls-tree", "-r", "--name-only", toSha]);
    return ls.split("\n").filter(Boolean);
  }
  const out = await git.raw(["diff", "--name-only", fromSha, toSha]);
  return out.split("\n").filter(Boolean);
}
