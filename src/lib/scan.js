// Reads the skills and commands available to Claude Code on this machine.
// Read-only: this module never writes to the scanned directories.
const fs = require('node:fs');
const path = require('node:path');

const UNREADABLE = "couldn't read details";

// Parses the `--- ... ---` block at the top of a skill/command file.
// Deliberately tiny instead of a YAML library: only `key: value` lines,
// with indented lines folded into the previous value.
function parseFrontmatter(content) {
  const lines = content.split('\n');
  if (lines[0].trim() !== '---') return { ok: false, attrs: {} };

  const attrs = {};
  let lastKey = null;
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === '---') return { ok: true, attrs };

    const match = line.match(/^([A-Za-z][\w-]*):\s*(.*)$/);
    if (match) {
      lastKey = match[1];
      attrs[lastKey] = match[2].trim();
    } else if (/^\s+\S/.test(line) && lastKey) {
      attrs[lastKey] = (attrs[lastKey] + ' ' + line.trim()).trim();
    }
  }
  return { ok: false, attrs: {} }; // fence never closed
}

// Longest usage snippet we show under an input box before trimming.
const MAX_USAGE_CHARS = 160;

// A genuine numbered placeholder, $1 to $9. The lookahead refuses to match
// inside a price — $125/hr, $5,000, $50k, $100.00 are money, not arguments.
const NUMBERED_PLACEHOLDER = /\$([1-9])(?!\d|[.,]\d)/g;

// Splits a file into lines with code taken out: fenced blocks become blank
// lines and inline `code` spans are dropped, while line positions stay put.
// Code samples are full of things that look like arguments but are not —
// database parameters (WHERE email = $1), shell fields (awk '{print $1}').
function proseLines(content) {
  let inFence = false;
  return content.split('\n').map((line) => {
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      return '';
    }
    if (inFence) return '';
    return line.replace(/`[^`]*`/g, '');
  });
}

// Matches one specific placeholder, keeping the no-prices rule for numbers.
function placeholderRegex(token, flags) {
  const notMoney = token === '$ARGUMENTS' ? '' : '(?!\\d|[.,]\\d)';
  return new RegExp('\\' + token + notMoney, flags);
}

// Tidies a snippet for display: markdown decoration off, whitespace collapsed.
function tidy(text) {
  return text
    .replace(/[`*]/g, '')
    .replace(/^[#>\-\s]+/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// The block of text around line `i`, joined into one string so a sentence
// that wraps over several lines stays whole. Headings end the block, because
// a heading is a label for what follows rather than part of the sentence.
function blockAround(lines, i) {
  const isHeading = (line) => /^\s*#+\s/.test(line);
  let start = i;
  while (start > 0 && lines[start - 1].trim() && !isHeading(lines[start - 1])) start--;
  let end = i;
  while (end < lines.length - 1 && lines[end + 1].trim() && !isHeading(lines[end + 1])) end++;
  return lines.slice(start, end + 1).join(' ');
}

// The nearest heading at or above line `i`, used when the placeholder sits
// on a line of its own and the surrounding text explains nothing.
function headingAbove(lines, i) {
  for (let j = i; j >= 0; j--) {
    const match = lines[j].match(/^\s*#+\s+(.+)$/);
    if (match) return tidy(match[1]);
  }
  return null;
}

// Explains where a placeholder is used, as the sentence around it with the
// placeholder shown as a blank ("___") so the user sees where their words go.
function usageFor(content, token) {
  const lines = content.split('\n');
  const prose = proseLines(content);
  const found = placeholderRegex(token);
  const i = prose.findIndex((line) => found.test(line));
  if (i === -1) return null;

  const block = blockAround(lines, i);
  const sentences = block.split(/(?<=[.!?])\s+/);
  const sentence = sentences.find((s) => found.test(s)) || block;

  let text = tidy(sentence).replace(placeholderRegex(token, 'g'), '___');

  // A line holding nothing but the placeholder says nothing on its own,
  // so name the section it belongs to instead.
  if (text === '___') {
    const heading = headingAbove(lines, i);
    if (!heading) return null;
    text = `${heading}: ___`;
  }

  // Very long snippets get trimmed to a window around the blank.
  if (text.length > MAX_USAGE_CHARS) {
    const idx = text.indexOf('___');
    const start = Math.max(0, idx - Math.floor(MAX_USAGE_CHARS / 2));
    const slice = text.slice(start, start + MAX_USAGE_CHARS);
    text = (start > 0 ? '…' : '') + slice + (start + MAX_USAGE_CHARS < text.length ? '…' : '');
  }
  return text;
}

// Works out whether an entry needs user input, what to call each blank,
// and the sentence in the file where each blank is used. Placeholders inside
// code samples are ignored — they belong to the example, not to the user.
function detectInput(content, attrs) {
  const prose = proseLines(content).join('\n');

  const numbered = new Set(prose.match(NUMBERED_PLACEHOLDER) || []);
  // Positional arguments always start at $1. A higher number with no $1
  // anywhere in the file is money the price rule missed — "$5 of free
  // credits", "$9 flat" — not argument 5.
  if (numbered.size > 0 && numbered.has('$1')) {
    const blanks = [...numbered]
      .sort()
      .map((p) => ({ label: `argument ${p.slice(1)}`, usage: usageFor(content, p) }));
    return { needsInput: true, blanks };
  }
  const hint = attrs['argument-hint'];
  if (prose.includes('$ARGUMENTS') || hint) {
    return {
      needsInput: true,
      blanks: [{ label: hint || 'input', usage: usageFor(content, '$ARGUMENTS') }],
    };
  }
  return { needsInput: false, blanks: [] };
}

// A "directory" here includes symlinks that point at directories —
// e.g. skills linked in from another folder.
function isDirLike(dir, dirent) {
  if (dirent.isDirectory()) return true;
  if (!dirent.isSymbolicLink()) return false;
  try {
    return fs.statSync(path.join(dir, dirent.name)).isDirectory();
  } catch {
    return false; // broken symlink
  }
}

function listDirs(dir) {
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((d) => isDirLike(dir, d))
      .map((d) => d.name)
      .sort();
  } catch {
    return null; // folder missing or unreadable
  }
}

function listFiles(dir, ext) {
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isFile() && d.name.endsWith(ext))
      .map((d) => d.name)
      .sort();
  } catch {
    return null;
  }
}

// Builds one list entry from a skill/command markdown file.
function readEntry(filePath, name, invoke, source) {
  let content;
  try {
    content = fs.readFileSync(filePath, 'utf8');
  } catch {
    return { name, invoke, source, file: filePath, description: '', needsInput: false, blanks: [], error: UNREADABLE };
  }

  const fm = parseFrontmatter(content);
  const input = detectInput(content, fm.attrs);
  if (!fm.ok || !fm.attrs.description) {
    return { name, invoke, source, file: filePath, description: '', ...input, error: UNREADABLE };
  }
  return { name, invoke, source, file: filePath, description: fm.attrs.description, ...input };
}

function scanSkillsDir(dir, makeName, source) {
  const skillDirs = listDirs(dir);
  if (skillDirs === null) return null;
  return skillDirs.map((skill) => {
    const name = makeName(skill);
    return readEntry(path.join(dir, skill, 'SKILL.md'), name, '/' + name, source);
  });
}

function scanCommandsDir(dir, makeName, source) {
  const files = listFiles(dir, '.md');
  if (files === null) return null;
  return files.map((file) => {
    const name = makeName(file.replace(/\.md$/, ''));
    return readEntry(path.join(dir, file), name, '/' + name, source);
  });
}

// Walks plugins/cache/<marketplace>/<plugin>/<version>/{skills,commands},
// deduplicating when several versions of the same plugin are on disk
// (last version directory in sorted order wins).
function scanPluginCache(cacheDir) {
  const skills = new Map();
  const commands = new Map();
  const marketplaces = listDirs(cacheDir);
  if (marketplaces === null) return { missing: true, skills: [], commands: [] };

  for (const mkt of marketplaces) {
    const plugins = listDirs(path.join(cacheDir, mkt)) || [];
    for (const plugin of plugins) {
      const versions = listDirs(path.join(cacheDir, mkt, plugin)) || [];
      for (const version of versions) {
        const base = path.join(cacheDir, mkt, plugin, version);
        const makeName = (n) => `${plugin}:${n}`;
        for (const e of scanSkillsDir(path.join(base, 'skills'), makeName, 'plugin-skill') || []) {
          skills.set(e.name, e);
        }
        for (const e of scanCommandsDir(path.join(base, 'commands'), makeName, 'plugin-command') || []) {
          commands.set(e.name, e);
        }
      }
    }
  }
  return { missing: false, skills: [...skills.values()], commands: [...commands.values()] };
}

// Agents are asked for in plain words rather than a /command, and always
// need one input: the task you want the agent to do.
function scanAgentsDir(dir) {
  const files = listFiles(dir, '.md');
  if (files === null) return null;
  return files.map((file) => {
    const name = file.replace(/\.md$/, '');
    const entry = readEntry(path.join(dir, file), name, `Use the ${name} agent to`, 'agent');
    // Agents take plain words, so show the shape of the sentence the user
    // will paste, with their words in place.
    return {
      ...entry,
      needsInput: true,
      blanks: [{ label: 'what it should do', usage: `${entry.invoke} ___` }],
    };
  });
}

// The full picture, grouped into the four navigation buckets the panel shows.
function scanAll(claudeDir) {
  const personalSkills = scanSkillsDir(path.join(claudeDir, 'skills'), (n) => n, 'personal-skill');
  const personalCommands = scanCommandsDir(path.join(claudeDir, 'commands'), (n) => n, 'personal-command');
  const agents = scanAgentsDir(path.join(claudeDir, 'agents'));
  const plugins = scanPluginCache(path.join(claudeDir, 'plugins', 'cache'));

  return {
    sections: [
      {
        id: 'skills',
        title: 'Skills',
        missing: personalSkills === null,
        entries: personalSkills || [],
      },
      {
        id: 'plugins',
        title: 'Plugins',
        missing: plugins.missing,
        entries: [...plugins.skills, ...plugins.commands],
      },
      {
        id: 'commands',
        title: 'Commands',
        missing: personalCommands === null,
        entries: personalCommands || [],
      },
      {
        id: 'agents',
        title: 'Agents',
        missing: agents === null,
        entries: agents || [],
      },
    ],
  };
}

module.exports = { parseFrontmatter, detectInput, scanAll };
