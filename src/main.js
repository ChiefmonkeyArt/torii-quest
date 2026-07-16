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
// v0.2.283 (M2): product surface promoted from read-only proof to a detail view
// + one real interaction — a LOCAL save keyed to the viewer's Nostr identity.
import { productDetailView } from './engine/components/productDetail.js';
import { isProductSaved, toggleProductSaved, savedCountFor } from './engine/components/savedProducts.js';
import { renderLeaderboardRows, shortenNpub } from './ui/leaderboardPanel.js';
import { talliesToCurrentEvents } from './engine/multiplayer/arenaLeaderboard.js';
// v0.2.285 (M2): LIVE leaderboard publish — real NIP-07 sign + relay fan-out,
// gated by explicit consent AND the SEC-1 crypto-verified publishGate verdict.
import { createLiveLeaderboardPublisher, buildFinalRunScore } from './engine/leaderboard/livePublish.js';
import { summariseConsent } from './engine/consent/consentGate.js';
// v0.2.285 (M2): LIVE update-check — real read-only GitHub releases/latest fetch,
// cached client-side and failing closed to "unable to check"; NO auto-update.
import { checkForUpdateLive, liveStatusView } from './engine/update/liveUpdateCheck.js';
// v0.2.387-alpha (UPD-2): capability-driven server-side "Update Now" flow. The
// client signs ONE fresh intent event and POSTs it; a root systemd runner does
// the actual reinstall. This module is pure/injectable — importing it touches
// nothing (no fetch, no DOM, no globals).
import {
  fetchCapability, requestUpdate, fetchStatus, isAdminOperator, deployCommand,
  DEPLOY_STALL_MS,
} from './engine/update/adminUpdateClient.js';
import { resolveMpHttpBase, getStoredToken } from './engine/multiplayer/sessionAuth.js';
import { mvpLoopSummary } from './engine/mvpLoop.js';
// v0.2.251 (P0): live n2n world-presence transport + pure presence layer.
import { fanoutReq, signEvent, fanoutPublish, RELAYS, readLatestAccessSettings, publishAccessSettings } from './nostr.js';
import { fetchOnlineWorlds, buildPresenceEvent, publishOurPresence } from './engine/gateway/worldPresence.js';
// v0.2.252 (P1): signed n2n travel-request handshake — stateful controller + SEC-2 verify gate.
import { createHandshakeController } from './engine/gateway/handshakeController.js';
// v0.2.253 (P2): SEC-3 product URL hardening — the gate before any armed spawn URL becomes navigable.
import { hardenSpawnUrl, appendTraveller } from './engine/gateway/urlHarden.js';
// v0.2.274 (P2 cross-host hop): read + crypto-verify an arriving traveller's npub and seat them.
import {
  readArrivingTraveller,
  ARRIVAL_MODE_PUBLIC,
  FOLLOW_POLICY_VISITOR_FOLLOWS_OWNER,
} from './engine/gateway/handoffArrival.js';
import { buildGatewayFilter } from './engine/gateway/gatewayRead.js';
import { readTravelRequests } from './engine/gateway/travelRequest.js';
// v0.2.358 (ACC-1): pure view-model + renderer for the title-screen Instance
// Settings shell (INERT: shown only to the logged-in instance admin; the Access
// section is a read-only "public + coming soon" placeholder).
import { buildInstanceSettingsModel, renderInstanceSettingsPanel, coerceEditableArrivalMode, coerceEditableWritePolicy } from './engine/ui/instanceSettings.js';
import { NAP_SPAWN_X, NAP_SPAWN_Z, NAP_SPAWN_YAW } from './config.js';

// ── Top-level screen visibility (three-free) ───────────────────────────────────
const elTitle = document.getElementById('screen-title');
const elHud   = document.getElementById('hud');
const elPause = document.getElementById('pause-overlay');
const elEnterBtn = document.getElementById('btn-enter');
const elNapBtn    = document.getElementById('btn-enter-nap'); // v0.2.275: NAP-zone shortcut

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
// v0.2.340: the #mvp-loop header was removed from the title screen's centre column
// during the card reorg, so there is nothing to render into. Call disabled (the
// function + mvpLoopSummary() are kept for tests / potential reuse).
// renderMvpLoop();

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
  // MP-1: gracefully close the multiplayer WebSocket before we navigate, so the
  // server logs a proper LEFT rather than a ping-timeout when we hop instances.
  try { _arena?.stopMultiplayer?.('travel'); } catch (e) { /* best-effort */ }
  try { window.location.href = target; } catch (e) { renderGatewayCard(); }
}

// ── P2 cross-host arrival: seat a crypto-verified inbound traveller ──────────────
// When a traveller jumps HERE from another host, their browser lands on our spawn
// URL carrying `?torii-traveller=<npub>` (urlHarden.appendTraveller). We seat the
// local session as that npub ONLY after re-reading their SIGNED travel request from
// relays and crypto-verifying it (handoffArrival.verifyArrival via the controller).
// Fails CLOSED: no host identity, no signed request, a tampered sig, or an already
// logged-in operator session → we do NOT seat (the visitor stays anon / unchanged).
const HEX64 = /^[0-9a-f]{64}$/;
let _inboundTraveller = (() => {
  const href = (typeof window !== 'undefined' && window.location && window.location.href) || '';
  const r = readArrivingTraveller(href);
  return r.ok ? r.pubkey : null;
})();

// _hostIdentity() — the deployed world's pubkey, used as `expectedHostPubkey` when
// verifying that an arriving request was addressed to US. A deployment sets it via
// `window.__toriiHostPubkey` (or a `<meta name="torii-host-pubkey">`). Absent → we
// cannot prove "addressed to us" and the arrival stays anon (fail closed).
function _hostIdentity() {
  if (typeof window !== 'undefined' && HEX64.test(window.__toriiHostPubkey || '')) return window.__toriiHostPubkey;
  const meta = typeof document !== 'undefined' ? document.querySelector('meta[name="torii-host-pubkey"]') : null;
  const v = meta && meta.getAttribute('content');
  return HEX64.test(v || '') ? v : '';
}

function _instanceId() {
  if (typeof window !== 'undefined' && typeof window.__toriiInstanceId === 'string' && window.__toriiInstanceId.trim()) {
    return window.__toriiInstanceId.trim();
  }
  const meta = typeof document !== 'undefined' ? document.querySelector('meta[name="torii-instance-id"]') : null;
  const v = meta && meta.getAttribute('content');
  if (typeof v === 'string' && v.trim()) return v.trim();
  const loc = (typeof window !== 'undefined' && window.location) ? window.location : null;
  const host = loc && typeof loc.host === 'string' ? loc.host.trim() : '';
  const path = loc && typeof loc.pathname === 'string' ? loc.pathname.replace(/\/+$/, '') || '/' : '/';
  return host ? `${host}${path}` : '';
}

function _arrivalMode() {
  if (typeof window === 'undefined') return ARRIVAL_MODE_PUBLIC;
  return typeof window.__toriiAccessMode === 'string' && window.__toriiAccessMode.trim()
    ? window.__toriiAccessMode.trim().toLowerCase()
    : ARRIVAL_MODE_PUBLIC;
}

function _followPolicy() {
  if (typeof window === 'undefined') return FOLLOW_POLICY_VISITOR_FOLLOWS_OWNER;
  return typeof window.__toriiAccessFollowPolicy === 'string' && window.__toriiAccessFollowPolicy.trim()
    ? window.__toriiAccessFollowPolicy.trim().toLowerCase()
    : FOLLOW_POLICY_VISITOR_FOLLOWS_OWNER;
}

async function _admitInboundTraveller() {
  if (!_inboundTraveller) return;
  // Do not hijack a logged-in operator's session — only an anonymous arrival seats.
  if (HEX64.test(state.nostrPubkey || '')) { _inboundTraveller = null; return; }
  const hostPubkey = _hostIdentity();
  if (!hostPubkey || hostPubkey === _inboundTraveller) { _inboundTraveller = null; return; }
  // Re-read the traveller's signed request addressed to us (cold-load: the
  // controller has no in-session record, so we fetch the proof from relays).
  const filter = buildGatewayFilter({ limit: 100 });
  filter['#p'] = [hostPubkey];
  filter.authors = [_inboundTraveller];
  let request = null;
  try {
    const raw = await fanoutReq(RELAYS, [filter], { timeoutMs: 5000, graceMs: 250, retries: 1 });
    const events = raw && Array.isArray(raw.events) ? raw.events : [];
    for (const rq of readTravelRequests(events).requests) {
      if (rq.travellerPubkey === _inboundTraveller) { request = rq; break; }
    }
  } catch { /* relay best-effort; no request → stay anon */ }
  const href = (window.location && window.location.href) || '';
  _handshake.setOurPubkey(hostPubkey);
  const admit = await _handshake.admitArrival(href, {
    ...(request ? { request } : {}),
    instanceId: _instanceId(),
    arrivalMode: _arrivalMode(),
    followPolicy: _followPolicy(),
  });
  if (admit.seated && HEX64.test(admit.npub || '')) {
    state.nostrPubkey = admit.npub;
    state.nostrName = admit.npub.slice(0, 8).toUpperCase();
    _handshake.setOurPubkey(admit.npub);
    emit(EV.NOSTR_LOGIN, { pubkey: admit.npub });
    renderGatewayCard();
  }
  _inboundTraveller = null;
}
_admitInboundTraveller();

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

let _presencePublishedPubkey = '';
async function publishOurWorldPresence() {
  const pubkey = state.nostrPubkey || '';
  if (!/^[0-9a-f]{64}$/.test(pubkey)) return;
  // v0.2.263: idempotent — NOSTR_LOGIN fires twice (once right after getPublicKey
  // in the login call, again from _fetchProfile() once the kind:0 profile resolves).
  // Without this guard each emit re-signs+republishes, popping the NIP-07 signer
  // twice on login (and a 3rd delayed pop the player sees around ENTER ARENA).
  // Publish at most once per pubkey per page load; the profile-refresh emit
  // still updates the UI but no longer re-signs.
  if (_presencePublishedPubkey === pubkey) return;
  _presencePublishedPubkey = pubkey;
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
  // v0.2.375-alpha — "1 sign at login, 0 signs in-game": the login-time presence
  // publish signed a kind:31111 event on every NOSTR_LOGIN (a 2nd signer prompt
  // beyond the arena auth). Presence is now the WS roster only; the n2n gateway
  // card is read-only. (publishOurWorldPresence remains available for a future
  // explicit, user-initiated publish, but is no longer auto-triggered.)
  refreshInstanceSettingsVisibility();
});

// ── Instance Settings (ACC-2b, v0.2.400) ───────────────────────────────────────
// Title-screen admin surface. The entry-point link stays UI-gated by
// isInstanceAdmin(); the saved access mode itself is secured by the signed
// kind:30078 settings event, verified on read before it can affect arrival.
const _elInstanceSettingsLink  = typeof document !== 'undefined' ? document.getElementById('instance-settings-link')  : null;
const _elInstanceSettingsPanel = typeof document !== 'undefined' ? document.getElementById('instance-settings-panel') : null;
const _elInstanceSettingsBackdrop = typeof document !== 'undefined' ? document.getElementById('instance-settings-backdrop') : null;
const _instanceSettingsState = {
  loading: false,
  saving: false,
  persisted: null,
  draftArrivalMode: null,
  draftWritePolicy: null,
  statusMessage: '',
  statusTone: '',
};

function _syncInstanceSettingsDraft() {
  const arrivalFallback = _instanceSettingsState.persisted && typeof _instanceSettingsState.persisted.arrivalMode === 'string'
    ? _instanceSettingsState.persisted.arrivalMode
    : _arrivalMode();
  const writeFallback = _instanceSettingsState.persisted && typeof _instanceSettingsState.persisted.writePolicy === 'string'
    ? _instanceSettingsState.persisted.writePolicy
    : 'owner-only';
  _instanceSettingsState.draftArrivalMode = coerceEditableArrivalMode(
    _instanceSettingsState.draftArrivalMode,
    coerceEditableArrivalMode(arrivalFallback, _arrivalMode()),
  );
  _instanceSettingsState.draftWritePolicy = coerceEditableWritePolicy(
    _instanceSettingsState.draftWritePolicy,
    coerceEditableWritePolicy(writeFallback, 'owner-only'),
  );
}

function _currentInstanceSettingsModel() {
  _syncInstanceSettingsDraft();
  return buildInstanceSettingsModel({
    operatorPubkey: state.nostrPubkey || '',
    hostPubkey: _hostIdentity(),
    arrivalMode: _arrivalMode(),
    followPolicy: _followPolicy(),
    persistedArrivalMode: _instanceSettingsState.persisted && _instanceSettingsState.persisted.arrivalMode,
    persistedFollowPolicy: _instanceSettingsState.persisted && _instanceSettingsState.persisted.followPolicy,
    persistedWritePolicy: _instanceSettingsState.persisted && _instanceSettingsState.persisted.writePolicy,
    persistedDelegateSet: _instanceSettingsState.persisted && _instanceSettingsState.persisted.delegateSet,
    selectedArrivalMode: _instanceSettingsState.draftArrivalMode,
    selectedWritePolicy: _instanceSettingsState.draftWritePolicy,
    hasSigner: typeof window !== 'undefined' && !!window.nostr && typeof window.nostr.signEvent === 'function',
    loading: _instanceSettingsState.loading,
    saving: _instanceSettingsState.saving,
    statusMessage: _instanceSettingsState.statusMessage,
    statusTone: _instanceSettingsState.statusTone,
  });
}

function _rerenderInstanceSettingsPanel() {
  if (!_elInstanceSettingsPanel || _elInstanceSettingsPanel.hidden) return;
  const model = _currentInstanceSettingsModel();
  if (!model.visible) {
    _closeInstanceSettingsPanel();
    return;
  }
  _elInstanceSettingsPanel.innerHTML = renderInstanceSettingsPanel(model);
}

async function _refreshInstanceSettingsAccessState() {
  const instanceId = _instanceId();
  const hostPubkey = _hostIdentity();
  _instanceSettingsState.loading = true;
  _instanceSettingsState.statusTone = 'muted';
  _instanceSettingsState.statusMessage = 'Reading saved access setting…';
  _rerenderInstanceSettingsPanel();
  if (!instanceId || !HEX64.test(hostPubkey)) {
    _instanceSettingsState.loading = false;
    _instanceSettingsState.persisted = null;
    _instanceSettingsState.statusTone = 'warn';
    _instanceSettingsState.statusMessage = 'No valid instance identity found — using this deploy default.';
    _syncInstanceSettingsDraft();
    _rerenderInstanceSettingsPanel();
    return;
  }
  const res = await readLatestAccessSettings({
    request: fanoutReq,
    relays: RELAYS,
    instanceId,
    ownerPubkey: hostPubkey,
    timeoutMs: 5000,
    graceMs: 250,
    retries: 1,
  });
  _instanceSettingsState.loading = false;
  if (res.ok && res.settings) {
    _instanceSettingsState.persisted = res.settings;
    _instanceSettingsState.draftArrivalMode = coerceEditableArrivalMode(res.settings.arrivalMode, _arrivalMode());
    _instanceSettingsState.draftWritePolicy = coerceEditableWritePolicy(res.settings.writePolicy, 'owner-only');
    _instanceSettingsState.statusTone = res.stale ? 'warn' : 'ok';
    _instanceSettingsState.statusMessage = res.stale
      ? 'Relay read failed — using the cached signed access setting.'
      : 'Loaded the latest valid signed access setting.';
  } else if (res.ok) {
    _instanceSettingsState.persisted = null;
    _instanceSettingsState.draftArrivalMode = coerceEditableArrivalMode(_arrivalMode(), _arrivalMode());
    _instanceSettingsState.draftWritePolicy = coerceEditableWritePolicy('owner-only', 'owner-only');
    _instanceSettingsState.statusTone = 'muted';
    _instanceSettingsState.statusMessage = 'No saved access setting yet — using this deploy default.';
  } else {
    _instanceSettingsState.persisted = res.settings || null;
    _instanceSettingsState.draftArrivalMode = coerceEditableArrivalMode(
      (res.settings && res.settings.arrivalMode) || _arrivalMode(),
      _arrivalMode(),
    );
    _instanceSettingsState.draftWritePolicy = coerceEditableWritePolicy(
      (res.settings && res.settings.writePolicy) || 'owner-only',
      'owner-only',
    );
    _instanceSettingsState.statusTone = 'warn';
    _instanceSettingsState.statusMessage = res.stale
      ? 'Relay read failed — using the cached signed access setting.'
      : 'Could not read a signed access setting — using this deploy default.';
  }
  _rerenderInstanceSettingsPanel();
}

async function _saveInstanceSettingsAccess() {
  const model = _currentInstanceSettingsModel();
  if (!model.visible || !model.canEditAccess) return;
  _instanceSettingsState.saving = true;
  _instanceSettingsState.statusTone = 'muted';
  _instanceSettingsState.statusMessage = 'Signing and publishing the access setting…';
  _rerenderInstanceSettingsPanel();
  const res = await publishAccessSettings({
    instanceId: _instanceId(),
    ownerPubkey: _hostIdentity(),
    arrivalMode: _instanceSettingsState.draftArrivalMode,
    followPolicy: _followPolicy(),
    writePolicy: _instanceSettingsState.draftWritePolicy,
    delegateSet: (_instanceSettingsState.persisted && _instanceSettingsState.persisted.delegateSet) || [],
    relays: RELAYS,
    sign: signEvent,
    publish: fanoutPublish,
    timeoutMs: 5000,
  });
  _instanceSettingsState.saving = false;
  if (!res.ok) {
    _instanceSettingsState.statusTone = 'warn';
    _instanceSettingsState.statusMessage = res.error === 'nip-07-unavailable'
      ? 'Connect a Nostr signer to save access changes.'
      : `Could not save access setting: ${(res && res.error) || 'unknown error'}`;
    _rerenderInstanceSettingsPanel();
    return;
  }
  _instanceSettingsState.persisted = res.settings;
  _instanceSettingsState.draftArrivalMode = coerceEditableArrivalMode(res.settings && res.settings.arrivalMode, _arrivalMode());
  _instanceSettingsState.draftWritePolicy = coerceEditableWritePolicy(res.settings && res.settings.writePolicy, 'owner-only');
  _instanceSettingsState.statusTone = 'ok';
  _instanceSettingsState.statusMessage = `Saved the signed access setting to ${res.accepted} relay${res.accepted === 1 ? '' : 's'}.`;
  _rerenderInstanceSettingsPanel();
}

function refreshInstanceSettingsVisibility() {
  if (!_elInstanceSettingsLink) return;
  const model = _currentInstanceSettingsModel();
  _elInstanceSettingsLink.hidden = !model.visible;
  if (!model.visible) _closeInstanceSettingsPanel();
}

function _openInstanceSettingsPanel() {
  if (!_elInstanceSettingsPanel) return;
  const model = _currentInstanceSettingsModel();
  if (!model.visible) return;
  _elInstanceSettingsPanel.innerHTML = renderInstanceSettingsPanel(model);
  _elInstanceSettingsPanel.hidden = false;
  if (_elInstanceSettingsBackdrop) _elInstanceSettingsBackdrop.hidden = false;
  _refreshInstanceSettingsAccessState();
}

function _closeInstanceSettingsPanel() {
  if (_elInstanceSettingsPanel) {
    _elInstanceSettingsPanel.hidden = true;
    _elInstanceSettingsPanel.innerHTML = '';
  }
  if (_elInstanceSettingsBackdrop) _elInstanceSettingsBackdrop.hidden = true;
}

if (_elInstanceSettingsLink) {
  _elInstanceSettingsLink.addEventListener('click', (e) => {
    e.preventDefault();
    _openInstanceSettingsPanel();
  });
}
if (_elInstanceSettingsPanel) {
  _elInstanceSettingsPanel.addEventListener('click', (e) => {
    const t = e && e.target;
    if (t && t.getAttribute && t.getAttribute('data-action') === 'close') {
      e.preventDefault();
      _closeInstanceSettingsPanel();
    }
  });
  _elInstanceSettingsPanel.addEventListener('change', (e) => {
    const t = e && e.target;
    if (!t || !t.matches) return;
    if (t.matches('input[name="arrival-mode"]')) {
      _instanceSettingsState.draftArrivalMode = coerceEditableArrivalMode(t.value, _arrivalMode());
    } else if (t.matches('input[name="write-policy"]')) {
      _instanceSettingsState.draftWritePolicy = coerceEditableWritePolicy(t.value, 'owner-only');
    } else {
      return;
    }
    _instanceSettingsState.statusMessage = '';
    _instanceSettingsState.statusTone = '';
    _rerenderInstanceSettingsPanel();
  });
  _elInstanceSettingsPanel.addEventListener('submit', (e) => {
    const t = e && e.target;
    if (!t || !t.getAttribute || t.getAttribute('data-form') !== 'access-settings') return;
    e.preventDefault();
    _saveInstanceSettingsAccess();
  });
}
if (_elInstanceSettingsBackdrop) {
  _elInstanceSettingsBackdrop.addEventListener('click', _closeInstanceSettingsPanel);
}
refreshInstanceSettingsVisibility();

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

// ── Title-screen proof cards (product / leaderboard / update) ───────────────────
// The product card (M2, v0.2.283) is now interactive: it shows a DETAIL view of
// the listing a traveller reaches through a gateway and offers ONE real action —
// a LOCAL save keyed to the viewer's verified Nostr identity (the arriving npub
// from the P2 gate, or a logged-in pubkey). Anon viewers see it read-only with a
// connect prompt. The save is client-side only (savedProducts.js): NOT a relay
// write, sign, or payment — so it needs no consent/sign gate. Marketplace checkout
// stays out-of-band (readOnly preserved).
const PRODUCT_FIXTURE = Object.freeze({
  title: 'Sticker Gun Skin',
  sellerNpub: 'npub1demo0seller0fixture0pleb0market0xxxxxxxxxxxxxxxxxxxx',
  priceSats: 2100,
  url: 'https://plebeian.market/listing/sticker-gun',
  reward: 'Sticker Gun skin',
  description: 'A bright Bitcoin-orange sticker wrap for your in-arena sidearm. '
    + 'Cosmetic only — owning the listing hints the skin; no entitlement is granted here.',
});

let _productDetailOpen = false;

function _drawRows(container, lines, labelCls, valueCls) {
  container.replaceChildren(...lines.flatMap(({ label, value }) => {
    const l = document.createElement('div');
    l.className = labelCls;
    l.textContent = label;
    const v = document.createElement('div');
    v.className = valueCls;
    v.textContent = value;
    return [l, v];
  }));
}

function renderProductPreview() {
  const body = document.getElementById('product-preview-body');
  if (!body) return;
  const viewer = HEX64.test(state.nostrPubkey || '') ? state.nostrPubkey : null;
  const storage = (typeof window !== 'undefined' && window.localStorage) || null;
  const saved = viewer ? isProductSaved(storage, viewer, PRODUCT_FIXTURE) : false;
  const view = productDetailView(PRODUCT_FIXTURE, { viewer, saved });

  // Summary rows (always visible): product / price / seller / marketplace link.
  const summary = view.lines.filter((l) => l.label !== 'About');
  _drawRows(body, summary, 'pp-row-label', 'pp-row-value');

  // Detail region (expandable): the full About description when present.
  const detail = document.getElementById('product-detail');
  if (detail) {
    const detailRows = view.lines.filter((l) => l.label === 'About' || l.label === 'Reward');
    _drawRows(detail, detailRows.length ? detailRows : [{ label: 'About', value: '—' }],
      'pp-row-label', 'pp-row-value');
    detail.hidden = !_productDetailOpen;
  }

  // Save button reflects the interaction view-model (enabled only for an identity).
  const saveBtn = document.getElementById('product-save-btn');
  if (saveBtn) {
    saveBtn.disabled = !view.interaction.enabled;
    saveBtn.textContent = view.interaction.label;
    saveBtn.setAttribute('aria-pressed', String(view.interaction.saved));
  }
  const statusEl = document.getElementById('product-save-status');
  if (statusEl) {
    if (!view.interaction.enabled) {
      statusEl.textContent = view.interaction.hint;
      statusEl.dataset.tone = 'muted';
    } else {
      const n = savedCountFor(storage, viewer);
      statusEl.textContent = view.interaction.saved
        ? `✓ saved · ${n} in your list` : (n ? `${n} saved in your list` : '');
      statusEl.dataset.tone = view.interaction.saved ? 'ok' : '';
    }
  }
}

function _toggleProductSave() {
  const viewer = HEX64.test(state.nostrPubkey || '') ? state.nostrPubkey : null;
  if (!viewer) return; // anon: button is disabled, but fail closed anyway
  const storage = (typeof window !== 'undefined' && window.localStorage) || null;
  toggleProductSaved(storage, viewer, PRODUCT_FIXTURE, Date.now());
  renderProductPreview();
}

(function wireProductCard() {
  const detailsBtn = document.getElementById('product-details-btn');
  if (detailsBtn) detailsBtn.addEventListener('click', () => {
    _productDetailOpen = !_productDetailOpen;
    detailsBtn.setAttribute('aria-expanded', String(_productDetailOpen));
    detailsBtn.textContent = _productDetailOpen ? 'HIDE DETAILS' : 'VIEW DETAILS';
    const detail = document.getElementById('product-detail');
    if (detail) detail.hidden = !_productDetailOpen;
  });
  const saveBtn = document.getElementById('product-save-btn');
  if (saveBtn) saveBtn.addEventListener('click', _toggleProductSave);
  on(EV.NOSTR_LOGIN, renderProductPreview);
})();
renderProductPreview();

// v0.2.384-alpha: the side-panel leaderboard is now HONEST — it renders the
// server-authoritative LOCAL tallies for this arena instance (the same SCORE
// ledger the in-arena LOCAL leaderboard uses), never fabricated names/numbers.
// Before any SCORE frame arrives (e.g. on the title screen, single-player) it
// shows a plain empty state instead of mock rows.
let _liveTallies = [];

function renderLeaderboardPreview() {
  const body = document.getElementById('leaderboard-preview-body');
  if (!body) return;
  const rows = renderLeaderboardRows(
    { current: talliesToCurrentEvents(_liveTallies, null, Date.now()), history: [] },
    5,
  );
  if (rows.length === 0) {
    const msg = document.createElement('div');
    msg.className = 'lb-empty';
    msg.textContent = 'No scores yet this session — play a match to get on the board.';
    body.replaceChildren(msg);
    return;
  }
  body.replaceChildren(...rows.flatMap((r) => {
    const l = document.createElement('div');
    l.className = 'lb-row-label';
    l.textContent = `#${r.rank} ${shortenNpub(r.npub)}`;
    const v = document.createElement('div');
    v.className = 'lb-row-value';
    v.textContent = `${r.kills}K · ${r.deaths}D · dmg ${r.damage}`;
    return [l, v];
  }));
}
renderLeaderboardPreview();
on(EV.SCORE_FRAME, (frame) => {
  _liveTallies = frame && Array.isArray(frame.tallies) ? frame.tallies : [];
  renderLeaderboardPreview();
});

// ── LIVE leaderboard publish (M2, v0.2.285) ────────────────────────────────────
// The promoted relay write. A consented, crypto-verified finalised score is signed
// via NIP-07 and fanned out to the configured RELAYS — reusing nostr.js seams
// through the SEC-1 publishGate (no ungated path). The button arms ONLY when the
// player is logged in; the click is the explicit consent, confirmed once more so
// the sign+publish stakes are never hidden. Status: idle → publishing → published
// / failed.
const _livePublisher = createLiveLeaderboardPublisher({
  sign: signEvent, publish: fanoutPublish, relays: RELAYS,
});
let _publishInFlight = false;

function _setLbPublishStatus(msg, tone) {
  const el = document.getElementById('leaderboard-publish-status');
  if (!el) return;
  el.textContent = msg || '';
  el.style.display = msg ? 'block' : 'none';
  el.dataset.tone = tone || '';
}

function _refreshLbPublishButton() {
  const btn = document.getElementById('leaderboard-publish-btn');
  if (!btn) return;
  const loggedIn = /^[0-9a-f]{64}$/.test(state.nostrPubkey || '');
  btn.disabled = !loggedIn || _publishInFlight;
  btn.textContent = _publishInFlight ? 'PUBLISHING…' : 'PUBLISH MY SCORE';
  if (!loggedIn) _setLbPublishStatus('login with Nostr to publish your score', 'muted');
  else if (!_publishInFlight && !document.getElementById('leaderboard-publish-status')?.textContent) {
    _setLbPublishStatus('', '');
  }
}

async function _publishMyScore() {
  if (_publishInFlight) return;
  const pubkey = state.nostrPubkey || '';
  if (!/^[0-9a-f]{64}$/.test(pubkey)) { _setLbPublishStatus('login with Nostr first', 'muted'); return; }

  // The finalised score snapshot for THIS run, from live state.
  const stats = buildFinalRunScore({ kills: state.kills | 0, hits: state.hits | 0 });

  // Explicit consent: the click plus a confirm that names the stakes (sign+publish).
  const consentLine = summariseConsent('leaderboard:submit');
  const consent = typeof window.confirm === 'function'
    ? window.confirm(`Publish to the leaderboard?\n\n${consentLine}\n\nScore ${stats.score} · ${stats.kills} kills`)
    : true;
  if (!consent) { _setLbPublishStatus('publish cancelled — consent not granted', 'muted'); _refreshLbPublishButton(); return; }

  _publishInFlight = true;
  _refreshLbPublishButton();
  _setLbPublishStatus('publishing to relays…', 'pending');
  let res;
  try {
    res = await _livePublisher.publishFinalScore(stats, { signerPubkey: pubkey, consent: true });
  } catch (e) {
    res = { ok: false, published: false, errors: ['unexpected error: ' + (e?.message || String(e))] };
  }
  _publishInFlight = false;
  _refreshLbPublishButton();
  if (res && res.published) {
    const relays = res.relay && Array.isArray(res.relay.used) ? res.relay.used.length : 0;
    _setLbPublishStatus(`✓ published to ${relays} relay${relays === 1 ? '' : 's'}`, 'ok');
  } else {
    _setLbPublishStatus('✗ ' + ((res && res.errors && res.errors.join('; ')) || 'publish failed'), 'fail');
  }
}

(function wireLeaderboardPublish() {
  const btn = document.getElementById('leaderboard-publish-btn');
  if (btn) btn.addEventListener('click', _publishMyScore);
  _refreshLbPublishButton();
  on(EV.NOSTR_LOGIN, _refreshLbPublishButton);
})();

// v0.2.387-alpha (UPD-2): the latest resolved view-model + the server capability
// signal, cached at module scope so `_refreshUpdateButton` can key off both
// without re-probing on every login event. Both `null` until their first probe
// resolves. `_updatePolling` guards against re-entrant status polls.
let _latestUpdateView = null;
let _updateCapability = null; // { autoUpdate, adminPubkey }
let _updatePolling = false;

function _drawUpdateBlock(block) {
  const body = document.getElementById('update-preview-body');
  if (!body) return;
  body.replaceChildren(...block.lines.flatMap((row) => {
    const { label, value, highlight } = row || {};
    const l = document.createElement('div');
    l.className = 'up-row-label';
    l.textContent = label;
    const v = document.createElement('div');
    v.className = highlight ? 'up-row-value up-row-value--new' : 'up-row-value';
    v.textContent = value;
    return [l, v];
  }));
}

// Paint the inert status line under the button (hidden when empty). aria-live so
// a screen reader announces poll transitions.
function _setUpdateStatusLine(text) {
  const el = document.getElementById('update-status-line');
  if (!el) return;
  const t = typeof text === 'string' ? text : '';
  el.textContent = t;
  el.hidden = !t;
}

// v0.2.390-alpha (UPD-3): ordered deploy stages for the progress bar. The
// connection-failure window (arena-ws restarting) maps to 'deploying'.
const _UPDATE_STEPS = ['requested', 'building', 'deploying', 'done'];
const _UPDATE_PCT = { requested: 20, building: 55, deploying: 80, done: 100, failed: 100, timeout: 90 };

// Drive the animated progress bar + step labels + status text as one call.
// `stage` ∈ requested|building|deploying|done|failed|timeout. Never throws.
function _setUpdateProgress(stage, text) {
  const wrap = document.getElementById('update-progress');
  const fill = document.getElementById('update-progress-fill');
  if (wrap) {
    wrap.hidden = false;
    wrap.classList.toggle('is-deploying', stage === 'deploying');
    wrap.classList.toggle('is-done', stage === 'done');
    wrap.classList.toggle('is-failed', stage === 'failed');
    const idx = _UPDATE_STEPS.indexOf(stage);
    wrap.querySelectorAll('#update-progress-steps span').forEach((el, i) => {
      el.classList.toggle('is-active', i === idx);
      el.classList.toggle('is-past', idx >= 0 && i < idx);
    });
  }
  if (fill) {
    const pct = _UPDATE_PCT[stage];
    if (Number.isFinite(pct)) fill.style.width = `${pct}%`;
  }
  _setUpdateStatusLine(text);
}

// Reset + hide the progress bar (button re-arm / idle).
function _clearUpdateProgress() {
  const wrap = document.getElementById('update-progress');
  const fill = document.getElementById('update-progress-fill');
  if (wrap) { wrap.hidden = true; wrap.classList.remove('is-deploying', 'is-done', 'is-failed'); }
  if (fill) fill.style.width = '0%';
  _setUpdateStatusLine('');
}

// v0.2.387-alpha (UPD-2): Update Now button + copy-fallback visibility rule.
// Fail-closed — nothing is shown unless the logged-in operator IS the configured
// admin AND the latest probe says an update is available. When auto-update is
// installed (capability.autoUpdate) the button is an ENABLED trigger; otherwise
// it is disabled and the copy-command fallback is revealed. Never throws.
function _refreshUpdateButton() {
  const btn = document.getElementById('update-upgrade-btn');
  const fallback = document.getElementById('update-copy-fallback');
  if (!btn) return;
  if (_updatePolling) return; // a run is in flight; leave the live UI untouched

  const view = _latestUpdateView;
  const cap = _updateCapability;
  const admin = !!(cap && isAdminOperator(state.nostrPubkey || '', cap.adminPubkey));
  const updateAvailable = !!(view && view.updateAvailable === true);
  const show = admin && updateAvailable;

  btn.hidden = !show;
  if (fallback) fallback.hidden = true;
  _clearUpdateProgress();

  if (!show) {
    btn.disabled = false;
    btn.textContent = '⬆ UPDATE NOW · CLICK HERE';
    return;
  }

  const auto = !!(cap && cap.autoUpdate === true);
  if (auto) {
    btn.disabled = false;
    btn.textContent = '⬆ UPDATE NOW · CLICK HERE';
  } else {
    // No auto-update installed on this instance — surface the manual command.
    btn.disabled = true;
    btn.textContent = 'AUTO-UPDATE NOT INSTALLED';
    if (fallback) {
      const cmd = document.getElementById('update-copy-cmd');
      if (cmd) cmd.textContent = deployCommand(view && view.latestVersion);
      fallback.hidden = false;
    }
  }
}

// Adapt nostr.js signEvent ({ok,event,error}) to the RETURN-or-throw contract the
// adminUpdateClient expects.
async function _signIntent(unsigned) {
  const r = await signEvent(unsigned);
  if (!r || !r.ok || !r.event) throw new Error(r && r.error ? r.error : 'sign failed');
  return r.event;
}

// v0.2.390-alpha (UPD-3): robust status poller that survives the arena-ws restart.
// A single fixed-cadence setInterval drives a small state machine (setTimeout is
// banned outside the allowlist per regression-check, so the reload delay and poll
// backoff are counted in ticks here rather than nested timers).
//
// The deploy restarts arena-ws for ~9s, during which /admin/update-status is
// unreachable and fetchStatus() returns { state:'unavailable' }. We treat that as
// the 'deploying' stage and KEEP polling (gentle backoff), instead of giving up.
// A terminal 'succeeded'/'failed' is only trusted once we've seen the NEW run make
// progress (or a short grace elapses), so a stale 'succeeded' left over from the
// previous deploy can't short-circuit the bar. On success we fill to 100%, show
// "Done — reloading", then location.reload() so the new bundle loads with no manual
// hard-refresh.
function _pollUpdateStatus(httpBase, token) {
  const TICK_MS = 500;
  const MAX_MS = 5 * 60 * 1000;   // safety timeout
  const GRACE_MS = 4000;          // ignore stale-terminal until a fresh run shows progress
  const RELOAD_MS = 1500;         // pause on 100% so the user sees "Done" before reload
  let elapsed = 0;
  let sincePoll = 0;
  let backoffMs = 1000;
  let sawProgress = false;
  let reloadCountdown = -1;
  let deployingSince = -1;        // elapsed when the DEPLOYING stall clock started

  const timer = setInterval(async () => {
    elapsed += TICK_MS;

    // Success → hold the full bar briefly, then hard reload.
    if (reloadCountdown >= 0) {
      reloadCountdown -= TICK_MS;
      if (reloadCountdown <= 0) { clearInterval(timer); location.reload(); }
      return;
    }

    if (elapsed >= MAX_MS) {
      clearInterval(timer);
      _updatePolling = false;
      _setUpdateProgress('timeout', 'timed out — hard-refresh to check, or click to retry');
      _armRetryButton();
      return;
    }

    sincePoll += TICK_MS;
    if (sincePoll < backoffMs) return; // wait out the current backoff window
    sincePoll = 0;

    const status = await fetchStatus({ httpBase, token });
    const st = status && typeof status.state === 'string' ? status.state : 'unavailable';
    const code = status && typeof status.code === 'number' ? status.code : 0;

    if (st === 'unavailable') {
      // arena-ws restarting (or briefly unreachable) — this IS the deploy, not a failure.
      sawProgress = true;
      if (deployingSince < 0) deployingSince = elapsed;
      // v0.2.393-alpha: recover instead of sticking. A 403 after we've seen progress
      // means a legacy gated server restarted and dropped our in-memory token — the
      // deploy almost certainly finished, so flip to DONE and reload. Likewise, if
      // DEPLOYING has run past the hard ceiling, assume the restart is done.
      if ((code === 403 && sawProgress) || (elapsed - deployingSince) >= DEPLOY_STALL_MS) {
        _setUpdateProgress('done', 'deploy complete — reloading');
        reloadCountdown = RELOAD_MS;
        return;
      }
      backoffMs = Math.min(backoffMs + 500, 3000);
      _setUpdateProgress('deploying', 'deploying — restarting arena (do not close)');
      return;
    }
    deployingSince = -1; // server answered cleanly — reset the stall clock
    backoffMs = 1000; // server answered — resume brisk polling

    if (st === 'succeeded' && (sawProgress || elapsed >= GRACE_MS)) {
      const ver = status && typeof status.targetRef === 'string' ? status.targetRef : '';
      _setUpdateProgress('done', ver ? `done — reloading ${ver}` : 'done — reloading');
      reloadCountdown = RELOAD_MS;
      return;
    }
    if (st === 'failed' && (sawProgress || elapsed >= GRACE_MS)) {
      clearInterval(timer);
      _updatePolling = false;
      const msg = (status && typeof status.message === 'string' && status.message)
        ? status.message : 'update failed on the host';
      _setUpdateProgress('failed', `update failed: ${msg} — click to retry`);
      _armRetryButton();
      return;
    }

    // In-progress (running / requested / pending) — advance the bar.
    if (st === 'running') { sawProgress = true; _setUpdateProgress('building', 'building the new version…'); }
    else { _setUpdateProgress('requested', 'update requested — starting runner…'); }
  }, TICK_MS);
}

// After a failed run, turn the Update Now button back into a live retry trigger.
function _armRetryButton() {
  const btn = document.getElementById('update-upgrade-btn');
  if (!btn) return;
  btn.hidden = false;
  btn.disabled = false;
  btn.textContent = '↻ RETRY UPDATE · CLICK HERE';
}

// v0.2.387-alpha (UPD-2): wire the Update Now click handler once. Idempotent.
// On click it signs a fresh intent, POSTs it with the session bearer token, then
// polls status. Disables the button so a double-click can't double-fire.
(function _wireUpdateButton() {
  const btn = document.getElementById('update-upgrade-btn');
  if (!btn || btn.dataset.wired === '1') return;
  btn.dataset.wired = '1';
  btn.addEventListener('click', async () => {
    if (btn.disabled || _updatePolling) return;
    const httpBase = resolveMpHttpBase();
    const token = getStoredToken();
    if (!httpBase || !token) {
      _setUpdateStatusLine('log in first to authorise an update');
      return;
    }
    btn.disabled = true;
    btn.textContent = 'REQUESTING…';
    _setUpdateProgress('requested', 'signing update request…');
    const res = await requestUpdate({ httpBase, token, signEvent: _signIntent });
    if (!res || !res.ok) {
      btn.disabled = false;
      btn.textContent = '⬆ UPDATE NOW · CLICK HERE';
      _clearUpdateProgress();
      _setUpdateStatusLine(`could not start update: ${(res && res.error) || 'unknown error'}`);
      return;
    }
    _updatePolling = true;
    btn.textContent = 'UPDATING…';
    _setUpdateProgress('requested', 'update requested — starting runner…');
    _pollUpdateStatus(httpBase, token);
  });
})();

// Wire the COPY button (manual-command fallback). Idempotent.
(function _wireCopyButton() {
  const btn = document.getElementById('update-copy-btn');
  if (!btn || btn.dataset.wired === '1') return;
  btn.dataset.wired = '1';
  btn.addEventListener('click', async () => {
    const cmd = document.getElementById('update-copy-cmd');
    const text = cmd ? cmd.textContent || '' : '';
    if (!text) return;
    try {
      if (navigator && navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
        await navigator.clipboard.writeText(text);
      }
      btn.textContent = 'COPIED';
    } catch { /* clipboard blocked — the command is visible for manual copy */ }
  });
})();

// Refresh button state whenever the login identity changes. The upstream
// NOSTR_LOGIN handler already fires on both admit + delayed-login.
on(EV.NOSTR_LOGIN, _refreshUpdateButton);

// LIVE update-check: paint an immediate "checking…" row, then resolve against the
// real GitHub TAGS endpoint (cached client-side) and repaint. In parallel, probe
// the server capability endpoint (public, no auth). Failure degrades to an inert
// "UNABLE TO CHECK" — the card never breaks.
function renderUpdatePreview() {
  const body = document.getElementById('update-preview-body');
  if (!body) return;
  _drawUpdateBlock({ lines: [{ label: 'Status', value: 'CHECKING…' }] });
  const fetcher = (typeof window !== 'undefined' && typeof window.fetch === 'function')
    ? window.fetch.bind(window) : null;
  const storage = (typeof window !== 'undefined') ? window.localStorage : null;

  const httpBase = resolveMpHttpBase();
  if (httpBase) {
    fetchCapability({ httpBase })
      .then((cap) => { _updateCapability = cap; _refreshUpdateButton(); })
      .catch(() => { _updateCapability = { autoUpdate: false, adminPubkey: null }; });
  }

  checkForUpdateLive({ fetcher, storage })
    .then((view) => { _latestUpdateView = view; _drawUpdateBlock(view); _refreshUpdateButton(); })
    .catch(() => {
      const view = liveStatusView({ latestVersion: null });
      _latestUpdateView = view;
      _drawUpdateBlock(view);
      _refreshUpdateButton();
    });
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

// v0.2.275: the ENTER ARENA handler. Shared bootstrap lives in ensureArenaReady
// below (hoisted, so callable here); on success it drops into the canonical SW
// arena spawn. The NAP button reuses the same bootstrap + sets a spawn override.
elEnterBtn?.addEventListener('click', async () => {
  if (!isTitle()) return;
  // v0.2.229: IMMEDIATE visible status before the async bootstrap so the click is
  // never a silent no-op (regression guard — tests assert a non-empty message here).
  showEntryStatus('Entering arena…');
  try {
    await ensureArenaReady('LOADING ARENA…');
  } catch { return; }
  showEntryStatus('');
  _arena.enter();
});

// v0.2.275: shared bootstrap for ENTER ARENA + ENTER NAP ZONE. Lazy-loads the
// three-vendor chunk + Rapier ONCE, then returns the ready arena API. Both title
// buttons call this before enter(); the NAP button additionally sets a one-shot
// spawn override so the player drops straight into the NAP far-left corner.
async function ensureArenaReady(loadingLabel) {
  if (_arenaBootstrapped) return _arena;
  elEnterBtn.textContent = loadingLabel;
  elEnterBtn.disabled = true;
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
    // v0.2.277: show the REAL error (bootstrapPhysics now throws a step-tagged
    // message; fall back to e.message for import/boot failures). The generic
    // message hid the actual failure.
    const real = (e && e.message) ? e.message : String(e);
    showEntryStatus(`⚠ Arena failed to load — ${real}`);
    throw e;
  }
  _arenaBootstrapped = true;
  return _arena;
}

function resetEnterButton() {
  if (elEnterBtn) {
    elEnterBtn.textContent = 'ENTER ARENA';
    elEnterBtn.disabled = false;
  }
}

// v0.2.275: ENTER NAP ZONE — same bootstrap, then a one-shot spawn override
// drops the player into the NAP far-left corner (config: NAP_SPAWN_*) facing
// west across the grass field, skipping the torii-gate walk.
elNapBtn?.addEventListener('click', async () => {
  if (!isTitle()) return;
  // IMMEDIATE visible status (mirrors ENTER ARENA) before the async bootstrap.
  showEntryStatus('Entering NAP zone…');
  try {
    await ensureArenaReady('LOADING NAP…');
  } catch { return; }
  showEntryStatus('');
  _arena.setSpawnOverride(NAP_SPAWN_X, NAP_SPAWN_Z, NAP_SPAWN_YAW);
  _arena.enter();
});
// ── Dev free-fly toggle (three-free, title-screen) ──────────────────────────────
// Reads/writes state.flyMode purely in the DOM before the arena boots; the ENTER
// handler enables ToriiDebug.fly when this is true. In-game F toggles also sync
// this button's label via the arena runtime's onToggle callback.
(function wireFlyToggle() {
  const btn = document.getElementById('btn-fly-toggle');
  if (!btn) return;
  const stateEl = btn.querySelector('.fly-switch-state');
  const paint = () => {
    const on = state.flyMode;
    btn.classList.toggle('is-on', on);
    btn.setAttribute('aria-checked', on ? 'true' : 'false');
    if (stateEl) stateEl.textContent = on ? 'ON' : 'OFF';
  };
  btn.addEventListener('click', () => { state.flyMode = !state.flyMode; paint(); });
  paint();
})();

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
