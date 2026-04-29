// Manual demo runner — boots a fake dev server, spawns the flip daemon
// against a temp app, makes two commits, then leaves everything running so
// you can poke at localhost:42069 in a browser.

import http from "node:http";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { simpleGit } from "simple-git";

const __filename = fileURLToPath(import.meta.url);
const ROOT = resolve(dirname(__filename), "..");
const DAEMON_ENTRY = join(ROOT, "dist/daemon/index.js");

// ---- Fake dev server: serves a different look per route ----
const PAGES = {
  "/": (rev) => `<!doctype html><html><head>
    <meta charset="utf-8"><title>Demo</title>
    <style>
      body{margin:0;font-family:ui-monospace,monospace;background:#111;color:#eee;}
      h1{padding:48px;font-size:64px;letter-spacing:-0.04em;color:${rev === 1 ? "#5b8def" : "#ef5b8d"};}
      .grid{display:grid;grid-template-columns:repeat(${rev === 1 ? 3 : 4},1fr);gap:16px;padding:48px;}
      .card{height:200px;background:#222;border:1px solid #333;padding:16px;}
      .card h2{margin:0;font-size:18px;}
      .footer{padding:48px;color:#666;}
    </style></head>
    <body><h1>Hello — rev ${rev}</h1>
    <div class="grid">${Array.from({length: rev === 1 ? 6 : 8}, (_, i) => `<div class="card"><h2>Card ${i+1}</h2><p>Content rev ${rev}</p></div>`).join("")}</div>
    <div class="footer">Footer text — revision ${rev}</div>
    </body></html>`,
  "/dashboard": (rev) => `<!doctype html><html><head>
    <meta charset="utf-8"><title>Dashboard</title>
    <style>
      body{margin:0;font-family:ui-monospace,monospace;background:#0e0e10;color:#f5f5f7;}
      .wrap{padding:64px;}
      h1{font-size:48px;color:${rev === 2 ? "#ef5b8d" : "#5b8def"};}
      .stat{display:inline-block;margin:24px;padding:24px;border:1px solid #333;min-width:160px;}
      .num{font-size:36px;color:#5b8def;}
    </style></head>
    <body><div class="wrap"><h1>Dashboard rev ${rev}</h1>
    <div class="stat"><div class="num">${rev === 2 ? "1,247" : "892"}</div>users</div>
    <div class="stat"><div class="num">${rev === 2 ? "4.2k" : "3.1k"}</div>orders</div>
    <div class="stat"><div class="num">${rev === 2 ? "$12.4k" : "$8.9k"}</div>revenue</div>
    </div></body></html>`,
};

let revision = 1;
const upstream = http.createServer((req, res) => {
  const path = (req.url ?? "/").split("?")[0];
  const fn = PAGES[path];
  if (!fn) {
    res.writeHead(404, { "content-type": "text/html" });
    res.end("<h1>404</h1>");
    return;
  }
  res.writeHead(200, { "content-type": "text/html" });
  res.end(fn(revision));
});
await new Promise((r) => upstream.listen(0, "127.0.0.1", r));
const upstreamPort = upstream.address().port;
console.log(`fake dev server: http://127.0.0.1:${upstreamPort}`);

// ---- Temp project + git repo ----
const HOME = mkdtempSync(join(tmpdir(), "flip-demo-home-"));
const APP = mkdtempSync(join(tmpdir(), "flip-demo-app-"));
console.log(`FLIP_HOME = ${HOME}`);
console.log(`app cwd   = ${APP}`);

writeFileSync(join(APP, "package.json"), JSON.stringify({ name: "demo", dependencies: { next: "14" } }));
mkdirSync(join(APP, "app/dashboard"), { recursive: true });
writeFileSync(join(APP, "app/page.tsx"), "export default function P(){return null}");
writeFileSync(join(APP, "app/dashboard/page.tsx"), "export default function D(){return null}");

const git = simpleGit(APP);
await git.init();
await git.addConfig("user.email", "demo@demo");
await git.addConfig("user.name", "demo");
await git.add(".");
await git.commit("feat: initial dashboard + home (rev 1)");

// ---- Spawn daemon ----
console.log("spawning daemon…");
const daemon = spawn(process.execPath, [DAEMON_ENTRY], {
  detached: false,
  stdio: ["ignore", "inherit", "inherit"],
  env: { ...process.env, FLIP_HOME: HOME },
});

// poll for the daemon being ready by hitting the viewer
async function waitFor(url, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(url);
      if (r.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`timeout waiting for ${url}`);
}
await waitFor("http://localhost:42069/");
console.log("viewer up at http://localhost:42069");

// ---- Register project via direct IPC (use the client lib) ----
const { sendRpc } = await import(join(ROOT, "dist/ipc/client.js"));
await sendRpc(HOME, { method: "register", cwd: APP, port: upstreamPort });
console.log("project registered, awaiting initial capture…");

// wait for first snapshot
async function waitForSnapshots(min) {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const r = await fetch("http://localhost:42069/api/projects");
    const list = await r.json();
    const proj = list[0];
    if (proj && proj.snapshotCount >= min) return proj;
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error("no snapshots captured");
}

let proj = await waitForSnapshots(1);
console.log(`first snapshot captured: ${proj.snapshotCount} commits visible`);

// ---- Second commit ----
revision = 2;
writeFileSync(join(APP, "app/dashboard/page.tsx"), "export default function D(){return null} // v2");
await git.add(".");
await git.commit("feat: bigger dashboard numbers (rev 2)");
console.log("made second commit, awaiting capture…");

proj = await waitForSnapshots(2);
console.log(`second snapshot captured: ${proj.snapshotCount} commits visible`);

// ---- Third commit (touches /) ----
revision = 2; // page.tsx unchanged but let's make a third commit that changes /
writeFileSync(join(APP, "app/page.tsx"), "export default function P(){return null} // v3");
await git.add(".");
await git.commit("feat: redesigned hero (rev 3)");
console.log("made third commit, awaiting capture…");
proj = await waitForSnapshots(3);
console.log(`third snapshot captured: ${proj.snapshotCount} commits visible`);

console.log("\n✓ READY — viewer at http://localhost:42069");
console.log(`  hashedCwd = ${proj.hashedCwd}`);
console.log("Press ctrl-c to tear down (daemon + temp dirs will leak; run cleanup-demo.mjs)");

// keep the upstream alive — the daemon will exit when the script does
await new Promise(() => {});
