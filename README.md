# flip

Zero-config visual snapshot tool for developers building with agents.

`flip` is a local CLI daemon that automatically captures full-page screenshots of your app on every git commit and presents them in a browser-based viewer at `localhost:42069`. Toggle between before and after by feel. Switch to diff mode to see exactly what moved or changed.

## Install

```bash
git clone <repo> flip && cd flip
npm install
npm run build
npm link            # exposes the `flip` command globally
```

## Commands

```bash
flip start         # start daemon, open browser viewer at localhost:42069
flip               # reopen browser if closed
flip stop          # stop daemon
flip snap          # manual snapshot for non-git projects
flip clear         # wipe all snapshot history (asks for confirmation)
```

`flip start` accepts `--port N` to point at a dev server on a specific port. With portless installed, it auto-detects the `myapp.localhost` URL.

## How it works

1. Detects framework from `package.json` (Next, Vite, SvelteKit, Astro, Remix, plain HTML).
2. Watches for local git commits.
3. Reads `git diff` to see which files changed.
4. Maps changed files to routes (`app/dashboard/page.tsx` → `/dashboard`).
5. Runs an HTTP proxy in front of your dev server that injects `<body data-flip-build-id="<sha>">` so capture knows when the page is fresh.
6. Drives Puppeteer to a 200 response, waits for the `load` event, confirms the build-id marker, then takes a full-page screenshot.
7. Stores PNGs + metadata under `~/.flip/projects/<hash>/snapshots/<sha>/`.
8. Serves a viewer SPA on `localhost:42069` with project list, commit selector, before/after/diff toggle.

## Storage

All snapshots live under `~/.flip/`. Nothing leaves your machine.

```
~/.flip/
├── config.json                    # { "historyLimit": 20 }
├── log
├── daemon.pid
├── daemon.sock
└── projects/<hashed-cwd>/
    ├── meta.json
    └── snapshots/<sha>/
        ├── meta.json
        └── <route-slug>.png
```

History is bounded to `historyLimit` commits per project (default 20). The oldest commit's snapshots are deleted when a new one comes in over the limit.

## Limitations (v1)

- Dynamic routes (`/products/[id]`) are skipped — no way to infer a real ID.
- Auth-protected pages capture the login redirect, not the protected page.
- Only files that ARE route files trigger captures. A commit touching only a shared component won't trigger.

## Development

```bash
npm test                    # unit tests
RUN_PUPPETEER=1 npm test    # include Puppeteer integration tests
RUN_E2E=1 npm test          # include the daemon e2e smoke test
npm run build               # tsc + copy viewer/public into dist
```
