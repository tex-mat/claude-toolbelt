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

// Works out whether an entry needs user input, and what to call each blank.
function detectInput(content, attrs) {
  const numbered = new Set(content.match(/\$[1-9]/g) || []);
  if (numbered.size > 0) {
    const blanks = [...numbered].sort().map((p) => `argument ${p.slice(1)}`);
    return { needsInput: true, blanks };
  }
  const hint = attrs['argument-hint'];
  if (content.includes('$ARGUMENTS') || hint) {
    return { needsInput: true, blanks: [hint || 'input'] };
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
    return { ...entry, needsInput: true, blanks: ['what it should do'] };
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
