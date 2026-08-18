// Reads a document for the "Read more" view — but only if it lives inside
// the allowed folder (~/.claude), so the UI can never ask for arbitrary files.
const fs = require('node:fs');
const path = require('node:path');

function readDocInside(allowedDir, filePath) {
  const root = path.resolve(allowedDir) + path.sep;
  const target = path.resolve(filePath);
  if (!target.startsWith(root)) {
    return { ok: false, error: 'That file is outside the skills folder.' };
  }
  try {
    return { ok: true, text: fs.readFileSync(target, 'utf8') };
  } catch {
    return { ok: false, error: "Couldn't read the file." };
  }
}

module.exports = { readDocInside };
