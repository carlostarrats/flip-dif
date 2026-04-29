import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PNG } from "pngjs";
import { writeSnapshot, listSnapshots } from "../../src/storage/snapshots.js";
import { applyRolloff } from "../../src/storage/history.js";

let HOME: string;
const CWD = "/tmp/proj-r";

beforeEach(() => {
  HOME = mkdtempSync(join(tmpdir(), "flip-roll-"));
});

function blank(): Buffer {
  const png = new PNG({ width: 1, height: 1 });
  png.data.fill(0);
  return PNG.sync.write(png);
}

function seed(n: number) {
  for (let i = 0; i < n; i++) {
    writeSnapshot(HOME, CWD, { sha: `s${i}`, message: `c${i}`, timestamp: i }, [
      { route: "/", pngBuffer: blank(), width: 1, height: 1 },
    ]);
  }
}

describe("history rolloff", () => {
  it("no-op when below limit", () => {
    seed(5);
    expect(applyRolloff(HOME, CWD, 20)).toEqual({ removed: [], warned: false });
    expect(listSnapshots(HOME, CWD).length).toBe(5);
  });

  it("removes oldest and warns once on first overflow", () => {
    seed(21);
    const r = applyRolloff(HOME, CWD, 20);
    expect(r.removed).toEqual(["s0"]);
    expect(r.warned).toBe(true);
    expect(listSnapshots(HOME, CWD).length).toBe(20);
  });

  it("does not warn again after the first time", () => {
    seed(21);
    applyRolloff(HOME, CWD, 20);
    writeSnapshot(HOME, CWD, { sha: "s21", message: "c21", timestamp: 21 }, [
      { route: "/", pngBuffer: blank(), width: 1, height: 1 },
    ]);
    const r = applyRolloff(HOME, CWD, 20);
    expect(r.removed).toEqual(["s1"]);
    expect(r.warned).toBe(false);
  });
});
