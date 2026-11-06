// Grid thumbnails. Each card asks for a preview of (generator, params).
// 1. Batched lookup on the server: already rendered? Use the cached PNG.
// 2. Otherwise generate the part, render it in this browser, upload the PNG
//    so every device gets it next time. One render at a time, only for cards
//    that are on screen.
import { api, el } from './lib.js';
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
