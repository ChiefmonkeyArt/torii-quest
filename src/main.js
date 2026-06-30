// main.js — shell wiring only. No game logic, NO THREE here.
//
// R2 (v0.2.264): the root shell / title screen is now three-free. Every three-
// dependent surface (scene/renderer, arena geometry, the game loop, players/bots/
// weapons, the in-world portal mesh + ToriiDebug) lives in ./arenaRuntime.js,
// which is `await import()`-ed ONLY inside the ENTER ARENA handler below. The
// ~610 KB three-vendor chunk is therefore deferred off first paint and paid on
// demand when the player actually enters the arena. The dashboard / title screen
// (gateway cards, product/leaderboard/update previews, login, char select, zone
// route notice) render with zero three in the synchronous import graph.
import { state, isTitle, isPlaying, transition, GAME_EVENT } from './state.js';
import { emit, on, EV } from './events.js';
// v0.2.236: install the REAL "LOGIN WITH NOSTR" handler before anything heavy. It
// has no THREE/scene deps and self-installs on import, so a loaded bundle wires
// login regardless of the (now deferred) 3D boot.
import './engine/ui/loginBootstrap.js';
import { showZoneNotice, hideZoneNotice } from './hud.js';
import { parseZoneRoute, ZONE_ROUTE_KIND } from './engine/gateway/zoneRoute.js';
import { applyPhaseScreens } from './engine/ui/phaseScreens.js';
import { productPreviewBlock } from './engine/components/productPreview.js';
import { leaderboardPreviewBlock } from './engine/nostr/leaderboardPreview.js';
import { updatePreviewBlock } from './engine/update/updatePreview.js';
import { mvpLoopSummary } from './engine/mvpLoop.js';
// v0.2.251 (P0): live n2n world-presence transport + pure presence layer.
import { fanoutReq, signEvent, fanoutPublish, RELAYS } from './nostr.js';
import { fetchOnlineWorlds, buildPresenceEvent, publishOurPresence } from './engine/gateway/worldPresence.js';
// v0.2.252 (P1): signed n2n travel-request handshake — stateful controller + SEC-2 verify gate.
import { createHandshakeController } from './engine/gateway/handshakeController.js';
// v0.2.253 (P2): SEC-3 product URL hardening — the gate before any armed spawn URL becomes navigable.
import { hardenSpawnUrl, appendTraveller } from './engine/gateway/urlHarden.js';

// ── Top-level screen visibility (three-free) ───────────────────────────────────
const elTitle = document.getElementById('screen-title');
const elHud   = document.getElementById('hud');
const elPause = document.getElementById('pause-overlay');
const elEnterBtn = document.getElementById('btn-enter');

// The single EV.PHASE_CHANGE subscriber: title / HUD / pause visibility is derived
// declaratively from the phase the FSM transitioned INTO. transition() stays the
// single source of phase change; this just reacts. (phaseScreens.js has no three.)
on(EV.PHASE_CHANGE, ({ to }) => applyPhaseScreens(to, { elTitle, elHud, elPause }));

// ── Entry-status line ──────────────────────────────────────────────────────────
const elEntryStatus = document.getElementById('entry-status');
function showEntryStatus(msg) {
  if (!elEntryStatus) return;
  elEntryStatus.textContent = msg || '';
  elEntryStatus.style.display = msg ? 'block' : 'none';
}

// ── MVP loop header (inert, content-only) ───────────────────────────────────────
function renderMvpLoop() {
  const flowEl = document.getElementById('mvp-loop-flow');
  const noteEl = document.getElementById('mvp-loop-note');
  if (!flowEl || !noteEl) return;
  const block = mvpLoopSummary();
  flowEl.textContent = block.flow;
  noteEl.textContent = block.note;
}
renderMvpLoop();

// ── Gateway / n2n world-presence LIVE card (v0.2.251, P0) ───────────────────────
// Live read of other Torii worlds advertising presence on shared relays. Read-only
// + safe: fanoutReq over wss relays → fetchOnlineWorlds → readGateways sanitisation.
// Never navigates, never signs (the write half runs only on explicit NIP-07 login).
function _setGatewayBadge(text) {
  const el = document.getElementById('gateway-preview-badge');
  if (el) el.textContent = text;
}

function _gatewayRows(...pairs) {
  const out = [];
  for (const [label, value] of pairs) {
    const l = document.createElement('div');
    l.className = 'gw-row-label';
    l.textContent = label;
    const v = document.createElement('div');
    v.className = 'gw-row-value';
    v.textContent = value;
    out.push(l, v);
  }
  return out;
}

// The live n2n handshake controller. Stateful but DOM-free; transports are the
// injected nostr.js fns; ourPubkey is empty until login.
const _handshake = createHandshakeController({
  request: fanoutReq, sign: signEvent, publish: fanoutPublish, relays: RELAYS, ourPubkey: '',
});
let _worldsCache = [];
let _worldsScan = 'idle';
let _handshakeFrame = 0;  // frame-throttled tick (shell rAF — no setTimeout in main.js)
let _presenceFrame = 0;   // frame-throttled presence re-scan (shell rAF)

function renderGatewayCard() {
  const body = document.getElementById('gateway-preview-body');
  if (!body) return;
  const v = _handshake.view();
  _setGatewayBadge(v.badge);
  if (v.mode !== 'scan') {
    body.replaceChildren(..._gatewayRows(...v.rows));
    _renderGatewayActions(body, v.actions);
    return;
  }
  if (_worldsScan === 'offline') {
    body.replaceChildren(..._gatewayRows(['SCAN', 'relays unreachable']));
    _renderGatewayActions(body, []);
    return;
  }
  if (_worldsScan === 'scanning' && !_worldsCache.length) {
    body.replaceChildren(..._gatewayRows(['SCAN', 'querying relays…']));
    _renderGatewayActions(body, []);
    return;
  }
  if (!_worldsCache.length) {
    const msg = state.nostrPubkey ? 'no other worlds online' : 'login to travel';
    body.replaceChildren(..._gatewayRows(['SCAN', msg]));
    _renderGatewayActions(body, []);
    return;
  }
  const canTravel = /^[0-9a-f]{64}$/.test(state.nostrPubkey || '');
  body.replaceChildren();
  const head = document.createElement('div');
  head.className = 'gw-row-label';
  head.textContent = `WORLDS · ${_worldsCache.length}`;
  const headV = document.createElement('div');
  headV.className = 'gw-row-value';
  headV.textContent = canTravel ? 'click to travel' : 'online';
  body.append(head, headV);
  for (const w of _worldsCache.slice(0, 24)) {
    const label = w.title || w.shortPubkey || w.zoneId || 'world';
    const row = document.createElement('div');
    row.className = canTravel ? 'gw-world-row gw-world-clickable' : 'gw-world-row';
    if (w.pubkey) row.setAttribute('data-pubkey', w.pubkey);
    row.textContent = (canTravel ? '→ ' : '  ') + label;
    if (canTravel) {
      row.setAttribute('role', 'button');
      row.setAttribute('tabindex', '0');
      row.setAttribute('aria-label', `travel to ${label}`);
      row.addEventListener('click', () => _gwTravel(w));
      row.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); _gwTravel(w); }
      });
    }
    const type = document.createElement('div');
    type.className = 'gw-row-value';
    type.textContent = w.zoneType || 'world';
    body.append(row, type);
  }
  _renderGatewayActions(body, []);
}

function _renderGatewayActions(body, actions) {
  if (!actions || !actions.length) return;
  const wrap = document.createElement('div');
  wrap.className = 'gw-actions';
  for (const a of actions) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'gw-btn';
    if (a === 'accept') { btn.classList.add('gw-btn-accept'); btn.textContent = 'ACCEPT'; btn.addEventListener('click', () => _gwAccept()); }
    else if (a === 'deny') { btn.classList.add('gw-btn-deny'); btn.textContent = 'DENY'; btn.addEventListener('click', () => _gwDeny()); }
    else if (a === 'jump') { btn.classList.add('gw-btn-jump'); btn.textContent = 'JUMP'; btn.addEventListener('click', () => _gwJump()); }
    else continue;
    wrap.append(btn);
  }
  body.append(wrap);
}

async function _gwTravel(world) {
  await _handshake.requestTravel(world);
  renderGatewayCard();
}
async function _gwAccept() {
  await _handshake.respondIncoming(true, { spawn: 'https://quest-torii.pplx.app' });
  renderGatewayCard();
}
async function _gwDeny() {
  await _handshake.respondIncoming(false);
  renderGatewayCard();
}
function _gwJump() { _executeJump(); }

// _executeJump() — the n2n hop. Reachable ONLY after SEC-2 (signed accept) armed
// the spawn. SEC-3 then hardens the spawn URL before the ONE navigation site in
// the whole gateway flow touches window.location. Fails closed.
function _executeJump() {
  const snap = _handshake.snapshot();
  const armed = snap && snap.armed;
  if (!armed) { renderGatewayCard(); return; }
  const spawn = armed.spawn || 'https://quest-torii.pplx.app';
  const hardened = hardenSpawnUrl(spawn);
  if (!hardened.ok) {
    _handshake.clearArmed();
    renderGatewayCard();
    return;
  }
  const withTraveller = appendTraveller(hardened.url, state.nostrPubkey || '');
  const target = withTraveller.ok ? withTraveller.url : hardened.url;
  _handshake.clearArmed();
  try { window.location.href = target; } catch (e) { renderGatewayCard(); }
}

async function refreshOnlineWorlds() {
  _worldsScan = 'scanning';
  if (!_worldsCache.length) renderGatewayCard();
  const r = await fetchOnlineWorlds({
    request: fanoutReq,
    relays: RELAYS,
    ourPubkey: state.nostrPubkey || '',
    timeoutMs: 5000,
    graceMs: 250,
    retries: 1,
  });
  if (!r.ok) {
    _worldsScan = 'offline';
    _worldsCache = [];
    renderGatewayCard();
    return;
  }
  _worldsCache = r.worlds || [];
  _worldsScan = 'idle';
  renderGatewayCard();
}

async function publishOurWorldPresence() {
  const pubkey = state.nostrPubkey || '';
  if (!/^[0-9a-f]{64}$/.test(pubkey)) return;
  const built = buildPresenceEvent({
    pubkey,
    zoneId: 'quest-torii',
    title: 'Torii Quest',
    zoneType: 'arena',
    website: 'https://quest-torii.pplx.app',
    relays: RELAYS,
  });
  if (!built.ok) return;
  await publishOurPresence({
    unsigned: built.event,
    sign: signEvent,
    publish: fanoutPublish,
    relays: RELAYS,
    timeoutMs: 5000,
  });
  refreshOnlineWorlds();
}

function renderGatewayPreview() {
  renderGatewayCard();
  refreshOnlineWorlds();
}
renderGatewayPreview();

on(EV.NOSTR_LOGIN, () => {
  _handshake.setOurPubkey(state.nostrPubkey || '');
  renderGatewayCard();
  publishOurWorldPresence();
});

// ── Canonical /#/zone/<slug> hash route resolution (inert notice only) ──────────
function _applyZoneRoute() {
  const loc = window.location || {};
  const hash = typeof loc.hash === 'string' ? loc.hash : '';
  const input = hash ? `/${hash}` : (loc.pathname || '/');
  const r = parseZoneRoute(input);
  if (r.kind === ZONE_ROUTE_KIND.HOME) hideZoneNotice();
  else showZoneNotice(r.notice);
  return r;
}
_applyZoneRoute();
window.addEventListener('popstate', _applyZoneRoute);
window.addEventListener('hashchange', _applyZoneRoute);

// ── Inert read-only title-screen proof cards (product / leaderboard / update) ───
function renderProductPreview() {
  const body = document.getElementById('product-preview-body');
  if (!body) return;
  const block = productPreviewBlock({
    title: 'Sticker Gun Skin',
    sellerNpub: 'npub1demo0seller0fixture0pleb0market0xxxxxxxxxxxxxxxxxxxx',
    priceSats: 2100,
    url: 'https://plebeian.market/listing/sticker-gun',
    reward: 'Sticker Gun skin',
  });
  body.replaceChildren(...block.lines.flatMap(({ label, value }) => {
    const l = document.createElement('div');
    l.className = 'pp-row-label';
    l.textContent = label;
    const v = document.createElement('div');
    v.className = 'pp-row-value';
    v.textContent = value;
    return [l, v];
  }));
}
renderProductPreview();

function renderLeaderboardPreview() {
  const body = document.getElementById('leaderboard-preview-body');
  if (!body) return;
  const block = leaderboardPreviewBlock(
    [
      { runId: 'plebshot', score: 240, kills: 20, headshots: 11, accuracy: 0.71 },
      { runId: 'nostrich', score: 180, kills: 16, headshots: 7, accuracy: 0.64 },
      { runId: 'chiefmonkey', score: 120, kills: 12, headshots: 5, accuracy: 0.58 },
    ],
    { signerNpub: 'npub1demo0player0fixture0torii0quest0xxxxxxxxxxxxxxxxxxxx', limit: 3 },
  );
  body.replaceChildren(...block.lines.flatMap(({ label, value }) => {
    const l = document.createElement('div');
    l.className = 'lb-row-label';
    l.textContent = label;
    const v = document.createElement('div');
    v.className = 'lb-row-value';
    v.textContent = value;
    return [l, v];
  }));
}
renderLeaderboardPreview();

function renderUpdatePreview() {
  const body = document.getElementById('update-preview-body');
  if (!body) return;
  const block = updatePreviewBlock({
    tag_name: 'v0.2.999-alpha',
    name: 'Torii Quest v0.2.999-alpha',
    html_url: 'https://github.com/torii-quest/torii-quest/releases/tag/v0.2.999-alpha',
    body: 'Sample release notes (local fixture) — bigger arena, nostrich skins, Chiefmonkey balance.',
    prerelease: true,
    published_at: '2026-06-24T00:00:00Z',
  });
  body.replaceChildren(...block.lines.flatMap(({ label, value }) => {
    const l = document.createElement('div');
    l.className = 'up-row-label';
    l.textContent = label;
    const v = document.createElement('div');
    v.className = 'up-row-value';
    v.textContent = value;
    return [l, v];
  }));
}
renderUpdatePreview();

// ── Character selector ──────────────────────────────────────────────────────────
// Stash the chosen character key (default 'chiefmonkey') so the arena runtime can
// apply it after it is lazily imported — selecting a model must NOT pull THREE in.
let _selectedCharacter = null;
document.querySelectorAll('.char-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.char-btn').forEach(b => {
      b.style.border = '1.5px solid #4a5568';
      b.style.background = '#0f0f1a';
      b.style.color = '#a0aec0';
    });
    btn.style.border = '1.5px solid #8b5cf6';
    btn.style.background = '#1a0a2e';
    btn.style.color = '#e2d8f0';
    _selectedCharacter = btn.dataset.char;
    // If the arena is already loaded, apply immediately; otherwise it is applied
    // when arenaRuntime is imported in the ENTER handler.
    _arena?.setCharacter?.(_selectedCharacter);
  });
});

// ── ENTER ARENA — the ONE place THREE is loaded ─────────────────────────────────
// On first click we `await import('./arenaRuntime.js')` (the three-vendor chunk
// loads HERE, deferred off first paint), build the scene + start the render loop,
// then lazy-load Rapier + spawn the player. Subsequent entries just start a fresh
// run. A failed bootstrap resets the button + shows a visible message.
let _arena = null;            // arenaRuntime API once imported
let _arenaBootstrapped = false;

function resetEnterButton() {
  if (elEnterBtn) {
    elEnterBtn.textContent = 'ENTER ARENA';
    elEnterBtn.disabled = false;
  }
}

elEnterBtn?.addEventListener('click', async () => {
  if (!isTitle()) return;

  if (!_arenaBootstrapped) {
    elEnterBtn.textContent = 'LOADING ARENA…';
    elEnterBtn.disabled = true;
    showEntryStatus('Entering arena…');
    try {
      if (!_arena) {
        // ← THE deferred three-vendor load. Nothing the shell imports touches three.
        const mod = await import('./arenaRuntime.js');
        _arena = mod.createArenaRuntime({
          showEntryStatus,
          resetEnterButton,
          getGatewayScreenState: () => ({
            worlds: _worldsCache,
            scanStatus: _worldsScan,
            canTravel: /^[0-9a-f]{64}$/.test(state.nostrPubkey || ''),
            onTravel: (w) => _gwTravel(w),
          }),
        });
        _arena.boot();
        if (_selectedCharacter) _arena.setCharacter(_selectedCharacter);
      }
      await _arena.bootstrapPhysics();
    } catch (e) {
      console.error('Arena bootstrap failed:', e);
      elEnterBtn.textContent = 'ENTER ARENA';
      elEnterBtn.disabled = false;
      showEntryStatus('⚠ Arena failed to load — please reload the page and try again.');
      return;
    }
    _arenaBootstrapped = true;
  }
  showEntryStatus('');
  _arena.enter();
});
// v0.2.230: signal the index.html inline fallback that the REAL ENTER handler is
// bound, so it stands down. The shell wires this synchronously (no three), so the
// flag is raised even though the 3D runtime is now deferred behind ENTER.
window.__toriiEnterReady = true;

// ── Title-screen ticker (three-free) ────────────────────────────────────────────
// The n2n handshake + presence polling used to ride the game loop, which ran from
// page load. With the loop now deferred behind ENTER (R2), the shell owns its own
// lightweight rAF ticker so the title-screen gateway card keeps polling BEFORE the
// arena is ever booted (and again after returning Home). Frame-throttled, guarded
// to NOT poll while playing (the in-arena loop owns those frames). rAF only — no
// window timers here (regression check [3] confines those to nostr.js + hud.js).
function _shellTick() {
  if (!isPlaying() && state.nostrPubkey) {
    if (++_handshakeFrame >= 120) {
      _handshakeFrame = 0;
      _handshake.tick().then(renderGatewayCard).catch(() => {});
    }
    if (++_presenceFrame >= 600) {
      _presenceFrame = 0;
      refreshOnlineWorlds().catch(() => {});
    }
  }
  requestAnimationFrame(_shellTick);
}
requestAnimationFrame(_shellTick);
