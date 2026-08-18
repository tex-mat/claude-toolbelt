import { describe, test, expect } from 'vitest';
import { buildPrompt } from '../../src/lib/assemble.js';

describe('buildPrompt', () => {
  test('returns just the command when there are no arguments or extra text', () => {
    expect(buildPrompt('/roll-dice', [], '')).toBe('/roll-dice');
  });

  test('appends a single filled argument after the command', () => {
    expect(buildPrompt('/crosspost', ['my launch post'], '')).toBe('/crosspost my launch post');
  });

  test('joins multiple filled arguments in order with spaces', () => {
    expect(buildPrompt('/plug-a:bar', ['a.txt', 'b.txt'], '')).toBe('/plug-a:bar a.txt b.txt');
  });

  test('adds extra context on its own paragraph below the command', () => {
    expect(buildPrompt('/explain', ['src/app.js'], 'Keep it non-technical.')).toBe(
      '/explain src/app.js\n\nKeep it non-technical.'
    );
  });

  test('ignores blank argument boxes and whitespace-only extra text', () => {
    expect(buildPrompt('/ship', ['  '], '   \n ')).toBe('/ship');
  });
});
