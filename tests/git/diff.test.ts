import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import simpleGit, { type SimpleGit } from "simple-git";
import { changedFiles } from "../../src/git/diff.js";

let CWD: string;
let git: SimpleGit;

beforeEach(async () => {
  CWD = mkdtempSync(join(tmpdir(), "flip-diff-"));
  git = simpleGit(CWD);
  await git.init();
  await git.addConfig("user.email", "t@t");
  await git.addConfig("user.name", "t");
});

describe("changedFiles", () => {
  it("from null returns all files at sha", async () => {
    writeFileSync(join(CWD, "a.txt"), "a");
    writeFileSync(join(CWD, "b.txt"), "b");
    await git.add(".");
    await git.commit("init");
    const sha = (await git.revparse(["HEAD"])).trim();
    const files = await changedFiles(CWD, null, sha);
    expect(files.sort()).toEqual(["a.txt", "b.txt"]);
  });

  it("returns diff between two shas", async () => {
    writeFileSync(join(CWD, "a.txt"), "a");
    await git.add(".");
    await git.commit("first");
    const first = (await git.revparse(["HEAD"])).trim();
    writeFileSync(join(CWD, "b.txt"), "b");
    await git.add(".");
    await git.commit("second");
    const second = (await git.revparse(["HEAD"])).trim();
    const files = await changedFiles(CWD, first, second);
    expect(files).toEqual(["b.txt"]);
  });
});
