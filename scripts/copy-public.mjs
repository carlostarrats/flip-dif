import { cp, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const src = resolve(root, "src/viewer/public");
const dst = resolve(root, "dist/viewer/public");

await mkdir(dst, { recursive: true });
await cp(src, dst, { recursive: true });
console.log(`copied ${src} → ${dst}`);
