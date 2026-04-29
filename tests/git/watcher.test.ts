import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import simpleGit, { type SimpleGit } from "simple-git";
import { watchHead, type HeadWatcher } from "../../src/git/watcher.js";

let CWD: string;
let git: SimpleGit;
let w: HeadWatcher | null = null;

beforeEach(async () => {
  CWD = mkdtempSync(join(tmpdir(), "flip-w-"));
  git = simpleGit(CWD);
  await git.init();
  await git.addConfig("user.email", "t@t");
  await git.addConfig("user.name", "t");
  writeFileSync(join(CWD, "a.txt"), "a");
  await git.add(".");
  await git.commit("first");
});

afterEach(async () => {
  if (w) await w.stop();
  w = null;
});

describe("watchHead", () => {
  it("emits head event after a new commit", async () => {
    w = await watchHead(CWD);
    const got = new Promise<string>((resolve) => {
      w!.on("head", (sha) => resolve(sha));
    });
    await new Promise((r) => setTimeout(r, 100));
    writeFileSync(join(CWD, "b.txt"), "b");
    await git.add(".");
    await git.commit("second");
    const sha = await got;
    expect(sha).toMatch(/^[a-f0-9]{40}$/);
  }, 10_000);
});
