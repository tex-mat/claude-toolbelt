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
    expect(out.blanks).toEqual(['input']);
  });

  test('uses the argument-hint as the blank label when present', () => {
    const out = detectInput('Use $ARGUMENTS.', { 'argument-hint': 'commit message' });
    expect(out.blanks).toEqual(['commit message']);
  });

  test('finds one blank per numbered placeholder', () => {
    const out = detectInput('Compare $1 against $2.', {});
    expect(out.blanks).toEqual(['argument 1', 'argument 2']);
  });

  test('reports no input needed when there are no placeholders or hints', () => {
    const out = detectInput('No arguments needed.', {});
    expect(out.needsInput).toBe(false);
    expect(out.blanks).toEqual([]);
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
    expect(bar.blanks).toEqual(['argument 1', 'argument 2']);
  });

  test('lists agents with a plain-words invocation and a task blank', () => {
    const entries = section(scanAll(FIXTURE_HOME), 'agents').entries;
    const reviewer = entries.find((e) => e.name === 'code-reviewer');
    expect(reviewer.invoke).toBe('Use the code-reviewer agent to');
    expect(reviewer.needsInput).toBe(true);
    expect(reviewer.blanks).toEqual(['what it should do']);
    expect(reviewer.description).toMatch(/code review/i);
  });

  test('marks a section as missing when its folder does not exist', () => {
    const result = scanAll(EMPTY_HOME);
    expect(section(result, 'skills').missing).toBe(true);
    expect(section(result, 'skills').entries).toEqual([]);
    expect(section(result, 'agents').missing).toBe(true);
  });
});
