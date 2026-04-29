import http from 'node:http';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const FLIP = join(ROOT, 'bin/flip.mjs');

const APP = mkdtempSync(join(tmpdir(), 'flip-conflict-app-'));
writeFileSync(join(APP, 'index.html'), '<!doctype html><h1>x</h1>');
const HOME = mkdtempSync(join(tmpdir(), 'flip-conflict-'));
const env = { ...process.env, FLIP_HOME: HOME };

// Case 1: a non-flip server holds 42069
console.log('=== case 1: port 42069 held by non-flip process ===');
const blocker = http.createServer((_, res) => {
  res.setHeader('content-type', 'text/html');
  res.end('not flip');
});
await new Promise(r => blocker.listen(42069, '127.0.0.1', r));
try {
  execSync(`${FLIP} start --port 8000`, { env, encoding: 'utf8', cwd: APP });
} catch (e) {
  console.log('STDOUT:', e.stdout?.toString().trim());
}
await new Promise(r => blocker.close(() => r(null)));

// Case 2: a flip-shaped server holds 42069
console.log('\n=== case 2: port 42069 held by flip-shaped server ===');
const flipShape = http.createServer((_, res) => {
  res.setHeader('content-type', 'application/json');
  res.end('[]');
});
await new Promise(r => flipShape.listen(42069, '127.0.0.1', r));
try {
  execSync(`${FLIP} start --port 8000`, { env, encoding: 'utf8', cwd: APP });
} catch (e) {
  console.log('STDOUT:', e.stdout?.toString().trim());
}
await new Promise(r => flipShape.close(() => r(null)));

// Case 3: --help works without daemon
console.log('\n=== case 3: --help (no daemon) ===');
console.log(execSync(`${FLIP} --help`, { encoding: 'utf8' }).split('\n').slice(0, 3).join('\n'));
