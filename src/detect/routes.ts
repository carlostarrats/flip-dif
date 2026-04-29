import type { Framework } from "./framework.js";

export function filesToRoutes(fw: Framework, files: string[]): string[] {
  const routes = new Set<string>();
  for (const f of files) {
    const r = mapOne(fw, f);
    if (r !== null) routes.add(r);
  }
  return [...routes];
}

function isDynamic(segment: string): boolean {
  return segment.includes("[") || segment.includes("]");
}

function mapOne(fw: Framework, file: string): string | null {
  switch (fw.kind) {
    case "next":
      return fw.router === "app" ? nextApp(file) : nextPages(file);
    case "sveltekit":
      return sveltekit(file);
    case "astro":
      return astro(file);
    case "vite":
      return null;
    case "remix":
      return remix(file);
    case "plain":
      return plain(file);
    case "unknown":
      return null;
  }
}

function nextApp(file: string): string | null {
  const m = file.match(/^(?:src\/)?app\/(.*)?page\.(tsx?|jsx?)$/);
  if (!m) return null;
  const inner = m[1] ?? "";
  const parts = inner.split("/").filter(Boolean);
  if (parts.some(isDynamic)) return null;
  const url = "/" + parts.filter((p) => !p.startsWith("(")).join("/");
  return url === "/" ? "/" : url.replace(/\/$/, "");
}

function nextPages(file: string): string | null {
  const m = file.match(/^(?:src\/)?pages\/(.+)\.(tsx?|jsx?)$/);
  if (!m) return null;
  const path = m[1];
  if (path.startsWith("_") || path.startsWith("api/")) return null;
  const parts = path.split("/");
  if (parts.some(isDynamic)) return null;
  const last = parts[parts.length - 1];
  if (last === "index") parts.pop();
  return "/" + parts.join("/");
}

function sveltekit(file: string): string | null {
  const m = file.match(/^src\/routes\/(.*)\+page\.svelte$/);
  if (!m) return null;
  const inner = m[1] ?? "";
  const parts = inner.split("/").filter(Boolean);
  if (parts.some(isDynamic)) return null;
  return "/" + parts.filter((p) => !p.startsWith("(")).join("/");
}

function astro(file: string): string | null {
  const m = file.match(/^src\/pages\/(.+)\.(astro|md|mdx)$/);
  if (!m) return null;
  const parts = m[1].split("/");
  if (parts.some(isDynamic)) return null;
  if (parts[parts.length - 1] === "index") parts.pop();
  return "/" + parts.join("/");
}

function remix(file: string): string | null {
  const m = file.match(/^app\/routes\/(.+)\.(tsx?|jsx?)$/);
  if (!m) return null;
  const flat = m[1];
  if (flat.includes("$")) return null;
  if (flat.startsWith("_") && flat !== "_index") return null;
  if (flat === "_index") return "/";
  return "/" + flat.replace(/\./g, "/");
}

function plain(file: string): string | null {
  const m = file.match(/^(.+)\.html$/);
  if (!m) return null;
  if (m[1] === "index") return "/";
  return "/" + m[1];
}
