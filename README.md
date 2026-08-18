# Skill Widget

A small always-on-top widget pinned to the right edge of the screen. It lists
every Claude Code skill, plugin, command and agent on this Mac, lets you search
by use case, and assembles a paste-ready prompt onto the clipboard.

Personal tool. Runs locally only, no network access. It only ever **reads**
`~/.claude` — it never writes there.

## Run it

Double-click `dist/SkillWidget-darwin-arm64/SkillWidget.app`, or from this folder:

```
npm start
```

A slim gold tab appears at the right mid edge. Hover or click to open — or
press **⌥ Option-Space** from anywhere to toggle it (change the key in
`src/main.js`, `TOGGLE_HOTKEY`). Esc or moving the mouse away closes it.
Quit with the small "quit" button in the panel.

It starts automatically at login (System Settings → General → Login Items).

Note: quit the widget before running `npm run test:e2e` — the running copy
holds the ⌥-Space hotkey, which makes the hotkey test fail.

## Use it

1. Pick a bucket (Skills / Plugins / Commands / Agents) or just search —
   search looks across everything by name and description.
2. Click an entry. Fill in any "needs input" blanks, optionally add extra
   context below. **Read more** shows the entry's full document if the
   one-line description isn't enough.
3. Hit **Copy prompt**, then paste into Claude Code and press enter.

## Files

- `src/main.js` — the app window (position, always-on-top, clipboard, quit)
- `src/preload.js` — the narrow bridge between the window and the UI
- `src/lib/scan.js` — reads skills/commands/agents from `~/.claude` (read-only)
- `src/lib/assemble.js` — builds the copied prompt text
- `src/renderer/` — the panel UI (HTML/CSS/JS, no frameworks)
- `tests/unit/` — Vitest tests for scanning and prompt assembly
- `tests/e2e/` — Playwright tests that drive the real app against fixture data

## Tests

```
npm test          # everything
npm run test:unit
npm run test:e2e
```

## Rebuild the app after changes

```
npm run package
```
