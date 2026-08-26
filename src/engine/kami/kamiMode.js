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
//   emagakePanel.js  — rack list render (one DOM writer)
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
  EMA_KIND, TRAY_MAX, POST_STATE, makeEma, makeEmaId, addToTray,
  removeFromTray, evictOldestSent, noteIsValid,
} from './emaModel.js';
import { renderEmagake, showEmagake, hideEmagake, mergeReplies } from './emagakePanel.js';

// The Kami public key. Its private half lives OFF this box, so ema stay readable
// by the maintainer without the VPS ever holding a key that opens them.
// Recipients are a LIST by design: adding an owner's own agent later (Routstr,
// Continuum) is one more entry, not a format change.
// ADR-0038: rotated keypair. The matching private key lives OFF this box at
// /home/user/workspace/.secrets/kami-priv.hex (chmod 600, never printed, never
// committed). It is the AI's read key for decrypting ema. Rotatable at any time.
export const KAMI_PUBKEY = 'ea3ff08e8509ee77bf2188e4834ff5a5eb789cd5cfb4927325de10f5488d37a3';

const HOTKEY_CODE = 'KeyK'; // bare key, no modifier — see ADR-0031. Plain E is
// already the jump alias (player.js), so Kami Mode cannot reuse bare E either.

let _installed = false;
let _tray = [];
// ADR-0039: AI reply feed the emagake rack polls while in Kami Mode. The browser
// cannot decrypt kamiSeal ema (NIP-07 has no ECDH), so AI replies are a separate
// plaintext feed (GET /mp/kami/replies) rendered as distinct rack rows.
let _replies = [];
let _lastReplyTs = 0;
let _replyPollTimer = null;
const REPLY_POLL_MS = 5000;
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
  console.log('[kami] Kami Mode armed — press K to enter Kami Mode');
  return true;
}

// ── ADR-0029 Kami state machine (ADR-0064: single K opens the note) ────────
// NORMAL --K--> EMA_OPEN (openNote enters KAMI first, then opens the note in
// the same press) ; EMA_OPEN --Enter/Esc--> KAMI ; KAMI --Esc--> NORMAL.
// enterKamiMode shows the rack + flips on the invincible-spirit suppressions
// (shooting off, movement/look live) but does not itself open a note — that is
// openNote's job, called by the K handler right after. exitKamiMode hides the
// rack + restores normal play. The tray is NOT cleared on exit: prior ema
// reappear on the next arm.

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
  // ADR-0032: tell the server we're invincible NOW, before the rack/anything
  // else, so the earliest possible bot tick already excludes us from
  // targeting. Client-side _invincible above only ever protected local SP
  // damage math that nothing calls; this is what actually stops MP bots/
  // peers from hurting the owner. The server independently re-verifies our
  // pubkey before honouring it — see arena-ws.js isKamiActive().
  _deps.sendKamiState?.(true);
  // The rack goes live the moment the owner enters Kami Mode: floating over the
  // world in-game, as a column in a menu. showEmagake removes `hidden` + pins it
  // right via .floating; the panels live at body scope (ADR-0028) so they survive
  // #screen-title being display:none during PLAYING.
  showEmagake({ floating: isPlaying(), doc: _deps.getDocument() });
  setKamiBadge(true);
  renderRack();
  // ADR-0039: begin polling the AI replies feed so 2-way comms show in the rack.
  startReplyPoll();
  // Invincible-spirit suppressions: shooting off, movement + look KEPT. The
  // full setGameInputSuppressed(true) is reserved for the ema textarea (finish).
  _deps.setShootingSuppressed?.(true);
  console.log('[kami] entered Kami Mode — press K for an ema, Esc to leave');
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
    _deps.sendKamiState?.(false);
    _deps.setShootingSuppressed?.(false);
    _deps.setGameInputSuppressed?.(false);
    _closeNoteIfOpen();
    setKamiBadge(false);
    return;
  }
  _kamiActive = false;
  _invincible = false;
  // ADR-0032: tell the server invincibility/bot-ignore is OFF the moment we
  // leave — the owner becomes a normal, vulnerable, targetable player again.
  _deps.sendKamiState?.(false);
  // If the ema note was still open, close it + remove its keydown listener.
  _closeNoteIfOpen();
  hideEmagake({ doc: _deps.getDocument() });
  // ADR-0039: stop polling the AI replies feed on exit.
  stopReplyPoll();
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

// ADR-0034: the ema editor used to be a full-screen rgba(8,6,14,0.72) backdrop
// with a centered wooden-plaque box — it darkened and blocked the whole
// screen. The owner's instruction is that Kami Mode must keep the world
// fully visible at all times, exactly like the emagake rack. This is now an
// inline, non-blocking bar anchored to the BOTTOM of the screen, styled with
// the same smoked-glass component language as #emagake-header/.ema-row
// (rgba(8,10,20,0.45) fill + 6px blur + amber border) — no backdrop dimming,
// nothing between the owner and the game.
function ensureOverlay() {
  const doc = _deps.getDocument();
  let root = doc.getElementById('kami-overlay');
  if (root) return root;

  root = doc.createElement('div');
  root.id = 'kami-overlay';
  root.setAttribute('hidden', '');
  root.style.cssText = [
    'position:fixed', 'left:50%', 'bottom:14px', 'transform:translateX(-50%)',
    'z-index:140', 'display:flex', 'font-family:inherit',
    'width:min(560px,92vw)', 'box-sizing:border-box',
    'pointer-events:auto',
  ].join(';');
  // ADR-0027 (carried forward): the cssText above sets display:flex, which
  // overrides the UA [hidden]{display:none} rule — so setAttribute('hidden','')
  // would NOT hide the bar. Toggle style.display directly (see openNote/finish).
  root.style.display = 'none';

  const box = doc.createElement('div');
  box.id = 'kami-note-box';
  box.style.cssText = [
    'width:100%', 'box-sizing:border-box', 'border-radius:8px',
    'background:rgba(8,10,20,0.55)', '-webkit-backdrop-filter:blur(6px)',
    'backdrop-filter:blur(6px)', 'border:1px solid rgba(255,194,71,0.45)',
    'box-shadow:inset 0 1px 0 rgba(255,255,255,0.08)',
    'padding:12px 16px', 'color:#f3efe3',
  ].join(';');
  box.style.position = 'relative';
  // ADR-0041: reliable pointer-lock-independent exit. ESC is reserved by the
  // browser while pointer-locked, so a visible ✕ button is the guaranteed escape
  // from Kami Mode back to normal play (fixes the stuck-in-kami bug where the
  // 2nd ESC never reached the pause menu).
  const exitBtn = doc.createElement('button');
  exitBtn.type = 'button';
  exitBtn.textContent = '✕';
  exitBtn.title = 'Exit Kami Mode';
  exitBtn.setAttribute('aria-label', 'Exit Kami Mode');
  exitBtn.style.cssText = [
    'position:absolute','top:5px','right:6px','width:22px','height:22px',
    'line-height:20px','padding:0','border:1px solid rgba(255,194,71,0.5)',
    'border-radius:5px','background:rgba(255,194,71,0.14)','color:#ffd36a',
    'font-size:13px','cursor:pointer','pointer-events:auto',
  ].join(';');
  exitBtn.addEventListener('click', (ev) => { ev.stopPropagation(); ev.preventDefault(); exitKamiMode(); });
  box.appendChild(exitBtn);

  const title = doc.createElement('div');
  title.id = 'kami-note-title';
  title.textContent = 'HANG AN EMA';
  title.style.cssText = [
    'font-size:10px', 'letter-spacing:3px', 'margin-bottom:4px', 'color:#ffd36a',
    'text-shadow:0 1px 1px rgba(0,0,0,1),0 0 6px rgba(0,0,0,0.9)',
  ].join(';');

  const ctx = doc.createElement('div');
  ctx.id = 'kami-note-context';
  ctx.style.cssText = [
    'font-size:11px', 'font-family:ui-monospace,monospace', 'margin-bottom:8px',
    'color:#b9b2a3', 'text-shadow:0 1px 2px rgba(0,0,0,0.95)',
  ].join(';');

  const ta = doc.createElement('textarea');
  ta.id = 'kami-note-input';
  ta.rows = 2;
  ta.placeholder = 'what should happen here?';
  ta.style.cssText = [
    'width:100%', 'box-sizing:border-box', 'background:rgba(8,10,20,0.55)',
    'color:#f3efe3', 'border:1px solid rgba(255,194,71,0.30)', 'border-radius:6px',
    'padding:8px 10px', 'font:inherit', 'font-size:13px', 'resize:none',
  ].join(';');

  const hint = doc.createElement('div');
  hint.style.cssText = 'font-size:10px;margin-top:6px;color:#8a8472;letter-spacing:0.5px';
  hint.textContent = 'Enter — hang · Shift+Enter — new line · Esc — discard · K — focus';

  box.appendChild(title);
  box.appendChild(ctx);
  box.appendChild(ta);
  box.appendChild(hint);
  root.appendChild(box);
  doc.body.appendChild(root);
  return root;
}

/** ADR-0034: highlight the already-open editor instead of no-op. A brief
 *  border pulse via inline style + focus() on the textarea — the owner asked
 *  for a 2nd K while the editor is open to draw the eye to it, not reopen a
 *  second box (there is only ever one #kami-overlay). Pure presentation. */
function highlightOpenNote() {
  const doc = _deps.getDocument();
  const box = doc.getElementById('kami-note-box');
  const ta = doc.getElementById('kami-note-input');
  if (ta) ta.focus();
  if (!box) return;
  box.style.borderColor = 'rgba(255,224,140,0.95)';
  box.style.boxShadow = 'inset 0 1px 0 rgba(255,255,255,0.08), 0 0 10px rgba(255,194,71,0.55)';
  setTimeout(() => {
    box.style.borderColor = 'rgba(255,194,71,0.45)';
    box.style.boxShadow = 'inset 0 1px 0 rgba(255,255,255,0.08)';
  }, 450);
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
  el.textContent = `${_tray.length} EMA ON THE RACK · ENTER HANGS · SHIFT+K RETRIES`;
}

function setStatus(msg) {
  const el = ensureTrayBadge();
  el.removeAttribute('hidden');
  el.textContent = msg;
  if (!msg) renderTray();
}

// ADR-0030 — KAMI MODE badge (#kami-mode-badge): a persistent top-center pill so
// the owner unambiguously sees they are in spirit mode. The emagake rack alone
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

/** Paint the emagake rack from the current tray. Called on every add/discard/hang. */
function renderRack() {
  renderEmagake(_tray, { doc: _deps.getDocument(), replies: _replies });
}

// ADR-0039: poll the AI replies feed while the owner is in Kami Mode. Replies are
// plaintext AI-generated responses derived from the owner's own notes — low
// sensitivity, and the key is rotatable. Polls only when owner + token present;
// stops on exit. Dedupes by id via mergeReplies; advances the high-water mark so
// each poll only fetches new rows.
async function pollReplies() {
  if (!_kamiActive) return;
  try {
    const base = resolveMpHttpBase();
    const token = getStoredToken();
    if (!token) return;
    const res = await _deps.fetchImpl(`${base}/kami/replies?since=${_lastReplyTs}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return;
    const body = await res.json().catch(() => ({}));
    const list = Array.isArray(body && body.replies) ? body.replies : [];
    if (list.length === 0) return;
    _replies = mergeReplies(_replies, list);
    let maxTs = _lastReplyTs;
    for (const r of list) { const ts = Number(r && r.ts) || 0; if (ts > maxTs) maxTs = ts; }
    _lastReplyTs = maxTs;
    renderRack();
  } catch (err) {
    console.warn('[kami] replies poll failed', err);
  }
}

function startReplyPoll() {
  stopReplyPoll();
  pollReplies(); // immediate first fetch so the rack isn't empty for 5s on enter
  _replyPollTimer = setInterval(pollReplies, REPLY_POLL_MS);
}

function stopReplyPoll() {
  if (_replyPollTimer) { clearInterval(_replyPollTimer); _replyPollTimer = null; }
}

// ── capture ────────────────────────────────────────────────────────────────

async function openNote() {
  // ADR-0034: 2nd K while the editor is already open highlights/focuses it
  // instead of silently no-op'ing — the owner wants a visible response to
  // every K press, not a press that appears to do nothing.
  if (_noteOpen) { highlightOpenNote(); return; }
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
    ta.blur(); // ADR-0064: free keyboard focus from the note input on close.
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
      // ADR-0042: make room for the new note by evicting the oldest already-hung
      // (SENT) note when the rack is full. Pending/failed notes are never evicted.
      if (_tray.length >= TRAY_MAX) _tray = evictOldestSent(_tray);
      rec.postState = POST_STATE.PENDING;
      const res = addToTray(_tray, rec, TRAY_MAX);
      _tray = res.tray;
      if (!res.added) {
        setStatus(`KAMI: ${res.reason.toUpperCase()} — DISCARD AN OLD ONE`);
        renderRack(); renderTray();
      } else {
        renderRack(); renderTray();
        // ADR-0042: Enter seals + POSTs instantly — no Shift+K required. The note
        // shows PENDING on the rack, then flips to SENT (hung) or FAILED (retry
        // with Shift+K) when the POST resolves. Fire-and-forget so input hands
        // back immediately; the .then re-renders the rack on resolution.
        sealAndPost([rec]).then((r) => {
          if (r.ok) {
            rec.postState = POST_STATE.SENT;
            if (rec.shotId) _shots.delete(rec.shotId);
            setStatus('KAMI: HUNG 1');
            renderRack(); renderTray();
          } else {
            rec.postState = POST_STATE.FAILED;
            setStatus('KAMI: HANG FAILED — RETRY SHIFT+K');
            renderRack(); renderTray();
          }
        });
      }
    } else {
      renderRack();
      renderTray();
    }
    // ADR-0064: do NOT re-request pointer lock after committing or cancelling a
    // note — leave the pointer free so the player can mouse-click the emagake
    // rack (hang a new ema, retry a failed one). Shooting remains suppressed
    // while Kami Mode is active (setShootingSuppressed above); the player can
    // press K again at any time to open a fresh note.
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

// ADR-0042: the reusable seal+POST. Seals the given records (text as JSON,
// screenshots as raw bytes) + POSTs one batch to /kami/ema. Does NOT touch the
// tray or the shot cache — the caller owns the postState transitions + cleanup.
// Returns { ok, stored } on success or { ok:false, error } on failure.
async function sealAndPost(records) {
  if (records.length === 0) return { ok: true, stored: 0 };
  if (!(await armIfOwner())) return { ok: false, error: 'OWNER ONLY' };
  const ownerPub = _deps.getOwnerPubkey();
  // Owner-only mode means the owner's key is always present; sealing to the Kami
  // key alone would silently make a note the owner cannot read back.
  if (!ownerPub) return { ok: false, error: 'NOT LOGGED IN — CANNOT SEAL' };
  const recipients = [ownerPub, KAMI_PUBKEY];
  try {
    const batch = [];
    for (const rec of records) {
      const { shotBytes, postState, ...clean } = rec; // drop bookkeeping before sealing
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
    return { ok: true, stored: body.stored ?? records.length };
  } catch (err) {
    // Keep the tray intact on failure — losing a batch of considered notes is
    // far worse than showing an error and letting the owner retry.
    console.warn('[kami] hang failed', err);
    return { ok: false, error: String((err && err.message) || err) };
  }
}

// ADR-0042: Shift+K is now the RETRY path — it re-seals + re-POSTs every note
// still pending or failed. Enter's instant POST already handled the rest.
async function hangTray() {
  const unsent = _tray.filter((r) => r && r.postState !== POST_STATE.SENT);
  if (unsent.length === 0) { setStatus('KAMI: RACK ALL HUNG'); setTimeout(renderTray, 1400); return; }
  setStatus(`KAMI: SEALING ${unsent.length}…`);
  const r = await sealAndPost(unsent);
  if (r.ok) {
    for (const rec of unsent) {
      rec.postState = POST_STATE.SENT;
      if (rec.shotId) _shots.delete(rec.shotId);
    }
    setStatus(`KAMI: HUNG ${r.stored}`);
    renderRack(); renderTray();
  } else {
    for (const rec of unsent) rec.postState = POST_STATE.FAILED;
    setStatus('KAMI: HANG FAILED — RACK KEPT');
    renderRack(); renderTray();
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
    // ADR-0032: notifies the server of enter/exit so it can independently
    // re-verify our pubkey and exclude us from bot targeting + damage.
    // Defaults to a no-op so single-player / no-MP-host callers need not
    // pass it.
    sendKamiState: deps.sendKamiState || (() => {}),
  };

  const doc = _deps.getDocument();
  doc.addEventListener('mousemove', trackMouse);
  doc.addEventListener('keydown', (ev) => {
    // ADR-0031: bare K, no Ctrl/Cmd. Ctrl+E (and Cmd+E) never reached the page —
    // Brave (and most Chromium browsers) reserves Ctrl/Cmd+E to focus the address
    // bar as a search shortcut, so the keydown was consumed by the browser chrome
    // before it ever fired here (zero [kami] console output, not even this
    // diagnostic log, was the symptom). A bare key has no browser-chrome meaning
    // while the page has focus, so it can't be intercepted the same way. Any
    // Ctrl/Cmd modifier on KeyK is ignored here — only the unmodified press counts.
    if (ev.ctrlKey || ev.metaKey || ev.altKey || ev.code !== HOTKEY_CODE) return;
    // A focused text field (chat, login, the ema textarea itself) owns bare
    // keystrokes — don't steal K from typing. Mirrors input.js's ADR-0027 guard.
    const _t = ev.target;
    if (_t && (_t.tagName === 'INPUT' || _t.tagName === 'TEXTAREA' || _t.tagName === 'SELECT' || _t.isContentEditable)) return;
    ev.preventDefault();
    // ADR-0031 diagnostic: log every hotkey press so a non-firing K is
    // distinguishable from a downstream guard (isPlaying / owner-check) failure.
    console.log('[kami] hotkey pressed, isPlaying=' + isPlaying() + ' phase=' + state.phase);
    // ADR-0029: Kami Mode is an in-arena authoring surface. It must NOT engage
    // on the title / pause / gameover screens — only while PLAYING (the arena +
    // the NAP zone, which lives inside PLAYING). The pause-modal button
    // (kamiCapture) still works from PAUSED because it calls openNote directly,
    // not through this hotkey. Guarding the hotkey on isPlaying() also closes the
    // title-re-entry bug: after exitKamiMode on PHASE_CHANGE→TITLE, a stray
    // K on the home screen no longer re-enters + re-shows the rack.
    if (!isPlaying()) return;
    if (ev.shiftKey) hangTray();
    // ADR-0029: Kami Mode is an in-arena authoring surface — K engages only
    // while PLAYING. ADR-0064: a bare K now opens the ema note directly on the
    // first press (openNote enters Kami Mode itself if not already active), so
    // the player can start typing at once — replacing the old 2-step "K to
    // enter, K again to note" flow. Enter on an open note seals + POSTs it
    // instantly (ADR-0042); Esc cancels. After either, the pointer is left free
    // (see openNote.finish) so the player can click the emagake rack. A repeat K
    // while a note is already open highlights it (ADR-0034) rather than no-op'ing.
    // Shift+K only retries the unsent (failed/pending).
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
/** ADR-0052: is a first-enter (async owner-check) currently pending? Distinct
 *  from kamiActive so an ema snapshot can tell a pending enter from a stuck
 *  active state. */
export function kamiEntering() { return _entering; }
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

// ADR-0042: test-only reset. vite.config runs the suite with
// poolOptions.threads.isolate:false, so test files in one worker share one
// kamiMode module registry — module-level state (_armed, _noteOpen, _tray,
// …) would otherwise leak from a file that entered KAMI into the next. Each
// kamiMode test file that mutates that state calls this in afterAll so it
// starts the next file from a clean slate. Not for production use.
export function __resetKamiForTests() {
  _installed = false;
  _tray = [];
  _noteOpen = false;
  _ownerCheck = null;
  _checkedPubkey = '';
  _isOwner = false;
  _armed = false;
  _kamiActive = false;
  _invincible = false;
  _entering = false;
  _enterToken = 0;
  _noteCleanup = null;
  _replyPollTimer = null;
  _shots.clear();
  _deps = null;
}
