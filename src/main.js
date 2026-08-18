// Main process: owns the always-on-top edge window, file scanning and clipboard.
const { app, BrowserWindow, ipcMain, clipboard, screen, globalShortcut } = require('electron');
const path = require('node:path');
const os = require('node:os');
const { scanAll } = require('./lib/scan');
const { buildPrompt } = require('./lib/assemble');
const { readDocInside } = require('./lib/safe-read');

const TOGGLE_HOTKEY = 'Alt+Space'; // ⌥ Option-Space

// Tests point this at a fixture folder; normal runs read the real ~/.claude.
const CLAUDE_DIR = process.env.SKILL_WIDGET_CLAUDE_DIR || path.join(os.homedir(), '.claude');

const COLLAPSED_SIZE = { width: 22, height: 168 };
const EXPANDED_SIZE = { width: 384, height: 640 };

let win = null;

// Pins the window to the right edge of the primary screen, vertically centred.
function edgeBounds(size) {
  const area = screen.getPrimaryDisplay().workArea;
  return {
    x: area.x + area.width - size.width,
    y: area.y + Math.round((area.height - size.height) / 2),
    width: size.width,
    height: size.height,
  };
}

function setExpanded(expanded) {
  if (!win) return;
  // resizable stays false so the user can't drag-resize; lift it briefly
  // because macOS ignores programmatic resizes on non-resizable windows.
  win.setResizable(true);
  win.setBounds(edgeBounds(expanded ? EXPANDED_SIZE : COLLAPSED_SIZE));
  win.setResizable(false);
}

function createWindow() {
  win = new BrowserWindow({
    ...edgeBounds(COLLAPSED_SIZE),
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    fullscreenable: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js') },
  });
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

ipcMain.handle('scan', () => scanAll(CLAUDE_DIR));
ipcMain.handle('set-expanded', (_event, expanded) => setExpanded(Boolean(expanded)));
ipcMain.handle('copy-prompt', (_event, { invoke, args, extra }) => {
  const text = buildPrompt(invoke, args, extra);
  clipboard.writeText(text);
  return text;
});
ipcMain.handle('read-doc', (_event, filePath) => readDocInside(CLAUDE_DIR, filePath));
ipcMain.handle('quit', () => app.quit());

app.whenReady().then(() => {
  if (app.dock) app.dock.hide(); // pure widget: no Dock icon
  createWindow();

  // System-wide hotkey: the renderer decides whether that means open or close.
  const ok = globalShortcut.register(TOGGLE_HOTKEY, () => {
    if (!win) return;
    win.focus(); // so you can type into search straight away
    win.webContents.send('toggle-panel');
  });
  if (!ok) console.error(`Could not register hotkey ${TOGGLE_HOTKEY} — another app may be using it.`);
});

app.on('will-quit', () => globalShortcut.unregisterAll());
app.on('window-all-closed', () => app.quit());
