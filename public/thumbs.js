// Grid thumbnails. Each card asks for a preview of (generator, params).
// 1. Batched lookup on the server: already rendered? Use the cached PNG.
// 2. Otherwise generate the part, render it in this browser, upload the PNG
//    so every device gets it next time. One render at a time, only for cards
//    that are on screen.
import { api, el, settings } from './lib.js';
import { createThumbnailer } from './viewer.js';

let thumbnailer = null;
const pendingLookups = [];
let lookupTimer = null;
const renderQueue = [];
let rendering = false;
const known = new Map(); // json(generator, params) -> url promise

const observer = new IntersectionObserver((entries) => {
  for (const e of entries) {
    if (!e.isIntersecting) continue;
    observer.unobserve(e.target);
    request(e.target);
  }
}, { rootMargin: '200px' });

/** An <img> placeholder that fills itself when it scrolls into view. */
export function thumbImg(generator, params, alt = '') {
  if (settings()?.ui.thumbnails === false) return el('div', { className: 'thumb empty', textContent: alt.slice(0, 40) });
  const img = el('img', { className: 'thumb loading', alt, loading: 'lazy', width: 320, height: 240 });
  img.dataset.generator = generator;
  img._params = params ?? {};
  observer.observe(img);
  return img;
}

function request(img) {
  const key = JSON.stringify([img.dataset.generator, img._params]);
  if (known.has(key)) {
    known.get(key).then((url) => show(img, url));
    return;
  }
  let resolve;
  known.set(key, new Promise((r) => { resolve = r; }));
  known.get(key).then((url) => show(img, url));
  pendingLookups.push({ generator: img.dataset.generator, params: img._params, resolve });
  clearTimeout(lookupTimer);
  lookupTimer = setTimeout(flushLookups, 60);
}

function show(img, url) {
  img.classList.remove('loading');
  if (url) img.src = url;
  else img.classList.add('failed');
}

async function flushLookups() {
  const batch = pendingLookups.splice(0, 100);
  if (pendingLookups.length) lookupTimer = setTimeout(flushLookups, 60);
  let results;
  try {
    results = await api('POST', '/api/thumbs/lookup', batch.map(({ generator, params }) => ({ generator, params })));
  } catch {
    results = batch.map(() => ({ url: null }));
  }
  batch.forEach((item, i) => {
    const r = results[i] ?? {};
    if (r.url) item.resolve(r.url);
    else if (r.key) { renderQueue.push(item); pump(); } else item.resolve(null);
  });
}

async function pump() {
  if (rendering) return;
  rendering = true;
  while (renderQueue.length) {
    const item = renderQueue.shift();
    try {
      if (item.custom) { item.resolve(await item.custom()); continue; }
      thumbnailer ??= createThumbnailer();
      const result = await api('POST', `/api/generate/${item.generator}`, item.params);
      const blob = await thumbnailer.render(result.parts);
      const res = await fetch(`/api/thumbs/${result.job}`, { method: 'PUT', body: blob });
      item.resolve(res.ok ? (await res.json()).url : URL.createObjectURL(blob));
    } catch {
      item.resolve(null);
    }
  }
  rendering = false;
}

// ---------------------------------------------------------------- library STLs

/** Preview for an imported STL: cached PNG if the server has one, else rendered here once and uploaded. */
export function thumbStl(entry) {
  if (settings()?.ui.thumbnails === false) return el('div', { className: 'thumb empty', textContent: entry.name.slice(0, 40) });
  const img = el('img', { className: 'thumb loading', alt: entry.name, loading: 'lazy', width: 320, height: 240 });
  if (entry.thumb) {
    img.src = entry.thumb;
    img.classList.remove('loading');
    return img;
  }
  const io = new IntersectionObserver((es) => {
    if (!es.some((e) => e.isIntersecting)) return;
    io.disconnect();
    renderQueue.push({
      custom: async () => {
        thumbnailer ??= createThumbnailer();
        const blob = await thumbnailer.render([{ url: `/api/library/${entry.id}.stl` }]);
        const res = await fetch(`/api/thumbs/${entry.thumbKey}`, { method: 'PUT', body: blob });
        return res.ok ? (await res.json()).url : URL.createObjectURL(blob);
      },
      resolve: (url) => show(img, url),
    });
    pump();
  }, { rootMargin: '200px' });
  io.observe(img);
  return img;
}
