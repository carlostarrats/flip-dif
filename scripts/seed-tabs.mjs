import { sendRpc } from '/Users/carlostarrats/Documents/Flip/dist/ipc/client.js';
import { registerProject } from '/Users/carlostarrats/Documents/Flip/dist/storage/projects.js';
import { writeSnapshot } from '/Users/carlostarrats/Documents/Flip/dist/storage/snapshots.js';
import { PNG } from 'pngjs';

const HOME = "/var/folders/q8/hhg9gsnd77s9375xg1y7rm080000gn/T/flip-demo-home-wdUAsq";
const png = (() => { const p = new PNG({ width: 1, height: 1 }); p.data.fill(0); return PNG.sync.write(p); })();
for (const name of ['adaptiveshop', 'portless', 'frank-cloud', 'localhost-test', 'demo-mobile', 'inbox-prototype']) {
  const cwd = `/tmp/${name}`;
  registerProject(HOME, cwd, { cwd, name, framework: 'next-app', lastSeen: Date.now() - Math.random()*86400000, url: 'http://localhost:3000' });
  writeSnapshot(HOME, cwd, { sha: 'a'.repeat(40), message: `feat: bootstrap ${name}`, timestamp: Date.now() }, [
    { route: '/', pngBuffer: png, width: 1, height: 1 },
  ]);
}
console.log('seeded 6 projects');
