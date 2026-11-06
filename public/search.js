// Global search in the header, on every page.
//
// Type to see the best 10 matches across presets, saved designs, generators,
// projects, imported STLs, shop items and pages (same index and query syntax
// as Home: see parseQuery in home.js). Arrow keys + Enter open a result;
// Enter with nothing picked shows all results on Home. "/" focuses the box
// from anywhere, Escape closes it.
import { $, el, store, debounce } from './lib.js';
import { search, openItem } from './home.js';

const KIND = { preset: 'Preset', design: 'Saved', generator: 'Generator', project: 'Project', stl: 'STL', item: 'Shop item', page: 'Page', part: 'My part' };

export function initGlobalSearch() {
  const input = $('globalSearch');
  const box = $('globalResults');
  let results = [];
  let active = -1;

  const close = () => { box.hidden = true; active = -1; };
  const open = (it) => { close(); input.value = ''; input.blur(); openItem(it); };
  const showAll = () => {
    const q = input.value.trim();
    store.set('homeSearch', { ...(store.get('homeSearch') ?? {}), q, kinds: undefined, section: '', generator: '', favoritesOnly: false });
    close();
    input.blur();
    if (location.hash === '#home' || location.hash === '') window.dispatchEvent(new HashChangeEvent('hashchange'));
    else location.hash = '#home';
  };

  const draw = () => {
    const q = input.value.trim();
    if (!q) { close(); return; }
    results = search(q).slice(0, 10);
    active = results.length ? 0 : -1;
    box.replaceChildren(
      ...results.map((r, i) => el('button', { type: 'button', className: `gs-row ${i === active ? 'active' : ''}`, onmousedown: (e) => e.preventDefault(), onclick: () => open(r) },
        el('span', { className: `gs-kind kind-${r.kind}`, textContent: KIND[r.kind] ?? r.kind }),
        el('span', { className: 'gs-title', textContent: r.title }),
        el('span', { className: 'gs-sub', textContent: r.sub }))),
      el('button', { type: 'button', className: 'gs-row gs-all', onmousedown: (e) => e.preventDefault(), onclick: showAll, textContent: results.length ? `Show all results for "${q}" on Home` : `No quick matches. Search Home for "${q}"` }));
    box.hidden = false;
  };
  const mark = () => [...box.querySelectorAll('.gs-row')].forEach((b, i) => b.classList.toggle('active', i === active));

  input.oninput = debounce(draw, 80);
  input.onfocus = () => { if (input.value.trim()) draw(); };
  input.onblur = () => setTimeout(close, 150);
  input.onkeydown = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); active = Math.min(results.length - 1, active + 1); mark(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); active = Math.max(0, active - 1); mark(); }
    else if (e.key === 'Enter') { e.preventDefault(); if (active >= 0 && results[active]) open(results[active]); else showAll(); }
    else if (e.key === 'Escape') { close(); input.blur(); }
  };
  document.addEventListener('keydown', (e) => {
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName) || document.activeElement?.isContentEditable;
    if (e.key === '/' && !typing && !e.ctrlKey && !e.metaKey) { e.preventDefault(); input.focus(); input.select(); }
  });
}
