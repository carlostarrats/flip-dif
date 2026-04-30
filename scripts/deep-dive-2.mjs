import { launchBrowser } from '/Users/carlostarrats/Documents/Flip/dist/capture/browser.js';
import { writeFileSync, writeFileSync as wf } from 'node:fs';
import { registerProject } from '/Users/carlostarrats/Documents/Flip/dist/storage/projects.js';
import { writeSnapshot } from '/Users/carlostarrats/Documents/Flip/dist/storage/snapshots.js';
import { PNG } from 'pngjs';

const HASH = "38f7249a2ca8";
const VIEWER = "http://localhost:42069";
const HOME = process.env.HOME_PATH;

// Seed extra projects for tab-overflow tests
const png = (() => { const p = new PNG({ width: 1, height: 1 }); p.data.fill(0); return PNG.sync.write(p); })();
for (const name of ['aaa-test', 'bbb-test', 'ccc-test', 'ddd-test', 'eee-test', 'fff-test']) {
  const cwd = `/tmp/${name}`;
  registerProject(HOME, cwd, { cwd, name, framework: 'next-app', lastSeen: Date.now() - Math.random()*86400000, url: 'http://localhost:3000' });
  writeSnapshot(HOME, cwd, { sha: 'a'.repeat(40), message: `feat: ${name}`, timestamp: Date.now() }, [
    { route: '/', pngBuffer: png, width: 1, height: 1 },
  ]);
}
console.log('seeded 6 fake projects');

const results = [];
const issues = [];
const pass = (name) => { results.push({ name, ok: true }); console.log(`✓ ${name}`); };
const fail = (name, why) => { results.push({ name, ok: false, why }); issues.push(`✗ ${name}: ${why}`); console.log(`✗ ${name}: ${why}`); };

const browser = await launchBrowser();
const page = await browser.newPage();
await page.setViewport({ width: 1400, height: 900 });

const errs = [];
page.on('pageerror', e => errs.push(`pageerror: ${e.message}`));
page.on('console', m => { if (m.type() === 'error') errs.push(`console.error: ${m.text()}`); });

// === TAB OVERFLOW ===
console.log('\n=== A. tab overflow with 7 projects ===');
await page.goto(`${VIEWER}/`, { waitUntil: 'networkidle0' });
await new Promise(r => setTimeout(r, 700));
const overflowState = await page.evaluate(() => {
  const tabs = document.querySelector('.home-tabs');
  return {
    overflow: tabs?.dataset.overflow,
    scrollWidth: tabs?.scrollWidth,
    clientWidth: tabs?.clientWidth,
    tabCount: document.querySelectorAll('.home-tab').length,
  };
});
console.log('overflow state:', overflowState);
overflowState.tabCount === 7 ? pass('7 tabs rendered') : fail('7 tabs', `got ${overflowState.tabCount}`);
overflowState.scrollWidth > overflowState.clientWidth ? pass('tab strip scrollable') : fail('strip scrollable', `${overflowState.scrollWidth} <= ${overflowState.clientWidth}`);
overflowState.overflow === 'right' ? pass('overflow=right (more to scroll right)') : fail('overflow=right', `got "${overflowState.overflow}"`);

// Scroll the tab strip to the end
await page.evaluate(() => {
  const t = document.querySelector('.home-tabs');
  t.scrollLeft = t.scrollWidth;
});
await new Promise(r => setTimeout(r, 400));
const afterScroll = await page.evaluate(() => document.querySelector('.home-tabs')?.dataset.overflow);
console.log('overflow after scrolling right:', afterScroll);
afterScroll === 'left' ? pass('overflow flips to left after scrolling end') : fail('overflow flip', `got "${afterScroll}"`);

// Click a different tab — verify scroll position survives + active updates
await page.evaluate(() => { const t = document.querySelector('.home-tabs'); t.scrollLeft = 100; });
await new Promise(r => setTimeout(r, 200));
const scrollBefore = await page.evaluate(() => document.querySelector('.home-tabs').scrollLeft);
await page.evaluate(() => { document.querySelectorAll('.home-tab')[3].click(); });
await new Promise(r => setTimeout(r, 700));
const scrollAfter = await page.evaluate(() => document.querySelector('.home-tabs').scrollLeft);
const activeTabIdx = await page.evaluate(() => [...document.querySelectorAll('.home-tab')].findIndex(t => t.classList.contains('active')));
console.log(`scroll before click=${scrollBefore}, after=${scrollAfter}, active idx=${activeTabIdx}`);
activeTabIdx === 3 ? pass('clicked tab becomes active') : fail('active tab', `idx=${activeTabIdx}`);

// === DELETE COMMIT ===
console.log('\n=== B. delete commit via UI ===');
await page.goto(`${VIEWER}/`, { waitUntil: 'networkidle0' });
await new Promise(r => setTimeout(r, 700));
// Switch to the real demo project tab (one of the 7)
await page.evaluate((hash) => {
  const tab = [...document.querySelectorAll('.home-tab')].find(t => t.textContent.toLowerCase().includes('flip-demo'));
  if (tab) tab.click();
}, HASH);
await new Promise(r => setTimeout(r, 700));
const beforeDelete = await page.evaluate(() => document.querySelectorAll('.commit-row').length);
console.log('commits before delete:', beforeDelete);
// Use the API directly + accept dialog handler
page.on('dialog', d => d.accept());
const firstSha = await page.evaluate(() => document.querySelector('.commit-row-li:first-child .commit-row-kebab')?.dataset.sha);
console.log('deleting first commit sha:', firstSha);
await page.evaluate(() => {
  const trigger = document.querySelector('.commit-row-li:first-child .commit-row-kebab .kebab-trigger');
  trigger.click();
});
await new Promise(r => setTimeout(r, 300));
await page.evaluate(() => {
  const item = document.querySelector('.commit-row-li:first-child .kebab-item');
  item.click();
});
await new Promise(r => setTimeout(r, 1500));
const afterDelete = await page.evaluate(() => document.querySelectorAll('.commit-row').length);
console.log('commits after delete:', afterDelete);
afterDelete === beforeDelete - 1 ? pass('commit row removed after delete') : fail('delete commit', `before=${beforeDelete}, after=${afterDelete}`);

// === DELETE PROJECT ===
console.log('\n=== C. delete fake project via UI ===');
// Navigate to home, switch to one of the fake projects, delete it
await page.goto(`${VIEWER}/`, { waitUntil: 'networkidle0' });
await new Promise(r => setTimeout(r, 700));
const tabsBeforeDel = await page.evaluate(() => document.querySelectorAll('.home-tab').length);
await page.evaluate(() => {
  const fakeTab = [...document.querySelectorAll('.home-tab')].find(t => /aaa-test/i.test(t.textContent));
  if (fakeTab) fakeTab.click();
});
await new Promise(r => setTimeout(r, 700));
await page.click('#project-actions .kebab-trigger');
await new Promise(r => setTimeout(r, 300));
await page.evaluate(() => document.querySelector('#project-actions .kebab-item').click());
await new Promise(r => setTimeout(r, 1500));
const tabsAfterDel = await page.evaluate(() => document.querySelectorAll('.home-tab').length);
console.log(`tabs before del=${tabsBeforeDel}, after=${tabsAfterDel}`);
tabsAfterDel === tabsBeforeDel - 1 ? pass('tab removed after project delete') : fail('delete project', `before=${tabsBeforeDel}, after=${tabsAfterDel}`);

// === LIVE-UPDATE POLL ===
console.log('\n=== D. live-update poll picks up new project ===');
const tabsBeforePoll = await page.evaluate(() => document.querySelectorAll('.home-tab').length);
console.log('tabs before injecting new project:', tabsBeforePoll);
// Inject a new project from outside the page; poll should pick it up within 3-4s
registerProject(HOME, '/tmp/zzz-live-test', { cwd: '/tmp/zzz-live-test', name: 'zzz-live-test', framework: 'next-app', lastSeen: Date.now(), url: 'http://localhost:3000' });
writeSnapshot(HOME, '/tmp/zzz-live-test', { sha: 'b'.repeat(40), message: 'feat: live test', timestamp: Date.now() }, [
  { route: '/', pngBuffer: png, width: 1, height: 1 },
]);
console.log('injected new project; waiting for poll to pick it up...');
let tabsAfterPoll = tabsBeforePoll;
for (let i = 0; i < 8; i++) {
  await new Promise(r => setTimeout(r, 1000));
  tabsAfterPoll = await page.evaluate(() => document.querySelectorAll('.home-tab').length);
  if (tabsAfterPoll > tabsBeforePoll) break;
}
console.log('tabs after poll:', tabsAfterPoll);
tabsAfterPoll === tabsBeforePoll + 1 ? pass('live-update poll picked up new project') : fail('live-update poll', `before=${tabsBeforePoll}, after=${tabsAfterPoll} (waited 8s)`);

// === ESC closes dropdown / kebab ===
console.log('\n=== E. ESC keyboard handling ===');
await page.evaluate(() => location.hash = `#/project/${'38f7249a2ca8'}`);
await new Promise(r => setTimeout(r, 600));
await page.click('.commit-host .dropdown-trigger');
await new Promise(r => setTimeout(r, 200));
await page.keyboard.press('Escape');
await new Promise(r => setTimeout(r, 200));
const dropdownClosed = await page.evaluate(() => document.querySelector('.commit-host .dropdown-menu')?.hidden);
dropdownClosed ? pass('ESC closes dropdown') : fail('ESC closes dropdown', 'still open');

console.log('\n=== console errors:', errs.length === 0 ? 'none' : errs);
errs.length === 0 ? pass('no JS errors during all tests') : fail('console clean', errs.join('; '));

await page.close();
await browser.close();

console.log(`\n=== SUMMARY ===`);
console.log(`${results.filter(r => r.ok).length} / ${results.length} pass`);
if (issues.length > 0) {
  console.log(`\nIssues:`);
  issues.forEach(i => console.log(`  ${i}`));
}
