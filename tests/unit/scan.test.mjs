import { describe, test, expect } from 'vitest';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { parseFrontmatter, detectInput, scanAll } from '../../src/lib/scan.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_HOME = path.join(here, '..', 'fixtures', 'claude-home');
const EMPTY_HOME = path.join(here, '..', 'fixtures', 'empty-home');

function section(result, id) {
  return result.sections.find((s) => s.id === id);
}

describe('parseFrontmatter', () => {
  test('reads name and description from a frontmatter block', () => {
    const out = parseFrontmatter('---\nname: foo\ndescription: Does a thing.\n---\n\nBody.');
    expect(out.ok).toBe(true);
    expect(out.attrs.name).toBe('foo');
    expect(out.attrs.description).toBe('Does a thing.');
  });

  test('returns ok false when there is no frontmatter block', () => {
    const out = parseFrontmatter('# Just a heading\n\nProse.');
    expect(out.ok).toBe(false);
  });

  test('returns ok false when the frontmatter block is never closed', () => {
    const out = parseFrontmatter('---\nname: foo\n\nBody without closing fence.');
    expect(out.ok).toBe(false);
  });

  test('folds indented continuation lines into the previous value', () => {
    const out = parseFrontmatter('---\ndescription: First part\n  second part\n---\n');
    expect(out.attrs.description).toBe('First part second part');
  });
});

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
    const out = detectInput('## Do it\n\n- Post $ARGUMENTS now.', {});
    expect(out.blanks[0].usage).toBe('Post ___ now.');
  });

  test('trims a very long usage line around the blank', () => {
    const long = 'x'.repeat(200) + ' $ARGUMENTS ' + 'y'.repeat(200);
    const out = detectInput(long, {});
    expect(out.blanks[0].usage.length).toBeLessThanOrEqual(164); // 160 + ellipses
    expect(out.blanks[0].usage).toContain('___');
  });

  test('reports no input needed when there are no placeholders or hints', () => {
    const out = detectInput('No arguments needed.', {});
    expect(out.needsInput).toBe(false);
    expect(out.blanks).toEqual([]);
  });

  test('ignores a placeholder that is only a database parameter in a code block', () => {
    const out = detectInput('Use a safe query:\n\n```sql\nSELECT * FROM users WHERE email = $1\n```\n', {});
    expect(out.needsInput).toBe(false);
    expect(out.blanks).toEqual([]);
  });

  test('ignores a placeholder inside an inline code span', () => {
    const out = detectInput("Get the sha with `awk '{print $1}'` first.", {});
    expect(out.needsInput).toBe(false);
  });

  test('ignores dollar amounts, which are prices rather than arguments', () => {
    const out = detectInput('Budget: $5,000 at $125/hr, total $50,000 for a $99.00 plan.', {});
    expect(out.needsInput).toBe(false);
  });

  test('still finds a real $ARGUMENTS in a file that also quotes prices', () => {
    const out = detectInput('## Requirements\n\n$ARGUMENTS\n\nCost: $5,000 at $125/hr.', {});
    expect(out.needsInput).toBe(true);
    expect(out.blanks).toEqual([{ label: 'input', usage: 'Requirements: ___' }]);
  });

  test('leaves a price untouched when it shares a line with a real placeholder', () => {
    const out = detectInput('Audit $1 for under $5,000.', {});
    expect(out.blanks[0].usage).toBe('Audit ___ for under $5,000.');
  });

  test('ignores a whole-dollar price like "$5 of free credits" when no $1 exists', () => {
    // Real case: the Vercel ai-gateway skill says "Every Vercel team gets
    // **$5 of free AI Gateway credits per month**" — money, not argument 5.
    const out = detectInput('Every team gets **$5 of free credits per month**.', {});
    expect(out).toEqual({ needsInput: false, blanks: [] });
  });

  test('a higher number with no $1 anywhere is a price, not an argument', () => {
    const out = detectInput('Ship it for $9 flat.', {});
    expect(out.needsInput).toBe(false);
  });

  test('joins a sentence that wraps over several lines', () => {
    const out = detectInput(
      'Target file: `docs/A.md` unless $ARGUMENTS names a different path, focus\narea, or diagram type — honour it.',
      {}
    );
    expect(out.blanks[0].usage).toBe(
      'Target file: docs/A.md unless ___ names a different path, focus area, or diagram type — honour it.'
    );
  });

  test('names the section above when the placeholder sits on a line of its own', () => {
    const out = detectInput('## Requirements\n\n$ARGUMENTS\n\n## Instructions\n\nGo.', {});
    expect(out.blanks[0].usage).toBe('Requirements: ___');
  });
});

describe('scanAll', () => {
  test('finds a personal skill with its description and input flag', () => {
    const entries = section(scanAll(FIXTURE_HOME), 'skills').entries;
    const cp = entries.find((e) => e.name === 'crosspost');
    expect(cp.invoke).toBe('/crosspost');
    expect(cp.description).toMatch(/social platforms/);
    expect(cp.needsInput).toBe(true);
  });

  test('each entry records the absolute path of the file it came from', () => {
    const entries = section(scanAll(FIXTURE_HOME), 'skills').entries;
    const cp = entries.find((e) => e.name === 'crosspost');
    expect(cp.file).toBe(path.join(FIXTURE_HOME, 'skills', 'crosspost', 'SKILL.md'));
  });

  test('finds a skill whose folder is a symlink', () => {
    const entries = section(scanAll(FIXTURE_HOME), 'skills').entries;
    const linked = entries.find((e) => e.name === 'linked');
    expect(linked).toBeDefined();
    expect(linked.description).toMatch(/symlink/);
  });

  test('still lists a skill whose file has no readable frontmatter', () => {
    const entries = section(scanAll(FIXTURE_HOME), 'skills').entries;
    const broken = entries.find((e) => e.name === 'broken');
    expect(broken).toBeDefined();
    expect(broken.error).toBe("couldn't read details");
  });

  test('namespaces plugin skills as /plugin:skill in the plugins bucket', () => {
    const entries = section(scanAll(FIXTURE_HOME), 'plugins').entries;
    const foo = entries.find((e) => e.name === 'plug-a:foo');
    expect(foo.invoke).toBe('/plug-a:foo');
  });

  test('lists a plugin skill once even when two versions exist on disk', () => {
    const entries = section(scanAll(FIXTURE_HOME), 'plugins').entries;
    expect(entries.filter((e) => e.name === 'plug-a:foo')).toHaveLength(1);
  });

  test('puts plugin commands in the plugins bucket, not the commands bucket', () => {
    const result = scanAll(FIXTURE_HOME);
    expect(section(result, 'plugins').entries.map((e) => e.name)).toContain('plug-a:bar');
    expect(section(result, 'commands').entries.map((e) => e.name)).not.toContain('plug-a:bar');
  });

  test('lists personal commands in the commands bucket', () => {
    const entries = section(scanAll(FIXTURE_HOME), 'commands').entries;
    expect(entries.map((e) => e.name)).toContain('ship');
  });

  test('gives a numbered-placeholder command one blank per number', () => {
    const entries = section(scanAll(FIXTURE_HOME), 'plugins').entries;
    const bar = entries.find((e) => e.name === 'plug-a:bar');
    expect(bar.blanks.map((b) => b.label)).toEqual(['argument 1', 'argument 2']);
    expect(bar.blanks[0].usage).toBe('Compare ___ against $2 and report differences.');
  });

  test('asks for no input on a skill whose only dollar signs are prices and code', () => {
    const entries = section(scanAll(FIXTURE_HOME), 'skills').entries;
    const pricing = entries.find((e) => e.name === 'pricing');
    expect(pricing.needsInput).toBe(false);
    expect(pricing.blanks).toEqual([]);
  });

  test('lists agents with a plain-words invocation and a task blank', () => {
    const entries = section(scanAll(FIXTURE_HOME), 'agents').entries;
    const reviewer = entries.find((e) => e.name === 'code-reviewer');
    expect(reviewer.invoke).toBe('Use the code-reviewer agent to');
    expect(reviewer.needsInput).toBe(true);
    expect(reviewer.blanks).toEqual([
      { label: 'what it should do', usage: 'Use the code-reviewer agent to ___' },
    ]);
    expect(reviewer.description).toMatch(/code review/i);
  });

  test('marks a section as missing when its folder does not exist', () => {
    const result = scanAll(EMPTY_HOME);
    expect(section(result, 'skills').missing).toBe(true);
    expect(section(result, 'skills').entries).toEqual([]);
    expect(section(result, 'agents').missing).toBe(true);
  });
});
