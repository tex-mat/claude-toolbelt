// Regenerates the README screenshots by driving the real app with Playwright.
// Usage: quit any running SkillWidget, then  node scripts/make-screenshots.mjs
import { _electron as electron } from 'playwright';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'docs', 'screenshots');
fs.mkdirSync(outDir, { recursive: true });

const app = await electron.launch({ args: [root] }); // real ~/.claude data
const win = await app.firstWindow();
const shot = (name) => win.screenshot({ path: path.join(outDir, name) });

// 1. Collapsed edge tab
await win.waitForSelector('#tab');
await shot('collapsed-tab.png');

// 2. Expanded list view (Skills bucket)
await win.click('#tab');
await win.waitForSelector('.entry');
await shot('list-view.png');

// 3. Search across every bucket
await win.fill('#search', 'review');
await win.waitForSelector('.group-label');
await shot('search-results.png');

// 4. Detail view: an agent with its blank and Read more open
await win.click('.entry:has-text("code-reviewer")');
await win.fill('.blank-input', 'review my sign-in flow for security issues');
await win.click('#readmore');
await win.waitForSelector('#doc:not([hidden])');
await shot('detail-view.png');

await app.close();
console.log('Screenshots written to docs/screenshots/');
