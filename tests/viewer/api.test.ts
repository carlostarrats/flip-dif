import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PNG } from "pngjs";
import { startViewer, type ViewerHandle } from "../../src/viewer/server.js";
import { registerProject } from "../../src/storage/projects.js";
import { writeSnapshot } from "../../src/storage/snapshots.js";
import { hashCwd } from "../../src/storage/paths.js";

let HOME: string;
let viewer: ViewerHandle;
const CWD = "/tmp/proj-v";

function pixel(w: number, h: number, c: [number, number, number, number]): Buffer {
  const png = new PNG({ width: w, height: h });
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      png.data[i] = c[0];
      png.data[i + 1] = c[1];
      png.data[i + 2] = c[2];
      png.data[i + 3] = c[3];
    }
  }
  return PNG.sync.write(png);
}

beforeEach(async () => {
  HOME = mkdtempSync(join(tmpdir(), "flip-viewer-"));
  registerProject(HOME, CWD, {
    cwd: CWD,
    name: "v",
    framework: "next-app",
    lastSeen: 1,
    url: "http://localhost:3000",
  });
  writeSnapshot(HOME, CWD, { sha: "a", message: "first", timestamp: 1 }, [
    { route: "/", pngBuffer: pixel(2, 2, [255, 0, 0, 255]), width: 2, height: 2 },
  ]);
  writeSnapshot(HOME, CWD, { sha: "b", message: "second", timestamp: 2 }, [
    { route: "/", pngBuffer: pixel(2, 2, [0, 255, 0, 255]), width: 2, height: 2 },
  ]);
  viewer = await startViewer({ home: HOME, port: 0 });
});

afterEach(async () => {
  if (viewer) await viewer.stop();
});

const base = () => `http://127.0.0.1:${viewer.port}`;

describe("viewer api", () => {
  it("/api/projects lists projects", async () => {
    const r = await fetch(`${base()}/api/projects`);
    const list = await r.json();
    expect(list.length).toBe(1);
    expect(list[0].cwd).toBe(CWD);
    expect(list[0].snapshotCount).toBe(2);
    expect(list[0].hashedCwd).toBe(hashCwd(CWD));
  });

  it("/api/projects/<hash>/snapshots returns newest first", async () => {
    const h = hashCwd(CWD);
    const r = await fetch(`${base()}/api/projects/${h}/snapshots`);
    const list = await r.json();
    expect(list.map((s: { sha: string }) => s.sha)).toEqual(["b", "a"]);
  });

  it("/snapshots/<hash>/<sha>/<file>.png returns PNG", async () => {
    const h = hashCwd(CWD);
    const r = await fetch(`${base()}/snapshots/${h}/a/_root.png`);
    expect(r.headers.get("content-type")).toBe("image/png");
    expect(Number(r.headers.get("content-length"))).toBeGreaterThan(0);
  });

  it("/api/diff returns image/png for differing snapshots", async () => {
    const h = hashCwd(CWD);
    const r = await fetch(`${base()}/api/diff?cwd=${h}&from=a&to=b&route=/`);
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toBe("image/png");
    const buf = await r.arrayBuffer();
    expect(buf.byteLength).toBeGreaterThan(0);
  });

  it("GET / returns the HTML shell", async () => {
    const r = await fetch(`${base()}/`);
    const text = await r.text();
    expect(r.status).toBe(200);
    expect(text).toContain('id="root"');
  });

  it("/api/notifications returns empty list initially", async () => {
    const r = await fetch(`${base()}/api/notifications`);
    expect(await r.json()).toEqual([]);
  });

  it("DELETE /api/projects/:hash/snapshots/:sha removes a single snapshot", async () => {
    const h = hashCwd(CWD);
    const before = await (await fetch(`${base()}/api/projects/${h}/snapshots`)).json();
    expect(before.length).toBe(2);
    const r = await fetch(`${base()}/api/projects/${h}/snapshots/a`, { method: "DELETE" });
    expect(r.status).toBe(200);
    const after = await (await fetch(`${base()}/api/projects/${h}/snapshots`)).json();
    expect(after.map((s: { sha: string }) => s.sha)).toEqual(["b"]);
  });

  it("DELETE /api/projects/:hash removes the project + invokes the unregister hook", async () => {
    const seenCwds: string[] = [];
    // Re-mount the viewer with a hook so we can verify it fires.
    await viewer.stop();
    const { startViewer } = await import("../../src/viewer/server.js");
    viewer = await startViewer({
      home: HOME,
      port: 0,
      hooks: {
        unregisterProject: async (cwd) => {
          seenCwds.push(cwd);
        },
      },
    });
    const h = hashCwd(CWD);
    const r = await fetch(`${base()}/api/projects/${h}`, { method: "DELETE" });
    expect(r.status).toBe(200);
    expect(seenCwds).toEqual([CWD]);
    const list = await (await fetch(`${base()}/api/projects`)).json();
    expect(list).toEqual([]);
  });

  it("DELETE /api/projects/:hash returns 404 for unknown project", async () => {
    const r = await fetch(`${base()}/api/projects/000000000000`, { method: "DELETE" });
    expect(r.status).toBe(404);
  });
});
