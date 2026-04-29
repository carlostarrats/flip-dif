// Mirror the exact user flow from the transcript:
// 1. Start a static-HTML server (mimics python3 -m http.server 8000)
// 2. flip start --port N (no git repo yet)
// 3. Verify message about manual snap
// 4. git init in the directory
// 5. flip start --port N (re-run; should now attach watcher)
// 6. Make a commit, expect snapshot
// 7. Verify viewer endpoints respond
import http from 'node:http';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import { simpleGit } from 'simple-git';

const __filename = fileURLToPath(import.meta.url);
const ROOT = resolve(dirname(__filename), '..');
const FLIP = join(ROOT, 'bin/flip.mjs');

// Step 1: static html server
const upstream = http.createServer((_req, res) => {
  res.setHeader('content-type', 'text/html');
  res.end('<html><body><h1>Hello world</h1></body></html>');
});
await new Promise(r => upstream.listen(0, '127.0.0.1', r));
const port = upstream.address().port;
console.log(`[step 1] static server: http://127.0.0.1:${port}`);

// Set up project dir with index.html (no git, no package.json)
const HOME = mkdtempSync(join(tmpdir(), 'flip-userflow-home-'));
const APP = mkdtempSync(join(tmpdir(), 'flip-userflow-app-'));
writeFileSync(join(APP, 'index.html'), '<!doctype html><h1>hi</h1>');
console.log(`[step 1] HOME=${HOME}, APP=${APP}`);

const env = { ...process.env, FLIP_HOME: HOME };

// Step 2: flip start --port (no git)
console.log('\n[step 2] flip start --port (no git repo)');
const out2 = execSync(`${FLIP} start --port ${port}`, { cwd: APP, env, encoding: 'utf8' });
console.log(out2);

// Probe initial snapshot (manual project)
await new Promise(r => setTimeout(r, 4000));
const r1 = await fetch('http://localhost:42069/api/projects');
const projs = await r1.json();
console.log(`[step 2 verify] projects=${projs.length}, snapshotCount=${projs[0]?.snapshotCount ?? 0}`);

// Step 3: git init (post-register)
console.log('\n[step 3] git init AFTER register');
const git = simpleGit(APP);
await git.init();
await git.addConfig('user.email', 't@t');
await git.addConfig('user.name', 't');
await git.add('.');
await git.commit('initial');

// Step 4: flip start again — should attach watcher
console.log('\n[step 4] flip start again (should attach watcher to new git repo)');
const out4 = execSync(`${FLIP} start --port ${port}`, { cwd: APP, env, encoding: 'utf8' });
console.log(out4);

// Make a commit, expect snapshot
console.log('\n[step 5] commit and wait for snapshot...');
writeFileSync(join(APP, 'index.html'), '<!doctype html><h1>changed</h1>');
await git.add('.');
await git.commit('change');

const before = (await (await fetch('http://localhost:42069/api/projects')).json())[0].snapshotCount;
let after = before;
const deadline = Date.now() + 30000;
while (Date.now() < deadline) {
  const list = await (await fetch('http://localhost:42069/api/projects')).json();
  after = list[0].snapshotCount;
  if (after > before) break;
  await new Promise(r => setTimeout(r, 500));
}
console.log(`[step 5 verify] snapshots before=${before}, after=${after}`);

// Cleanup
console.log('\n[cleanup] flip stop');
console.log(execSync(`${FLIP} stop`, { env, encoding: 'utf8' }));
upstream.close();

// Verdict
if (after > before) {
  console.log('\n✓ SUCCESS — watcher attached on second `flip start` after git init, captured the new commit.');
} else {
  console.log('\n✗ FAIL — second `flip start` did not attach watcher / no new snapshot after commit.');
  process.exit(1);
}
