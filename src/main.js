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
import { leaderboardPreviewBlock } from './engine/nostr/leaderboardPreview.js';
// v0.2.285 (M2): LIVE leaderboard publish — real NIP-07 sign + relay fan-out,
// gated by explicit consent AND the SEC-1 crypto-verified publishGate verdict.
import { createLiveLeaderboardPublisher, buildFinalRunScore } from './engine/leaderboard/livePublish.js';
import { summariseConsent } from './engine/consent/consentGate.js';
// v0.2.285 (M2): LIVE update-check — real read-only GitHub releases/latest fetch,
// cached client-side and failing closed to "unable to check"; NO auto-update.
import { checkForUpdateLive, liveStatusView } from './engine/update/liveUpdateCheck.js';
import { mvpLoopSummary } from './engine/mvpLoop.js';
// v0.2.251 (P0): live n2n world-presence transport + pure presence layer.
import { fanoutReq, signEvent, fanoutPublish, RELAYS } from './nostr.js';
import { fetchOnlineWorlds, buildPresenceEvent, publishOurPresence } from './engine/gateway/worldPresence.js';
// v0.2.252 (P1): signed n2n travel-request handshake — stateful controller + SEC-2 verify gate.
import { createHandshakeController } from './engine/gateway/handshakeController.js';
// v0.2.253 (P2): SEC-3 product URL hardening — the gate before any armed spawn URL becomes navigable.
import { hardenSpawnUrl, appendTraveller } from './engine/gateway/urlHarden.js';
// v0.2.274 (P2 cross-host hop): read + crypto-verify an arriving traveller's npub and seat them.
import { readArrivingTraveller } from './engine/gateway/handoffArrival.js';
import { buildGatewayFilter } from './engine/gateway/gatewayRead.js';
import { readTravelRequests } from './engine/gateway/travelRequest.js';
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
  const admit = _handshake.admitArrival(href, request ? { request } : {});
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

function _drawUpdateBlock(block) {
  const body = document.getElementById('update-preview-body');
  if (!body) return;
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

// LIVE update-check: paint an immediate "checking…" row, then resolve against the real
// GitHub releases/latest endpoint (cached client-side) and repaint. Failure / rate-limit /
// 404 degrade to an inert "UNABLE TO CHECK" — the card never breaks. No auto-update.
function renderUpdatePreview() {
  const body = document.getElementById('update-preview-body');
  if (!body) return;
  _drawUpdateBlock({ lines: [{ label: 'Status', value: 'CHECKING…' }] });
  const fetcher = (typeof window !== 'undefined' && typeof window.fetch === 'function')
    ? window.fetch.bind(window) : null;
  const storage = (typeof window !== 'undefined') ? window.localStorage : null;
  checkForUpdateLive({ fetcher, storage })
    .then((block) => _drawUpdateBlock(block))
    .catch(() => _drawUpdateBlock(liveStatusView({ latestVersion: null })));
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
