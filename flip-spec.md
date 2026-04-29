# flip

> Zero-config visual snapshot tool for developers building with agents.

---

## What It Is

`flip` is a local CLI daemon that automatically captures full-page screenshots of your app on every git commit and presents them in a browser-based viewer. Toggle between before and after by feel. Switch to diff mode to see exactly what moved or changed. No setup, no accounts, no config.

---

## The Problem

When an agent makes a UI change, there's no lightweight way to see what visually changed before and after. Developers open two tabs, one old one new, and eyeball the difference manually. `flip` automates the capture and makes comparison effortless.

---

## Core Principles

- **Frictionless** — starts silently, captures automatically, never interrupts
- **Agent-aware** — reads changed files from git to know which pages to screenshot
- **Dev only** — never runs in production, never touches remote infrastructure
- **Local first** — all snapshots stored on your machine, nothing leaves without your action

---

## Commands

```bash
flip start        # start daemon, open browser viewer at localhost:42069
flip              # reopen browser if closed
flip stop         # stop daemon
flip snap         # manual snapshot for non-git projects
flip clear        # wipe all snapshot history (asks for confirmation)
```

---

## How It Works

### Daemon
Runs silently in the background. Watches for git commits. Never outputs to terminal after first run message. Completely decoupled from the viewer.

### Viewer
Lives at `localhost:42069`. Opens automatically on `flip start`. If closed, run `flip` to reopen. Never intrudes on your app — runs on its own port.

---

## Triggering Snapshots

### With a git repo (automatic)
Flip watches for local git commits. No GitHub, no remote required. Purely local git. On every commit:

1. Reads the git diff to identify which files changed
2. Maps changed files to routes using framework-aware route detection
3. Waits for app to return 200
4. Waits for native browser `load` event (CSS, fonts, images, video first frame all ready)
5. Checks `data-flip-build-id` marker matches current commit hash
6. Takes full-page screenshot with dimension metadata

### Without a git repo (manual)
```bash
flip snap
```
Run when something feels done enough to capture. Explicit and meaningful — you chose to save that moment.

---

## Framework Detection

Flip reads `package.json` on start to detect framework. Automatically knows route conventions for:

- Next.js (App Router and Pages Router)
- Vite + React / Svelte / Vue
- SvelteKit
- Astro
- Remix
- Plain static HTML

### File-to-Route Mapping
If an agent modifies `app/dashboard/page.tsx`, flip knows to screenshot `/dashboard`. No config. The changed files tell flip where to look.

**Dynamic routes** (`app/products/[id]/page.tsx`) are skipped in v1 — no way to infer a real ID without config.

**Auth-protected pages** are a known limitation — flip will capture the login redirect, not the protected page. Document this clearly.

### First Run Output
```
flip: detected Next.js project
flip: watching myapp.localhost
flip: viewer at localhost:42069
flip: ready. Make a commit to capture your first snapshot.
```
Silent after that.

---

## URL Detection

### With portless (recommended)
Flip reads the stable `myapp.localhost` URL automatically. Zero config.

### Without portless (fallback)
```bash
flip start --port 3000
```

---

## Build ID Marker

Flip injects a `data-flip-build-id` attribute on the page body at dev build time containing the current commit hash. After a commit, flip pings the URL and checks this attribute — if it matches the commit, the page is fresh and ready to screenshot.

**Fallback:** If injection fails (unsupported framework or setup), flip falls back to native `load` event plus a short buffer. Silent degradation, no errors.

**Dev only:** Marker only exists in development builds. Never appears in production.

---

## Screenshot Capture

- **Full page** — captures entire scrollable height, not just the viewport
- **Dimension metadata** — stores exact capture width and height alongside every screenshot
- **Viewer rendering** — images always displayed at native capture dimensions, never stretched. Scroll to see full page if larger than screen.

---

## Multi-Page Support

Flip maps changed files to routes and screenshots every affected static page per commit. If a commit touches the global nav component, flip screenshots whatever pages reference it based on file dependency. If only one route file changed, only that page is captured.

---

## Multiple Projects

Flip is directory-aware. Running `flip start` inside a project directory registers that project with the central flip instance.

```bash
cd ~/projects/adaptiveshop
flip start    # registers adaptiveshop

cd ~/projects/frank
flip start    # registers frank
```

One viewer at `localhost:42069` for all projects. Projects appear as tabs in the viewer. One place to go, everything visible.

---

## Snapshot History

- **Storage unit:** commits, not time or flat count
- **Default:** last 20 commits of visual history per project
- **Rolloff:** when a new commit comes in at capacity, oldest drops automatically
- **One-time warning:** first time history hits 20 commits:
  ```
  flip: history full (20 commits). Oldest snapshots will now roll off automatically.
  ```
  Never shown again after that.
- **Clear:** `flip clear` wipes everything with confirmation prompt
- **Configurable:** limit can be changed in `~/.flip/config.json`

---

## Viewer UI

### Home View
Project list. Each project shows name, last snapshot time, number of commits in history. Click to enter project view.

### Project View
- **Back button** top left
- **Commit selector** top — browse history by commit message and timestamp
- **Before / After toggle** top — switch between the two versions by feel
- **Diff mode toggle** top — overlay highlights showing what moved or changed
- **Full page screenshot** below — rendered at native capture dimensions

### Diff Mode
Uses **Pixelmatch** for pixel-level comparison. Highlights changed regions. Same toggle mechanic as before/after — tabbing between them shows movement clearly.

### Empty State
Before first commit:
> *"Flip is watching. Make a commit to capture your first snapshot."*

After first commit (baseline established):
> *"Flip is now active. Your baseline is set."*

---

## Visual Design

Uses Frank's design system for consistency across tools. Same palette, same tokens, same component patterns. Two tools, one visual language.

---

## Storage

All snapshots stored in `~/.flip/` on your machine. Nothing leaves your computer. No telemetry, no analytics, no accounts.

---

## Out of Scope for v1

- Dynamic route screenshot (`/products/[id]`)
- Auth-protected page screenshot
- Multi-project running simultaneously (single project per session in v1, multi-project is v2)
- Cloud storage or team sharing
- Video / animation capture

---

## Tech Stack

| Layer | Technology |
|---|---|
| CLI / Daemon | Node.js + TypeScript |
| Screenshot capture | Puppeteer (headless Chromium) |
| Pixel diff | Pixelmatch |
| Viewer UI | Plain JS ES modules, no build step |
| Storage | JSON + PNG files in `~/.flip/` |
| Framework detection | package.json parsing |
| Route mapping | Framework-specific file tree conventions |

---

## Portless Integration

Flip works standalone with `--port`. Pair with portless and it's completely zero-config — no ports, no flags, no setup. Flip reads the stable `myapp.localhost` URL automatically.

> flip works best with portless.

---

## Summary

```
flip start
→ detects framework from package.json
→ watches for git commits
→ reads changed files → maps to routes
→ waits for page ready (200 + load event + build ID marker)
→ full page screenshot with dimension metadata
→ stores in ~/.flip/ under project + commit
→ viewer at localhost:42069, project tabs, before/after toggle, diff mode
→ rolls off oldest when 20 commit limit reached
→ never interrupts, never touches production, never leaves your machine
```
