// kamiMode.js — ADR-0025. Kami Mode: the owner's in-world authoring surface.
//
// NAMING. Torii is a shrine gate; the kami (神) is the spirit that inhabits the
// shrine. Kami Mode is the owner standing inside their own world, unseen, able
// to mark and change it. The notes are ema (絵馬) — the wooden plaques a visitor
// writes on and hangs up.
//
// THIS MODULE IS THE GLUE ONLY. Everything testable lives elsewhere on purpose:
//   emaModel.js     — record shape, tray rules, lifecycle, cull policy (pure)
//   uiTarget.js     — pointer → DOM control description (pure)
//   kamiSeal.js      — sealed-box encryption (pure + WebCrypto)
//   emakakePanel.js  — rack list render (one DOM writer)
//   scene.js         — requestFrameGrab(), the same-tick canvas capture
// What is left here is genuinely browser-shaped: hotkey wiring, pointer-lock
// juggling, overlay DOM, one fetch, and the owner-gate.
//
// OWNER-ONLY (owner's requirement: "Kami mode should only be available to the
// admin the owner of the vps"). The hotkey + mouse tracker install
// unconditionally — they are inert. The owner check is LAZY: on the first
// capture we fetch the instance capability (public endpoint) and compare the
// logged-in pubkey to cap.adminPubkey. Non-owners see "KAMI: OWNER ONLY" and
// nothing is ever sealed or sent. That is a UX gate; the server independently
// admin-gates the POST route, and nothing here is trusted.
//
// SEAL IS SPLIT. The ema record (note + meta + snapshot, small JSON) and the
// screenshot (large JPEG bytes) are sealed SEPARATELY:
//   POST {v:1, batch:[{id, ema: <envelope>, shot: <envelope>|null}]}
// Why split: the server keeps ema text FOREVER but rings screenshots to 420
// (owner's rule). It cannot do that if text and image are one blob — it can't
// see inside a sealed envelope. Splitting lets the server store the sealed ema
// in JSONL forever and the sealed shot in a 420-deep ring buffer. Neither the
// server nor anyone reading the disk can decrypt either; only a holder of the
// owner or Kami private key can.
//
// CAPTURE FLOW, and why it is ordered this way:
//   1. Grab the frame FIRST, before any overlay exists. The screenshot must show
//      the game as it was at the moment of the problem, not the note box.
//   2. Release pointer lock. While locked, keystrokes belong to the game and a
//      textarea cannot receive them.
//   3. Collect the note. Enter hangs it into the tray, Escape discards.
//   4. Re-lock and hand control back, so noting three things in a row never
//      breaks flow.
// Nothing is sent until the owner hangs the tray: one seal pass, one POST.

import { VERSION } from '../../config.js';
import { state, isPlaying } from '../../state.js';
import { getYaw, getPitch } from '../../input.js';
import { requestFrameGrab } from '../../scene.js';
import { resolveMpHttpBase, getStoredToken } from '../multiplayer/sessionAuth.js';
import { fetchCapability } from '../update/adminUpdateClient.js';
import { describeUiTarget } from './uiTarget.js';
import { sealJson, sealTo, toB64 } from './kamiSeal.js';
import {
  EMA_KIND, TRAY_MAX, makeEma, makeEmaId, addToTray, removeFromTray, noteIsValid,
} from './emaModel.js';
import { renderEmakake, showEmakake } from './emakakePanel.js';

// The Kami public key. Its private half lives OFF this box, so ema stay readable
// by the maintainer without the VPS ever holding a key that opens them.
// Recipients are a LIST by design: adding an owner's own agent later (Routstr,
// Continuum) is one more entry, not a format change.
export const KAMI_PUBKEY = 'f69bbd44782c4e0c075260fc9159555d8d08085102731529649404fdcdddf30c';

const HOTKEY_CODE = 'KeyE'; // with Ctrl — plain E is already a jump alias.

let _installed = false;
let _tray = [];
let _lastMouse = { x: 0, y: 0 };
let _noteOpen = false;

// ADR-0027 debug helper: write a visible trace into the ema modal's #kami-debug
// line so the owner can see (without DevTools) whether openNote/onKey/finish
// fire + in what order. Pure DOM, no-op if the element is absent.
function _dbg(msg) {
  try {
    const el = (typeof document !== 'undefined') && document.getElementById('kami-debug');
    if (el) el.textContent = (el.textContent === 'K7: (idle)' ? 'K7: ' : el.textContent + ' | ') + msg;
  } catch (_) { /* debug only */ }
}

// ADR-0027 persistent trace: a red-on-black banner pinned to the top-right
// corner that survives modal open/close. Shows the Ctrl+E -> openNote flow
// so the owner can see WHY the ema didn't open (owner-check? nothing-to-pin?)
// without DevTools. Diagnostic only — strip with the [K7] probes.
function _trace(msg) {
  try {
    if (typeof document === 'undefined') return;
    let el = document.getElementById('kami-trace');
    if (!el) {
      el = document.createElement('div');
      el.id = 'kami-trace';
      el.style.cssText = 'position:fixed;top:8px;right:8px;z-index:99999;font:11px monospace;color:#fff;background:#600;padding:4px 7px;border:1px solid #f99;max-width:340px;word-break:break-all;pointer-events:none;white-space:pre-wrap';
      document.body.appendChild(el);
    }
    el.textContent = (el.textContent ? el.textContent + ' | ' : '') + msg;
  } catch (_) { /* debug only */ }
}
let _deps = null;

// Lazy owner-gate state. _ownerCheck is a memo of the capability fetch so the
// first Ctrl+E pays one round-trip and every later capture is instant.
let _ownerCheck = null;
let _isOwner = false;
let _armed = false; // true once the owner is confirmed and the rack is live

// Screenshots are held OUT of the tray records until seal time, so the tray
// stays a list of small JSON objects rather than megabytes of data URLs.
const _shots = new Map();

/** Track the pointer so a UI ema knows what was under it. Pointer-lock mode
 *  ignores this and uses the crosshair (screen centre) instead. */
function trackMouse(ev) {
  _lastMouse = { x: ev.clientX, y: ev.clientY };
}

function playerPos() {
  const dbg = _deps.getDebug();
  const p = dbg && dbg.player && dbg.player.position;
  if (p && Number.isFinite(p.x)) return { x: p.x, y: p.y, z: p.z };
  return null;
}

function safeSnapshot() {
  try {
    const dbg = _deps.getDebug();
    return dbg && typeof dbg.snapshot === 'function' ? dbg.snapshot() : null;
  } catch (err) {
    // A snapshot failure must never cost the owner their note.
    console.warn('[kami] snapshot failed', err);
    return null;
  }
}

/** Decode a data: URL's base64 payload into raw bytes for sealing. Falls back to
 *  UTF-8 if the URL is malformed — we never lose the bytes, only the efficiency. */
function dataUrlToBytes(dataUrl) {
  if (typeof dataUrl !== 'string' || !dataUrl) return null;
  const m = /^data:[^;]*;base64,(.*)$/s.exec(dataUrl);
  const b64 = m ? m[1] : dataUrl;
  try {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return new TextEncoder().encode(dataUrl);
  }
}

/** Decide which kind of ema this capture is, and describe its target. */
function captureTarget() {
  _trace('cap:ptrLock=' + !!state.pointerLocked);
  if (state.pointerLocked) {
    const pos = playerPos();
    _trace('cap:playerPos=' + (pos ? 'yes' : 'no'));
    if (pos) {
      return { kind: EMA_KIND.WORLD, world: { pos, yaw: getYaw(), pitch: getPitch() } };
    }
    // No player position (menus, pre-spawn): fall through to a UI ema rather
    // than refusing the capture.
  }
  const doc = _deps.getDocument();
  const el = doc.elementFromPoint(_lastMouse.x, _lastMouse.y);
  _trace('cap:elAt=' + (el ? el.tagName : 'none') + '.' + (el ? el.id || el.className : ''));
  const ui = describeUiTarget(el, { phase: state.phase });
  return ui ? { kind: EMA_KIND.UI, ui } : null;
}

/** Lazily confirm the logged-in user is the instance admin. Memoised. */
async function checkOwner() {
  if (_ownerCheck) return _ownerCheck;
  _ownerCheck = (async () => {
    const owner = String(_deps.getOwnerPubkey() || '').toLowerCase();
    if (!owner) { _isOwner = false; return false; }
    const httpBase = resolveMpHttpBase();
    const cap = await fetchCapability({ httpBase, fetchImpl: _deps.fetchImpl });
    const admin = String(cap && cap.adminPubkey || '').toLowerCase();
    _isOwner = !!(admin && owner === admin);
    return _isOwner;
  })();
  return _ownerCheck;
}

async function armIfOwner() {
  if (_armed) return true;
  const ok = await checkOwner();
  if (!ok) return false;
  _armed = true;
  // The rack goes live the moment the owner is confirmed: floating over the
  // world in-game, as a column in a menu.
  showEmakake({ floating: isPlaying(), doc: _deps.getDocument() });
  renderRack();
  console.log('[kami] Kami Mode armed — Ctrl+E to hang an ema');
  return true;
}

// ── overlay DOM ────────────────────────────────────────────────────────────

function ensureOverlay() {
  const doc = _deps.getDocument();
  let root = doc.getElementById('kami-overlay');
  if (root) return root;

  root = doc.createElement('div');
  root.id = 'kami-overlay';
  root.setAttribute('hidden', '');
  root.style.cssText = [
    'position:fixed', 'inset:0', 'z-index:200', 'display:flex',
    'align-items:center', 'justify-content:center',
    'background:rgba(8,6,14,0.72)', 'font-family:inherit',
  ].join(';');

  const box = doc.createElement('div');
  box.style.cssText = [
    'background:#d9b382', 'color:#4a3010', 'border:1px solid #8a5f2f',
    'border-radius:6px', 'padding:20px 22px', 'width:min(480px,86vw)',
    'box-sizing:border-box',
  ].join(';');

  const title = doc.createElement('div');
  title.id = 'kami-note-title';
  title.textContent = 'HANG AN EMA';
  title.style.cssText = 'font-size:12px;letter-spacing:3px;margin-bottom:4px;opacity:0.75';

  const ctx = doc.createElement('div');
  ctx.id = 'kami-note-context';
  ctx.style.cssText = 'font-size:11px;font-family:monospace;margin-bottom:10px;opacity:0.65';

  const ta = doc.createElement('textarea');
  ta.id = 'kami-note-input';
  ta.rows = 3;
  ta.placeholder = 'what should happen here?';
  ta.style.cssText = [
    'width:100%', 'box-sizing:border-box', 'background:#f0d9b5', 'color:#4a3010',
    'border:1px solid #a9793f', 'border-radius:4px', 'padding:8px 10px',
    'font:inherit', 'font-size:14px', 'resize:none',
  ].join(';');

  const hint = doc.createElement('div');
  hint.style.cssText = 'font-size:11px;margin-top:8px;opacity:0.7';
  hint.textContent = 'Enter — hang · Shift+Enter — new line · Esc — discard';

  const dbg = doc.createElement('div');
  dbg.id = 'kami-debug';
  dbg.style.cssText = 'font-size:10px;font-family:monospace;margin-top:6px;color:#b00;background:#fff3e0;border:1px dashed #b00;padding:3px 5px;min-height:14px;word-break:break-all';
  dbg.textContent = 'K7: (idle)';

  box.appendChild(title);
  box.appendChild(ctx);
  box.appendChild(ta);
  box.appendChild(hint);
  box.appendChild(dbg);
  root.appendChild(box);
  doc.body.appendChild(root);
  return root;
}

function ensureTrayBadge() {
  const doc = _deps.getDocument();
  let el = doc.getElementById('kami-tray');
  if (el) return el;
  el = doc.createElement('div');
  el.id = 'kami-tray';
  el.setAttribute('hidden', '');
  el.style.cssText = [
    'position:fixed', 'left:50%', 'transform:translateX(-50%)', 'bottom:10px',
    'z-index:150', 'display:flex', 'gap:6px', 'align-items:center',
    'padding:6px 12px', 'border-radius:4px',
    'background:rgba(20,20,35,0.85)', 'border:1px solid rgba(224,160,32,0.5)',
    'color:#e0a020', 'font-size:11px', 'letter-spacing:2px', 'pointer-events:none',
  ].join(';');
  doc.body.appendChild(el);
  return el;
}

function renderTray() {
  const el = ensureTrayBadge();
  if (_tray.length === 0) {
    el.setAttribute('hidden', '');
    return;
  }
  el.removeAttribute('hidden');
  el.textContent = `${_tray.length} EMA ON THE RACK · CTRL+SHIFT+E TO HANG`;
}

function setStatus(msg) {
  const el = ensureTrayBadge();
  el.removeAttribute('hidden');
  el.textContent = msg;
  if (!msg) renderTray();
}

/** Paint the emakake rack from the current tray. Called on every add/discard/hang. */
function renderRack() {
  renderEmakake(_tray, { doc: _deps.getDocument() });
}

// ── capture ────────────────────────────────────────────────────────────────

async function openNote() {
  if (_noteOpen) { _trace('openNote:alreadyOpen'); return; }
  _trace('openNote:armCheck');
  const armed = await armIfOwner();
  _trace('armed=' + armed);
  if (!armed) {
    setStatus('KAMI: OWNER ONLY');
    setTimeout(renderTray, 1800);
    return;
  }
  const target = captureTarget();
  _trace('target=' + (target ? target.kind : 'null'));
  if (!target) {
    setStatus('KAMI: NOTHING TO PIN HERE');
    setTimeout(renderTray, 1600);
    return;
  }
  _noteOpen = true;
  console.log('[K7] openNote: _noteOpen=true, ta=', doc.getElementById('kami-note-input')?.tagName);
  _dbg('OPEN');
  // ADR-0027: suppress ALL game input while the note is open — a bare Space / E
  // must not jump the player and a click must not fire a shot, regardless of
  // where focus lands (textarea, overlay, body). Re-enabled in finish().
  _deps.setGameInputSuppressed(true);

  // Frame FIRST — before the overlay is shown, so the picture is the game.
  let shotUrl = null;
  requestFrameGrab((url) => { shotUrl = url; });

  const snapshot = safeSnapshot();
  const doc = _deps.getDocument();
  const wasLocked = state.pointerLocked;
  if (wasLocked && doc.exitPointerLock) doc.exitPointerLock();

  const root = ensureOverlay();
  const ta = doc.getElementById('kami-note-input');
  const ctx = doc.getElementById('kami-note-context');
  ctx.textContent = target.kind === EMA_KIND.WORLD
    ? `world · x ${target.world.pos.x.toFixed(1)} y ${target.world.pos.y.toFixed(1)} z ${target.world.pos.z.toFixed(1)}`
    : `ui · ${target.ui.selector}${target.ui.text ? ` · "${target.ui.text}"` : ''}`;
  ta.value = '';
  root.removeAttribute('hidden');
  ta.focus();

  const finish = (commit) => {
    console.log('[K7] finish: commit=', commit, '_noteOpen=', _noteOpen);
    _dbg('FIN:' + commit + (commit ? '' : '(discard)'));
    if (!_noteOpen) return;
    _noteOpen = false;
    _deps.setGameInputSuppressed(false); // ADR-0027: hand game input back
    root.setAttribute('hidden', '');
    ta.removeEventListener('keydown', onKey);
    if (commit && noteIsValid(ta.value)) {
      const ts = Date.now();
      const rec = makeEma({
        id: makeEmaId(ts),
        kind: target.kind,
        world: target.world,
        ui: target.ui,
        note: ta.value,
        snapshot,
        ts,
        version: VERSION,
      });
      // The screenshot rides alongside the record until the batch is sealed.
      if (shotUrl) {
        rec.shotId = `${rec.id}.jpg`;
        rec.shotBytes = Math.round((shotUrl.length * 3) / 4);
        _shots.set(rec.shotId, shotUrl);
      }
      const res = addToTray(_tray, rec, TRAY_MAX);
      _tray = res.tray;
      if (!res.added) setStatus(`KAMI: ${res.reason.toUpperCase()} — HANG FIRST`);
      else { renderRack(); renderTray(); }
    } else {
      renderRack();
      renderTray();
    }
    // Hand control back exactly as it was found.
    if (wasLocked) _deps.requestPointerLock();
  };

  function onKey(ev) {
    console.log('[K7] onKey: key=', ev.key, 'target=', ev.target?.tagName, 'id=', ev.target?.id);
    _dbg('KEY:' + ev.key);
    if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); finish(false); return; }
    if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); ev.stopPropagation(); finish(true); }
  }
  ta.addEventListener('keydown', onKey);
}

// ── hang (seal + send) ─────────────────────────────────────────────────────

async function hangTray() {
  if (_tray.length === 0) { setStatus('KAMI: RACK IS EMPTY'); setTimeout(renderTray, 1400); return; }
  if (!(await armIfOwner())) {
    setStatus('KAMI: OWNER ONLY');
    setTimeout(renderTray, 1800);
    return;
  }
  const count = _tray.length;
  setStatus(`KAMI: SEALING ${count}…`);

  const ownerPub = _deps.getOwnerPubkey();
  // Owner-only mode means the owner's key is always present; sealing to the Kami
  // key alone would silently make a note the owner cannot read back.
  if (!ownerPub) { setStatus('KAMI: NOT LOGGED IN — CANNOT SEAL'); setTimeout(renderTray, 2400); return; }
  const recipients = [ownerPub, KAMI_PUBKEY];

  try {
    const batch = [];
    for (const rec of _tray) {
      const { shotBytes, ...clean } = rec; // drop bookkeeping before sealing
      // Split seal: the small ema record seals as JSON; the large screenshot
      // seals as raw bytes. The server stores the text forever and rings the
      // shot to 420 — it cannot do either if they were one blob.
      const ema = await sealJson(clean, recipients);
      let shot = null;
      const shotUrl = rec.shotId ? _shots.get(rec.shotId) || null : null;
      const shotBytesRaw = shotUrl ? dataUrlToBytes(shotUrl) : null;
      if (shotBytesRaw) {
        const env = await sealTo(shotBytesRaw, recipients);
        shot = { env, bytes: shotBytesRaw.length };
      }
      batch.push({ id: rec.id, ema, shot });
    }

    const base = resolveMpHttpBase();
    const token = getStoredToken();
    const res = await _deps.fetchImpl(`${base}/kami/ema`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token || ''}` },
      body: JSON.stringify({ v: 1, batch }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = await res.json().catch(() => ({}));
    _tray = [];
    _shots.clear();
    setStatus(`KAMI: HUNG ${body.stored ?? count}`);
    renderRack();
    setTimeout(renderTray, 2000);
  } catch (err) {
    // Keep the tray intact on failure — losing a batch of considered notes is
    // far worse than showing an error and letting the owner retry.
    console.warn('[kami] hang failed', err);
    setStatus('KAMI: HANG FAILED — RACK KEPT');
    setTimeout(renderTray, 2600);
  }
}

// ── install ────────────────────────────────────────────────────────────────

/**
 * Install Kami Mode. The hotkey + mouse tracker always install (inert); the
 * owner check is deferred to the first capture so a non-owner never pays for
 * it and never sees the surface.
 *
 * @param {object} deps
 *   getOwnerPubkey  () => hex pubkey of the logged-in user, or ''
 *   getDebug        () => window.ToriiDebug-like surface
 *   requestPointerLock () => void
 *   getDocument     () => document
 *   fetchImpl       fetch
 * @returns {boolean} whether it installed
 */
export function installKamiMode(deps = {}) {
  if (_installed) return true;

  _deps = {
    getOwnerPubkey: deps.getOwnerPubkey || (() => ''),
    getDebug: deps.getDebug || (() => (typeof window !== 'undefined' ? window.ToriiDebug : null)),
    requestPointerLock: deps.requestPointerLock || (() => {}),
    getDocument: deps.getDocument || (() => document),
    setGameInputSuppressed: deps.setGameInputSuppressed || (() => {}),
    fetchImpl: deps.fetchImpl || ((...a) => fetch(...a)),
  };

  const doc = _deps.getDocument();
  doc.addEventListener('mousemove', trackMouse);
  doc.addEventListener('keydown', (ev) => {
    if (!ev.ctrlKey || ev.code !== HOTKEY_CODE) return;
    ev.preventDefault();
    _trace('CtrlE');
    if (ev.shiftKey) hangTray();
    else openNote();
  });

  _installed = true;
  return true;
}

/** Open the note box from a UI control (the pause-modal button). */
export function kamiCapture() { if (_installed) openNote(); }
/** Is the ema note input currently open? Arena input guards on this so Escape /
 *  movement keys aren't stolen from the textarea while the owner is writing. */
export function kamiNoteOpen() { return _noteOpen; }
/** Hang the tray from a UI control. */
export function kamiHang() { if (_installed) hangTray(); }
/** Test/diagnostic read of pending tray state. */
export function kamiTrayState() { return { count: _tray.length, ids: _tray.map((r) => r.id) }; }
/** Discard one pending ema (tray is not yet sent, so this is purely local). */
export function kamiDiscard(id) { _tray = removeFromTray(_tray, id); _shots.delete(`${id}.jpg`); renderRack(); renderTray(); }
/** Exposed for tests/diagnostics: is the owner gate satisfied? */
export function kamiIsOwner() { return _isOwner; }
