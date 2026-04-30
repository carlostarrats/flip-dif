import { launchBrowser } from '/Users/carlostarrats/Documents/Flip/dist/capture/browser.js';
import { writeFileSync } from 'node:fs';
const HASH = (await (await fetch('http://localhost:42069/api/projects')).json())[0].hashedCwd;
const browser = await launchBrowser();
const page = await browser.newPage();
await page.setViewport({ width: 1400, height: 900 });
await page.goto('http://localhost:42069/', { waitUntil: 'load' });
await new Promise(r => setTimeout(r, 600));
// Hover row + open kebab
await page.evaluate(() => {
  const trigger = document.querySelector('.commit-row-li:nth-child(2) .commit-row-kebab .kebab-trigger');
  trigger.click();
});
await new Promise(r => setTimeout(r, 300));
await page.evaluate(() => document.querySelector('.commit-row-li:nth-child(2) .kebab-item').click());
await new Promise(r => setTimeout(r, 400));
const buf = await page.screenshot({ type: 'png' });
writeFileSync('/tmp/modal-snapshot.png', Buffer.from(buf));

// Also screenshot the project-delete modal
await page.keyboard.press('Escape');
await new Promise(r => setTimeout(r, 300));
await page.click('#project-actions .kebab-trigger');
await new Promise(r => setTimeout(r, 300));
await page.evaluate(() => document.querySelector('#project-actions .kebab-item').click());
await new Promise(r => setTimeout(r, 400));
const buf2 = await page.screenshot({ type: 'png' });
writeFileSync('/tmp/modal-project.png', Buffer.from(buf2));

// And the project view back-button hover state
await page.keyboard.press('Escape');
await page.goto(`http://localhost:42069/#/project/${HASH}`, { waitUntil: 'load' });
await new Promise(r => setTimeout(r, 500));
await page.hover('.back');
await new Promise(r => setTimeout(r, 300));
const buf3 = await page.screenshot({ type: 'png', clip: { x: 0, y: 0, width: 200, height: 80 } });
writeFileSync('/tmp/back-hover.png', Buffer.from(buf3));

await page.close();
await browser.close();
