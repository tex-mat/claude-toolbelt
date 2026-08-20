# Argument Usage Hints Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Under each "needs input" text box, show the sentence from the skill/command file where the argument is actually used, so the user knows what to type.

**Architecture:** The scanner (`src/lib/scan.js`) already finds placeholders (`$1`, `$2`, `$ARGUMENTS`) in each file. We extend it to also capture the line of text surrounding each placeholder, with the placeholder replaced by `___`. The `blanks` field changes shape from an array of label strings to an array of `{ label, usage }` objects. The renderer (`src/renderer/app.js`) shows the usage text as small helper text under each input box, prefixed "Used as:". Agents keep their existing "what it should do" label with no usage text (their description already appears directly above).

**Tech Stack:** Electron, vanilla JS, Vitest (unit), Playwright (e2e). No new dependencies.

## Global Constraints

- Per the user's git rules: **no commits** — the user commits when they ask. Plan steps therefore end at "tests pass", not "commit".
- Scanner stays read-only: never write to the scanned directories.
- Keep code simple and commented in plain English (non-technical owner reads it).
- `MAX_USAGE_CHARS = 120` — usage text longer than this is trimmed around the `___` with `…` markers. Named constant, no magic numbers.
- Usage helper text in the UI is rendered with `textContent` (never innerHTML) — file content is untrusted input.

## Data shape (contract between tasks)

`detectInput(content, attrs)` returns:

```js
// before: { needsInput: true, blanks: ['argument 1'] }
// after:  { needsInput: true, blanks: [{ label: 'argument 1', usage: 'Compare ___ against $2 and report differences.' }] }
```

- `label`: same strings as today ('argument N', the `argument-hint` value, or 'input').
- `usage`: cleaned text of the first body line containing that placeholder, with the placeholder replaced by `___`; `null` when no such line exists (e.g. `argument-hint` present but no `$ARGUMENTS` in the body).
- Agent entries: `blanks: [{ label: 'what it should do', usage: null }]`.

---

### Task 1: Extract the usage line in the scanner

**Files:**
- Modify: `src/lib/scan.js` (the `detectInput` function and `scanAgentsDir`)
- Test: `tests/unit/scan.test.mjs`

**Interfaces:**
- Produces: `detectInput(content, attrs)` returning `{ needsInput, blanks: [{ label, usage }] }` as specified above. Renderer (Task 2) consumes `blank.label` and `blank.usage`.

- [ ] **Step 1: Update the unit tests to the new shape and add usage-extraction cases**

Rewrite the `detectInput` block in `tests/unit/scan.test.mjs`:

```js
describe('detectInput', () => {
  test('finds a single blank when the body mentions $ARGUMENTS', () => {
    const out = detectInput('Post $ARGUMENTS everywhere.', {});
    expect(out.needsInput).toBe(true);
    expect(out.blanks).toEqual([{ label: 'input', usage: 'Post ___ everywhere.' }]);
  });

  test('uses the argument-hint as the blank label when present', () => {
    const out = detectInput('Use $ARGUMENTS.', { 'argument-hint': 'commit message' });
    expect(out.blanks).toEqual([{ label: 'commit message', usage: 'Use ___.' }]);
  });

  test('finds one blank per numbered placeholder, each with its own usage line', () => {
    const out = detectInput('Compare $1 against $2.\nThen delete $2.', {});
    expect(out.blanks).toEqual([
      { label: 'argument 1', usage: 'Compare ___ against $2.' },
      { label: 'argument 2', usage: 'Compare $1 against ___.' },
    ]);
  });

  test('gives a null usage when the hint exists but no placeholder is in the body', () => {
    const out = detectInput('No placeholder here.', { 'argument-hint': 'a file path' });
    expect(out.blanks).toEqual([{ label: 'a file path', usage: null }]);
  });

  test('strips leading markdown markers from the usage line', () => {
    const out = detectInput('## Do it\n- Post $ARGUMENTS now.', {});
    expect(out.blanks[0].usage).toBe('Post ___ now.');
  });

  test('trims a very long usage line around the blank', () => {
    const long = 'x'.repeat(200) + ' $ARGUMENTS ' + 'y'.repeat(200);
    const out = detectInput(long, {});
    expect(out.blanks[0].usage.length).toBeLessThanOrEqual(124); // 120 + ellipses
    expect(out.blanks[0].usage).toContain('___');
  });

  test('reports no input needed when there are no placeholders or hints', () => {
    const out = detectInput('No arguments needed.', {});
    expect(out.needsInput).toBe(false);
    expect(out.blanks).toEqual([]);
  });
});
```

Also update the `scanAll` assertions that touch blanks:

```js
  test('gives a numbered-placeholder command one blank per number', () => {
    const entries = section(scanAll(FIXTURE_HOME), 'plugins').entries;
    const bar = entries.find((e) => e.name === 'plug-a:bar');
    expect(bar.blanks.map((b) => b.label)).toEqual(['argument 1', 'argument 2']);
    expect(bar.blanks[0].usage).toBe('Compare ___ against $2 and report differences.');
  });
```

and in the agents test:

```js
    expect(reviewer.blanks).toEqual([{ label: 'what it should do', usage: null }]);
```

- [ ] **Step 2: Run the unit tests to verify they fail**

Run: `npm run test:unit`
Expected: FAIL — blanks are still plain strings.

- [ ] **Step 3: Implement usage extraction in `src/lib/scan.js`**

Replace `detectInput` with:

```js
// Longest usage snippet we show under an input box before trimming.
const MAX_USAGE_CHARS = 120;

// Finds the first body line that uses a placeholder (e.g. "$1" or
// "$ARGUMENTS") and turns it into helper text: the placeholder becomes
// a visible blank ("___") so the user can see where their words land.
function usageFor(content, token) {
  const line = content.split('\n').find((l) => l.includes(token));
  if (!line) return null;

  let text = line
    .trim()
    .replace(/^[#>*-]+\s*/, '') // drop leading markdown markers (#, -, >, *)
    .split(token)
    .join('___');

  // Very long lines get trimmed to a window around the blank.
  if (text.length > MAX_USAGE_CHARS) {
    const idx = text.indexOf('___');
    const start = Math.max(0, idx - Math.floor(MAX_USAGE_CHARS / 2));
    const slice = text.slice(start, start + MAX_USAGE_CHARS);
    text = (start > 0 ? '…' : '') + slice + (start + MAX_USAGE_CHARS < text.length ? '…' : '');
  }
  return text;
}

// Works out whether an entry needs user input, what to call each blank,
// and the sentence in the file where each blank is used.
function detectInput(content, attrs) {
  const numbered = new Set(content.match(/\$[1-9]/g) || []);
  if (numbered.size > 0) {
    const blanks = [...numbered]
      .sort()
      .map((p) => ({ label: `argument ${p.slice(1)}`, usage: usageFor(content, p) }));
    return { needsInput: true, blanks };
  }
  const hint = attrs['argument-hint'];
  if (content.includes('$ARGUMENTS') || hint) {
    return {
      needsInput: true,
      blanks: [{ label: hint || 'input', usage: usageFor(content, '$ARGUMENTS') }],
    };
  }
  return { needsInput: false, blanks: [] };
}
```

Note: placeholders only appear in the file body in practice, so searching
the whole content (frontmatter included) is fine and keeps the code simple.

In `scanAgentsDir`, change the blank line to the new shape:

```js
    return { ...entry, needsInput: true, blanks: [{ label: 'what it should do', usage: null }] };
```

- [ ] **Step 4: Run the unit tests to verify they pass**

Run: `npm run test:unit`
Expected: PASS (all files — assemble and safe-read tests must stay green too).

---

### Task 2: Show the usage text under each input box

**Files:**
- Modify: `src/renderer/app.js` (the `showDetail` function)
- Modify: `src/renderer/style.css` (one new rule)
- Test: `tests/e2e/widget.spec.mjs`

**Interfaces:**
- Consumes: `entry.blanks` as `[{ label, usage }]` from Task 1.
- Produces: each `.field` in `#blanks` may contain a `.usage` div with text `Used as: “<usage>”`.

- [ ] **Step 1: Add a failing e2e test**

Add to `tests/e2e/widget.spec.mjs`:

```js
test('the input box explains how the argument is used in the file', async () => {
  const { app, win } = await launchWidget();
  await win.click('#tab');
  await win.click('.bucket-btn:has-text("Commands")');
  await win.click('.entry:has-text("ship")');
  await expect(win.locator('.field .usage')).toHaveText(
    'Used as: “Commit everything with message: ___”'
  );
  await app.close();
});

test('numbered arguments each explain their own position', async () => {
  const { app, win } = await launchWidget();
  await win.click('#tab');
  await win.click('.bucket-btn:has-text("Plugins")');
  await win.click('.entry:has-text("plug-a:bar")');
  const usages = win.locator('.field .usage');
  await expect(usages).toHaveText([
    'Used as: “Compare ___ against $2 and report differences.”',
    'Used as: “Compare $1 against ___ and report differences.”',
  ]);
  await app.close();
});
```

- [ ] **Step 2: Run the e2e tests to verify the new ones fail**

Run: `npm run test:e2e`
Expected: the two new tests FAIL (no `.usage` element); existing tests PASS.

- [ ] **Step 3: Render the usage text in `showDetail`**

In `src/renderer/app.js`, replace the blank-building loop with:

```js
  entry.blanks.forEach((blank, i) => {
    const field = document.createElement('label');
    field.className = 'field';
    const caption = document.createElement('span');
    caption.textContent = blank.label;
    const input = document.createElement('input');
    input.className = 'blank-input';
    input.type = 'text';
    input.dataset.index = String(i);
    field.append(caption, input);
    // Show the sentence from the file where this argument is used,
    // so the user knows what to type. textContent keeps it safe.
    if (blank.usage) {
      const usage = document.createElement('div');
      usage.className = 'usage';
      usage.textContent = `Used as: “${blank.usage}”`;
      field.appendChild(usage);
    }
    blanks.appendChild(field);
  });
```

- [ ] **Step 4: Style the helper text**

In `src/renderer/style.css`, after the `.field span` rule add:

```css
.field .usage { font-size: 11px; font-weight: 400; font-style: italic; color: var(--text-dim); }
```

- [ ] **Step 5: Run the full test suite**

Run: `npm test`
Expected: all unit and e2e tests PASS.

---

### Task 3: Document the behaviour

**Files:**
- Modify: `README.md` (the "Fill in any needs input blanks" area, around line 42)

**Interfaces:**
- Consumes: nothing programmatic — prose only.

- [ ] **Step 1: Update the README usage paragraph**

Change the step-2 line to mention the helper text, e.g.:

```markdown
2. Click an entry. Each "needs input" blank shows the sentence from the
   skill file where your text will land ("Used as: …"), so you know what
   to type. Fill in the blanks, optionally add extra
```

(keep the rest of the original sentence flow intact).

- [ ] **Step 2: Run the full test suite one last time**

Run: `npm test`
Expected: PASS. Report the real output to the user. Do not commit — the user commits when they ask.

---

### Task 4: Ignore fake placeholders (bug fix after first review)

Real-world review showed the widget was flagging entries that need no input at
all, because `\$[1-9]` matched things that are not arguments:

- **Money.** `$125/hr`, `$5,000`, `$50k`, `$99.00` — the `$1` inside `$125` was
  read as "argument 1". This hit `security-scan` (3 fake blanks, and they
  outranked its one real `$ARGUMENTS`), `high-end-visual-design`, and
  `redesign-existing-projects`.
- **Code samples.** `SELECT * FROM users WHERE email = $1` (a database
  parameter) in `ecc-security-review`, and `awk '{print $1}'` (a shell field)
  in `superpowers:requesting-code-review`.

**Files:**
- Modify: `src/lib/scan.js`
- Modify: `src/renderer` — none needed; the renderer already handles `usage: null`
- Test: `tests/unit/scan.test.mjs`, `tests/e2e/widget.spec.mjs`
- Create: `tests/fixtures/claude-home/skills/pricing/SKILL.md`

**Changes made:**
1. `proseLines()` strips fenced code blocks and inline `code` spans before any
   placeholder search, keeping line positions so headings can still be found.
2. `NUMBERED_PLACEHOLDER = /\$([1-9])(?!\d|[.,]\d)/g` — refuses to match inside
   a price, while still matching `$1,` in ordinary prose.
3. `$ARGUMENTS` is now also searched in prose only, for the same reason.
4. Usage text is built from the whole sentence (block of wrapped lines, ended by
   headings) rather than one physical line, so wrapped sentences read properly.
5. A placeholder alone on a line falls back to the section heading above it:
   `## Requirements` + `$ARGUMENTS` renders as `Requirements: ___`.
6. `MAX_USAGE_CHARS` raised 120 → 160 now that snippets are full sentences.
7. Agents now carry a usage line too — `Use the code-reviewer agent to ___` —
   answering "why is this not applied to agents?".

**Verified:** `npm test` → 39 unit tests pass, 11 e2e tests pass. Re-running the
scan against the real `~/.claude` leaves 0 false positives: 5 of 7 commands and
all 22 agents ask for input, and no skill or plugin does.
