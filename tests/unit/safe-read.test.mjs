import { describe, test, expect } from 'vitest';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { readDocInside } from '../../src/lib/safe-read.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_HOME = path.join(here, '..', 'fixtures', 'claude-home');

describe('readDocInside', () => {
  test('reads a file that lives inside the allowed folder', () => {
    const out = readDocInside(FIXTURE_HOME, path.join(FIXTURE_HOME, 'commands', 'ship.md'));
    expect(out.ok).toBe(true);
    expect(out.text).toContain('Commit everything');
  });

  test('refuses a path outside the allowed folder', () => {
    const out = readDocInside(FIXTURE_HOME, '/etc/hosts');
    expect(out.ok).toBe(false);
    expect(out.error).toMatch(/outside/);
  });

  test('refuses a traversal path that escapes via dot-dot segments', () => {
    const sneaky = path.join(FIXTURE_HOME, '..', '..', '..', 'package.json');
    const out = readDocInside(FIXTURE_HOME, sneaky);
    expect(out.ok).toBe(false);
  });

  test('reports a readable error when the file does not exist', () => {
    const out = readDocInside(FIXTURE_HOME, path.join(FIXTURE_HOME, 'commands', 'gone.md'));
    expect(out.ok).toBe(false);
    expect(out.error).toMatch(/read/i);
  });
});
