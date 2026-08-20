// Panel UI: expand/collapse, bucket navigation, search, and prompt preparation.
// All data comes fresh from the main process on every expand.

const COLLAPSE_GRACE_MS = 400; // how long the mouse may leave before we tuck away

const el = (id) => document.getElementById(id);

const state = {
  data: null,       // scan result: { sections: [...] }
  bucket: 'skills', // active bucket when not searching
  query: '',
  current: null,    // entry shown in the detail view
};

/* ---------- expand / collapse ---------- */

async function expand() {
  await window.api.setExpanded(true);
  document.body.classList.remove('collapsed');
  document.body.classList.add('expanded');
  el('panel').setAttribute('aria-hidden', 'false');
  state.data = await window.api.scan(); // rescan every open: new skills show up immediately
  showList();
  el('search').focus();
}

function collapse() {
  state.query = '';
  state.current = null;
  el('search').value = '';
  document.body.classList.remove('expanded');
  document.body.classList.add('collapsed');
  el('panel').setAttribute('aria-hidden', 'true');
  window.api.setExpanded(false);
}

/* ---------- list view ---------- */

function matches(entry, query) {
  const haystack = `${entry.name} ${entry.description}`.toLowerCase();
  return query.split(/\s+/).every((word) => haystack.includes(word));
}

function entryButton(entry) {
  const btn = document.createElement('button');
  btn.className = 'entry';
  btn.dataset.name = entry.name;

  const top = document.createElement('div');
  top.className = 'entry-top';
  const name = document.createElement('span');
  name.className = 'entry-name';
  name.textContent = entry.name;
  top.appendChild(name);
  if (entry.needsInput) {
    const badge = document.createElement('span');
    badge.className = 'badge';
    badge.textContent = 'needs input';
    top.appendChild(badge);
  }
  btn.appendChild(top);

  const desc = document.createElement('div');
  desc.className = 'entry-desc' + (entry.error ? ' unreadable' : '');
  desc.textContent = entry.error || entry.description;
  btn.appendChild(desc);

  btn.addEventListener('click', () => showDetail(entry));
  return btn;
}

function renderBuckets() {
  const nav = el('buckets');
  nav.replaceChildren();
  for (const section of state.data.sections) {
    const btn = document.createElement('button');
    btn.className = 'bucket-btn' + (section.id === state.bucket && !state.query ? ' active' : '');
    btn.dataset.bucket = section.id;
    btn.textContent = section.title;
    btn.addEventListener('click', () => {
      state.bucket = section.id;
      state.query = '';
      el('search').value = '';
      renderList();
    });
    nav.appendChild(btn);
  }
}

function renderList() {
  renderBuckets();
  const list = el('list');
  list.replaceChildren();

  const query = state.query.trim().toLowerCase();

  if (query) {
    // Searching looks across every bucket, grouped, so use-case search
    // doesn't depend on knowing where something lives.
    let any = false;
    for (const section of state.data.sections) {
      const hits = section.entries.filter((e) => matches(e, query));
      if (hits.length === 0) continue;
      any = true;
      const label = document.createElement('div');
      label.className = 'group-label';
      label.textContent = section.title;
      list.appendChild(label);
      hits.forEach((e) => list.appendChild(entryButton(e)));
    }
    if (!any) list.appendChild(emptyNote('Nothing matches that search.'));
    return;
  }

  const section = state.data.sections.find((s) => s.id === state.bucket);
  if (section.missing) {
    list.appendChild(emptyNote(`The ${section.title.toLowerCase()} folder was not found in ~/.claude.`));
    return;
  }
  if (section.entries.length === 0) {
    list.appendChild(emptyNote(`No ${section.title.toLowerCase()} found.`));
    return;
  }
  section.entries.forEach((e) => list.appendChild(entryButton(e)));
}

function emptyNote(text) {
  const div = document.createElement('div');
  div.className = 'empty-note';
  div.textContent = text;
  return div;
}

function showList() {
  state.current = null;
  el('detail').hidden = true;
  el('list').hidden = false;
  el('search').hidden = false;
  el('buckets').hidden = false;
  renderList();
}

/* ---------- detail view ---------- */

function showDetail(entry) {
  state.current = entry;
  el('list').hidden = true;
  el('search').hidden = true;
  el('buckets').hidden = true;
  el('detail').hidden = false;

  el('detail-name').textContent = entry.name;
  el('detail-desc').textContent = entry.error || entry.description;
  el('detail-invoke').textContent = entry.needsInput ? `${entry.invoke} …` : entry.invoke;

  const blanks = el('blanks');
  blanks.replaceChildren();
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

  el('extra').value = '';
  el('copied').hidden = true;

  // "Read more" shows the entry's full document, fetched on first click.
  const readmore = el('readmore');
  const doc = el('doc');
  doc.hidden = true;
  doc.textContent = '';
  readmore.hidden = !entry.file;
  readmore.textContent = 'Read more';

  const first = blanks.querySelector('input');
  if (first) first.focus();
}

async function toggleReadMore() {
  const doc = el('doc');
  const readmore = el('readmore');
  if (!doc.hidden) {
    doc.hidden = true;
    readmore.textContent = 'Read more';
    return;
  }
  if (!doc.textContent) {
    const result = await window.api.readDoc(state.current.file);
    doc.textContent = result.ok ? result.text : result.error;
  }
  doc.hidden = false;
  readmore.textContent = 'Hide';
}

async function copyPrompt() {
  const args = [...document.querySelectorAll('.blank-input')].map((i) => i.value);
  await window.api.copyPrompt(state.current.invoke, args, el('extra').value);
  el('copied').hidden = false;
  setTimeout(() => { el('copied').hidden = true; }, 2000);
}

/* ---------- wiring ---------- */

el('tab').addEventListener('mouseenter', expand);
el('tab').addEventListener('click', expand);
el('back').addEventListener('click', showList);
el('copy').addEventListener('click', copyPrompt);
el('readmore').addEventListener('click', toggleReadMore);
el('quit').addEventListener('click', () => window.api.quit());

// System-wide hotkey (⌥ Space), forwarded from the main process.
window.api.onToggle(() => {
  if (document.body.classList.contains('expanded')) collapse();
  else expand();
});

el('search').addEventListener('input', (e) => {
  state.query = e.target.value;
  renderList();
});

document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (state.current) showList();
  else collapse();
});

// Tuck away when the mouse leaves the panel, with a short grace period.
let leaveTimer = null;
document.addEventListener('mouseleave', () => {
  if (!document.body.classList.contains('expanded')) return;
  leaveTimer = setTimeout(collapse, COLLAPSE_GRACE_MS);
});
document.addEventListener('mouseenter', () => clearTimeout(leaveTimer));
