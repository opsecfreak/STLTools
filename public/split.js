// Split / arrange panel (designer): cut parts that do not fit the printer into pieces
// with alignment holes, pack every piece onto as few plates as possible, estimate
// each plate. Server: POST /api/split (src/core/split.js). Uses the estimate box's printer.
import { el, api, toast, store } from './lib.js';

export function openSplit({ job, parts, viewer, profile }) {
  document.querySelector('.split-overlay')?.remove();
  const saved = store.get('splitOpts') ?? { joint: 'pins', pinDiameter: 4, pinLength: 12, clearance: 0.2, spacing: 5, margin: 3 };
  const num = (k, attrs) => { const i = el('input', { type: 'number', step: 'any', value: saved[k], className: 'num', ...attrs }); i.onchange = () => { saved[k] = Number(i.value); store.set('splitOpts', saved); }; return i; };
  const joint = el('select', {}, ...[['pins', 'Printed alignment pins'], ['filament', '1.75 mm filament pins'], ['none', 'No holes (glue only)']].map(([v, l]) => el('option', { value: v, textContent: l, selected: saved.joint === v })));
  joint.onchange = () => { saved.joint = joint.value; store.set('splitOpts', saved); };
  const qty = new Map(parts.map((p) => [p.name, p.qty ?? 1]));
  const out = el('div', { className: 'split-out' });
  const run = async (btn) => {
    btn.disabled = true;
    out.replaceChildren(el('p', { className: 'muted', textContent: 'Cutting and packing...' }));
    try {
      const r = await api('POST', '/api/split', { job, profile: profile?.id?.replace(/@printer$/, ''), qty: Object.fromEntries(qty), ...saved });
      out.replaceChildren(
        el('p', {}, el('strong', { textContent: `${r.plates.length} plate${r.plates.length > 1 ? 's' : ''} on ${r.profile}` }), ` (bed ${r.bed.x} x ${r.bed.y} x ${r.bed.z} mm). ${r.cuts.length ? `${r.cuts.length} cut(s), ${r.joint === 'pins' ? `${r.pins} printed pins` : r.joint === 'filament' ? 'filament pins' : 'glue only'}.` : 'Everything fits without cutting.'}`),
        el('table', { className: 'est-table' }, el('thead', {}, el('tr', {}, ...['Plate', 'Pieces', 'Time, filament', ''].map((h) => el('th', { textContent: h })))),
          el('tbody', {}, ...r.plates.map((p) => el('tr', {},
            el('td', {}, el('a', { href: '#', textContent: p.name, title: 'Show this plate in the 3D view', onclick: (e) => { e.preventDefault(); viewer.show([{ url: p.url, name: p.name }]); } })),
            el('td', { textContent: p.items.join(', ') }),
            el('td', { textContent: p.estimate.text }),
            el('td', {}, el('a', { href: p.url, download: p.filename, textContent: 'STL' })))))),
        el('div', { className: 'row' }, el('a', { className: 'button', href: r.zip, download: 'split.zip', textContent: 'Download all (pieces, plates, README)' })),
        el('details', {}, el('summary', { textContent: 'Assembly notes' }), el('pre', { className: 'cfg-view', textContent: r.readme })));
      if (r.plates[0]) viewer.show([{ url: r.plates[0].url, name: r.plates[0].name }]);
    } catch (err) { out.replaceChildren(el('p', { className: 'error', textContent: err.message })); } finally { btn.disabled = false; }
  };
  const box = el('div', { className: 'split-overlay' }, el('div', { className: 'card split-box' },
    el('div', { className: 'row' }, el('h3', { textContent: `Split and arrange for ${profile?.name ?? 'the printer'}` }), el('button', { type: 'button', className: 'secondary small', textContent: 'Close', onclick: () => box.remove() })),
    el('p', { className: 'muted', textContent: 'Parts larger than the bed are cut into equal pieces along their longest side, with alignment holes on every cut. Then every piece is packed onto as few plates as possible, standing as designed when it fits. Change the printer in the estimate box.' }),
    el('div', { className: 'split-qty' }, ...parts.map((p) => {
      const i = el('input', { type: 'number', min: 1, max: 50, value: qty.get(p.name), className: 'num' });
      i.onchange = () => qty.set(p.name, Math.max(1, Number(i.value) || 1));
      return el('label', {}, `${p.name} x `, i);
    })),
    el('div', { className: 'row' }, el('label', {}, 'Joints ', joint), el('label', {}, 'pin diameter ', num('pinDiameter'), ' mm'), el('label', {}, 'length ', num('pinLength'), ' mm'), el('label', {}, 'hole clearance ', num('clearance'), ' mm')),
    el('div', { className: 'row' }, el('label', {}, 'spacing ', num('spacing'), ' mm'), el('label', {}, 'edge margin ', num('margin'), ' mm'),
      el('button', { type: 'button', textContent: 'Split and arrange', onclick: (e) => run(e.target) })),
    out));
  document.body.append(box);
  box.onclick = (e) => { if (e.target === box) box.remove(); };
}
