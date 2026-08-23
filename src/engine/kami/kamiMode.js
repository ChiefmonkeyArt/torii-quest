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
import { state, isPlaying, PHASE } from '../../state.js';
import { on, EV } from '../../events.js';
import { getYaw, getPitch } from '../../input.js';
import { requestFrameGrab } from '../../scene.js';
import { resolveMpHttpBase, getStoredToken } from '../multiplayer/sessionAuth.js';
import { fetchCapability } from '../update/adminUpdateClient.js';
import { describeUiTarget } from './uiTarget.js';
import { sealJson, sealTo, toB64 } from './kamiSeal.js';
import {
  EMA_KIND, TRAY_MAX, makeEma, makeEmaId, addToTray, removeFromTray, noteIsValid,
} from './emaModel.js';
import { renderEmakake, showEmakake, hideEmakake } from './emakakePanel.js';

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

let _deps = null;

// Lazy owner-gate state. _ownerCheck is a memo of the capability fetch keyed by
// pubkey so the first Ctrl+E pays one round-trip and every later capture is
// instant — but ONLY a confirmed-owner result is cached. A false result is NOT
// cached: the arena can be PLAYING before the async NIP-07 login resolves, so a
// Ctrl+E fired before state.nostrPubkey is set must re-check on the next press,
// or the owner is silently locked out of Kami Mode for the whole session
// (exactly the "logged in, no rack, shooting still works" symptom).
let _ownerCheck = null;
let _checkedPubkey = '';
let _isOwner = false;
let _armed = false; // true once the owner is confirmed and the rack CAN go live
// ADR-0029 Kami state machine. _armed = owner is verified + crypto is ready
// (a capability, not a mode). _kamiActive = the admin is currently IN Kami Mode
// (the invincible-spirit state: rack visible, shooting suppressed, movement +
// look live, bots running). _noteOpen = the ema textarea editor is open (full
// input suppressed for typing). _invincible = recorded so the damage path can
// no-op the owner's HP while in Kami Mode; today nothing damages the local
// player in single-player (bots are targets, not return-fire), so this is a
// no-op flag until bot return-fire / MP damage exists — but it is wired so that
// path is one guard away.
let _kamiActive = false;
let _invincible = false;
// ADR-0029 async-enter race guard. The first Ctrl+E awaits an owner-capability
// fetch (checkOwner). While that is in flight, Esc must NOT fall through to the
// pause menu, and a late owner resolution must NOT show the rack after the user
// backed out. _entering marks a pending enter; _enterToken is a cancel counter —
// enterKamiMode captures it, exitKamiMode/Kami-cancel bump it, so a stale
// resolution sees token !== _enterToken and aborts. _noteCleanup removes the
// textarea keydown listener so a forced exit (Esc-in-KAMI / phase→TITLE) can't
// leave a stale onKey bound to a hidden note.
let _entering = false;
let _enterToken = 0;
let _noteCleanup = null;

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
  if (state.pointerLocked) {
    const pos = playerPos();
    if (pos) {
      return { kind: EMA_KIND.WORLD, world: { pos, yaw: getYaw(), pitch: getPitch() } };
    }
    // No player position (menus, pre-spawn): fall through to a UI ema rather
    // than refusing the capture.
  }
  const doc = _deps.getDocument();
  const el = doc.elementFromPoint(_lastMouse.x, _lastMouse.y);
  const ui = describeUiTarget(el, { phase: state.phase });
  return ui ? { kind: EMA_KIND.UI, ui } : null;
}

/** Lazily confirm the logged-in user is the instance admin. Memoised by pubkey
 *  — but ONLY a confirmed-owner result is cached. An empty pubkey (login not yet
 *  resolved) or a non-match is NOT cached, so a Ctrl+E fired before/around login
 *  re-checks on the next press instead of locking the owner out for the session. */
async function checkOwner() {
  const owner = String(_deps.getOwnerPubkey() || '').toLowerCase();
  // Login not ready yet (NIP-07 getPubKey still resolving, or logged out): do not
  // memoise — a later Ctrl+E once login resolves must re-check, not return a
  // stale false from before the pubkey existed.
  if (!owner) { _isOwner = false; _ownerCheck = null; _checkedPubkey = ''; return false; }
  // Cache hit for the same pubkey (the owner re-presses Ctrl+E: instant).
  if (_ownerCheck && _checkedPubkey === owner) return _ownerCheck;
  _checkedPubkey = owner;
  _ownerCheck = (async () => {
    const httpBase = resolveMpHttpBase();
    const cap = await fetchCapability({ httpBase, fetchImpl: _deps.fetchImpl });
    const admin = String(cap && cap.adminPubkey || '').toLowerCase();
    _isOwner = !!(admin && owner === admin);
    // A non-match is not cached: the user may switch identity, or the capability
    // fetch may have transiently failed. Re-check on the next Ctrl+E.
    if (!_isOwner) { _ownerCheck = null; _checkedPubkey = ''; }
    console.log('[kami] owner-check owner=' + owner.slice(0,8) + ' admin=' + admin.slice(0,8) + ' isOwner=' + _isOwner);
    return _isOwner;
  })();
  return _ownerCheck;
}

async function armIfOwner() {
  if (_armed) return true;
  const ok = await checkOwner();
  if (!ok) return false;
  _armed = true;
  console.log('[kami] Kami Mode armed — Ctrl+E to enter Kami Mode');
  return true;
}

// ── ADR-0029 Kami state machine ───────────────────────────────────────────
// NORMAL --Ctrl+E--> KAMI --Ctrl+E--> EMA_OPEN ; EMA_OPEN --Enter/Esc--> KAMI ;
// KAMI --Esc--> NORMAL. enterKamiMode shows the rack + flips on the invincible-
// spirit suppressions (shooting off, movement/look live). It does NOT open a
// note — that is the 2nd Ctrl+E. exitKamiMode hides the rack + restores normal
// play. The tray is NOT cleared on exit: prior ema reappear on the next arm.

async function enterKamiMode() {
  if (_kamiActive || _entering) return true;
  _entering = true;
  const token = ++_enterToken; // cancel token: exit/supersede bumps this
  const armed = await armIfOwner();
  if (token !== _enterToken) return false; // superseded — user backed out or re-pressed
  _entering = false;
  if (!armed) {
    setStatus('KAMI: OWNER ONLY');
    setTimeout(renderTray, 1800);
    return false;
  }
  _kamiActive = true;
  _invincible = true;
  // The rack goes live the moment the owner enters Kami Mode: floating over the
  // world in-game, as a column in a menu. showEmakake removes `hidden` + pins it
  // right via .floating; the panels live at body scope (ADR-0028) so they survive
  // #screen-title being display:none during PLAYING.
  showEmakake({ floating: isPlaying(), doc: _deps.getDocument() });
  setKamiBadge(true);
  renderRack();
  // Invincible-spirit suppressions: shooting off, movement + look KEPT. The
  // full setGameInputSuppressed(true) is reserved for the ema textarea (finish).
  _deps.setShootingSuppressed?.(true);
  console.log('[kami] entered Kami Mode — Ctrl+E for an ema, Esc to leave');
  return true;
}

function exitKamiMode() {
  // Cancel any pending enter first so a late owner-check can't show the rack
  // after the user backed out, + clear the entering flag so the Esc guard stops
  // yielding once we're out.
  _enterToken++;
  _entering = false;
  if (!_kamiActive) {
    // Not actually in KAMI (e.g. Esc during the owner-check): still make sure no
    // half-applied suppressions linger, then bail.
    _invincible = false;
    _deps.setShootingSuppressed?.(false);
    _deps.setGameInputSuppressed?.(false);
    _closeNoteIfOpen();
    setKamiBadge(false);
    return;
  }
  _kamiActive = false;
  _invincible = false;
  // If the ema note was still open, close it + remove its keydown listener.
  _closeNoteIfOpen();
  hideEmakake({ doc: _deps.getDocument() });
  setKamiBadge(false);
  // Restore normal input: shoot back on, full-suppress cleared.
  _deps.setShootingSuppressed?.(false);
  _deps.setGameInputSuppressed?.(false);
  setStatus('');
  console.log('[kami] left Kami Mode');
}

/** Hard-close an open note: hide the overlay + remove the textarea keydown
 *  listener so a forced exit can't leave a stale onKey bound to a hidden note. */
function _closeNoteIfOpen() {
  if (!_noteOpen) return;
  const root = _deps.getDocument().getElementById('kami-overlay');
  if (root) root.style.display = 'none';
  _noteOpen = false;
  if (_noteCleanup) { try { _noteCleanup(); } catch { /* noop */ } _noteCleanup = null; }
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
  // ADR-0027: the cssText above sets display:flex, which overrides the UA
  // [hidden]{display:none} rule — so setAttribute('hidden','') would NOT hide
  // the overlay. Toggle style.display directly instead (see openNote/finish).
  root.style.display = 'none';

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

  box.appendChild(title);
  box.appendChild(ctx);
  box.appendChild(ta);
  box.appendChild(hint);
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

// ADR-0030 — KAMI MODE badge (#kami-mode-badge): a persistent top-center pill so
// the owner unambiguously sees they are in spirit mode. The emakake rack alone
// was too easy to miss over the weapon (empty rack = a few lines of floating
// text). This badge is the unmistakable "you are in KAMI" signal. Toggled in
// enterKamiMode / exitKamiMode so every entry shows it + every exit hides it.
function setKamiBadge(visible) {
  const doc = _deps.getDocument();
  const el = doc && doc.getElementById('kami-mode-badge');
  if (!el) return;
  if (visible) el.removeAttribute('hidden');
  else el.setAttribute('hidden', '');
}

/** Paint the emakake rack from the current tray. Called on every add/discard/hang. */
function renderRack() {
  renderEmakake(_tray, { doc: _deps.getDocument() });
}

// ── capture ────────────────────────────────────────────────────────────────

async function openNote() {
  if (_noteOpen) return;
  // ADR-0029: opening a note first enters Kami Mode (arms + shows the rack +
  // flips on the invincible-spirit suppressions). If already in Kami Mode this is
  // a no-op fast path. enterKamiMode owns the owner-gate + rack show now.
  const entered = await enterKamiMode();
  if (!entered) return; // owner-only / status handled inside enterKamiMode
  const target = captureTarget();
  if (!target) {
    setStatus('KAMI: NOTHING TO PIN HERE');
    setTimeout(renderTray, 1600);
    return;
  }
  _noteOpen = true;
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
  root.style.display = 'flex';
  ta.focus();

  const finish = (commit) => {
    // ADR-0027: ALWAYS hide + hand input back, even on a stray second Enter/Esc,
    // so the overlay can never get stuck visible with _noteOpen already false
    // (which is what let Escape fall through to the pause menu before).
    root.style.display = 'none';
    // ADR-0029: commit/discard returns to KAMI (not NORMAL): clear the full
    // input-suppress used for typing (movement + look back on) but re-apply the
    // shooting-only suppress so the invincible-spirit state holds. The rack
    // stays visible (shown on enterKamiMode, not hidden here). The suppress is
    // gated on _kamiActive: if a phase→TITLE exit already cleared KAMI while the
    // note was open, shooting must come back ON, not stay suppressed.
    _deps.setGameInputSuppressed(false);
    _deps.setShootingSuppressed?.(_kamiActive);
    if (!_noteOpen) return;
    _noteOpen = false;
    if (_noteCleanup) { try { _noteCleanup(); } catch { /* noop */ } _noteCleanup = null; }
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
    if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); finish(false); return; }
    if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); ev.stopPropagation(); finish(true); }
  }
  ta.addEventListener('keydown', onKey);
  // ADR-0029: record the cleanup so a FORCED exit (Esc-in-KAMI / phase→TITLE)
  // can remove this listener via _closeNoteIfOpen — otherwise a hidden note
  // keeps a stale onKey bound, and a later re-open would stack a second one.
  _noteCleanup = () => ta.removeEventListener('keydown', onKey);
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
    setShootingSuppressed: deps.setShootingSuppressed || (() => {}),
    fetchImpl: deps.fetchImpl || ((...a) => fetch(...a)),
  };

  const doc = _deps.getDocument();
  doc.addEventListener('mousemove', trackMouse);
  doc.addEventListener('keydown', (ev) => {
    // ADR-0029: accept BOTH Ctrl+E (⌃E, the spec'd hotkey) and Cmd+E (⌘E).
    // Mac users instinctively reach for ⌘ for shortcuts; the handler previously
    // checked ev.ctrlKey alone, so ⌘E was silently ignored (no [kami] log at all
    // — the "logged in, no kami" symptom). input.js ADR-0025 already treats
    // ctrlKey || metaKey as app-shortcut modifiers, so this is consistent.
    if (!(ev.ctrlKey || ev.metaKey) || ev.code !== HOTKEY_CODE) return;
    ev.preventDefault();
    // ADR-0029 diagnostic: log every hotkey press so a non-firing Ctrl+E is
    // distinguishable from a downstream guard (isPlaying / owner-check) failure.
    console.log('[kami] hotkey pressed, isPlaying=' + isPlaying() + ' phase=' + state.phase);
    // ADR-0029: Kami Mode is an in-arena authoring surface. It must NOT engage
    // on the title / pause / gameover screens — only while PLAYING (the arena +
    // the NAP zone, which lives inside PLAYING). The pause-modal button
    // (kamiCapture) still works from PAUSED because it calls openNote directly,
    // not through this hotkey. Guarding the hotkey on isPlaying() also closes the
    // title-re-entry bug: after exitKamiMode on PHASE_CHANGE→TITLE, a stray
    // Ctrl+E on the home screen no longer re-enters + re-shows the rack.
    if (!isPlaying()) return;
    if (ev.shiftKey) hangTray();
    // ADR-0029: 1st Ctrl+E enters Kami Mode (rack visible, invincible spirit,
    // shooting off, movement/look live). 2nd Ctrl+E (already in Kami) opens a
    // new ema note. Shift+Ctrl+E seals + sends the tray (unchanged).
    else if (!_kamiActive) enterKamiMode();
    else openNote();
  });

  // ADR-0029: leaving the arena (PAUSED→TITLE via the Home button, or any path
  // that transitions to TITLE) auto-exits Kami Mode so the rack doesn't persist
  // across exit/re-enter. _tray is NOT cleared — prior ema reappear on re-arm.
  on(EV.PHASE_CHANGE, ({ to }) => { if (to === PHASE.TITLE) exitKamiMode(); });

  _installed = true;
  return true;
}

/** Open the note box from a UI control (the pause-modal button). Enters Kami
 *  Mode first if not already in it (so the pause button works from NORMAL). */
export function kamiCapture() { if (_installed) openNote(); }
/** Is the ema note input currently open? Arena input guards on this so Escape /
 *  movement keys aren't stolen from the textarea while the owner is writing. */
export function kamiNoteOpen() { return _noteOpen; }
/** ADR-0029: is the admin currently in Kami Mode (invincible-spirit state)?
 *  The arena's capture-phase Escape listener yields to this so Esc exits Kami
 *  instead of opening the pause menu. */
export function kamiActive() { return _kamiActive; }
/** ADR-0029: is Kami Mode active OR a first-enter (owner check) pending? The
 *  arena's capture-phase Escape listener yields to this so Esc pressed while the
 *  async owner-check is still in flight CANCELS the pending enter instead of
 *  falling through to the pause menu. */
export function kamiBusy() { return _kamiActive || _entering; }
/** ADR-0029: is the owner invincible right now (in Kami Mode)? The damage path
 *  (player.takeDamage) no-ops while this is true. No-op in single-player today
 *  (nothing damages the local player); live for MP peer-fire / future bot
 *  return-fire. */
export function kamiInvincible() { return _invincible; }
/** ADR-0029: exit Kami Mode from a UI control / external caller. */
export function kamiExit() { exitKamiMode(); }
/** Hang the tray from a UI control. */
export function kamiHang() { if (_installed) hangTray(); }
/** Test/diagnostic read of pending tray state. */
export function kamiTrayState() { return { count: _tray.length, ids: _tray.map((r) => r.id) }; }
/** Discard one pending ema (tray is not yet sent, so this is purely local). */
export function kamiDiscard(id) { _tray = removeFromTray(_tray, id); _shots.delete(`${id}.jpg`); renderRack(); renderTray(); }
/** Exposed for tests/diagnostics: is the owner gate satisfied? */
export function kamiIsOwner() { return _isOwner; }
