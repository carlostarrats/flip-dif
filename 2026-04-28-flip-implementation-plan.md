# flip Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `flip` — a zero-config local CLI daemon that auto-captures full-page screenshots on every git commit and serves a browser-based before/after/diff viewer at `localhost:42069`.

**Architecture:** Single Node.js + TypeScript package providing a CLI that boots a long-lived daemon process. The daemon watches git, maps changed files to framework-specific routes, drives Puppeteer to capture full-page screenshots, persists them under `~/.flip/`, and runs an HTTP server on port 42069 that serves a static-JS viewer with Pixelmatch-powered diff mode. Communication between the CLI and daemon goes over a Unix domain socket (`~/.flip/daemon.sock`). The viewer is an SPA built from plain ES modules — no build step.

**Tech Stack:**
- Runtime: Node.js ≥ 20, TypeScript 5.x, ESM
- Screenshot: `puppeteer` (bundled Chromium)
- Diff: `pixelmatch` + `pngjs`
- Git: `simple-git`
- File watching: `chokidar`
- HTTP: Node built-in `node:http` (no Express dependency)
- Test runner: `vitest`
- Package manager: `pnpm`
- Lint/format: `eslint` + `prettier`

**Scope notes (from spec "Out of Scope for v1"):**
- Dynamic routes (`/products/[id]`) — skipped, not screenshotted
- Auth-protected pages — captured as login redirect, documented limitation
- Cloud / team sharing — out
- Video / animation — out

**Multi-project (in scope, per spec):** The central daemon registers any number of projects from any cwd. Each registered project gets its own HEAD watcher and capture pipeline running concurrently — commits to project A and project B both produce snapshots without one blocking the other. Puppeteer is shared (one browser, multiple pages). Projects appear as tabs in the viewer.

**Pre-execution requirements (provide before kicking off):**
1. **Frank design tokens** — RESOLVED. Source file: `/Users/carlostarrats/Documents/frank/ui-v2/styles/tokens.css`. This is a shadcn-based token set (preset b50cupdRo, Lyra style, Neutral base, Geist Mono, dark default with `.light` opt-in). Phase 9.4 copies it verbatim to `src/viewer/public/tokens.css` and uses the canonical token names (`--background`, `--foreground`, `--muted`, `--muted-foreground`, `--border`, `--ring`, `--card`, `--primary`, `--font-sans`, `--space-*`, `--text-*`, `--shadow*`, `--radius*`, `--duration-*`, `--ease-standard`).
2. **portless manifest format** — confirm the assumed `~/.portless/projects.json` cwd→host map matches portless's actual on-disk format. If not, update `src/detect/url.ts` accordingly.

**Phasing:** This plan is split into 11 phases. Each phase ends with working, demoable software and a green test suite. Phases 1–6 produce a working "headless capture" tool. Phases 7–10 add the viewer. Phase 11 polishes.

> **A note on scope:** This spec covers multiple subsystems (CLI, daemon, capture engine, viewer UI, diff engine). Each phase below is large enough to justify its own plan in a strict reading of the writing-plans skill. If you'd rather, stop after Phase 1 and break the remaining phases out into per-phase sub-plans before executing. The plan as written is internally consistent and can be executed top-to-bottom.

---

## File Structure

```
flip/
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── .eslintrc.cjs
├── .prettierrc
├── bin/
│   └── flip.mjs                     # shebang launcher → dist/cli/index.js
├── src/
│   ├── cli/
│   │   ├── index.ts                 # arg parser + dispatch
│   │   ├── start.ts                 # `flip start`
│   │   ├── stop.ts                  # `flip stop`
│   │   ├── snap.ts                  # `flip snap`
│   │   ├── clear.ts                 # `flip clear`
│   │   └── open.ts                  # bare `flip` → reopen browser
│   ├── daemon/
│   │   ├── index.ts                 # daemon entry (forked child)
│   │   ├── lifecycle.ts             # pid file, socket, shutdown
│   │   ├── ipc-server.ts            # Unix-socket JSON-RPC
│   │   ├── registry.ts              # in-memory map of registered projects → per-project state (watcher, proxy, queue)
│   │   └── orchestrator.ts          # ties watcher → capture → storage; runs concurrently per project
│   ├── ipc/
│   │   ├── client.ts                # CLI side of JSON-RPC
│   │   └── protocol.ts              # request/response types
│   ├── detect/
│   │   ├── framework.ts             # package.json sniff
│   │   ├── routes.ts                # framework-specific file→route maps
│   │   └── url.ts                   # portless vs --port
│   ├── git/
│   │   ├── repo.ts                  # detect repo, current commit, message
│   │   ├── watcher.ts               # poll HEAD via chokidar on .git/HEAD
│   │   └── diff.ts                  # changed files between commits
│   ├── capture/
│   │   ├── browser.ts               # puppeteer launch/teardown
│   │   ├── ready.ts                 # 200 + load + build-id marker
│   │   └── snapshot.ts              # full-page screenshot + dims
│   ├── inject/
│   │   ├── proxy.ts                 # transparent HTTP proxy that injects build-id into HTML responses
│   │   └── html-rewrite.ts          # body-tag rewriter
│   ├── storage/
│   │   ├── paths.ts                 # ~/.flip/ resolver
│   │   ├── projects.ts              # registry of projects
│   │   ├── snapshots.ts             # write/read PNG + meta JSON
│   │   ├── history.ts               # 20-commit rolloff
│   │   └── config.ts                # ~/.flip/config.json
│   ├── viewer/
│   │   ├── server.ts                # http on 42069
│   │   ├── api.ts                   # /api/* JSON endpoints
│   │   ├── static.ts                # serves /public
│   │   └── public/
│   │       ├── index.html
│   │       ├── styles.css
│   │       ├── app.js               # router
│   │       ├── views/home.js
│   │       ├── views/project.js
│   │       └── lib/diff.js          # pixelmatch in browser via worker
│   ├── diff/
│   │   └── pixelmatch.ts            # server-side diff PNG generation
│   ├── log/
│   │   └── index.ts                 # silent logger to ~/.flip/log
│   └── types.ts                     # shared cross-module types
├── tests/                           # mirrors src/
│   └── …
└── docs/
    └── limitations.md               # auth pages, dynamic routes, etc.
```

**One responsibility per file.** Files that change together live together (e.g. `routes.ts` and `framework.ts` both deal with detection but split because they have distinct contracts).

---

# Phase 1 — Project Foundation

**Output of phase:** Empty TypeScript project, `flip --help` runs, all commands wired to no-op handlers, vitest runs and passes.

### Task 1.1: Initialize project

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `.gitignore`
- Create: `vitest.config.ts`

- [ ] **Step 1: Run init**

```bash
mkdir -p flip && cd flip
pnpm init
```

- [ ] **Step 2: Write `package.json`**

```json
{
  "name": "flip",
  "version": "0.1.0",
  "type": "module",
  "bin": { "flip": "./bin/flip.mjs" },
  "scripts": {
    "build": "tsc -p .",
    "dev": "tsc -p . --watch",
    "test": "vitest run",
    "test:watch": "vitest",
    "lint": "eslint src tests",
    "format": "prettier --write src tests"
  },
  "engines": { "node": ">=20" },
  "dependencies": {
    "puppeteer": "^23.0.0",
    "pixelmatch": "^6.0.0",
    "pngjs": "^7.0.0",
    "simple-git": "^3.25.0",
    "chokidar": "^3.6.0"
  },
  "devDependencies": {
    "typescript": "^5.6.0",
    "vitest": "^2.1.0",
    "@types/node": "^20.0.0",
    "@types/pixelmatch": "^5.2.6",
    "@types/pngjs": "^6.0.5",
    "eslint": "^9.0.0",
    "prettier": "^3.3.0"
  }
}
```

- [ ] **Step 3: Write `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "declaration": false,
    "sourceMap": true
  },
  "include": ["src/**/*"]
}
```

- [ ] **Step 4: Write `vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
  },
});
```

- [ ] **Step 5: Write `.gitignore`**

```
node_modules
dist
.flip-test/
*.log
```

- [ ] **Step 6: Install + commit**

```bash
pnpm install
git init && git add . && git commit -m "chore: project scaffold"
```

### Task 1.2: CLI dispatch with smoke test

**Files:**
- Create: `bin/flip.mjs`
- Create: `src/cli/index.ts`
- Create: `tests/cli/index.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/cli/index.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { parseArgs } from "../../src/cli/index.js";

describe("CLI parser", () => {
  it("returns 'open' when called with no args", () => {
    expect(parseArgs([])).toEqual({ cmd: "open" });
  });

  it("recognizes start with no flags", () => {
    expect(parseArgs(["start"])).toEqual({ cmd: "start", port: undefined });
  });

  it("recognizes start --port", () => {
    expect(parseArgs(["start", "--port", "3000"])).toEqual({
      cmd: "start",
      port: 3000,
    });
  });

  it("recognizes stop, snap, clear", () => {
    expect(parseArgs(["stop"])).toEqual({ cmd: "stop" });
    expect(parseArgs(["snap"])).toEqual({ cmd: "snap" });
    expect(parseArgs(["clear"])).toEqual({ cmd: "clear" });
  });

  it("rejects unknown commands", () => {
    expect(() => parseArgs(["fly"])).toThrow(/unknown command/);
  });
});
```

- [ ] **Step 2: Run to verify failure**

```bash
pnpm test -- cli/index
```
Expected: FAIL — module not found.

- [ ] **Step 3: Write `src/cli/index.ts`**

```ts
export type ParsedArgs =
  | { cmd: "open" }
  | { cmd: "start"; port: number | undefined }
  | { cmd: "stop" }
  | { cmd: "snap" }
  | { cmd: "clear" };

export function parseArgs(argv: string[]): ParsedArgs {
  if (argv.length === 0) return { cmd: "open" };
  const [head, ...rest] = argv;
  switch (head) {
    case "start": {
      const portFlag = rest.indexOf("--port");
      const port =
        portFlag >= 0 && rest[portFlag + 1]
          ? Number(rest[portFlag + 1])
          : undefined;
      return { cmd: "start", port };
    }
    case "stop":
      return { cmd: "stop" };
    case "snap":
      return { cmd: "snap" };
    case "clear":
      return { cmd: "clear" };
    default:
      throw new Error(`unknown command: ${head}`);
  }
}

export async function main(argv: string[]): Promise<number> {
  let parsed: ParsedArgs;
  try {
    parsed = parseArgs(argv);
  } catch (e) {
    console.error((e as Error).message);
    return 1;
  }
  // each handler imported lazily so cold path is fast
  switch (parsed.cmd) {
    case "open":
      return (await import("./open.js")).run();
    case "start":
      return (await import("./start.js")).run(parsed.port);
    case "stop":
      return (await import("./stop.js")).run();
    case "snap":
      return (await import("./snap.js")).run();
    case "clear":
      return (await import("./clear.js")).run();
  }
}
```

- [ ] **Step 4: Stub the handlers**

Each of `src/cli/{open,start,stop,snap,clear}.ts`:

```ts
export async function run(_arg?: unknown): Promise<number> {
  throw new Error("not implemented");
}
```

- [ ] **Step 5: Write `bin/flip.mjs`**

```js
#!/usr/bin/env node
import { main } from "../dist/cli/index.js";
const code = await main(process.argv.slice(2));
process.exit(code);
```

```bash
chmod +x bin/flip.mjs
```

- [ ] **Step 6: Build, verify, commit**

```bash
pnpm build && pnpm test
git add . && git commit -m "feat(cli): arg parser and command dispatch"
```

---

# Phase 2 — Framework Detection & URL Resolution

**Output of phase:** Given any project directory, flip can identify the framework and the dev URL.

### Task 2.1: Framework detection from `package.json`

**Files:**
- Create: `src/detect/framework.ts`
- Create: `tests/detect/framework.test.ts`
- Create: `tests/fixtures/projects/{nextjs-app,vite-react,sveltekit,astro,remix,plain-html,unknown}/package.json`

Supported frameworks (from spec): `next` (App / Pages router auto-detected from folder presence), `vite-react`, `vite-svelte`, `vite-vue`, `sveltekit`, `astro`, `remix`, `plain`.

- [ ] **Step 1: Create fixture `package.json`s**

Example `tests/fixtures/projects/nextjs-app/package.json`:

```json
{ "name": "demo", "dependencies": { "next": "14.0.0" } }
```

Plus an empty `tests/fixtures/projects/nextjs-app/app/page.tsx` to signal App Router.
For `nextjs-pages`, instead create `pages/index.tsx`.
For `vite-react`, dependencies include `vite` and `react`.
For `unknown`, just `{ "name": "x" }` and no signal files.
For `plain-html`, no `package.json` at all — only `index.html`.

- [ ] **Step 2: Write the failing test**

`tests/detect/framework.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { detectFramework } from "../../src/detect/framework.js";
import { resolve } from "node:path";

const fixture = (name: string) =>
  resolve(__dirname, "../fixtures/projects", name);

describe("detectFramework", () => {
  it("Next.js App Router", () => {
    expect(detectFramework(fixture("nextjs-app"))).toEqual({
      kind: "next",
      router: "app",
    });
  });

  it("Next.js Pages Router", () => {
    expect(detectFramework(fixture("nextjs-pages"))).toEqual({
      kind: "next",
      router: "pages",
    });
  });

  it("Vite + React", () => {
    expect(detectFramework(fixture("vite-react"))).toEqual({
      kind: "vite",
      flavor: "react",
    });
  });

  it("plain HTML when no package.json", () => {
    expect(detectFramework(fixture("plain-html"))).toEqual({ kind: "plain" });
  });

  it("returns 'unknown' when nothing matches", () => {
    expect(detectFramework(fixture("unknown"))).toEqual({ kind: "unknown" });
  });
});
```

- [ ] **Step 3: Run to verify failure**

```bash
pnpm test -- detect/framework
```
Expected: FAIL.

- [ ] **Step 4: Implement `src/detect/framework.ts`**

```ts
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
```

- [ ] **Step 5: Run tests, commit**

```bash
pnpm test && git add . && git commit -m "feat(detect): framework detection from package.json"
```

### Task 2.2: File-to-route mapping

**Files:**
- Create: `src/detect/routes.ts`
- Create: `tests/detect/routes.test.ts`

Spec rules:
- `app/dashboard/page.tsx` → `/dashboard` (Next App Router)
- `pages/about.tsx` → `/about` (Next Pages Router)
- `pages/index.tsx` → `/`
- Dynamic segments (`[id]`, `[...slug]`) → **skip**, return no route
- Non-route files → empty array
- Component files that aren't pages → empty array (mapped via dependency-graph in v1.x; for v1, only direct route files map to routes)

Note: spec says multi-page support uses file dependency mapping for shared components. **v1 simplification:** only files that ARE route files map to routes. A future task can add dep-graph support; until then a commit that touches only `components/Nav.tsx` produces zero captures. Document this in `docs/limitations.md`.

- [ ] **Step 1: Failing test**

```ts
import { describe, it, expect } from "vitest";
import { filesToRoutes } from "../../src/detect/routes.js";

describe("filesToRoutes (Next App Router)", () => {
  const fw = { kind: "next" as const, router: "app" as const };

  it("maps page.tsx files", () => {
    expect(filesToRoutes(fw, ["app/dashboard/page.tsx"])).toEqual(["/dashboard"]);
  });

  it("maps app/page.tsx → /", () => {
    expect(filesToRoutes(fw, ["app/page.tsx"])).toEqual(["/"]);
  });

  it("skips dynamic segments", () => {
    expect(filesToRoutes(fw, ["app/products/[id]/page.tsx"])).toEqual([]);
  });

  it("ignores non-page files", () => {
    expect(filesToRoutes(fw, ["app/dashboard/Header.tsx"])).toEqual([]);
  });

  it("dedupes when multiple files in same route folder change", () => {
    expect(
      filesToRoutes(fw, [
        "app/dashboard/page.tsx",
        "app/dashboard/loading.tsx",
        "app/dashboard/Header.tsx",
      ]),
    ).toEqual(["/dashboard"]);
  });
});

describe("filesToRoutes (Next Pages Router)", () => {
  const fw = { kind: "next" as const, router: "pages" as const };

  it("pages/index.tsx → /", () => {
    expect(filesToRoutes(fw, ["pages/index.tsx"])).toEqual(["/"]);
  });

  it("pages/about.tsx → /about", () => {
    expect(filesToRoutes(fw, ["pages/about.tsx"])).toEqual(["/about"]);
  });

  it("ignores _app, _document, api/*", () => {
    expect(
      filesToRoutes(fw, ["pages/_app.tsx", "pages/_document.tsx", "pages/api/x.ts"]),
    ).toEqual([]);
  });

  it("skips dynamic segments", () => {
    expect(filesToRoutes(fw, ["pages/products/[id].tsx"])).toEqual([]);
  });
});

describe("filesToRoutes (SvelteKit)", () => {
  const fw = { kind: "sveltekit" as const };

  it("src/routes/about/+page.svelte → /about", () => {
    expect(filesToRoutes(fw, ["src/routes/about/+page.svelte"])).toEqual(["/about"]);
  });

  it("src/routes/+page.svelte → /", () => {
    expect(filesToRoutes(fw, ["src/routes/+page.svelte"])).toEqual(["/"]);
  });

  it("skips [param] dirs", () => {
    expect(filesToRoutes(fw, ["src/routes/blog/[slug]/+page.svelte"])).toEqual([]);
  });
});

describe("filesToRoutes (Astro)", () => {
  const fw = { kind: "astro" as const };

  it("src/pages/about.astro → /about", () => {
    expect(filesToRoutes(fw, ["src/pages/about.astro"])).toEqual(["/about"]);
  });
});

describe("filesToRoutes (plain)", () => {
  const fw = { kind: "plain" as const };

  it("index.html → /", () => {
    expect(filesToRoutes(fw, ["index.html"])).toEqual(["/"]);
  });
  it("about.html → /about", () => {
    expect(filesToRoutes(fw, ["about.html"])).toEqual(["/about"]);
  });
});
```

- [ ] **Step 2: Run, fail, implement `src/detect/routes.ts`**

```ts
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
      return null; // SPA — single index.html, not file-routed
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
  const inner = m[1] ?? ""; // "" for app/page.tsx
  const parts = inner.split("/").filter(Boolean);
  if (parts.some(isDynamic)) return null;
  // route groups (foo) are stripped from URL
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
  if (flat.includes("$")) return null; // dynamic param
  if (flat.startsWith("_")) return null; // pathless layout
  if (flat === "_index") return "/";
  return "/" + flat.replace(/\./g, "/");
}

function plain(file: string): string | null {
  const m = file.match(/^(.+)\.html$/);
  if (!m) return null;
  if (m[1] === "index") return "/";
  return "/" + m[1];
}
```

- [ ] **Step 3: Test, commit**

```bash
pnpm test && git add . && git commit -m "feat(detect): file-to-route mapping for Next/SvelteKit/Astro/Remix/plain"
```

### Task 2.3: Dev URL detection

**Files:**
- Create: `src/detect/url.ts`
- Create: `tests/detect/url.test.ts`

Behavior:
- `--port N` flag wins → `http://localhost:N`
- Otherwise look for portless registration. **Spec assumption:** portless writes a manifest file at `~/.portless/projects.json` mapping cwd → `myapp.localhost`. If not found, return `null` and the daemon refuses to start with a clear "no port — pass --port N" error.

- [ ] **Step 1: Failing test**

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { resolveDevUrl } from "../../src/detect/url.js";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let HOME: string;
let CWD: string;

beforeEach(() => {
  HOME = mkdtempSync(join(tmpdir(), "flip-home-"));
  CWD = mkdtempSync(join(tmpdir(), "flip-proj-"));
});

describe("resolveDevUrl", () => {
  it("uses --port when given", () => {
    expect(resolveDevUrl({ port: 3000, cwd: CWD, home: HOME })).toEqual({
      url: "http://localhost:3000",
      source: "port",
    });
  });

  it("reads portless manifest when no port", () => {
    mkdirSync(join(HOME, ".portless"), { recursive: true });
    writeFileSync(
      join(HOME, ".portless/projects.json"),
      JSON.stringify({ [CWD]: "myapp.localhost" }),
    );
    expect(resolveDevUrl({ port: undefined, cwd: CWD, home: HOME })).toEqual({
      url: "http://myapp.localhost",
      source: "portless",
    });
  });

  it("returns null when no port + no portless", () => {
    expect(resolveDevUrl({ port: undefined, cwd: CWD, home: HOME })).toBeNull();
  });
});
```

- [ ] **Step 2: Implement**

```ts
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

export type Resolved = { url: string; source: "port" | "portless" };

export function resolveDevUrl(opts: {
  port: number | undefined;
  cwd: string;
  home: string;
}): Resolved | null {
  if (opts.port) return { url: `http://localhost:${opts.port}`, source: "port" };
  const manifest = join(opts.home, ".portless/projects.json");
  if (!existsSync(manifest)) return null;
  try {
    const map = JSON.parse(readFileSync(manifest, "utf8")) as Record<string, string>;
    const host = map[opts.cwd];
    if (host) return { url: `http://${host}`, source: "portless" };
  } catch {
    /* ignore */
  }
  return null;
}
```

- [ ] **Step 3: Test, commit**

---

# Phase 3 — Storage Layer

**Output of phase:** All on-disk operations work. We can write/read snapshots, manage history rolloff, and persist project registry + config.

### Task 3.1: Path resolver and config

**Files:**
- Create: `src/storage/paths.ts`
- Create: `src/storage/config.ts`
- Create: `tests/storage/paths.test.ts`
- Create: `tests/storage/config.test.ts`

Layout (FROZEN — all later phases depend on this):

```
~/.flip/
├── config.json                    # { "historyLimit": 20 }
├── log                            # daemon log
├── daemon.pid
├── daemon.sock
└── projects/
    └── <hashed-cwd>/
        ├── meta.json              # { name, cwd, framework, lastSeen }
        └── snapshots/
            └── <commit-sha>/
                ├── meta.json      # { sha, message, timestamp, captures: [...] }
                └── <route-slug>.png   # one PNG per captured route
                └── <route-slug>-<sha2>.diff.png  # generated lazily
```

`<hashed-cwd>` = first 12 chars of sha256(absolute project dir). Stable across runs, avoids collisions, keeps directory names short.

`<route-slug>` = url-safe (`/` → `_`, leading slash stripped, `/` becomes `_root` for `/`).

- [ ] **Step 1: Failing tests for paths**

```ts
import { describe, it, expect } from "vitest";
import { hashCwd, projectDir, snapshotDir, routeSlug } from "../../src/storage/paths.js";

describe("paths", () => {
  it("hashCwd is stable and 12 chars", () => {
    const h = hashCwd("/Users/me/projects/app");
    expect(h).toHaveLength(12);
    expect(h).toEqual(hashCwd("/Users/me/projects/app"));
  });

  it("projectDir nests under home/.flip/projects", () => {
    expect(projectDir("/h", "/Users/me/x")).toBe(`/h/.flip/projects/${hashCwd("/Users/me/x")}`);
  });

  it("snapshotDir uses commit sha", () => {
    expect(snapshotDir("/h", "/p", "abc123")).toMatch(/snapshots\/abc123$/);
  });

  it("routeSlug encodes safely", () => {
    expect(routeSlug("/")).toBe("_root");
    expect(routeSlug("/dashboard")).toBe("dashboard");
    expect(routeSlug("/users/profile")).toBe("users_profile");
  });
});
```

- [ ] **Step 2: Implement `src/storage/paths.ts`**

```ts
import { createHash } from "node:crypto";
import { join } from "node:path";

export function hashCwd(cwd: string): string {
  return createHash("sha256").update(cwd).digest("hex").slice(0, 12);
}

export function flipHome(home: string): string {
  return join(home, ".flip");
}

export function projectDir(home: string, cwd: string): string {
  return join(flipHome(home), "projects", hashCwd(cwd));
}

export function snapshotDir(home: string, projDir: string, sha: string): string {
  return join(projDir, "snapshots", sha);
}

export function routeSlug(route: string): string {
  if (route === "/") return "_root";
  return route.replace(/^\//, "").replace(/\//g, "_");
}
```

- [ ] **Step 3: Failing tests for config**

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig, saveConfig, DEFAULT_CONFIG } from "../../src/storage/config.js";

let HOME: string;
beforeEach(() => {
  HOME = mkdtempSync(join(tmpdir(), "flip-cfg-"));
});

describe("config", () => {
  it("returns DEFAULT when missing", () => {
    expect(loadConfig(HOME)).toEqual(DEFAULT_CONFIG);
  });

  it("round-trips", () => {
    saveConfig(HOME, { historyLimit: 50 });
    expect(loadConfig(HOME)).toEqual({ historyLimit: 50 });
  });

  it("merges partial config with defaults", () => {
    saveConfig(HOME, { historyLimit: 5 });
    const cfg = loadConfig(HOME);
    expect(cfg.historyLimit).toBe(5);
  });
});
```

- [ ] **Step 4: Implement `src/storage/config.ts`**

```ts
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { flipHome } from "./paths.js";

export type Config = { historyLimit: number };
export const DEFAULT_CONFIG: Config = { historyLimit: 20 };

export function loadConfig(home: string): Config {
  const file = join(flipHome(home), "config.json");
  if (!existsSync(file)) return { ...DEFAULT_CONFIG };
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8"));
    return { ...DEFAULT_CONFIG, ...parsed };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

export function saveConfig(home: string, cfg: Partial<Config>): void {
  const merged: Config = { ...DEFAULT_CONFIG, ...cfg };
  const dir = flipHome(home);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "config.json"), JSON.stringify(merged, null, 2));
}
```

- [ ] **Step 5: Test, commit**

### Task 3.2: Project registry

**Files:**
- Create: `src/storage/projects.ts`
- Create: `tests/storage/projects.test.ts`

A "project" is a registered cwd. The registry is the union of all `projectDir/meta.json` files.

```ts
export type ProjectMeta = {
  cwd: string;
  name: string;            // basename(cwd) by default
  framework: string;       // serialized Framework.kind + flavor/router
  lastSeen: number;        // Date.now() of last commit captured
  url: string;             // dev URL (informational; can change)
};
```

API:
- `registerProject(home, cwd, init: ProjectMeta)` — creates dir, writes meta if missing or updates lastSeen
- `listProjects(home): ProjectMeta[]`
- `getProject(home, cwd): ProjectMeta | null`

- [ ] **Step 1: Failing tests** (writes a project, lists it, re-registers updates lastSeen but keeps name)

- [ ] **Step 2: Implement** standard JSON I/O + `mkdirSync(..., { recursive: true })`

- [ ] **Step 3: Commit**

### Task 3.3: Snapshots write/read

**Files:**
- Create: `src/storage/snapshots.ts`
- Create: `tests/storage/snapshots.test.ts`

```ts
export type Capture = {
  route: string;
  file: string;        // relative path within snapshotDir, e.g. "_root.png"
  width: number;
  height: number;
};

export type SnapshotMeta = {
  sha: string;
  message: string;
  timestamp: number;
  captures: Capture[];
};

export function writeSnapshot(
  home: string,
  cwd: string,
  meta: Omit<SnapshotMeta, "captures">,
  captures: Array<{ route: string; pngBuffer: Buffer; width: number; height: number }>,
): void;

export function readSnapshot(
  home: string,
  cwd: string,
  sha: string,
): SnapshotMeta | null;

export function listSnapshots(home: string, cwd: string): SnapshotMeta[]; // newest first
```

- [ ] **Step 1: Failing tests** — write a synthetic 1×1 PNG and round-trip

```ts
import { PNG } from "pngjs";

function blankPng(w: number, h: number): Buffer {
  const png = new PNG({ width: w, height: h });
  png.data.fill(0);
  return PNG.sync.write(png);
}

it("writes and reads a snapshot", () => {
  writeSnapshot(HOME, CWD, { sha: "abc", message: "init", timestamp: 1 }, [
    { route: "/", pngBuffer: blankPng(2, 3), width: 2, height: 3 },
  ]);
  const meta = readSnapshot(HOME, CWD, "abc");
  expect(meta?.captures[0]).toMatchObject({ route: "/", file: "_root.png", width: 2, height: 3 });
});
```

- [ ] **Step 2: Implement** — write PNG buffers as files via `fs.writeFileSync`, write `meta.json`

- [ ] **Step 3: Test, commit**

### Task 3.4: History rolloff

**Files:**
- Create: `src/storage/history.ts`
- Create: `tests/storage/history.test.ts`

```ts
export type RolloffResult = {
  removed: string[];     // shas removed
  warned: boolean;       // true if this is the first time we hit the limit
};

export function applyRolloff(home: string, cwd: string, limit: number): RolloffResult;
```

Behavior:
- After each new snapshot, count snapshots
- If > limit, delete the (count - limit) oldest by timestamp
- A warning sentinel file `<projectDir>/warned.json` records whether we've already shown the "history full" warning. Set on first overflow; never warn again.

- [ ] **Step 1: Failing test** — seed 21 fake snapshots, run rolloff with limit=20, expect 1 removed and warned=true. Run again with limit=20 (still 20 snapshots) → expect 0 removed and warned=false. Add a 21st → expect 1 removed and warned=false (already warned).

- [ ] **Step 2: Implement**

```ts
import { existsSync, readFileSync, writeFileSync, rmSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { projectDir } from "./paths.js";
import { listSnapshots } from "./snapshots.js";

export type RolloffResult = { removed: string[]; warned: boolean };

export function applyRolloff(home: string, cwd: string, limit: number): RolloffResult {
  const dir = projectDir(home, cwd);
  const snaps = listSnapshots(home, cwd); // newest first
  if (snaps.length <= limit) return { removed: [], warned: false };

  const toRemove = snaps.slice(limit); // oldest beyond cap
  for (const s of toRemove) {
    rmSync(join(dir, "snapshots", s.sha), { recursive: true, force: true });
  }

  const warnFile = join(dir, "warned.json");
  let warned = false;
  if (!existsSync(warnFile)) {
    writeFileSync(warnFile, JSON.stringify({ warnedAt: Date.now() }));
    warned = true;
  }
  return { removed: toRemove.map((s) => s.sha), warned };
}
```

- [ ] **Step 3: Test, commit**

---

# Phase 4 — Capture Engine

**Output of phase:** Given a URL and an expected commit SHA, flip launches Puppeteer, waits for readiness, takes a full-page screenshot, and returns a buffer plus dimensions.

### Task 4.1: Browser lifecycle

**Files:**
- Create: `src/capture/browser.ts`
- Create: `tests/capture/browser.test.ts` (integration; gated by `RUN_PUPPETEER=1`)

```ts
export interface BrowserHandle {
  newPage(): Promise<Page>; // re-export puppeteer types
  close(): Promise<void>;
}

export async function launchBrowser(): Promise<BrowserHandle>;
```

- [ ] **Step 1: Test (integration, gated)**

```ts
import { describe, it, expect } from "vitest";
import { launchBrowser } from "../../src/capture/browser.js";

const RUN = process.env.RUN_PUPPETEER === "1";
describe.skipIf(!RUN)("browser", () => {
  it("launches and closes", async () => {
    const b = await launchBrowser();
    const p = await b.newPage();
    await p.goto("about:blank");
    await b.close();
    expect(true).toBe(true);
  });
});
```

- [ ] **Step 2: Implement**

```ts
import puppeteer, { Browser, Page } from "puppeteer";

export async function launchBrowser() {
  const browser: Browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox"],
  });
  return {
    newPage: () => browser.newPage() as Promise<Page>,
    close: () => browser.close(),
  };
}
```

- [ ] **Step 3: Verify with `RUN_PUPPETEER=1 pnpm test`, commit**

### Task 4.2: Page-ready detection

**Files:**
- Create: `src/capture/ready.ts`
- Create: `tests/capture/ready.test.ts`

`waitForReady(page, url, expectedSha, opts)` does:
1. Loop fetching `url` until 200 or timeout. Use `node:http` request, not Puppeteer (so we can detect 200 without waiting for full page load).
2. `page.goto(url, { waitUntil: "load" })` — fires once `load` has fired (CSS, fonts, images, video first frame all ready, per spec).
3. Check `document.body.dataset.flipBuildId` equals `expectedSha`. If yes, ready immediately. If no, wait `fallbackBufferMs` (default 750 ms) and proceed anyway. **Silent degradation per spec** — no error, no retry.
4. Return `{ matched: boolean }` so caller can log telemetry but never user-facing.

- [ ] **Step 1: Failing tests** — use a tiny in-process `http.createServer` to serve a fixture page; test the marker-match path and the no-marker fallback path. Mock the page object as a typed stub; or use real Puppeteer behind the same `RUN_PUPPETEER` gate.

```ts
// Pseudocode — see real test for full implementation
it("returns matched=true when build id present", async () => {
  // server serves <body data-flip-build-id="abc">
  const page = await browser.newPage();
  const r = await waitForReady(page, url, "abc", { fallbackBufferMs: 50 });
  expect(r.matched).toBe(true);
});

it("returns matched=false but resolves when marker absent", async () => {
  // server serves <body>
  const r = await waitForReady(page, url, "xyz", { fallbackBufferMs: 50 });
  expect(r.matched).toBe(false);
});

it("rejects when 200 never arrives (timeout)", async () => {
  await expect(
    waitForReady(page, "http://127.0.0.1:1/", "x", { httpTimeoutMs: 100 }),
  ).rejects.toThrow(/timeout/);
});
```

- [ ] **Step 2: Implement**

```ts
import http from "node:http";
import type { Page } from "puppeteer";

export type ReadyOpts = {
  httpTimeoutMs?: number;       // default 30000
  pollIntervalMs?: number;      // default 250
  fallbackBufferMs?: number;    // default 750
};

export async function waitForReady(
  page: Page,
  url: string,
  expectedSha: string,
  opts: ReadyOpts = {},
): Promise<{ matched: boolean }> {
  const httpTimeoutMs = opts.httpTimeoutMs ?? 30_000;
  const pollIntervalMs = opts.pollIntervalMs ?? 250;
  const fallbackBufferMs = opts.fallbackBufferMs ?? 750;

  await waitFor200(url, httpTimeoutMs, pollIntervalMs);
  await page.goto(url, { waitUntil: "load" });

  const buildId = await page.evaluate(
    () => (document.body.dataset?.flipBuildId as string | undefined) ?? null,
  );

  if (buildId === expectedSha) return { matched: true };
  await new Promise((r) => setTimeout(r, fallbackBufferMs));
  return { matched: false };
}

function waitFor200(url: string, timeoutMs: number, intervalMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const tick = () => {
      const req = http.get(url, (res) => {
        res.resume();
        if (res.statusCode === 200) resolve();
        else retry();
      });
      req.on("error", retry);
      req.setTimeout(intervalMs * 4, () => {
        req.destroy();
        retry();
      });
    };
    const retry = () => {
      if (Date.now() > deadline) reject(new Error("timeout waiting for 200"));
      else setTimeout(tick, intervalMs);
    };
    tick();
  });
}
```

- [ ] **Step 3: Test, commit**

### Task 4.3: Full-page screenshot with dimensions

**Files:**
- Create: `src/capture/snapshot.ts`
- Create: `tests/capture/snapshot.test.ts`

```ts
export type CaptureResult = {
  pngBuffer: Buffer;
  width: number;
  height: number;
};

export async function captureRoute(
  page: Page,
  url: string,
  expectedSha: string,
): Promise<CaptureResult>;
```

Behavior:
- Set viewport to 1280×800 (sane default; configurable later)
- Call `waitForReady`
- Use `page.screenshot({ fullPage: true, type: "png" })`
- Read content size via `document.documentElement.scrollWidth/scrollHeight` for dimension metadata

- [ ] **Step 1: Integration test** (gated by RUN_PUPPETEER) — start a fixture server returning a 600×2400 page, capture, expect width=600, height=2400, png is decodable

- [ ] **Step 2: Implement**

```ts
import type { Page } from "puppeteer";
import { waitForReady } from "./ready.js";

export async function captureRoute(page: Page, url: string, expectedSha: string) {
  await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1 });
  await waitForReady(page, url, expectedSha);
  const dims = await page.evaluate(() => ({
    width: document.documentElement.scrollWidth,
    height: document.documentElement.scrollHeight,
  }));
  const pngBuffer = (await page.screenshot({ fullPage: true, type: "png" })) as Buffer;
  return { pngBuffer, width: dims.width, height: dims.height };
}
```

- [ ] **Step 3: Test, commit**

---

# Phase 5 — Git Integration

**Output of phase:** Given a repo, we can detect HEAD changes and compute the file-diff between the previous and current HEAD.

### Task 5.1: Repo helpers

**Files:**
- Create: `src/git/repo.ts`
- Create: `tests/git/repo.test.ts`

```ts
export function isGitRepo(cwd: string): boolean;
export async function head(cwd: string): Promise<{ sha: string; message: string; timestamp: number }>;
```

- [ ] **Step 1: Failing test** — initialize a temp repo via `simple-git`, make a commit, expect `head()` to return the right sha + message

- [ ] **Step 2: Implement using `simple-git`**

```ts
import simpleGit from "simple-git";
import { existsSync } from "node:fs";
import { join } from "node:path";

export function isGitRepo(cwd: string): boolean {
  return existsSync(join(cwd, ".git"));
}

export async function head(cwd: string) {
  const git = simpleGit(cwd);
  const log = await git.log({ maxCount: 1 });
  const c = log.latest!;
  return { sha: c.hash, message: c.message, timestamp: new Date(c.date).getTime() };
}
```

- [ ] **Step 3: Test, commit**

### Task 5.2: Changed-file diff

**Files:**
- Create: `src/git/diff.ts`
- Create: `tests/git/diff.test.ts`

```ts
export async function changedFiles(cwd: string, fromSha: string | null, toSha: string): Promise<string[]>;
```

- `fromSha === null` (first commit ever): return all tracked files at `toSha`.
- Otherwise: `git diff --name-only fromSha toSha`.

- [ ] **Step 1: Failing test** — repo with two commits, expect diff returns the file modified in second commit

- [ ] **Step 2: Implement**

```ts
import simpleGit from "simple-git";

export async function changedFiles(
  cwd: string,
  fromSha: string | null,
  toSha: string,
): Promise<string[]> {
  const git = simpleGit(cwd);
  if (fromSha === null) {
    const ls = await git.raw(["ls-tree", "-r", "--name-only", toSha]);
    return ls.split("\n").filter(Boolean);
  }
  const out = await git.raw(["diff", "--name-only", fromSha, toSha]);
  return out.split("\n").filter(Boolean);
}
```

- [ ] **Step 3: Test, commit**

### Task 5.3: HEAD watcher

**Files:**
- Create: `src/git/watcher.ts`
- Create: `tests/git/watcher.test.ts`

Use `chokidar` to watch `.git/HEAD` and `.git/refs/heads/*`. Debounce 200 ms. Emit on change with the new HEAD sha.

```ts
import { EventEmitter } from "node:events";

export interface HeadWatcher extends EventEmitter {
  on(event: "head", listener: (sha: string) => void): this;
  stop(): Promise<void>;
}

export async function watchHead(cwd: string): Promise<HeadWatcher>;
```

- [ ] **Step 1: Failing test** — start watcher, make a commit, expect "head" event with the new sha within 2 s

- [ ] **Step 2: Implement** — chokidar watcher + debounce + read HEAD via simple-git

- [ ] **Step 3: Test, commit**

---

# Phase 6 — Daemon & CLI Wiring

**Output of phase:** `flip start` boots a detached daemon process that prints the four-line first-run output then goes silent. `flip stop` shuts it down. `flip snap` triggers a manual capture for the current cwd via the daemon. End-to-end: `flip start` in a Next.js project, make a commit, find a PNG in `~/.flip/projects/<hash>/snapshots/<sha>/`.

### Task 6.1: IPC protocol

**Files:**
- Create: `src/ipc/protocol.ts`
- Create: `src/ipc/client.ts`
- Create: `src/daemon/ipc-server.ts`
- Create: `tests/ipc/roundtrip.test.ts`

JSON-RPC over Unix socket at `~/.flip/daemon.sock`. Newline-delimited JSON.

```ts
export type Request =
  | { id: number; method: "ping" }
  | { id: number; method: "register"; cwd: string; port?: number }
  | { id: number; method: "snap"; cwd: string }
  | { id: number; method: "shutdown" }
  | { id: number; method: "status" };

export type Response =
  | { id: number; ok: true; result: unknown }
  | { id: number; ok: false; error: string };
```

- [ ] **Step 1: Failing test** — start a server with a `ping` handler, send a request from `client.ts`, assert response

- [ ] **Step 2: Implement** — `net.createServer({ allowHalfOpen: false })`, line buffering, Promise-based client

- [ ] **Step 3: Commit**

### Task 6.2: Daemon process management

**Files:**
- Create: `src/daemon/lifecycle.ts`
- Create: `tests/daemon/lifecycle.test.ts`

API:
- `isRunning(home): Promise<boolean>` — checks pid file exists and process is alive (signal 0)
- `spawnDaemon(home): Promise<void>` — fork detached child running `dist/daemon/index.js`, write pid file
- `stopDaemon(home): Promise<void>` — sends RPC `shutdown`; falls back to SIGTERM after 2 s

- [ ] **Step 1: Failing test** — spawnDaemon, isRunning=true, ping succeeds, stopDaemon, isRunning=false

- [ ] **Step 2: Implement**

```ts
import { spawn } from "node:child_process";
import { join } from "node:path";
import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { flipHome } from "../storage/paths.js";
import { sendRpc } from "../ipc/client.js";

const PID = (home: string) => join(flipHome(home), "daemon.pid");

export async function isRunning(home: string): Promise<boolean> {
  if (!existsSync(PID(home))) return false;
  const pid = Number(readFileSync(PID(home), "utf8"));
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export async function spawnDaemon(home: string, daemonEntry: string): Promise<void> {
  mkdirSync(flipHome(home), { recursive: true });
  const child = spawn(process.execPath, [daemonEntry], {
    detached: true,
    stdio: "ignore",
    env: { ...process.env, FLIP_HOME: home },
  });
  child.unref();
  writeFileSync(PID(home), String(child.pid));
  // wait until socket responds to ping (≤ 5s)
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    try {
      await sendRpc(home, { method: "ping" } as never);
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  throw new Error("daemon failed to start");
}

export async function stopDaemon(home: string): Promise<void> {
  try {
    await sendRpc(home, { method: "shutdown" } as never);
  } catch {
    if (existsSync(PID(home))) {
      const pid = Number(readFileSync(PID(home), "utf8"));
      try { process.kill(pid, "SIGTERM"); } catch { /* gone */ }
    }
  }
  rmSync(PID(home), { force: true });
}
```

- [ ] **Step 3: Test, commit**

### Task 6.3: Project registry (concurrent multi-project state)

**Files:**
- Create: `src/daemon/registry.ts`
- Create: `tests/daemon/registry.test.ts`

The registry holds in-memory state for every registered project. Projects run independently — each has its own watcher, capture queue, and (in Phase 7) injection proxy. The shared resource is the Puppeteer browser; projects use separate `Page` instances.

```ts
export type ProjectState = {
  cwd: string;
  meta: ProjectMeta;             // from storage/projects
  resolvedUrl: string;           // dev URL (may become proxy URL after Phase 7)
  watcher: HeadWatcher | null;   // null for non-git projects
  queue: AsyncQueue;             // serializes captures within a single project
  // Phase 7 adds: proxy: InjectionProxy
};

export interface AsyncQueue {
  enqueue(task: () => Promise<void>): void;
  drain(): Promise<void>;
}

export class ProjectRegistry {
  add(state: ProjectState): void;
  get(cwd: string): ProjectState | undefined;
  list(): ProjectState[];
  remove(cwd: string): Promise<void>;       // stops watcher, drains queue
  shutdown(): Promise<void>;                // remove all
}
```

**Concurrency rules:**
- Different projects run captures in parallel (each project's queue runs independently)
- Within a single project, captures are serialized (a fast burst of commits queues; we never run two captures for the same project at once)
- Browser is shared; each capture opens a new Page, captures, closes the page

- [ ] **Step 1: Failing tests** — register two projects, fire HEAD events on both simultaneously, assert both queues drain and both projects produce snapshots. Fire two HEAD events on the same project rapidly, assert second runs after first completes.

- [ ] **Step 2: Implement** — `AsyncQueue` is a 20-line class with a Promise chain

- [ ] **Step 3: Test, commit**

### Task 6.4: Daemon orchestrator

**Files:**
- Create: `src/daemon/index.ts`
- Create: `src/daemon/orchestrator.ts`
- Create: `tests/daemon/orchestrator.test.ts`

Orchestrator handles "snap this commit" for a single project:
1. Read current HEAD
2. Compute changed files vs last-stored snapshot's sha
3. Map to routes
4. For each route, open a fresh Page on the shared browser, capture
5. Persist + applyRolloff
6. Update project meta `lastSeen`

`src/daemon/index.ts` is the entrypoint that:
- Boots Puppeteer browser (one shared instance) and viewer HTTP server (Phase 8)
- Creates a `ProjectRegistry`
- Starts IPC server
- On RPC `register`: validates framework + URL, creates `ProjectState`, starts HEAD watcher (if git repo), adds to registry. Watcher events `enqueue` an `orchestrator.snapCommit` call onto the project's queue.
- Implements RPC methods: ping, register, snap, status, shutdown

- [ ] **Step 1: Failing test** — set up two fake repos with one commit each, register both, fire commits on both within 100 ms, assert both PNGs exist. Use `RUN_PUPPETEER=1` gating; for unit tests, abstract `captureRoute` behind an injectable function.

```ts
// orchestrator.ts signature
export type Capturer = (page: Page, url: string, sha: string) => Promise<CaptureResult>;
export async function snapCommit(deps: {
  home: string; cwd: string; capturer: Capturer; browser: BrowserHandle;
}, sha: string): Promise<{ routes: string[]; warned: boolean }>;
```

- [ ] **Step 2: Implement** — reuse Phase 2/3/4/5 modules

- [ ] **Step 3: Test, commit

### Task 6.5: Wire CLI commands

**Files:**
- Modify: `src/cli/start.ts`
- Modify: `src/cli/stop.ts`
- Modify: `src/cli/snap.ts`
- Modify: `src/cli/clear.ts`
- Modify: `src/cli/open.ts`
- Create: `tests/cli/start.test.ts` etc.

Behavior per command (matching spec):

- `flip start [--port N]`:
  1. Detect framework. If `unknown`, print one line: `flip: framework not detected. flip works with Next.js, Vite, SvelteKit, Astro, Remix, or plain HTML.` Exit 1.
  2. Resolve URL. If null and framework needs URL, print: `flip: pass --port N (or use portless).` Exit 1.
  3. If daemon not running, spawn it.
  4. RPC `register` (cwd, port?).
  5. Open browser to `http://localhost:42069`.
  6. Print exactly the four-line message from spec:
     ```
     flip: detected <Framework Display Name>
     flip: watching <url-or-host>
     flip: viewer at localhost:42069
     flip: ready. Make a commit to capture your first snapshot.
     ```
     (When project has no git repo, replace last line with: `flip: ready. Run 'flip snap' to capture.`)
  7. Exit 0 — daemon keeps running detached.

- `flip` (bare):
  - If daemon not running: print `flip: daemon not running. Run 'flip start' first.` exit 1.
  - Else: open browser to `localhost:42069`. Print nothing.

- `flip stop`:
  - If running: send shutdown, print `flip: stopped.` exit 0.
  - Else: print `flip: not running.` exit 0.

- `flip snap`:
  - If daemon not running: same as bare.
  - RPC `snap` for current cwd. Print nothing on success. On error, single-line message.

- `flip clear`:
  - Prompt: `Delete all snapshot history? (y/N) ` — read from stdin (use `node:readline`).
  - On `y` / `Y`: stop daemon, `rm -rf ~/.flip/projects` (keep config), restart? No — spec doesn't say. Just delete projects, leave daemon alive (it'll detect empty registry next watch tick).
  - On other: exit silently.

- [ ] **Step 1: Failing tests** for each command using mocked dependencies (inject `runDaemon`, `sendRpc`, `process.exit`, `console.log` as parameters via a context object — or use `vi.mock`)

- [ ] **Step 2: Implement** each handler

- [ ] **Step 3: Open browser:** spec doesn't specify how. Use `node:child_process` + platform check:

```ts
import { exec } from "node:child_process";
function openBrowser(url: string) {
  const cmd = process.platform === "darwin" ? `open "${url}"`
    : process.platform === "win32" ? `start "" "${url}"`
    : `xdg-open "${url}"`;
  exec(cmd);
}
```

- [ ] **Step 4: Manual smoke test** — in a temp Next.js project: `flip start --port 3000`, dev server running on 3000, make a commit, verify PNG appears under `~/.flip/projects/<hash>/snapshots/<sha>/`. Document the run in the commit message.

- [ ] **Step 5: Commit**

---

# Phase 7 — Build ID Marker (Auto-Injection)

**Output of phase:** Flip auto-injects `<body data-flip-build-id="<sha>">` into the running dev server's HTML responses for every supported framework. Capture deterministically knows when the page is fresh after a commit. When auto-injection genuinely cannot succeed (unknown framework, custom server we can't intercept), fall back silently to `load` event + buffer per spec.

**Mechanism:** Flip runs a transparent HTTP proxy in front of the user's dev server. The dev URL the daemon screenshots becomes the proxy's URL; the proxy forwards everything to the real dev server but rewrites HTML responses to inject the marker.

- For `--port N` mode: proxy listens on a flip-allocated port and points at `localhost:N`. Capture URL becomes the proxy's URL.
- For portless mode: portless already routes `myapp.localhost` → real port. Flip inserts itself between portless and the real port. (If portless exposes a hook for response rewrites, prefer that. Confirm with portless API before implementation.)
- Injection: parse only `Content-Type: text/html` responses. Use a streaming HTML rewriter (`parse5` or `htmlparser2` — pick whichever is smaller). Find the `<body>` open tag; add or replace `data-flip-build-id` attribute with the current commit sha. Pass everything else through untouched (including streaming responses, byte-for-byte).
- The current sha is updated whenever the daemon detects a HEAD change, before triggering capture.
- Failure modes (proxy can't bind, target server returns non-HTML for the route, response is gzipped + chunked in a way the rewriter can't handle): log silently to `~/.flip/log`, marker absent → `waitForReady` falls back to load + buffer.

### Task 7.1: HTML-injecting proxy

**Files:**
- Create: `src/inject/proxy.ts`
- Create: `src/inject/html-rewrite.ts`
- Create: `tests/inject/proxy.test.ts`
- Create: `tests/inject/html-rewrite.test.ts`

```ts
// proxy.ts
export interface InjectionProxy {
  url: string;                 // the URL capture should hit
  setBuildId(sha: string): void;
  stop(): Promise<void>;
}
export async function startInjectionProxy(opts: {
  targetUrl: string;           // real dev server, e.g. http://localhost:3000
  listenPort?: number;         // 0 = pick free port
}): Promise<InjectionProxy>;
```

```ts
// html-rewrite.ts
export function rewriteBodyTag(html: string, buildId: string): string;
```

- [ ] **Step 1: Failing tests for `rewriteBodyTag`**

```ts
it("adds data-flip-build-id when missing", () => {
  expect(rewriteBodyTag("<html><body><h1>x</h1></body></html>", "abc"))
    .toBe('<html><body data-flip-build-id="abc"><h1>x</h1></body></html>');
});
it("replaces existing attribute", () => {
  expect(rewriteBodyTag('<body data-flip-build-id="old">', "new"))
    .toBe('<body data-flip-build-id="new">');
});
it("handles body with other attrs", () => {
  expect(rewriteBodyTag('<body class="foo">', "abc"))
    .toBe('<body class="foo" data-flip-build-id="abc">');
});
it("returns input unchanged when no body tag", () => {
  expect(rewriteBodyTag("<div>fragment</div>", "abc"))
    .toBe("<div>fragment</div>");
});
```

- [ ] **Step 2:** Implement using a small regex-based rewriter (no parser overhead — body open tag is well-defined enough). Validate the regex covers `<body>`, `<body attr="x">`, `<body\nclass="...">` (multi-line attrs).

- [ ] **Step 3: Failing tests for proxy**

```ts
it("injects marker into HTML responses", async () => {
  const upstream = http.createServer((_, res) => {
    res.setHeader("content-type", "text/html");
    res.end("<html><body><h1>hi</h1></body></html>");
  }).listen(0);
  const proxy = await startInjectionProxy({ targetUrl: `http://localhost:${upstream.address().port}` });
  proxy.setBuildId("abc123");
  const body = await (await fetch(proxy.url)).text();
  expect(body).toContain('data-flip-build-id="abc123"');
  await proxy.stop(); upstream.close();
});

it("passes non-HTML through untouched", async () => {
  // upstream serves application/json — proxy returns identical bytes
});

it("supports gzipped HTML by decoding, rewriting, re-encoding", async () => {
  // upstream returns Content-Encoding: gzip; proxy still injects
});
```

- [ ] **Step 4:** Implement with `node:http` + `node:https` + `node:zlib`. Buffer HTML responses (reasonable since dev HTML is small), passthrough everything else as a stream.

- [ ] **Step 5:** Test, commit

### Task 7.2: Wire proxy into daemon orchestrator

**Files:**
- Modify: `src/daemon/orchestrator.ts` — when registering a project, start an injection proxy in front of the resolved dev URL; capture targets the proxy URL; before each commit's capture, call `proxy.setBuildId(sha)`
- Modify: `src/daemon/index.ts` — track proxy per project, stop on shutdown
- Modify: `tests/daemon/orchestrator.test.ts`

- [ ] **Step 1:** Add `proxy` to per-project state in orchestrator
- [ ] **Step 2:** Update capture call site to use `proxy.url` instead of `resolved.url` (resolved.url stays in project meta for display)
- [ ] **Step 3:** Failing test — register a project pointing at a fixture server, snap, assert `waitForReady` returned `matched: true`
- [ ] **Step 4:** Test, commit

### Task 7.3: Silent failure logging

**Files:**
- Modify: `src/capture/ready.ts` — return `{ matched, reason }` where reason is `"matched"|"absent"|"mismatch"`
- Modify: `src/daemon/orchestrator.ts` — when `matched: false`, append a single-line log entry to `~/.flip/log`. Never console output.
- Create: `docs/build-id-marker.md` — document how the proxy works, the fallback path, and how to inspect `~/.flip/log` for diagnostics

- [ ] **Step 1:** Implement
- [ ] **Step 2:** Test, commit

---

# Phase 8 — Viewer HTTP Server

**Output of phase:** `localhost:42069` returns an HTML shell, serves static assets, and exposes `/api/projects`, `/api/projects/:cwd/snapshots`, `/api/snapshots/:cwd/:sha/:slug.png`, `/api/diff?cwd=&from=&to=&route=` (server-side pixelmatch).

### Task 8.1: HTTP server skeleton

**Files:**
- Create: `src/viewer/server.ts`
- Create: `src/viewer/static.ts`
- Create: `src/viewer/api.ts`
- Create: `tests/viewer/server.test.ts`

```ts
export async function startViewer(opts: { home: string; port: number }): Promise<{ stop(): Promise<void> }>;
```

- [ ] **Step 1: Failing test** — start server on a random port, GET `/`, expect 200 and HTML containing `<div id="root">`

- [ ] **Step 2: Implement** — `node:http` server; routes:
  - `GET /api/projects` → JSON list (call `listProjects(home)`)
  - `GET /api/projects/:hashedCwd/snapshots` → list of `SnapshotMeta`
  - `GET /snapshots/:hashedCwd/:sha/:filename.png` → stream the file with `image/png` content type
  - `GET /api/diff?cwd=&from=&to=&route=` → JSON { url } where url points to a generated PNG
  - All other GETs → static file from `src/viewer/public`
  - Default `/` → `public/index.html`

- [ ] **Step 3: Daemon hook** — `daemon/index.ts` calls `startViewer({ home, port: 42069 })` on boot

- [ ] **Step 4: Test, commit**

### Task 8.2: API endpoints

**Files:**
- Modify: `src/viewer/api.ts`
- Create: `tests/viewer/api.test.ts`

- [ ] **Step 1: Failing tests** — seed storage with a fake project + 3 snapshots; expect `/api/projects` returns the project; expect `/api/projects/<hash>/snapshots` returns 3 entries newest first

- [ ] **Step 2: Implement** the routes

- [ ] **Step 3: Commit**

---

# Phase 9 — Viewer UI

**Output of phase:** A working SPA at `localhost:42069` matching the spec's UI: home view (project tabs/list), project view (commit selector, before/after toggle, diff toggle, full-page screenshot at native dims), empty states.

**Key constraint:** No build step. Plain ES modules. Use the platform.

### Task 9.1: HTML shell + router

**Files:**
- Create: `src/viewer/public/index.html`
- Create: `src/viewer/public/app.js`
- Create: `src/viewer/public/styles.css`
- Create: `src/viewer/public/views/home.js`
- Create: `src/viewer/public/views/project.js`

`index.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>flip</title>
    <link rel="stylesheet" href="/styles.css" />
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/app.js"></script>
  </body>
</html>
```

`app.js`:

```js
import { renderHome } from "/views/home.js";
import { renderProject } from "/views/project.js";

const root = document.getElementById("root");

function render() {
  const hash = location.hash || "#/";
  if (hash.startsWith("#/project/")) {
    const cwdHash = hash.slice("#/project/".length);
    renderProject(root, cwdHash);
  } else {
    renderHome(root);
  }
}

window.addEventListener("hashchange", render);
render();
```

- [ ] **Step 1:** Write the three files. No tests yet — wait until the views render.

### Task 9.2: Home view

**Files:**
- Modify: `src/viewer/public/views/home.js`

Behavior:
- Fetches `/api/projects`
- If empty: render the empty-state quote *"Flip is watching. Make a commit to capture your first snapshot."*
- Else: render a list. Each row: project name, last snapshot timestamp (relative: "2 minutes ago"), commit count. Click → `location.hash = "#/project/<hashedCwd>"`.

```js
export async function renderHome(root) {
  root.innerHTML = `<div class="loading">…</div>`;
  const res = await fetch("/api/projects");
  const projects = await res.json();
  if (projects.length === 0) {
    root.innerHTML = `<div class="empty">Flip is watching. Make a commit to capture your first snapshot.</div>`;
    return;
  }
  root.innerHTML = `
    <header><h1>flip</h1></header>
    <ul class="projects">
      ${projects.map(p => `
        <li>
          <a href="#/project/${p.hashedCwd}">
            <span class="name">${escapeHtml(p.name)}</span>
            <span class="meta">${p.snapshotCount} commits · ${rel(p.lastSeen)}</span>
          </a>
        </li>
      `).join("")}
    </ul>
  `;
}
```

(Helpers `escapeHtml`, `rel` — colocate in same file, ~10 lines each.)

- [ ] **Step 1:** Implement
- [ ] **Step 2: Manual test:** seed 2 projects, refresh, click into one, hash changes — verify
- [ ] **Step 3: Commit**

### Task 9.3: Project view — commit selector + before/after

**Files:**
- Modify: `src/viewer/public/views/project.js`

UI elements per spec:
- Back button (top-left) → `location.hash = "#/"`
- Commit selector: `<select>` of "<short-sha> · <message> · <relative-time>", newest first
- Before/After toggle: a single button labeled "before" or "after". Clicking flips. Spec says "by feel" — same image element swaps `src` between two precomputed URLs.
- Full-page screenshot: `<img>` at native dimensions (no scaling). Wrap in a scrollable container for tall pages.
- Diff toggle: third button. When on, image src points to `/api/diff?...`.

State: `{ snapshots[], currentIdx, mode: "before"|"after"|"diff" }`. `currentIdx=0` is newest. "Before" = `snapshots[currentIdx+1]`. "After" = `snapshots[currentIdx]`. If only one snapshot exists, before/diff disabled.

Multi-route handling: each snapshot may have multiple captures. Render a route selector below commit selector. v1 default: first route. (Spec doesn't dictate the exact UX; this is reasonable.)

```js
export async function renderProject(root, hashedCwd) {
  root.innerHTML = `<div class="loading">…</div>`;
  const res = await fetch(`/api/projects/${hashedCwd}/snapshots`);
  const snapshots = await res.json();
  if (snapshots.length === 0) {
    root.innerHTML = baselineEmpty();
    return;
  }
  let currentIdx = 0;
  let route = snapshots[0].captures[0]?.route ?? "/";
  let mode = "after";

  const draw = () => {
    const after = snapshots[currentIdx];
    const before = snapshots[currentIdx + 1];
    const cap = after.captures.find(c => c.route === route);
    let src;
    if (mode === "after") src = imgUrl(hashedCwd, after.sha, route);
    else if (mode === "before" && before) src = imgUrl(hashedCwd, before.sha, route);
    else if (mode === "diff" && before) src = `/api/diff?cwd=${hashedCwd}&from=${before.sha}&to=${after.sha}&route=${encodeURIComponent(route)}`;
    else src = imgUrl(hashedCwd, after.sha, route);

    root.innerHTML = `
      <header>
        <a href="#/" class="back">← back</a>
        <select class="commit">${snapshots.map((s, i) =>
          `<option value="${i}" ${i===currentIdx?"selected":""}>${s.sha.slice(0,7)} · ${escapeHtml(s.message)}</option>`).join("")}</select>
        <select class="route">${after.captures.map(c =>
          `<option value="${c.route}" ${c.route===route?"selected":""}>${escapeHtml(c.route)}</option>`).join("")}</select>
        <button class="mode" data-m="before" ${!before?"disabled":""}>before</button>
        <button class="mode" data-m="after">after</button>
        <button class="mode" data-m="diff" ${!before?"disabled":""}>diff</button>
      </header>
      <main class="canvas">
        <img src="${src}" width="${cap.width}" height="${cap.height}" alt="" />
      </main>
    `;
    root.querySelector(".commit").onchange = (e) => { currentIdx = Number(e.target.value); draw(); };
    root.querySelector(".route").onchange  = (e) => { route = e.target.value; draw(); };
    root.querySelectorAll(".mode").forEach(b => b.onclick = () => { mode = b.dataset.m; draw(); });
  };
  draw();
}

function imgUrl(cwd, sha, route) {
  const slug = route === "/" ? "_root" : route.replace(/^\//,"").replace(/\//g,"_");
  return `/snapshots/${cwd}/${sha}/${slug}.png`;
}

function baselineEmpty() {
  return `<div class="empty">Flip is now active. Your baseline is set.</div>`;
}
```

- [ ] **Step 1:** Implement
- [ ] **Step 2: Manual test:** with 2 commits' worth of snapshots, verify before/after/diff swap; verify route selector
- [ ] **Step 3: Commit**

### Task 9.4: Visual design — Frank design system

Spec: "Uses Frank's design system for consistency across tools."

**Source:** `/Users/carlostarrats/Documents/frank/ui-v2/styles/tokens.css` is the canonical Frank token file. It's a shadcn-derived set — preset b50cupdRo, Lyra style, Neutral base, Geist Mono, dark mode default with `.light` class opt-in, `--radius: 0` (sharp corners). Copy it verbatim into `src/viewer/public/tokens.css` and import it from `index.html` ahead of `styles.css`. The flip-specific layout rules below reference the canonical Frank tokens (`--background`, `--foreground`, `--muted`, `--muted-foreground`, `--border`, `--card`, `--ring`, `--font-sans`, `--space-*`, `--text-*`, `--shadow`, `--duration-base`, `--ease-standard`).

**Files:**
- Create: `src/viewer/public/tokens.css` — verbatim copy of Frank's tokens.css
- Create: `src/viewer/public/styles.css` — flip layout/components, references Frank tokens only

- [ ] **Step 1: Copy Frank tokens**

```bash
cp /Users/carlostarrats/Documents/frank/ui-v2/styles/tokens.css src/viewer/public/tokens.css
```

Add a one-line comment at the top recording the source path and date copied (so future maintenance knows where to re-pull from).

- [ ] **Step 2: Update `index.html` to import tokens first**

```html
<link rel="stylesheet" href="/tokens.css" />
<link rel="stylesheet" href="/styles.css" />
```

- [ ] **Step 3: Write `src/viewer/public/styles.css`**

```css
/* flip layout. All colors/spacing/type via Frank tokens in tokens.css. */

#root { display: flex; flex-direction: column; min-height: 100vh; }

header {
  display: flex;
  gap: var(--space-3);
  align-items: center;
  padding: var(--space-3) var(--space-4);
  border-bottom: 1px solid var(--border);
  background: var(--card);
}

header h1 {
  font-size: var(--text-lg);
  font-weight: 500;
  letter-spacing: 0.02em;
}

button, select {
  background: transparent;
  color: var(--foreground);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: var(--space-2) var(--space-3);
  font-family: var(--font-sans);
  font-size: var(--text-sm);
  transition: border-color var(--duration-base) var(--ease-standard),
              background var(--duration-base) var(--ease-standard);
}
button:hover:not([disabled]),
select:hover { border-color: var(--ring); }
button[disabled] { opacity: 0.4; cursor: not-allowed; }

.canvas {
  padding: 0;
  overflow: auto;
  flex: 1;
  background: var(--background);
}
.canvas img { display: block; }

.empty {
  padding: var(--space-12) var(--space-6);
  text-align: center;
  color: var(--muted-foreground);
  font-style: italic;
  max-width: 480px;
  margin: 0 auto;
}

.projects { list-style: none; padding: 0; margin: 0; }
.projects li a {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: var(--space-4) var(--space-6);
  color: inherit;
  text-decoration: none;
  border-bottom: 1px solid var(--border);
  transition: background var(--duration-fast) var(--ease-standard);
}
.projects li a:hover { background: var(--muted); }

.name { font-size: var(--text-base); }
.meta { color: var(--muted-foreground); font-size: var(--text-xs); }
.back { color: var(--muted-foreground); text-decoration: none; font-size: var(--text-sm); }
.back:hover { color: var(--foreground); }

.commit, .route { min-width: 0; }
```

- [ ] **Step 4: Manual visual check** — open `localhost:42069`, verify Geist Mono is loading (or system mono fallback), dark background, sharp corners, hover states feel right against Frank.

- [ ] **Step 5: Commit**

---

# Phase 10 — Pixel Diff

**Output of phase:** Diff mode highlights changed regions. Server generates the diff PNG on demand and caches it.

### Task 10.1: Server-side diff generation

**Files:**
- Create: `src/diff/pixelmatch.ts`
- Create: `tests/diff/pixelmatch.test.ts`

```ts
export async function generateDiff(opts: {
  home: string;
  cwd: string;
  fromSha: string;
  toSha: string;
  route: string;
}): Promise<{ pngPath: string; changedPixels: number }>;
```

Behavior:
- Resolve before/after PNG paths
- If dimensions differ, resize the smaller canvas to the larger and pad transparent (don't compare cropped — alignment matters for "what moved")
- Run pixelmatch with threshold 0.1, antialiasing on, diffColor red
- Write to `<snapshotDir>/<routeSlug>-vs-<fromShortSha>.diff.png`
- Cache: if file exists, return existing path

- [ ] **Step 1: Failing test** — write two synthetic 4×4 PNGs that differ in one pixel; expect `changedPixels === 1` and an output file

- [ ] **Step 2: Implement**

```ts
import { PNG } from "pngjs";
import pixelmatch from "pixelmatch";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { snapshotDir, routeSlug, projectDir } from "../storage/paths.js";

export async function generateDiff(o: {
  home: string; cwd: string; fromSha: string; toSha: string; route: string;
}) {
  const slug = routeSlug(o.route);
  const proj = projectDir(o.home, o.cwd);
  const fromPng = join(proj, "snapshots", o.fromSha, `${slug}.png`);
  const toPng = join(proj, "snapshots", o.toSha, `${slug}.png`);
  const outPath = join(proj, "snapshots", o.toSha, `${slug}-vs-${o.fromSha.slice(0,7)}.diff.png`);
  if (existsSync(outPath)) {
    return { pngPath: outPath, changedPixels: -1 }; // cached
  }
  const a = PNG.sync.read(readFileSync(fromPng));
  const b = PNG.sync.read(readFileSync(toPng));
  const w = Math.max(a.width, b.width);
  const h = Math.max(a.height, b.height);
  const ap = pad(a, w, h);
  const bp = pad(b, w, h);
  const diff = new PNG({ width: w, height: h });
  const changedPixels = pixelmatch(ap.data, bp.data, diff.data, w, h, { threshold: 0.1 });
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
```

- [ ] **Step 3: Test, commit**

### Task 10.2: `/api/diff` endpoint

**Files:**
- Modify: `src/viewer/api.ts`
- Modify: `tests/viewer/api.test.ts`

`GET /api/diff?cwd=<hash>&from=<sha>&to=<sha>&route=<encoded>` →
- Looks up project cwd by hash, calls `generateDiff`, redirects (302) to the static `/snapshots/...png` URL of the result, OR streams the file directly. Streaming is simpler — do that.

- [ ] **Step 1:** Failing test — request `/api/diff?...` for two snapshots that differ → response is `image/png`, body is non-empty
- [ ] **Step 2:** Implement
- [ ] **Step 3:** Commit

---

# Phase 11 — Polish & Edge Cases

### Task 11.1: First-overflow warning surfacing

**Files:**
- Modify: `src/daemon/orchestrator.ts`
- Modify: `src/cli/start.ts` (only relevant if user is foregrounded — but `flip start` exits. Drop in `~/.flip/log` instead.)

Spec line:
```
flip: history full (20 commits). Oldest snapshots will now roll off automatically.
```

Where does this print? Daemon is silent. CLI has already exited. Pragmatic answer: push it to `~/.flip/log` on first overflow AND surface in viewer as a one-time toast. Toast dismisses on click and a `dismissed` flag is written next to `warned.json`.

- [ ] **Step 1:** Add `/api/notifications` endpoint returning pending warnings
- [ ] **Step 2:** Viewer renders a toast div if any notifications; click → POST `/api/notifications/dismiss`
- [ ] **Step 3:** Test, commit

### Task 11.2: `flip clear` confirmation flow

Already covered in Task 6.5 — verify here that the clear command is truly destructive only after `y`/`Y`, and only deletes `~/.flip/projects` (not config.json, not the daemon).

- [ ] **Step 1:** Manual test: have 3 projects with snapshots, run `flip clear`, type `n` → nothing changes; run again, type `y` → `~/.flip/projects` is empty; viewer reloads to empty state

### Task 11.3: Documentation

**Files:**
- Create: `README.md`
- Create: `docs/limitations.md`
- Create: `docs/build-id-marker.md` (already created in Phase 7)

`README.md`: install (`pnpm i -g flip` once published, or `pnpm link` for dev), commands, screenshots.
`docs/limitations.md`: dynamic routes, auth pages, dependency-graph multi-page (deferred), single-project capture per session.

- [ ] **Step 1:** Write each
- [ ] **Step 2:** Commit

### Task 11.4: End-to-end smoke test

**Files:**
- Create: `tests/e2e/smoke.test.ts`

Gated by `RUN_E2E=1`. Spins up:
1. A throwaway Next.js app in `os.tmpdir()` (use `pnpm dlx create-next-app --typescript --no-tailwind --no-eslint --app --no-src-dir --import-alias '@/*' tmp`)
2. `pnpm dev` on that app on a random port
3. `flip start --port <port>` against that cwd
4. `git init`, commit, expect a snapshot to appear within 30 s
5. Edit a page, commit again, expect a second snapshot
6. Hit `/api/projects` and `/api/diff`, assert both return data

- [ ] **Step 1:** Write the test
- [ ] **Step 2:** Run with `RUN_E2E=1 pnpm test`, fix anything that breaks, commit

### Task 11.5: Release prep

- [ ] **Step 1:** Bump `package.json` to 0.1.0
- [ ] **Step 2:** `pnpm build`, verify `dist/` is clean
- [ ] **Step 3:** `pnpm pack` and confirm tarball contains `bin/`, `dist/`, `src/viewer/public/` (NOT `src/`, NOT `tests/`)
- [ ] **Step 4:** Document install path in README
- [ ] **Step 5:** Final commit, tag `v0.1.0`

---

## Self-Review Notes

**Spec coverage:**
- ✓ Commands (start, bare, stop, snap, clear) — Task 6.5
- ✓ Daemon silent after first run — Phases 6, 11
- ✓ Viewer at 42069 — Phase 8
- ✓ Git commit trigger — Phase 5
- ✓ File→route mapping — Task 2.2
- ✓ Framework detection — Task 2.1
- ✓ URL detection portless+port — Task 2.3
- ✓ Build ID marker (auto-injected via proxy) — Phase 7
- ✓ Full-page screenshot + dimensions — Task 4.3
- ✓ ~/.flip/ storage — Phase 3
- ✓ History 20-commit rolloff — Task 3.4
- ✓ Configurable limit — Task 3.1
- ✓ Multi-page (route-file basis) — Task 2.2
- ✓ Multi-project simultaneous capture — Task 6.3 (registry) + Task 6.4 (orchestrator)
- ✓ Pixelmatch diff — Phase 10
- ✓ Empty states — Task 9.2/9.3
- ✓ First-run output — Task 6.5
- ✓ Frank design system — Task 9.4 (canonical tokens.css copied from Frank)
- ✓ Out-of-scope items — explicitly skipped

**Open assumptions to confirm with user before/during execution:**
1. ~~Frank design tokens~~ RESOLVED — using `/Users/carlostarrats/Documents/frank/ui-v2/styles/tokens.css`
2. portless manifest format (`~/.portless/projects.json` with cwd→host map) — confirm or replace with the real protocol
3. portless integration with the injection proxy — does portless expose a response-rewrite hook, or do we slot the proxy between portless and the dev server? Confirm before Phase 7.
4. Multi-route per commit selector UX — dropdown is reasonable but not in spec; verify

**Type consistency:** Function names used across phases — `detectFramework`, `filesToRoutes`, `resolveDevUrl`, `captureRoute`, `waitForReady`, `writeSnapshot`, `applyRolloff`, `snapCommit`, `generateDiff`, `startViewer` — checked, consistent.

**No placeholders:** every step has either concrete code or a concrete instruction.
