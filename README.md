# flip

**See what your agent just changed visually — without leaving the terminal.**

<img width="1312" height="1061" alt="Screenshot 2026-04-29 at 12 59 01 PM" src="https://github.com/user-attachments/assets/7243c452-d727-40c3-a41d-59fbf1bd4d9c" />

<table>
  <tr>
     <td><img src="https://github.com/user-attachments/assets/d54aafa0-ad7c-4669-9d87-3b54d5762999"></td>
     <td><img src="https://github.com/user-attachments/assets/f30a1262-0a53-495a-bb48-16c0ab86ebc8"></td>
   </tr>
 </table>

You ask Claude (or Cursor, or whoever) to "tighten up the dashboard spacing." It edits five files. Tests pass. You alt-tab to your dev server, eyeball the page, try to remember what it looked like five minutes ago. Did the fix actually land? Did it nudge anything else?

`flip` is a local CLI daemon that captures a full-page screenshot of every page your agent touches, on every git commit. A browser-based viewer at `localhost:42069` lets you toggle between **before** and **after** by feel, or switch to **diff mode** to see exactly which pixels moved. No test suite, no baselines, no cloud — just a visual record of every commit's effect on the screen.

Flip is for the moment between "the agent finished" and "I'm convinced it's right." It does one job: tell you what changed visually.

### What flip isn't

- **Not a visual regression test runner.** No assertions, no baselines, no CI failures. Flip records, you decide. If you want pass/fail visual checks, use Percy or Chromatic.
- **Not a screenshot service.** Doesn't run in production, doesn't run on a remote — only against your local dev server, only when you commit.
- **Not an end-to-end browser test.** No clicks, no flows, no assertions. Flip just loads the URL and screenshots it.
- **Not a SaaS app.** No accounts, no telemetry, no cloud. Snapshots live in `~/.flip/` on your machine.

Most visual tools assume you're shipping software with a CI pipeline. Flip assumes you're iterating fast with an AI agent and you need a quick "what did that just do" — not infrastructure.

---

## What it does

```
Agent edits app/dashboard/page.tsx
                |
You commit
                |
flip reads the diff, sees /dashboard changed
                |
Proxies your dev server, injects <body data-flip-build-id="<sha>">
                |
Drives Puppeteer to /dashboard, waits for the marker, full-page screenshot
                |
Stores PNG + dimensions under ~/.flip/projects/<hash>/snapshots/<sha>/
                |
Viewer at localhost:42069 — pick a commit, flip before/after, watch the diff
```

Multiple files in one commit? Flip screenshots every affected page in parallel. Many projects open at once? Each gets its own tab in the viewer. Twenty commits ago? Still there — flip keeps the last 20 commits per project (configurable).

---

## How to use it

### Install

Requires [Node.js](https://nodejs.org/) v20+.

```bash
git clone https://github.com/carlostarrats/flip-dif
cd flip-dif
npm install
npm run build
npm install -g .
```

After install, the `flip` command is available globally.

### Commands

```bash
flip start          # start daemon, open browser at localhost:42069
flip                # reopen browser if closed
flip stop           # stop daemon
flip snap           # manual snapshot (for non-git projects, or on-demand)
flip clear          # wipe all snapshot history (asks for confirmation)
```

`flip start` accepts `--port N` to point at a dev server on a specific port. With [portless](https://portless.dev) installed, the `myapp.localhost` URL is auto-detected.

### The viewer

Open `localhost:42069` after `flip start`. Three things to know:

1. **Home view** — every project you've registered, with a commit count and a last-seen timestamp. Click into one.
2. **Project view** — a commit selector and a route selector at the top. Three buttons: **before**, **after**, **diff**. Tabbing between them is the whole point — your eye catches what's changed by looking at the same pixels in different states.
3. **Diff mode** — Pixelmatch overlays every changed pixel in red. Layout shift, color change, font swap — all visible at a glance.

Flip walks back through history per route, so if you commit a `/dashboard` change and then a `/` change, the "before" for `/` correctly skips past the dashboard commit to find the previous `/` snapshot.

---

## Architecture

One TypeScript package. Pure local.

```
+----------------------------------------+
| flip CLI (TypeScript, Node 20+)        |
| - Argument parser, command dispatch    |
+----------------------------------------+
                 |
       Unix domain socket (JSON-RPC)
                 |
+----------------------------------------+
| flip Daemon (long-lived background)    |
| - Project registry (concurrent)        |
| - Per-project chokidar HEAD watcher    |
| - Per-project capture queue (serial)   |
| - Shared Puppeteer (Chrome) instance   |
| - Injection proxy (build-id marker)    |
| - HTTP server on :42069 (viewer)       |
+----------------------------------------+
                 |
        +--------+--------+
        v                 v
 ~/.flip/ (PNG       localhost:42069
 + JSON metadata)    (plain-ESM SPA;
                     no build step)
```

- **No accounts. No telemetry. No remote.** The daemon listens on `localhost`-only.
- **One daemon, many projects.** Run `flip start` in different project directories — each registers and starts its own watcher. They capture in parallel.
- **Build-id auto-injection.** Flip slips a transparent HTTP proxy in front of your dev server and tags `<body data-flip-build-id="<sha>">` on the way through, so capture knows the page reflects the new commit (not a stale render). Falls back silently to load-event + buffer if injection can't work.

### Tech stack

| Layer | Technology |
|---|---|
| CLI / Daemon | Node.js + TypeScript (ESM, `node:http`, `node:net`) |
| Browser | [Puppeteer](https://pptr.dev) — bundled Chrome for Testing |
| Pixel diff | [pixelmatch](https://github.com/mapbox/pixelmatch) + [pngjs](https://github.com/lukeapage/pngjs) |
| Git | [simple-git](https://github.com/steveukx/git-js) + [chokidar](https://github.com/paulmillr/chokidar) for `.git/HEAD` |
| Viewer UI | Plain JS ES modules, no framework, no build step |
| Visual design | [Frank's](https://github.com/carlostarrats/frank) shadcn-derived design tokens (Geist Mono, dark default) |
| Storage | JSON + PNG files in `~/.flip/` |
| Tests | [Vitest](https://vitest.dev) — 96 tests across 24 files |

---

## Storage

```
~/.flip/
├── config.json                    # { "historyLimit": 20 }
├── log                            # daemon log (silent except on error)
├── daemon.pid
├── daemon.sock
└── projects/<hashed-cwd>/
    ├── meta.json                  # name, framework, lastSeen, dev URL
    └── snapshots/<commit-sha>/
        ├── meta.json              # message, timestamp, captures[]
        ├── <route-slug>.png       # one PNG per captured route
        └── <route-slug>-vs-<sha>.diff.png   # generated lazily
```

Edit `~/.flip/config.json` to change `historyLimit`. The first time a project hits the limit, the viewer surfaces a one-time toast: *"flip: history full (20 commits). Oldest snapshots will now roll off automatically."*

`flip clear` wipes `~/.flip/projects/` after confirmation. Config and the daemon stay alive.

---

## Limitations

Flip is opinionated about what it does and doesn't try to do. The honest list:

- **Dynamic routes are skipped.** `app/products/[id]/page.tsx` has no fixed URL — flip would have to guess an ID. It refuses; no capture for that route. Same for `[...slug]`, `$param`, etc.
- **Auth-protected pages capture the redirect.** Flip drives a fresh headless browser without your session cookies, so a logged-out request hits the login screen and the screenshot reflects that. Mark the limitation, don't be confused.
- **Only direct route files trigger captures.** A commit that touches only `components/Nav.tsx` produces zero captures, even though the nav probably appears on every page. Future versions will follow the file dependency graph; for now, touch a route file (or run `flip snap`) to force one.
- **Build-id auto-injection is best-effort.** Most dev servers respond fine. Some setups (custom proxies, exotic SSR), the marker won't make it onto the page — flip silently falls back to load + buffer, and capture timing degrades from "deterministic" to "good enough." Misses are logged at `~/.flip/log`.
- **One Chrome per daemon.** Captures within a single project serialize. If you commit twice in 200ms, the second waits for the first — there's no race, but there's also no parallelism.
- **Dev only.** Flip listens on `localhost`. It is not a production tool. It will not run in CI without significant rewiring.

---

## Privacy

- **Local by default.** Project metadata, PNG snapshots, and the daemon log all live in `~/.flip/` on your machine.
- **No telemetry, no analytics, no accounts.** Flip never phones home.
- **No remote.** The daemon listens only on `127.0.0.1`. Other machines on your network can't reach the viewer or the IPC socket.
- **No third-party calls.** Puppeteer launches a bundled Chrome offline; the viewer SPA doesn't fetch anything off your machine.

If you `flip clear`, snapshot directories are deleted from disk. There's nothing else to clear — there's no cloud anywhere.

---

## Development

```bash
git clone https://github.com/carlostarrats/flip-dif
cd flip-dif
npm install
npm run build
npm test                          # 90 unit tests
RUN_PUPPETEER=1 npm test          # +5 Puppeteer integration tests
RUN_E2E=1 npm test                # +1 daemon e2e smoke (spawns a fake dev server)
```

The viewer SPA is plain JS — edit any file under `src/viewer/public/`, refresh the browser, you're done. The daemon is TypeScript; rerun `npm run build` and `flip stop && flip start` to pick up changes.

### Project structure

```
flip-dif/
+-- bin/flip.mjs                  # CLI entry shebang
+-- src/
|   +-- cli/                      # start, stop, snap, clear, open
|   +-- daemon/                   # process lifecycle, IPC, registry, orchestrator
|   +-- ipc/                      # JSON-RPC over Unix socket
|   +-- detect/                   # framework detection, file→route mapping, dev URL
|   +-- git/                      # simple-git helpers, chokidar HEAD watcher
|   +-- capture/                  # Puppeteer launch, page-ready detection, screenshot
|   +-- inject/                   # HTTP proxy + body-tag rewriter (build-id marker)
|   +-- storage/                  # paths, config, projects, snapshots, history rolloff
|   +-- viewer/                   # HTTP server, /api/* endpoints, SPA assets
|   |   +-- public/               # tokens.css (from Frank), styles.css, app.js, views/
|   +-- diff/                     # server-side pixelmatch diff generation
|   +-- log/                      # silent file logger to ~/.flip/log
+-- tests/                        # Vitest — mirrors src/, plus tests/e2e/
+-- docs/limitations.md
+-- docs/build-id-marker.md
+-- scripts/copy-public.mjs       # build step: copy viewer/public → dist/viewer/public
+-- scripts/demo.mjs              # manual demo: fake dev server + 3 commits
```

### Escape hatches

- `FLIP_NO_PROXY=1` — disable the injection proxy entirely, fall back to load + buffer for readiness detection. Useful if the proxy ever interferes with your specific dev server.
- `FLIP_VIEWER_PORT=N` — bind the viewer to a different port (default 42069). Used by tests; you probably don't need this.
- `FLIP_HOME=path` — override `~/` for the storage root. Used by tests; you probably don't need this either.

---

## License

[PolyForm Shield 1.0.0](LICENSE) — a source-available license that permits use, modification, and distribution for any purpose **except** providing a product that competes with flip. Full text in [`LICENSE`](LICENSE); license homepage: <https://polyformproject.org/licenses/shield/1.0.0/>.

What this means in practice:

- **Use it yourself** — individuals, teams, and companies can run flip internally for any commercial or non-commercial purpose
- **Fork it, modify it, redistribute it** — as long as you keep the license and the `Required Notice` intact
- **Contribute back** — forks and PRs are welcome under the same terms
- **Don't resell it as a competing product** — you may not package flip (or a derivative) as a SaaS or commercial offering that competes with it

> PolyForm Shield is *source-available* rather than OSI-certified "open source." Consult your own legal counsel if in doubt.

### Acknowledgements

- [Puppeteer](https://pptr.dev) — Apache-2.0 (bundled Chrome for capture)
- [pixelmatch](https://github.com/mapbox/pixelmatch) — ISC (pixel-level diff)
- [pngjs](https://github.com/lukeapage/pngjs) — MIT (PNG read/write)
- [simple-git](https://github.com/steveukx/git-js) — MIT (git operations)
- [chokidar](https://github.com/paulmillr/chokidar) — MIT (file watching)
- [Vitest](https://vitest.dev/) — MIT (dev-only)
- [Geist Mono](https://vercel.com/font) — OFL-1.1 (loaded from Google Fonts at runtime in the viewer)
- Design tokens copied from [Frank](https://github.com/carlostarrats/frank), itself shadcn-derived (MIT)
