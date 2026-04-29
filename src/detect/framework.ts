import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

export type Framework =
  | { kind: "next"; router: "app" | "pages" }
  | { kind: "vite"; flavor: "react" | "svelte" | "vue" }
  | { kind: "sveltekit" }
  | { kind: "astro" }
  | { kind: "remix" }
  | { kind: "plain" }
  | { kind: "unknown" };

export function detectFramework(projectDir: string): Framework {
  const pkgPath = join(projectDir, "package.json");
  if (!existsSync(pkgPath)) {
    if (existsSync(join(projectDir, "index.html"))) return { kind: "plain" };
    return { kind: "unknown" };
  }
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
  const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };

  if (deps["next"]) {
    if (existsSync(join(projectDir, "app"))) return { kind: "next", router: "app" };
    if (existsSync(join(projectDir, "src/app"))) return { kind: "next", router: "app" };
    return { kind: "next", router: "pages" };
  }
  if (deps["@sveltejs/kit"]) return { kind: "sveltekit" };
  if (deps["astro"]) return { kind: "astro" };
  if (deps["@remix-run/node"] || deps["@remix-run/serve"]) return { kind: "remix" };
  if (deps["vite"]) {
    if (deps["svelte"]) return { kind: "vite", flavor: "svelte" };
    if (deps["vue"]) return { kind: "vite", flavor: "vue" };
    if (deps["react"]) return { kind: "vite", flavor: "react" };
  }
  return { kind: "unknown" };
}
