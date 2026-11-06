// Import page (#import), STL Files library page (#stls) and the side pane for
// one library STL (#stl/<id>, shown next to the 3D view).
//
// Import detects what you drop:
//   *.stl                                  -> STL library (PUT /api/library/upload)
//   *.json with format "stltools-project"  -> new project (POST /api/projects/import)
//   *.json with "generator" (or a list)    -> My Designs (POST /api/designs)
//   *.json with format "stltools-backup"   -> refused with an explanation (restore = copy the data folder)
import { el, api, putFile, toast, confirmDelete, fmtBytes, fmtAgo, viewMode, store, debounce } from './lib.js';
import { cardList, search, addToProject, starButton } from './home.js';

let ctx = null; // { state, refreshLibrary, refreshDesigns }
export function initFiles(context) { ctx = context; }

// ---------------------------------------------------------------- import

function dropzone(label, accept, onFiles) {
  const input = el('input', { type: 'file', accept, multiple: true, hidden: true, onchange: () => { onFiles([...input.files]); input.value = ''; } });
  const zone = el('div', { className: 'dropzone big', tabIndex: 0, onclick: () => input.click(), onkeydown: (e) => { if (e.key === 'Enter') input.click(); } }, el('strong', { textContent: label }), el('div', { className: 'muted', textContent: 'Drop files here, or click to choose' }), input);
  zone.ondragover = (e) => { e.preventDefault(); zone.classList.add('drag'); };
  zone.ondragleave = () => zone.classList.remove('drag');
  zone.ondrop = (e) => { e.preventDefault(); zone.classList.remove('drag'); onFiles([...e.dataTransfer.files]); };
  return zone;
}

export async function importFiles(files, { folder = '', tags = '' } = {}, log = () => {}) {
  const done = { stl: [], projects: [], designs: 0, errors: 0 };
  for (const f of files) {
    try {
      if (/\.stl$/i.test(f.name)) {
        log(`Uploading ${f.name} (${fmtBytes(f.size)})...`);
        const q = new URLSearchParams({ filename: f.name, folder, tags });
        const e = await putFile(`/api/library/upload?${q}`, f);
        done.stl.push(e);
        log(`OK  ${f.name}: ${e.stats.size.map((v) => v.toFixed(1)).join(' x ')} mm, ${e.stats.triangles} triangles.`, 'ok', `#stl/${e.id}`);
        continue;
      }
      if (!/\.json$/i.test(f.name)) throw new Error('Not an STL or JSON file. 3MF, OBJ and STEP: export STL from your CAD or slicer first.');
      const data = JSON.parse(await f.text());
      if (data.format === 'stltools-backup') throw new Error('This is a backup file. To restore, copy the data folder back (Settings > Data and backup).');
      if (data.format === 'stltools-project' || (data.items && data.name && !data.generator)) {
        log(`Importing project ${f.name}...`);
        const r = await api('POST', '/api/projects/import', data);
        done.projects.push(r.project);
        log(`OK  Project "${r.project.name}": ${r.project.items.length} parts.${r.warnings.length ? ` Warnings: ${r.warnings.join(' ')}` : ''}`, r.warnings.length ? 'warn' : 'ok', `#project/${r.project.id}`);
        continue;
      }
      const entries = Array.isArray(data) ? data : [data];
      if (!entries.every((d) => d && d.generator)) throw new Error('JSON file is not an STL Tools project or design file.');
      for (const d of entries) await api('POST', '/api/designs', { name: d.name ?? f.name.replace(/\.(params\.)?json$/, ''), generator: d.generator, params: d.params, section: d.section, notes: d.notes });
      done.designs += entries.length;
      log(`OK  ${entries.length} design(s) from ${f.name} added to My Designs.`, 'ok', '#library');
    } catch (err) {
      done.errors++;
      log(`FAIL  ${f.name}: ${err.message}`, 'fail');
    }
  }
  await Promise.all([ctx.refreshLibrary(), ctx.refreshDesigns()]).catch(() => {});
  return done;
}

export function renderImport(page) {
  const folder = el('input', { type: 'text', placeholder: 'Folder for STL files (optional), e.g. Typhoon H', maxLength: 60, value: store.get('importFolder') ?? '' });
  const tags = el('input', { type: 'text', placeholder: 'Tags, comma separated (optional)', maxLength: 200 });
  folder.oninput = () => store.set('importFolder', folder.value);
  const out = el('ol', { className: 'import-log' });
  const log = (msg, kind = '', href = null) => out.append(el('li', { className: kind }, href ? el('a', { href, textContent: msg }) : document.createTextNode(msg)));
  const go = (files) => { if (files.length) importFiles(files, { folder: folder.value.trim(), tags: tags.value }, log).then((d) => toast(`Imported ${d.stl.length} STL, ${d.projects.length} project(s), ${d.designs} design(s)${d.errors ? `, ${d.errors} failed` : ''}.`, d.errors ? 'error' : 'ok')); };
  page.replaceChildren(
    el('div', { className: 'page-head' }, el('h2', { textContent: 'Import' }),
      el('p', { className: 'muted', textContent: 'Bring in files from other places. STL files go to STL Files, project files become projects, design files go to My Designs. Files are stored on this STL Tools server.' })),
    el('div', { className: 'import-grid' },
      el('section', { className: 'card' }, el('h3', { textContent: 'STL files' }),
        el('p', { className: 'muted', textContent: 'Binary or ASCII STL, up to 100 MB each. You can view them in 3D, get a print time, add them to projects and download them again.' }),
        el('div', { className: 'row' }, folder, tags),
        dropzone('Import STL files', '.stl', go)),
      el('section', { className: 'card' }, el('h3', { textContent: 'Project files' }),
        el('p', { className: 'muted', textContent: 'A .stltools-project.json file from "Export project file" on another computer. It carries its saved designs and imported STLs.' }),
        dropzone('Import a project', '.json', go)),
      el('section', { className: 'card' }, el('h3', { textContent: 'Design files' }),
        el('p', { className: 'muted', textContent: 'A .params.json file from "Export settings file", or a My Designs export (a list).' }),
        dropzone('Import designs', '.json', go))),
    el('h3', { textContent: 'Results' }), out,
    el('p', { className: 'muted', textContent: 'Tip: you can drop files on any of the boxes; the type is detected from the file.' }));
}

// ---------------------------------------------------------------- STL Files page

export function renderStls(page) {
  const lib = ctx.state.library ?? [];
  const folders = [...new Set(lib.map((e) => e.folder).filter(Boolean))].sort();
  const saved = store.get('stlFilter') ?? {};
  const q = el('input', { type: 'search', placeholder: `Search ${lib.length} STL files (name, folder, tag, x>100)`, value: saved.q ?? '' });
  const folder = el('select', {}, el('option', { value: '', textContent: 'All folders' }), ...folders.map((f) => el('option', { value: f, textContent: f, selected: saved.folder === f })));
  const sort = el('select', {}, ...[['recent', 'Recently changed'], ['name', 'Name']].map(([v, l]) => el('option', { value: v, textContent: l, selected: saved.sort === v })));
  const grid = el('div');
  const draw = () => {
    store.set('stlFilter', { q: q.value, folder: folder.value, sort: sort.value });
    const items = search(q.value, { kinds: ['stl'], sort: sort.value }).filter((it) => !folder.value || it.ref.folder === folder.value);
    grid.replaceChildren(cardList(items, viewMode(), lib.length ? 'No STL files match.' : 'No STL files yet. Press Import STL files.'));
  };
  q.oninput = debounce(draw, 120);
  folder.onchange = draw;
  sort.onchange = draw;
  page.replaceChildren(
    el('div', { className: 'page-head' }, el('h2', { textContent: 'STL Files' }),
      el('p', { className: 'muted', textContent: 'STL files you imported. Open one to view it in 3D with a print time, edit its name, folder and tags, add it to a project or download it.' })),
    el('div', { className: 'row' }, q, folder, sort, el('a', { className: 'button', href: '#import', textContent: 'Import STL files' }),
      el('button', { type: 'button', className: 'secondary', textContent: 'Grid / List', onclick: () => { store.set('view', viewMode() === 'grid' ? 'list' : 'grid'); draw(); } })),
    grid);
  draw();
}

// ---------------------------------------------------------------- one STL (side pane)

export function renderStlPane(pane, e, { onChange, onDelete }) {
  const name = el('input', { type: 'text', value: e.name, maxLength: 80, 'aria-label': 'Name' });
  const folder = el('input', { type: 'text', value: e.folder, maxLength: 60, placeholder: 'Folder' });
  const tags = el('input', { type: 'text', value: e.tags.join(', '), placeholder: 'tags, comma separated' });
  const notes = el('textarea', { rows: 3, value: e.notes, placeholder: 'Notes: source, material, settings...' });
  const save = debounce(async () => {
    try { const next = await api('PUT', `/api/library/${e.id}`, { name: name.value, folder: folder.value, tags: tags.value, notes: notes.value }); onChange?.(next); toast('Saved', 'ok', 1200); } catch (err) { toast(err.message, 'error'); }
  }, 600);
  for (const i of [name, folder, tags, notes]) i.oninput = save;
  const s = e.stats;
  pane.replaceChildren(
    el('a', { href: '#stls', className: 'back', textContent: '< STL Files' }),
    el('div', { className: 'row' }, name, starButton('stl', e.id)),
    el('div', { className: 'card' },
      el('div', { className: 'field' }, el('label', { textContent: 'Folder' }), folder),
      el('div', { className: 'field' }, el('label', { textContent: 'Tags' }), tags),
      el('div', { className: 'field' }, el('label', { textContent: 'Notes' }), notes)),
    el('dl', { className: 'facts' }, ...[
      ['Size', `${s.size.map((v) => v.toFixed(1)).join(' x ')} mm`],
      ['Volume', `${(s.volumeMm3 / 1000).toFixed(1)} cm3`],
      ['Triangles', s.triangles.toLocaleString()],
      ['File', `${e.filename}, ${fmtBytes(e.bytes)}`],
      ['Imported', fmtAgo(e.createdAt)],
    ].flatMap(([k, v]) => [el('dt', { textContent: k }), el('dd', { textContent: v })])),
    el('div', { className: 'actions' },
      el('a', { className: 'button', href: `/api/library/${e.id}.stl`, download: e.filename, textContent: 'Download STL' }),
      el('button', { type: 'button', className: 'secondary', textContent: 'Add to project', onclick: () => addToProject({ kind: 'stl', ref: e.id, name: e.name }) }),
      el('button', { type: 'button', className: 'secondary', textContent: 'Delete', onclick: async () => {
        if (!confirmDelete(`Delete ${e.name} from the STL library? Projects that use it lose this part.`)) return;
        try { await api('DELETE', `/api/library/${e.id}`); onDelete?.(); } catch (err) { toast(err.message, 'error'); }
      } })),
    el('p', { className: 'muted', textContent: 'Imported STLs are shown as they are. To change the shape, use a generator or your CAD.' }));
}
