// Assembles the paste-ready prompt: the command with its filled-in
// arguments on the first line, then any extra context as its own paragraph.
function buildPrompt(invoke, argValues, extraText) {
  const args = (argValues || []).map((v) => v.trim()).filter(Boolean);
  const commandLine = [invoke, ...args].join(' ');
  const extra = (extraText || '').trim();
  return extra ? `${commandLine}\n\n${extra}` : commandLine;
}

module.exports = { buildPrompt };
