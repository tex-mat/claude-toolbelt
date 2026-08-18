import { test, expect, _electron as electron } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..', '..');
const fixtureHome = path.join(root, 'tests', 'fixtures', 'claude-home');

// Every test runs the real app against the fixture ~/.claude folder,
// so results don't change when real skills are added or removed.
async function launchWidget() {
  const app = await electron.launch({
    args: [root],
    env: { ...process.env, SKILL_WIDGET_CLAUDE_DIR: fixtureHome },
  });
  const win = await app.firstWindow();
  return { app, win };
}

async function readClipboard(app) {
  return app.evaluate(({ clipboard }) => clipboard.readText());
}

test('clicking the edge tab expands the panel and shows the four buckets', async () => {
  const { app, win } = await launchWidget();
  await win.click('#tab');
  await expect(win.locator('.bucket-btn')).toHaveText(['Skills', 'Plugins', 'Commands', 'Agents']);
  await expect(win.locator('.entry-name', { hasText: 'crosspost' })).toBeVisible();
  await app.close();
});

test('searching by use case, filling the blank and copying puts the command on the clipboard', async () => {
  const { app, win } = await launchWidget();
  await win.click('#tab');
  await win.fill('#search', 'social platforms');
  await win.click('.entry:has-text("crosspost")');
  await win.fill('.blank-input', 'my launch post');
  await win.click('#copy');
  expect(await readClipboard(app)).toBe('/crosspost my launch post');
  await app.close();
});

test('extra context is copied as its own paragraph below the command', async () => {
  const { app, win } = await launchWidget();
  await win.click('#tab');
  await win.click('.bucket-btn:has-text("Commands")');
  await win.click('.entry:has-text("ship")');
  await win.fill('.blank-input', 'fix: typo in pricing page');
  await win.fill('#extra', 'Only the files we discussed, nothing else.');
  await win.click('#copy');
  expect(await readClipboard(app)).toBe(
    '/ship fix: typo in pricing page\n\nOnly the files we discussed, nothing else.'
  );
  await app.close();
});

test('the detail view fully replaces the list, search and bucket tabs', async () => {
  const { app, win } = await launchWidget();
  await win.click('#tab');
  await win.click('.entry:has-text("crosspost")');
  await expect(win.locator('#list')).toBeHidden();
  await expect(win.locator('#buckets')).toBeHidden();
  await expect(win.locator('#search')).toBeHidden();
  await app.close();
});

test('read more reveals the full skill document and toggles back off', async () => {
  const { app, win } = await launchWidget();
  await win.click('#tab');
  await win.click('.entry:has-text("crosspost")');
  await win.click('#readmore');
  await expect(win.locator('#doc')).toContainText('Post $ARGUMENTS to every configured platform');
  await win.click('#readmore');
  await expect(win.locator('#doc')).toBeHidden();
  await app.close();
});

test('registers the global hotkey and toggling it opens and closes the panel', async () => {
  const { app, win } = await launchWidget();

  const registered = await app.evaluate(({ globalShortcut }) =>
    globalShortcut.isRegistered('Alt+Space')
  );
  expect(registered).toBe(true);

  // Drive the same code path the OS hotkey triggers (Playwright cannot
  // synthesise a system-wide keystroke).
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].webContents.send('toggle-panel')
  );
  await expect(win.locator('#search')).toBeVisible();

  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].webContents.send('toggle-panel')
  );
  await expect(win.locator('#search')).toBeHidden();
  await app.close();
});

test('agents copy as a plain-words request instead of a slash command', async () => {
  const { app, win } = await launchWidget();
  await win.click('#tab');
  await win.click('.bucket-btn:has-text("Agents")');
  await win.click('.entry:has-text("code-reviewer")');
  await win.fill('.blank-input', 'review my login code');
  await win.click('#copy');
  expect(await readClipboard(app)).toBe('Use the code-reviewer agent to review my login code');
  await app.close();
});
