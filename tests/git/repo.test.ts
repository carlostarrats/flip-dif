import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import simpleGit from "simple-git";
import { isGitRepo, head } from "../../src/git/repo.js";

let CWD: string;

beforeEach(async () => {
  CWD = mkdtempSync(join(tmpdir(), "flip-git-"));
  const git = simpleGit(CWD);
  await git.init();
  await git.addConfig("user.email", "t@t");
  await git.addConfig("user.name", "t");
  writeFileSync(join(CWD, "a.txt"), "hi");
  await git.add(".");
  await git.commit("initial");
});

describe("git repo", () => {
  it("isGitRepo true for repo", () => {
    expect(isGitRepo(CWD)).toBe(true);
  });

  it("isGitRepo false for non-repo", () => {
    expect(isGitRepo(tmpdir())).toBe(false);
  });

  it("head returns sha + message", async () => {
    const h = await head(CWD);
    expect(h.sha).toMatch(/^[a-f0-9]{40}$/);
    expect(h.message).toBe("initial");
    expect(h.timestamp).toBeGreaterThan(0);
  });
});
