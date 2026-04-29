# flip — known limitations (v1)

## Dynamic routes are skipped

`app/products/[id]/page.tsx` and similar bracketed segments are skipped. Flip has no way to know which `id` to render without configuration. If a commit touches only dynamic-route files, no capture happens.

## Auth-protected pages capture the login redirect

Flip drives a fresh headless browser without your session cookies. A page that requires login will redirect to the login screen — flip captures that redirect, not the protected page. There's no warning; check the snapshot to confirm what was captured.

## Only direct route files trigger captures

If a commit touches only a shared component (e.g. `components/Nav.tsx`), flip does not capture anything. Future versions will follow the file dependency graph to capture every page that references the component. For now, touch the page file (or use `flip snap`) to force a capture.

## One project per session

The daemon supports registering multiple projects, but in v1 only one runs the watcher → capture pipeline at a time per directory. If you `flip start` in two terminals from two different cwds, both register; both will capture on commits.

## Build ID marker is best-effort

Flip's HTTP proxy injects `<body data-flip-build-id="<sha>">` into HTML responses so capture knows the page is fresh. If the proxy fails to bind, or the dev server returns HTML in a way the rewriter can't handle, flip falls back to the native `load` event plus a short buffer. Misses are logged silently to `~/.flip/log` — no user-facing error.

## No production / remote use

Flip is dev-only and never touches remote infrastructure. The daemon listens on `localhost` only. Snapshots stay on your machine.
