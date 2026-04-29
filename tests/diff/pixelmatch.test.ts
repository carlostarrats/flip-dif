import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PNG } from "pngjs";
import { writeSnapshot } from "../../src/storage/snapshots.js";
import { generateDiff } from "../../src/diff/pixelmatch.js";

let HOME: string;
const CWD = "/tmp/proj-d";

function pixel(w: number, h: number, fill: [number, number, number, number]): Buffer {
  const png = new PNG({ width: w, height: h });
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      png.data[i] = fill[0];
      png.data[i + 1] = fill[1];
      png.data[i + 2] = fill[2];
      png.data[i + 3] = fill[3];
    }
  }
  return PNG.sync.write(png);
}

beforeEach(() => {
  HOME = mkdtempSync(join(tmpdir(), "flip-diff-"));
});

describe("generateDiff", () => {
  it("counts changed pixels", async () => {
    writeSnapshot(HOME, CWD, { sha: "a", message: "a", timestamp: 1 }, [
      { route: "/", pngBuffer: pixel(4, 4, [255, 0, 0, 255]), width: 4, height: 4 },
    ]);
    writeSnapshot(HOME, CWD, { sha: "b", message: "b", timestamp: 2 }, [
      { route: "/", pngBuffer: pixel(4, 4, [0, 255, 0, 255]), width: 4, height: 4 },
    ]);
    const r = await generateDiff({
      home: HOME,
      cwd: CWD,
      fromSha: "a",
      toSha: "b",
      route: "/",
    });
    expect(r.changedPixels).toBe(16);
    expect(r.pngPath).toMatch(/\.diff\.png$/);
  });

  it("returns 0 when identical", async () => {
    const same = pixel(2, 2, [10, 20, 30, 255]);
    writeSnapshot(HOME, CWD, { sha: "x", message: "x", timestamp: 1 }, [
      { route: "/", pngBuffer: same, width: 2, height: 2 },
    ]);
    writeSnapshot(HOME, CWD, { sha: "y", message: "y", timestamp: 2 }, [
      { route: "/", pngBuffer: same, width: 2, height: 2 },
    ]);
    const r = await generateDiff({
      home: HOME,
      cwd: CWD,
      fromSha: "x",
      toSha: "y",
      route: "/",
    });
    expect(r.changedPixels).toBe(0);
  });
});
