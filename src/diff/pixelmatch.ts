import { PNG } from "pngjs";
import pixelmatch from "pixelmatch";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { projectDir, routeSlug } from "../storage/paths.js";

export async function generateDiff(o: {
  home: string;
  cwd: string;
  fromSha: string;
  toSha: string;
  route: string;
}): Promise<{ pngPath: string; changedPixels: number }> {
  const slug = routeSlug(o.route);
  const proj = projectDir(o.home, o.cwd);
  const fromPng = join(proj, "snapshots", o.fromSha, `${slug}.png`);
  const toPng = join(proj, "snapshots", o.toSha, `${slug}.png`);
  const outPath = join(
    proj,
    "snapshots",
    o.toSha,
    `${slug}-vs-${o.fromSha.slice(0, 7)}.diff.png`,
  );
  if (existsSync(outPath)) return { pngPath: outPath, changedPixels: -1 };
  if (!existsSync(fromPng) || !existsSync(toPng)) {
    throw new Error("source PNG missing");
  }
  const a = PNG.sync.read(readFileSync(fromPng));
  const b = PNG.sync.read(readFileSync(toPng));
  const w = Math.max(a.width, b.width);
  const h = Math.max(a.height, b.height);
  const ap = pad(a, w, h);
  const bp = pad(b, w, h);
  const diff = new PNG({ width: w, height: h });
  const changedPixels = pixelmatch(ap.data, bp.data, diff.data, w, h, {
    threshold: 0.1,
  });
  writeFileSync(outPath, PNG.sync.write(diff));
  return { pngPath: outPath, changedPixels };
}

function pad(src: PNG, w: number, h: number): PNG {
  if (src.width === w && src.height === h) return src;
  const dst = new PNG({ width: w, height: h });
  dst.data.fill(0);
  for (let y = 0; y < src.height; y++) {
    for (let x = 0; x < src.width; x++) {
      const si = (y * src.width + x) * 4;
      const di = (y * w + x) * 4;
      dst.data[di] = src.data[si];
      dst.data[di + 1] = src.data[si + 1];
      dst.data[di + 2] = src.data[si + 2];
      dst.data[di + 3] = src.data[si + 3];
    }
  }
  return dst;
}
