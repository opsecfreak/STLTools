// Self-hosting: how this copy of STL Tools runs (desktop, USB portable, one-time
// temp session, Pi service) and the optional LAN access PIN.
//
// The PIN protects the app when it listens on the LAN (Pi in the shop, --lan on
// a desktop). Requests from this machine itself (127.0.0.1 / ::1) never need it,
// so you cannot lock yourself out on the machine that runs it. Other devices
// enter the PIN once; they get a cookie that stays valid until the PIN changes.
//
// Storage: <data>/hosting.json = { salt, hash, secret, setAt }. The PIN itself
// is never stored (scrypt hash). It is not a replacement for a firewall: keep
// STL Tools on a network you trust. See docs/SELF-HOSTING.md.

import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { randomBytes, scryptSync, timingSafeEqual, createHmac } from 'node:crypto';
import { networkInterfaces, hostname } from 'node:os';
import { createJsonFile } from './jsonstore.js';
import { CatalogError } from './catalog.js';

export const COOKIE = 'stltools_pin';
const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

export const isLoopback = (addr) => LOOPBACK.has(String(addr ?? ''));

/** Raspberry Pi model from the device tree ("Raspberry Pi 5 Model B Rev 1.0"), else null. */
export function boardModel() {
  for (const f of ['/proc/device-tree/model', '/sys/firmware/devicetree/base/model']) {
    try { return readFileSync(f, 'utf8').replace(/\0/g, '').trim() || null; } catch { /* not a Pi */ }
  }
  return null;
}

/** http://<ip>:<port> for each LAN address of this machine, plus <hostname>.local. */
export function lanUrls(port) {
  const ips = Object.values(networkInterfaces()).flat().filter((i) => i && i.family === 'IPv4' && !i.internal).map((i) => i.address);
  return [...ips.map((ip) => `http://${ip}:${port}`), `http://${hostname()}.local:${port}`];
}

export function readCookie(req, name = COOKIE) {
  for (const part of String(req.headers.cookie ?? '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return null;
}

export function createHosting({ dataDir }) {
  const file = createJsonFile(join(dataDir, 'hosting.json'), {});
  // login attempts per client address: { count, until }
  const attempts = new Map();

  const tokenOf = (cfg) => createHmac('sha256', cfg.secret).update('stltools-lan-access').digest('hex');

  const api = {
    async hasPin() {
      return Boolean((await file.get()).hash);
    },

    /** Set, change or remove (pin: '') the PIN. Changing or removing needs the current one. */
    async setPin(pin, current) {
      const cfg = await file.get();
      if (cfg.hash && !(await api.checkPin(current))) throw new CatalogError('The current PIN is wrong', 403);
      const p = String(pin ?? '');
      if (!p) {
        await file.set({});
        return { pin: false };
      }
      if (p.length < 4 || p.length > 32) throw new CatalogError('PIN must be 4 to 32 characters');
      const salt = randomBytes(16).toString('hex');
      const next = { salt, hash: scryptSync(p, salt, 32).toString('hex'), secret: randomBytes(32).toString('hex'), setAt: new Date().toISOString() };
      await file.set(next);
      return { pin: true, token: tokenOf(next) };
    },

    async checkPin(pin) {
      const cfg = await file.get();
      if (!cfg.hash) return true;
      const got = scryptSync(String(pin ?? ''), cfg.salt, 32);
      return timingSafeEqual(got, Buffer.from(cfg.hash, 'hex'));
    },

    /** Login from another device: returns the cookie token, or throws (5 tries a minute per address). */
    async login(pin, addr) {
      const now = Date.now();
      const a = attempts.get(addr) ?? { count: 0, until: 0 };
      if (a.until > now && a.count >= 5) throw new CatalogError('Too many wrong PINs. Wait a minute.', 429);
      if (!(await api.checkPin(pin))) {
        attempts.set(addr, { count: a.until > now ? a.count + 1 : 1, until: now + 60000 });
        if (attempts.size > 1000) attempts.delete(attempts.keys().next().value);
        throw new CatalogError('Wrong PIN', 403);
      }
      attempts.delete(addr);
      const cfg = await file.get();
      return cfg.hash ? tokenOf(cfg) : null;
    },

    /** True when the request may use the app: no PIN set, this machine, or a valid cookie. */
    async allowed(req, { trustLoopback = true } = {}) {
      const cfg = await file.get();
      if (!cfg.hash) return true;
      if (trustLoopback && isLoopback(req.socket.remoteAddress)) return true;
      const t = readCookie(req);
      if (!t) return false;
      const want = Buffer.from(tokenOf(cfg));
      const got = Buffer.from(String(t));
      return got.length === want.length && timingSafeEqual(got, want);
    },
  };
  return api;
}

/** Small login page served to other devices when a PIN is set. No external files. */
export function loginPage(message = '') {
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>STL Tools: enter PIN</title>
<style>
:root { color-scheme: light dark; --bg: #f5f6f8; --panel: #fff; --text: #1c1f24; --muted: #5d6570; --accent: #3d8bfd; --border: #d6dae0; }
@media (prefers-color-scheme: dark) { :root { --bg: #14161a; --panel: #1c1f24; --text: #e6e8eb; --muted: #9aa1ab; --border: #2e333a; } }
body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: var(--bg); color: var(--text); font: 16px system-ui, sans-serif; padding: 16px; box-sizing: border-box; }
form { background: var(--panel); border: 1px solid var(--border); border-radius: 10px; padding: 24px; width: 100%; max-width: 340px; box-sizing: border-box; }
h1 { font-size: 1.25rem; margin: 0 0 8px; } p { color: var(--muted); margin: 0 0 16px; font-size: 0.92rem; }
input { width: 100%; box-sizing: border-box; font-size: 1.2rem; padding: 10px; border: 1px solid var(--border); border-radius: 6px; background: var(--bg); color: var(--text); }
button { margin-top: 12px; width: 100%; padding: 10px; font-size: 1rem; border: 0; border-radius: 6px; background: var(--accent); color: #fff; cursor: pointer; }
.err { color: #cf222e; min-height: 1.2em; margin: 8px 0 0; }
</style></head><body>
<form id="f"><h1>STL Tools</h1><p>This STL Tools server asks for its access PIN. Ask the person who set it up.</p>
<input id="pin" type="password" inputmode="numeric" autocomplete="current-password" placeholder="PIN" autofocus required>
<button type="submit">Open STL Tools</button><p class="err" id="e">${esc(message)}</p></form>
<script>
document.getElementById('f').onsubmit = async (ev) => {
  ev.preventDefault();
  const r = await fetch('/api/hosting/login', { method: 'POST', body: JSON.stringify({ pin: document.getElementById('pin').value }) });
  if (r.ok) location.reload(); else document.getElementById('e').textContent = ((await r.json().catch(() => ({}))).error) || 'Wrong PIN';
};
</script></body></html>`;
}
