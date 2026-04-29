# Build ID marker

Flip needs to know when, after a commit, your dev server has finished rebuilding and is serving the new code. It does this by checking for a `data-flip-build-id="<commit-sha>"` attribute on the page's `<body>`.

## Auto-injection (default)

When you run `flip start`, flip starts a tiny HTTP proxy in front of your dev server. Capture targets the proxy URL, not your dev server directly. The proxy:

1. Forwards every request to your dev server unchanged.
2. Inspects responses with `Content-Type: text/html`.
3. Decodes any `gzip`/`deflate`/`br` encoding.
4. Inserts `data-flip-build-id="<sha>"` on the `<body>` open tag.
5. Re-emits the response uncompressed.

Non-HTML responses pass through byte-for-byte.

The proxy listens on a random local port. The viewer at `localhost:42069` displays your real dev URL in the project list — the proxy port is internal.

## Fallback

If the proxy can't bind (rare) or if the marker doesn't appear in the rendered DOM (some frameworks defer body rendering), flip falls back to:

1. Wait for the URL to return HTTP 200.
2. Wait for the browser's native `load` event (CSS, fonts, images, video first frame all ready).
3. Sleep an extra 750ms buffer.
4. Take the screenshot.

This is silent. No user-facing error. To diagnose, check `~/.flip/log` for lines like `[<cwd>] build-id miss for /<route> @ <sha>`.

## When to disable

You almost certainly shouldn't. If you have a specific need (e.g. you're already running your own proxy and don't want flip's interfering), open an issue.
