// Settings page (#settings, #settings/<section>).
//
// Most of the page is drawn from the server's schema (GET /api/settings/schema,
// defined in src/core/settings.js), so a new setting added there appears here
// with no UI code. Hand-written parts: the printer manager (connect, test,
// save, remove printers), Data and backup, and About.
//
// Printer manager rules (view only, like the Printers page):
//   - "Test connection" runs read-only Moonraker requests and shows each step.
//   - API keys are write-only here: the server never sends them back.
import { el, api, settings, saveSettings, toast, confirmDelete, debounce } from './lib.js';

const ORDER = [
  ['printers', 'Printers'],
  ['print', 'Print estimates'],
  ['viewer', '3D view'],
  ['ui', 'Appearance'],
  ['labels', 'Paper labels'],
  ['data', 'Data and backup'],
  ['about', 'About'],
];

let ctx = null; // { openCategories, refreshEstimate }
export function initSettings(context) { ctx = context; }

export async function renderSettings(page, focus = '') {
  const [schema, profiles, version] = await Promise.all([api('GET', '/api/settings/schema'), api('GET', '/api/printer-profiles'), api('GET', '/api/version')]);
  const nav = el('nav', { className: 'settings-nav', 'aria-label': 'Settings sections' },
    ...ORDER.map(([id, label]) => el('a', { href: `#settings/${id}`, textContent: label, className: id === focus ? 'active' : '' })));
  const body = el('div', { className: 'settings-body' });
  page.replaceChildren(
    el('div', { className: 'page-head' }, el('h2', { textContent: 'Settings' }),
      el('p', { className: 'muted', textContent: 'Saved on the STL Tools server, so every computer and phone that opens it uses the same settings. Changes save as you make them.' })),
    el('div', { className: 'settings-layout' }, nav, body));

  for (const [id, label] of ORDER) {
    const sec = el('section', { id: `set-${id}`, className: 'card settings-section' }, el('h3', { textContent: label }));
    body.append(sec);
    if (id === 'printers') await printerManager(sec, profiles);
    if (schema[id]) sec.append(schemaForm(id, schema[id], profiles));
    if (id === 'labels') {
      sec.append(el('div', { className: 'row' },
        el('a', { className: 'button secondary', href: '/labels.html', target: '_blank', textContent: 'Preview paper labels' }),
        el('button', { type: 'button', className: 'secondary', textContent: 'Edit categories and colors', onclick: () => ctx?.openCategories?.() })));
    }
    if (id === 'print') {
      const cur = profiles.find((p) => p.id === settings().print.profile);
      sec.append(el('details', {}, el('summary', { textContent: 'How to calibrate the time' }),
        el('ol', {},
          el('li', { textContent: 'Generate a part and note the STL Tools estimate (same layer height and infill as your slicer).' }),
          el('li', { textContent: 'Slice the same STL in your slicer with your SV07 profile. Note the slicer time.' }),
          el('li', { textContent: 'Set Time calibration factor = slicer time / STL Tools time (for example 52 min / 40 min = 1.3).' }),
          el('li', { textContent: 'Check with a second, different part. Real print times are in Printers > Print history.' }))),
      el('p', { className: 'muted', textContent: `Profiles: ${profiles.map((p) => p.name).join(', ')}.${cur && !cur.verified ? ` ${cur.name}: ${cur.notes}` : ''} Add your own: docs/PRINTER-PROFILES.md.` }));
    }
    if (id === 'data') dataSection(sec, version);
    if (id === 'about') aboutSection(sec, version);
  }
  if (focus) document.getElementById(`set-${focus}`)?.scrollIntoView({ block: 'start' });
}

// ---------------------------------------------------------------- schema form

function schemaForm(section, def, profiles) {
  const cur = settings()[section];
  const form = el('div', { className: 'settings-grid' });
  const saveSoon = debounce(async (patch) => {
    try { await saveSettings({ [section]: patch }); toast('Saved', 'ok', 1200); } catch (err) { toast(err.message, 'error'); }
  }, 350);
  for (const [key, f] of Object.entries(def.fields)) {
    if (section === 'printers' && key === 'defaultPrinter') continue; // set with the radio buttons in the printer list
    let input;
    const v = cur[key];
    if (f.type === 'boolean') {
      input = el('input', { type: 'checkbox', checked: Boolean(v), onchange: () => saveSoon({ [key]: input.checked }) });
      form.append(el('label', { className: 'check-inline set-check', title: f.help ?? '' }, input, ` ${f.label}`, f.help ? el('span', { className: 'help', textContent: ` (${f.help})` }) : null));
      continue;
    }
    if (f.type === 'select' || f.type === 'profile') {
      const opts = f.type === 'profile' ? profiles.map((p) => [p.id, p.name]) : f.options;
      input = el('select', { onchange: () => saveSoon({ [key]: input.value }) }, ...opts.map(([o, l]) => el('option', { value: o, textContent: l, selected: o === v })));
    } else if (f.type === 'color') {
      input = el('input', { type: 'color', value: v, oninput: () => saveSoon({ [key]: input.value }) });
    } else if (f.type === 'string') {
      input = el('input', { type: 'text', value: v ?? '', maxLength: f.maxLength ?? 60, oninput: () => saveSoon({ [key]: input.value }) });
    } else {
      input = el('input', { type: 'number', value: v ?? '', min: f.min, max: f.max, step: f.step ?? (f.type === 'integer' ? 1 : 'any'), placeholder: f.default === null ? 'blank' : '' });
      input.oninput = () => {
        if (input.value === '' && f.default === null) return saveSoon({ [key]: null });
        const n = Number(input.value);
        if (input.value !== '' && n >= f.min && n <= f.max) saveSoon({ [key]: n });
      };
    }
    form.append(el('label', { className: 'set-field' }, el('span', { textContent: `${f.label}${f.unit ? ` (${f.unit})` : ''}` }), input, f.help ? el('span', { className: 'help', textContent: f.help }) : null));
  }
  const reset = el('button', { type: 'button', className: 'secondary small', textContent: `Reset ${def.label.toLowerCase()} to defaults`, onclick: async () => {
    if (!confirmDelete(`Reset ${def.label} to the defaults?`)) return;
    await api('POST', '/api/settings/reset', { section });
    await saveSettings({});
    location.reload();
  } });
  return el('div', {}, form, el('div', { className: 'row' }, reset));
}

// ---------------------------------------------------------------- printers

function stepList(result) {
  return el('ol', { className: 'diag' }, ...result.steps.map((s) => el('li', { className: s.ok ? 'ok' : 'fail' },
    el('strong', { textContent: `${s.ok ? 'OK' : 'FAIL'}  ${s.step}: ` }), document.createTextNode(s.detail),
    !s.ok && s.fix ? el('div', { className: 'muted', textContent: `Fix: ${s.fix}` }) : null)));
}

async function printerManager(sec, profiles) {
  const wrap = el('div');
  sec.append(el('p', { className: 'muted', textContent: 'Klipper printers with Moonraker (Sovol SV07, any Mainsail or Fluidd printer). STL Tools only reads status and uploads G-code with print=false: it can never start, stop or change a print.' }), wrap);
  const modelSelect = (value) => el('select', { 'aria-label': 'Printer model' }, el('option', { value: '', textContent: 'Model: not set (no estimates)' }),
    ...profiles.map((p) => el('option', { value: p.id, textContent: p.name, selected: p.id === value })));

  async function draw() {
    const printers = await api('GET', '/api/printers');
    const def = settings().printers.defaultPrinter;
    const rows = printers.map((p) => {
      const name = el('input', { type: 'text', value: p.name, maxLength: 60, 'aria-label': 'Name' });
      const addr = el('input', { type: 'text', value: p.url, 'aria-label': 'Address' });
      const key = el('input', { type: 'password', placeholder: p.hasApiKey ? 'API key saved (type to replace)' : 'API key (only if needed)', autocomplete: 'off', 'aria-label': 'API key' });
      const clearKey = el('input', { type: 'checkbox' });
      const model = modelSelect(p.model);
      const out = el('div');
      const isDef = el('input', { type: 'radio', name: 'defPrinter', checked: def === p.id, onchange: async () => { await saveSettings({ printers: { defaultPrinter: p.id } }); ctx?.refreshEstimate?.(); toast(`${p.name} is the default printer`, 'ok'); } });
      return el('div', { className: 'printer-row' },
        el('div', { className: 'row' }, name, addr, model),
        el('div', { className: 'row' }, key, p.hasApiKey ? el('label', { className: 'check-inline' }, clearKey, ' remove saved key') : null,
          el('label', { className: 'check-inline' }, isDef, ' default printer')),
        el('div', { className: 'row' },
          el('button', { type: 'button', textContent: 'Save', onclick: async () => {
            const body = { name: name.value, url: addr.value, model: model.value };
            if (key.value) body.apiKey = key.value;
            else if (clearKey.checked) body.apiKey = '';
            try { await api('PUT', `/api/printers/${p.id}`, body); toast('Printer saved', 'ok'); ctx?.refreshEstimate?.(); draw(); } catch (err) { toast(err.message, 'error'); }
          } }),
          el('button', { type: 'button', className: 'secondary', textContent: 'Test connection', onclick: async (e) => {
            e.target.disabled = true;
            out.replaceChildren(el('p', { className: 'muted', textContent: 'Testing (read-only requests)...' }));
            try { out.replaceChildren(stepList(await api('POST', '/api/printers/diagnose', { id: p.id, url: addr.value, apiKey: key.value || undefined }))); } catch (err) { out.replaceChildren(el('p', { className: 'error', textContent: err.message })); } finally { e.target.disabled = false; }
          } }),
          el('a', { className: 'button secondary', href: '#printers', textContent: 'Open status' }),
          el('button', { type: 'button', className: 'secondary', textContent: 'Remove', onclick: async () => {
            if (!confirmDelete(`Remove ${p.name} from STL Tools? Nothing on the printer changes.`)) return;
            await api('DELETE', `/api/printers/${p.id}`);
            if (def === p.id) await saveSettings({ printers: { defaultPrinter: '' } });
            draw();
          } })),
        out);
    });

    // add form
    const name = el('input', { type: 'text', placeholder: 'Name, e.g. SV07', maxLength: 60 });
    const addr = el('input', { type: 'text', placeholder: 'Address, e.g. 192.168.1.50' });
    const key = el('input', { type: 'password', placeholder: 'API key (only if Moonraker asks)', autocomplete: 'off' });
    const model = modelSelect('sovol-sv07');
    const out = el('div');
    const scanOut = el('div');
    const test = async () => {
      out.replaceChildren(el('p', { className: 'muted', textContent: 'Testing (read-only requests)...' }));
      const r = await api('POST', '/api/printers/diagnose', { url: addr.value, apiKey: key.value || undefined });
      out.replaceChildren(stepList(r));
      if (r.model && !model.value) model.value = r.model;
      if (r.hostname && !name.value) name.value = r.hostname;
      return r;
    };
    const add = el('form', { className: 'add-printer', onsubmit: async (e) => {
      e.preventDefault();
      try {
        const r = await test();
        if (!r.steps.find((s) => s.step === 'Moonraker answers')?.ok) { toast('Not added: Moonraker did not answer. See the steps.', 'error'); return; }
        const p = await api('POST', '/api/printers', { name: name.value || r.hostname || '', url: r.url, apiKey: key.value || undefined, model: model.value });
        if (!settings().printers.defaultPrinter) await saveSettings({ printers: { defaultPrinter: p.id } });
        toast(`Added ${p.name}`, 'ok');
        ctx?.refreshEstimate?.();
        draw();
      } catch (err) { out.replaceChildren(el('p', { className: 'error', textContent: err.message })); }
    } },
    el('h4', { textContent: 'Add a printer' }),
    el('ol', { className: 'muted steps' },
      el('li', { textContent: 'On the SV07 screen open Settings > Network (or check your router) and note the IP address.' }),
      el('li', { textContent: 'Check that http://<that address> opens Mainsail in a browser on this computer.' }),
      el('li', { textContent: 'Enter the address below, keep the model "Sovol SV07", press Test connection, then Add printer.' })),
    el('div', { className: 'row' }, name, addr, model), key,
    el('div', { className: 'row' },
      el('button', { type: 'submit', textContent: 'Add printer' }),
      el('button', { type: 'button', className: 'secondary', textContent: 'Test connection', onclick: () => test().catch((err) => out.replaceChildren(el('p', { className: 'error', textContent: err.message }))) }),
      el('button', { type: 'button', className: 'secondary', textContent: 'Scan my network', onclick: async (e) => {
        e.target.disabled = true;
        scanOut.replaceChildren(el('p', { className: 'muted', textContent: 'Scanning the local network for Moonraker (about 10 seconds)...' }));
        try {
          const r = await api('GET', '/api/printers/scan');
          scanOut.replaceChildren(el('p', { className: 'muted', textContent: `Scanned ${r.networks.join(', ') || 'no local network found'}: ${r.printers.length} printer(s).` }),
            ...r.printers.map((f) => el('div', { className: 'pick-row' }, el('span', { textContent: `${f.hostname ?? 'Klipper printer'} at ${f.url} (${f.klippyState})` }),
              el('button', { type: 'button', className: 'small', textContent: 'Use', onclick: () => { addr.value = f.url; name.value = f.hostname ?? ''; } }))));
        } catch (err) { scanOut.replaceChildren(el('p', { className: 'error', textContent: err.message })); } finally { e.target.disabled = false; }
      } })),
    out, scanOut);
    wrap.replaceChildren(...(rows.length ? rows : [el('p', { className: 'muted', textContent: 'No printers yet.' })]), add);
    // keep the radio in step with the saved default (it may change in another tab)
  }
  await draw();
}

// ---------------------------------------------------------------- data, about

function dataSection(sec, version) {
  sec.append(
    el('p', {}, 'Data folder on the server: ', el('code', { textContent: version.dataDir })),
    el('p', { className: 'muted', textContent: 'Everything you make lives there: settings, designs, projects, shop catalog, favorites, printers, the STL library and preview images. Copy that folder for a full backup; app updates never touch it.' }),
    el('div', { className: 'row' },
      el('a', { className: 'button secondary', href: '/api/backup', download: 'stltools-backup.json', textContent: 'Download backup (JSON, no STL files, no API keys)' }),
      el('a', { className: 'button secondary', href: '#import', textContent: 'Import files' }),
      el('button', { type: 'button', className: 'secondary', textContent: 'Clear preview images', onclick: async () => {
        await api('DELETE', '/api/thumbs');
        toast('Preview images cleared. They render again when shown.', 'ok');
      } })));
}

function aboutSection(sec, v) {
  sec.append(
    el('dl', { className: 'facts' }, ...[
      ['Version', `v${v.version}`], ['Generators', v.generators], ['Presets', v.presets], ['Printer profiles', v.profiles],
      ['Server', `Node ${v.node} on ${v.platform} ${v.arch}`],
    ].flatMap(([k, val]) => [el('dt', { textContent: k }), el('dd', { textContent: String(val) })])),
    v.issues.length ? el('div', {}, el('strong', { textContent: 'Skipped custom files' }), el('ul', {}, ...v.issues.map((i) => el('li', { textContent: i })))) : el('p', { className: 'muted', textContent: 'No problems with custom files.' }),
    el('p', { className: 'muted', textContent: 'Developer docs in the app folder: README.md, AGENTS.md, docs/ARCHITECTURE.md, docs/API.md, docs/EXTENDING.md, docs/PRINTER-PROFILES.md.' }),
    el('p', { className: 'muted', textContent: 'Keyboard: / search everything, Ctrl+Enter generate, Escape close search.' }));
}
