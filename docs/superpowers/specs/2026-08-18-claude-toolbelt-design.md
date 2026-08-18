# Claude Toolbelt — design spec

Date: 2026-08-18. Approved by Mattia in conversation; spec review waived by user.
Renamed from "Skill Widget" to "Claude Toolbelt" on 2026-08-18, since it covers
plugins, commands and agents as well as skills. App bundle: Toolbelt.app.

## Purpose

A small always-on-top macOS widget pinned to the right mid edge of the screen.
It lists every Claude Code skill and slash command available on this machine,
lets Mattia search by use case, shows whether an entry needs arguments, and
assembles a paste-ready prompt that is copied to the clipboard.

Personal tool, single user, runs locally only. No network access.

## Behaviour

- Collapsed: a slim vertical tab (~16px wide) at the right edge, vertically
  centred, floating above all windows, visible on all desktops/spaces.
- Hover or click expands it into a ~380px panel. Mouse leaving the panel or
  pressing Esc collapses it.
- Panel top: search box filtering by name AND description (case-insensitive).
  Search looks across ALL buckets, grouped by bucket in the results.
- Navigation tabs below the search box: four buckets —
  Skills (personal) / Plugins (plugin skills + plugin commands) /
  Commands (personal) / Agents. (Added mid-build at Mattia's request.)
- Entries show name, one-line description, and a "needs input" badge when
  the entry requires arguments.
- Agents are not slash commands: they copy as plain words, e.g.
  "Use the code-reviewer agent to <task>", with the task as the blank.
- Clicking an entry opens a form: one text box per argument blank
  ($1..$n if numbered, otherwise a single box when $ARGUMENTS or an
  argument-hint is present), plus an optional free-text "extra context" area.
- Copy button assembles: `/name <args>` on the first line, then a blank line,
  then the extra context (if any). Result goes to the clipboard.
- Quit button in the panel footer. No dock icon.
- Global hotkey ⌥-Space (Alt+Space) toggles the panel from anywhere and
  focuses the search box. (Added after v1 at Mattia's request.)
- Detail view has a "Read more" toggle showing the entry's full markdown
  document. The main process only serves files inside ~/.claude.
- The packaged app is registered as a macOS Login Item (one-time osascript,
  not app code), so it starts at login.

## Data sources (rescanned every time the panel opens)

- Personal skills: `~/.claude/skills/*/SKILL.md` (symlinked skill folders
  are followed — two of Mattia's skills are symlinks)
- Agents: `~/.claude/agents/*.md`
- Plugin skills: `~/.claude/plugins/cache/<marketplace>/<plugin>/<version>/skills/*/SKILL.md`
  — invoked as `/plugin:skill`; deduplicated when multiple versions exist.
- Plugin commands: `~/.claude/plugins/cache/.../commands/*.md` — invoked as `/plugin:command`.
- Personal commands: `~/.claude/commands/*.md`
- Frontmatter parsed by a small hand-rolled parser (name, description,
  argument-hint). No YAML library dependency.
- Needs-input detection: `$ARGUMENTS`, `$1`–`$9`, or an `argument-hint` in the file.

## Error handling

- Unreadable/unparseable file: entry still listed with "couldn't read details".
- Missing source folder: that section says so explicitly. Nothing silently
  dropped or invented.
- The app only reads `~/.claude`; it never writes there.

## Tech

Electron, vanilla HTML/CSS/JS renderer. Dependencies limited to
well-known official packages only: `electron`, `@electron/packager` (packaging),
`vitest` (unit tests), `playwright` (functional tests). No other runtime deps.

## Testing

- Unit (Vitest): frontmatter parser, scanner (against a fixture directory),
  prompt assembly.
- Functional (Playwright Electron): launch app, expand panel, search, open an
  entry, fill argument, copy, assert clipboard contents.

## Out of scope (YAGNI)

Multi-display placement, editing skills, invoking skills directly in a
terminal, favourites, recents, copy history, usage stats, LLM prompt
refinement (considered and rejected: adds network access, latency and cost
while Claude Code already interprets rough prompts well).
