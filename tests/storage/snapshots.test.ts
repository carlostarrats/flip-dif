import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PNG } from "pngjs";
import {
  writeSnapshot,
  readSnapshot,
  listSnapshots,
} from "../../src/storage/snapshots.js";

let HOME: string;
const CWD = "/tmp/proj-x";

beforeEach(() => {
  HOME = mkdtempSync(join(tmpdir(), "flip-snap-"));
});

function blankPng(w: number, h: number): Buffer {
  const png = new PNG({ width: w, height: h });
  png.data.fill(0);
  return PNG.sync.write(png);
}

describe("snapshots storage", () => {
  it("writes and reads a snapshot", () => {
    writeSnapshot(HOME, CWD, { sha: "abc", message: "init", timestamp: 1 }, [
      { route: "/", pngBuffer: blankPng(2, 3), width: 2, height: 3 },
    ]);
    const meta = readSnapshot(HOME, CWD, "abc");
    expect(meta?.sha).toBe("abc");
    expect(meta?.captures[0]).toMatchObject({
      route: "/",
      file: "_root.png",
      width: 2,
      height: 3,
    });
  });

  it("returns null for unknown sha", () => {
    expect(readSnapshot(HOME, CWD, "nope")).toBeNull();
  });

  it("listSnapshots returns newest first", () => {
    writeSnapshot(HOME, CWD, { sha: "a", message: "a", timestamp: 1 }, [
      { route: "/", pngBuffer: blankPng(1, 1), width: 1, height: 1 },
    ]);
    writeSnapshot(HOME, CWD, { sha: "b", message: "b", timestamp: 3 }, [
      { route: "/", pngBuffer: blankPng(1, 1), width: 1, height: 1 },
    ]);
    writeSnapshot(HOME, CWD, { sha: "c", message: "c", timestamp: 2 }, [
      { route: "/", pngBuffer: blankPng(1, 1), width: 1, height: 1 },
    ]);
    const list = listSnapshots(HOME, CWD);
    expect(list.map((s) => s.sha)).toEqual(["b", "c", "a"]);
  });

  it("supports multiple routes per snapshot", () => {
    writeSnapshot(HOME, CWD, { sha: "abc", message: "m", timestamp: 1 }, [
      { route: "/", pngBuffer: blankPng(1, 1), width: 1, height: 1 },
      { route: "/dashboard", pngBuffer: blankPng(2, 2), width: 2, height: 2 },
    ]);
    const meta = readSnapshot(HOME, CWD, "abc");
    expect(meta?.captures.length).toBe(2);
    expect(meta?.captures.map((c) => c.route).sort()).toEqual(["/", "/dashboard"]);
  });
});
