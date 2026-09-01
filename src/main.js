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
import { showZoneNotice, hideZoneNotice, showFlyNotice } from './hud.js';
import { parseZoneRoute, ZONE_ROUTE_KIND } from './engine/gateway/zoneRoute.js';
import { applyPhaseScreens } from './engine/ui/phaseScreens.js';
import { renderLeaderboardRows, shortenNpub } from './ui/leaderboardPanel.js';
import { talliesToCurrentEvents } from './engine/multiplayer/arenaLeaderboard.js';
import {
  createScoreReporter, SCORE_D_TAG, SCORE_HISTORY_T_TAG,
  SCORE_KIND_ADDRESSABLE, SCORE_KIND_HISTORY,
} from './engine/multiplayer/scoreReporter.js';
import {
  loadLatestScoreFrame, normaliseScoreFrame, saveLatestScoreFrame,
} from './engine/multiplayer/scoreSessionStore.js';
import { verifyNostrEventSig } from './engine/crypto/nostrSig.js';
// v0.2.285 (M2): LIVE leaderboard publish — real NIP-07 sign + relay fan-out,
// gated by explicit consent AND the SEC-1 crypto-verified publishGate verdict.
import { createLiveLeaderboardPublisher, buildFinalRunScore } from './engine/leaderboard/livePublish.js';
import { createGamestrPublisher } from './engine/gamestr/gamestrPublisher.js';
import { GAMESTR_RELAYS, GAMESTR_KIND, GAMESTR_GAME_ID } from './engine/gamestr/gamestrScore.js';
import { buildGamestrLeaderboard } from './engine/gamestr/gamestrLeaderboard.js';
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
import { fetchBeaconState, setBeacon } from './engine/presence/beaconClient.js';
import { mvpLoopSummary } from './engine/mvpLoop.js';
// v0.2.251 (P0): live n2n world-presence transport + pure presence layer.
import { fanoutReq, signEvent, fanoutPublish, fetchOwnerProfileName, fetchOwnProfile, fetchOwnCharacter, publishCharacter, uploadBlossom, readLatestAccessSettings, publishAccessSettings } from './nostr.js';
import { fetchOnlineWorlds, buildPresenceEvent, publishOurPresence } from './engine/gateway/worldPresence.js';
// Phase 0d: node presence heartbeat — pure timing + status helpers + the
// node-relay config reader. Pure + node-safe; main.js injects `now` (epoch ms)
// and the rAF shell tick drives the republish (NO setTimeout in new code).
import { isHeartbeatDue, isFirstPublishDue, nextHeartbeatInMs, heartbeatStatus, isHeartbeatBroadcasting, HEARTBEAT_INTERVAL_MS, FIRST_PUBLISH_RETRY_MS } from './engine/presence/heartbeat.js';
// v0.2.403-alpha: pure partition of online worlds into "your friends" (mutual
// follows) + "arenas" (everything else, created_at DESC). main.js fetches the
// kind:3 contact lists; this classifies + sorts.
import {
  partitionGatewaySections, candidateFriendOwners, contactSetFromEvent,
  newestContactEvent, SECTION_ROW_CAP,
} from './engine/gateway/gatewaySections.js';
// v0.2.252 (P1): signed n2n travel-request handshake — stateful controller + SEC-2 verify gate.
import { createHandshakeController } from './engine/gateway/handshakeController.js';
// v0.2.253 (P2): SEC-3 product URL hardening — the gate before any armed spawn URL becomes navigable.
import { hardenSpawnUrl, appendTraveller } from './engine/gateway/urlHarden.js';
// Phase 0 (open-world): the OPEN-VISIT travel path — a pure leaf that turns a
// world's https `website` into a hardened, traveller-tagged visit URL. This is
// the DEFAULT n2n hop now (direct navigate, no signed handshake). The signed
// handshake code below stays in place but UNUSED — reserved for an optional
// future private/invite-only travel mode.
import { buildVisitUrl } from './engine/gateway/openVisit.js';
// Phase 0c: the canonical NAP-zone slug validator (used to forward zoneSlug on
// travel so visiting lands in the destination NAP zone).
import { isValidZoneSlug } from './engine/gateway/zoneRoute.js';
// Phase 0c: the persistent Torii menu — DOM presentation layer + pure
// sub-partitioner + owner-admin localStorage prefs. The menu renders from a
// getState() snapshot main.js owns; it never fetches/signs/navigates on its own.
import { openToriiMenu, closeToriiMenu, isToriiMenuOpen } from './engine/menu/toriiMenu.js';
import { openSettingsPanel, closeSettingsPanel, isSettingsPanelOpen, registerSettingsTabRenderer, renderActiveSettingsTab } from './engine/settings/settingsPanel.js';
import { renderGatewaySetupPanel } from './engine/settings/gatewaySetupPanel.js';
import { renderHeartbeatPanel } from './engine/settings/heartbeatPanel.js';
import { renderRelayPanel } from './engine/settings/relayPanel.js';
import { renderProfilePanel } from './engine/settings/profilePanel.js';
import { renderCharacterForgePanel } from './engine/settings/characterForgePanel.js';
import { CHARACTER_PRESETS, getCharacterPreset, presetToManifest } from './engine/character/characterPresets.js';
import { resolveCharacterMeshUrl } from './engine/character/characterMesh.js';
import { addSticker, removeSticker, STICKER_LIBRARY } from './engine/character/stickerPlacement.js';
// v0.2.712 (ADR-0078): the Access tab re-surfaces the existing signed kind:30078
// access-control surface (arrival authority + write authority) that was hidden
// since v0.2.676. The view-model + renderer are the unchanged instanceSettings.js
// from v0.2.358; main.js owns the read/save relay round-trips below.
import { buildInstanceSettingsModel, renderInstanceSettingsPanel, coerceEditableArrivalMode, coerceEditableWritePolicy } from './engine/ui/instanceSettings.js';
import { buildProfileMetadataEvent } from './engine/identity/profileMetadata.js';
import { getProfileDraft, setProfileDraft } from './engine/identity/profileDraft.js';
import { resolveToriiOwnerLabel } from './engine/identity/toriiOwnerLabel.js';
// Phase 0g: the "Gateway setup" homepage stub — a three-free DOM overlay (mirrors
// toriiMenu.js) presenting the 4 operator/visitor entry actions. main.js owns
// the state + every callback; the stub is a pure renderer. No timer primitives,
// no three import, browser-only, fail-safe (missing document → no-op).
// v0.3: openHomepageStub/closeHomepageStub/isHomepageStubOpen (the old
// standalone overlay renderer) are no longer imported — Gateway Setup is now
// a tab in the new settings panel (gatewaySetupPanel.js). The session-once
// auto-open flag helpers (hasShownThisSession/setShownThisSession) were removed
// with the auto-open itself in ADR-0063.
import { classifySections } from './engine/menu/menuSections.js';
import { getHeartbeatIntent, setHeartbeatIntent, getActiveWorld, setActiveWorld, getNodeRelays, setNodeRelays, readEffectiveNodeRelays, getGamestrEnabled, setGamestrEnabled } from './engine/menu/adminPrefs.js';
// v0.2.274 (P2 cross-host hop): read + crypto-verify an arriving traveller's npub and seat them.
import {
  readArrivingTraveller,
  ARRIVAL_MODE_PUBLIC,
  FOLLOW_POLICY_VISITOR_FOLLOWS_OWNER,
} from './engine/gateway/handoffArrival.js';
import { buildGatewayFilter } from './engine/gateway/gatewayRead.js';
import { readTravelRequests } from './engine/gateway/travelRequest.js';
// v0.3: the Instance Settings tab (arrival-mode / write-policy admin
// controls) is REMOVED from the settings menu per design direction — not
// useful to admins or guests. instanceSettings.js's underlying access-control
// enforcement (handoffArrival.js / writeAuthority.js) is untouched; only
// this title-screen EDITING surface and its import are gone.
import {
  NAP_SPAWN_X, NAP_SPAWN_Z, NAP_SPAWN_YAW, SCORE_PUBLISH_ENABLED, GAMESTR_ENABLED,
} from './config.js';
import { mark, startPhase, endPhase, resetTimings, logReport } from './engine/debug/bootTiming.js';

// ── Top-level screen visibility (three-free) ───────────────────────────────────
const elTitle = document.getElementById('screen-title');
const elHud   = document.getElementById('hud');
const elPause = document.getElementById('pause-overlay');
// v0.3 cleanup: ENTER ARENA + ENTER NAP ZONE merged into the single
// #btn-enter-nap button (everyone drops into the NAP zone by default). The
// old #btn-enter element no longer exists in index.html.
const elNapBtn    = document.getElementById('btn-enter-nap');
const elToriiMenuBtn = document.getElementById('btn-torii-menu'); // Phase 0c: persistent menu

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
  request: fanoutReq, sign: signEvent, publish: fanoutPublish, relays: _effectiveRelays(), ourPubkey: '',
});
let _worldsCache = [];
let _worldsScan = 'idle';
// Friend-detection cache, refreshed on the _worldsScan cadence. `_userContacts`
// is the logged-in user's follow set (newest kind:3); `_ownerContacts` maps each
// candidate world-owner to their follow set. Empty when logged out or on relay
// failure — arenas still renders, friends just degrades to empty.
let _userContacts = new Set();
let _ownerContacts = new Map();
let _handshakeFrame = 0;  // frame-throttled tick (shell rAF — no setTimeout in main.js)
let _presenceFrame = 0;   // frame-throttled presence re-scan (shell rAF)
let _heartbeatFrame = 0;  // frame-throttled heartbeat republish check (Phase 0d, shell rAF)

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
  const { friends, arenas } = partitionGatewaySections({
    worlds: _worldsCache,
    userPubkey: canTravel ? state.nostrPubkey : '',
    userContacts: _userContacts,
    ownerContacts: _ownerContacts,
  });
  // "your friends" — mutual-follow worlds. Logged out: a safe login hint instead.
  if (canTravel) {
    _renderGatewaySection(body, 'your friends', friends, canTravel,
      friends.length ? '' : 'no mutual friends online');
  } else {
    _renderGatewaySectionHeader(body, 'your friends', 'login to see friends');
  }
  // "arenas" — everything else, latest signal first.
  _renderGatewaySection(body, 'arenas', arenas, canTravel,
    arenas.length ? '' : 'no arenas online');
  _renderGatewayActions(body, []);
}

// Section header row (label + value), full pair in the 2-col grid. Pure DOM.
function _renderGatewaySectionHeader(body, title, hint) {
  const head = document.createElement('div');
  head.className = 'gw-section-title';
  head.textContent = title;
  const headV = document.createElement('div');
  headV.className = 'gw-row-value';
  headV.textContent = hint;
  body.append(head, headV);
}

// Render one section: a header, up to SECTION_ROW_CAP travel rows, and a "+N more"
// overflow summary line when the section has more worlds than the cap.
function _renderGatewaySection(body, title, worlds, canTravel, emptyHint) {
  _renderGatewaySectionHeader(body, title, emptyHint || `${worlds.length}`);
  const shown = worlds.slice(0, SECTION_ROW_CAP);
  for (const w of shown) {
    const label = w.title || w.shortPubkey || w.zoneId || 'world';
    const row = document.createElement('div');
    row.className = canTravel ? 'gw-world-row gw-world-clickable' : 'gw-world-row';
    if (w.pubkey) row.setAttribute('data-pubkey', w.pubkey);
    row.textContent = (canTravel ? '→ ' : '  ') + label;
    if (canTravel) {
      row.setAttribute('role', 'button');
      row.setAttribute('tabindex', '0');
      row.setAttribute('aria-label', `travel to ${label}`);
      row.addEventListener('click', () => _gwOpenVisit(w, { zoneSlug: isValidZoneSlug(w.zoneId) ? w.zoneId : null }));
      row.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); _gwOpenVisit(w, { zoneSlug: isValidZoneSlug(w.zoneId) ? w.zoneId : null }); }
      });
    }
    const type = document.createElement('div');
    type.className = 'gw-row-value';
    type.textContent = w.zoneType || 'world';
    body.append(row, type);
  }
  const overflow = worlds.length - shown.length;
  if (overflow > 0) {
    const more = document.createElement('div');
    more.className = 'gw-more';
    more.textContent = `+${overflow} more`;
    body.append(more);
  }
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

// ── Phase 0c: persistent Torii menu state ─────────────────────────────────────
// _getToriiMenuState() builds the snapshot the menu renders from. main.js owns ALL
// the data (the live presence scan, the contact partition, the owner detection,
// the admin prefs); the menu is a pure presentation layer. onTravel forwards the
// destination world's zoneId as zoneSlug so visiting lands in the NAP zone.
const _SHIPPED_WORLDS = Object.freeze([
  { id: 'gateway-blank', name: 'Torii Gateway — Blank' },
  { id: 'chiefmonkey-template', name: 'Chiefmonkey Template' },
]);

function _getToriiMenuState() {
  const canTravel = /^[0-9a-f]{64}$/.test(state.nostrPubkey || '');
  const { friends, following, games, all } = classifySections({
    worlds: _worldsCache,
    userPubkey: canTravel ? state.nostrPubkey : '',
    userContacts: _userContacts,
    ownerContacts: _ownerContacts,
  });
  const cap = _updateCapability;
  const isOwner = !!(cap && isAdminOperator(state.nostrPubkey || '', cap.adminPubkey));
  const hasSigner = typeof window !== 'undefined' && !!window.nostr && typeof window.nostr.signEvent === 'function';
  const nodeRelays = _effectiveRelays();
  const heartbeatIntent = getHeartbeatIntent();
  const heartbeat = heartbeatStatus({
    intent: heartbeatIntent,
    isOwner,
    hasSigner,
    nodeRelays,
    lastPublishedAt: _heartbeat.lastPublishedAt,
    now: Date.now(),
    lastError: _heartbeat.lastError,
    republishPaused: _heartbeat.republishPaused,
  });
  const nextDueMs = nextHeartbeatInMs({
    lastPublishedAt: _heartbeat.lastPublishedAt,
    now: Date.now(),
    intervalMs: HEARTBEAT_INTERVAL_MS,
  });
  // ADR-0094: when the server beacon is enabled the SERVER publishes presence
  // 24/7 — surface that truth instead of the now-client-gated heartbeat status
  // (which would otherwise read 'idle' even though the world is live).
  const serverBeaconEnabled = _beacon.state.enabled === true;
  const effectiveHeartbeat = serverBeaconEnabled ? 'live' : heartbeat;
  return {
    scanStatus: _worldsScan,
    canTravel,
    friends,
    following,
    games,
    all,
    isOwner,
    admin: {
      heartbeatIntent,
      heartbeatStatus: effectiveHeartbeat,
      serverBeaconEnabled,
      heartbeatLastPublishedAt: _heartbeat.lastPublishedAt,
      heartbeatNextDueMs: nextDueMs,
      nodeRelays,
      nodeRelaysInput: getNodeRelays(),
      activeWorld: getActiveWorld(),
      availableWorlds: _SHIPPED_WORLDS,
      scoresEnabled: !!SCORE_PUBLISH_ENABLED,
      // Phase 0f — gamestr.io publish status. Reflects the operator opt-in: the
      // build-time GAMESTR_ENABLED const OR the runtime localStorage override
      // (adminPrefs.getGamestrEnabled, toggled from this menu). Off by default; the
      // actual publish still requires the player's explicit NIP-07 consent.
      gamestrEnabled: GAMESTR_ENABLED || getGamestrEnabled(),
      gamestrLastPublish: _lastGamestrResult
        ? (_lastGamestrResult.published ? 'ok' : 'failed')
        : 'idle',
      onToggleHeartbeat: (next) => {
        const wantOn = next === 'on';
        setHeartbeatIntent(next);
        // ADR-0094: mirror the toggle to the server beacon (the source of truth).
        // When the server is reachable and holds the key, presence is published
        // server-side 24/7; the client-side publish below is only the fallback
        // (server unreachable / unconfigured). An explicit OFF always stops both.
        const httpBase = resolveMpHttpBase();
        const token = getStoredToken();
        if (httpBase && token) {
          setBeacon({ httpBase, token, action: next })
            .then((r) => {
              if (r && r.ok) {
                _beacon.state.enabled = wantOn;
                showEntryStatus(wantOn ? 'Heartbeat ON (server beacon).' : 'Heartbeat OFF.');
                if (wantOn) refreshOnlineWorlds();
              } else if (wantOn) {
                // Server rejected/unreachable — fall back to the client publish.
                _heartbeat.republishPaused = false;
                _heartbeat.lastError = null;
                publishOurWorldPresence().catch(() => {});
                showEntryStatus('Server beacon unavailable — browser heartbeat active.');
              } else {
                showEntryStatus('Heartbeat OFF.');
              }
            })
            .catch(() => {
              if (wantOn) publishOurWorldPresence().catch(() => {});
            });
          return;
        }
        // No server session/URL: pure client-side fallback (pre-existing path).
        if (wantOn) {
          _heartbeat.republishPaused = false;  // re-toggle clears a pause
          _heartbeat.lastError = null;
          publishOurWorldPresence().catch(() => { /* status surfaced */ });
        } else {
          _heartbeat.republishPaused = false;
          showEntryStatus('Heartbeat OFF.');
        }
      },
      onToggleGamestr: (next) => {
        // Owner-only: runtime opt-in for the gamestr.io score publish (kind 30762).
        // This is a localStorage override on top of the build-time GAMESTR_ENABLED
        // const; main.js publishes when (GAMESTR_ENABLED || getGamestrEnabled()).
        // Enabling does NOT publish immediately — the actual score publish still
        // requires the player's explicit NIP-07 consent (PUBLISH MY SCORE).
        setGamestrEnabled(next === 'on');
        showEntryStatus(next === 'on' ? 'gamestr.io ON — publishes on your next score.' : 'gamestr.io OFF.');
      },
      onSetNodeRelays: (str) => {
        // Owner-only: persist the relay list so reads + presence publish use it.
        // Validated wss-only inside setNodeRelays.
        setNodeRelays(str);
        showEntryStatus('Node relays saved.');
      },
      onSetActiveWorld: (id) => {
        setActiveWorld(id);
        showEntryStatus('Homepage world set — reloading to apply…');
        // Local preview toggle: reload so the loader picks up the new active
        // world from localStorage `torii.world.active`.
        try { window.location.reload(); } catch { /* best-effort */ }
      },
      // Phase 0g: owner-only "Gateway setup" button in this Node settings panel.
      // Closes the menu first (so the two overlays never stack) then opens the
      // homepage stub. The stub is a separate DOM element with its own state.
      onOpenHomepageStub: () => {
        closeToriiMenu();
        _openHomepageStub();
      },
    },
    onTravel: (w) => _gwOpenVisit(w, { zoneSlug: isValidZoneSlug(w && w.zoneId) ? w.zoneId : null }),
  };
}

// Title-screen settings icon → open the new settings panel (nav-left/
// content-right, 2 tabs: Gateway Setup + Heartbeat). Replaces the old
// persistent Torii menu on THIS surface only — the in-game KeyM quick menu
// (arenaRuntime.js) still opens toriiMenu.js unchanged (separate call site,
// out of scope here).
elToriiMenuBtn?.addEventListener('click', () => {
  if (isSettingsPanelOpen()) { closeSettingsPanel(); return; }
  openSettingsPanel({ initialTab: 'gateway', onClose: () => { /* title screen: no pause to resume */ } });
});

// ── Phase 0g: "Gateway setup" homepage stub ───────────────────────────────────
// A three-free DOM overlay (mirrors toriiMenu.js) with 4 cards. 3 of 4 actions
// are ALREADY BUILT — this is the UI panel + wiring, not a reimplementation:
//   1. Choose Blank            → setActiveWorld('gateway-blank') + reload      (owner-only)
//   2. Use My World as Template → setActiveWorld('chiefmonkey-template') + reload (owner-only)
//   3. Visit a Node            → openToriiMenu (the live node directory)        (everyone)
//   4. Publish My Node         → the existing onToggleHeartbeat consent-publish path (owner-only)
// main.js owns the state + every callback; the stub is a pure renderer. Guests /
// non-owners must NOT mutate torii.world.active — the stub DISABLES + hints the
// owner cards for them (fail-closed on the gate). Owner detection reuses the
// existing isAdminOperator(state.nostrPubkey, cap.adminPubkey) (no new auth).
//
// _homepageStubState() — the snapshot the stub renders from. isOwner reuses the
// same isAdminOperator check the menu uses; activeWorld comes from adminPrefs;
// heartbeatStatus reuses the same heartbeatStatus() call so blocked/paused
// states stay consistent with the menu's heartbeat toggle.
function _homepageStubState() {
  const cap = _updateCapability;
  const isOwner = !!(cap && isAdminOperator(state.nostrPubkey || '', cap.adminPubkey));
  const isLoggedIn = /^[0-9a-f]{64}$/.test(state.nostrPubkey || '');
  const heartbeatIntent = getHeartbeatIntent();
  const hasSigner = typeof window !== 'undefined' && !!window.nostr && typeof window.nostr.signEvent === 'function';
  const nodeRelays = _effectiveRelays();
  const hb = heartbeatStatus({
    intent: heartbeatIntent,
    isOwner,
    hasSigner,
    nodeRelays,
    lastPublishedAt: _heartbeat.lastPublishedAt,
    now: Date.now(),
    lastError: _heartbeat.lastError,
    republishPaused: _heartbeat.republishPaused,
  });
  // v0.4: Relay tab reads the same validated node-relay set the heartbeat
  // publishes to (nodeRelays already computed above), plus the raw stored
  // string so the textarea shows exactly what's saved.
  const nodeRelaysInput = getNodeRelays();
  // v0.4: Profile tab reads its local draft (profileDraft.js) — separate
  // from the published kind:0, so the form shows the owner's last edit even
  // before a publish succeeds.
  const profileDraft = getProfileDraft();
  return {
    isOwner,
    isLoggedIn,
    activeWorld: getActiveWorld(),
    heartbeatStatus: hb,
    nodeRelays,
    nodeRelaysInput,
    profileDraft,
    profilePublishStatus: _profilePublishStatus,
  };
}

// v0.4: tracks the Profile tab's last publish attempt outcome for display
// only (module-level, not persisted — a reload/reopen just shows 'idle'
// again, which is fine since the draft itself IS persisted separately).
let _profilePublishStatus = 'idle';

// _homepageStubCallbacks() — the action callbacks. Each delegates to an
// EXISTING function (no new publish/reload path). onChooseWorld reuses the
// menu's onSetActiveWorld body (setActiveWorld + reload). onVisitNodeDirectory
// opens the persistent Torii menu (optionally the directory is already at the
// top). onPublishNode reuses the menu's onToggleHeartbeat consent-publish path
// so blocked states stay consistent. onSetNodeRelays mirrors the existing
// in-game menu's onSetNodeRelays body (setNodeRelays + status message).
// onSaveProfile builds+signs+publishes a kind:0 via the EXISTING
// signEvent/fanoutPublish (nostr.js) — no new sign/publish path — and always
// saves the local draft first so a signer rejection never loses the edit.
// onClose is a no-op on the title screen.
function _homepageStubCallbacks() {
  return {
    onChooseWorld: (worldId) => {
      // Owner-only by construction (the stub disables the card for non-owners,
      // and the gate is fail-closed). Mirrors the menu's onSetActiveWorld body.
      setActiveWorld(worldId);
      showEntryStatus('Homepage world set — reloading to apply…');
      try { window.location.reload(); } catch { /* best-effort */ }
    },
    // v0.3: onVisitNodeDirectory REMOVED — the "Visit a Node" card is dropped
    // by design decision. In-world travel already has a home at the physical
    // Torii Gateway inside the NAP zone (KeyM in-game menu), so a second
    // UI-level node directory on the homepage would be redundant.
    onPublishNode: () => {
      // Reuse the existing heartbeat consent-publish path (NOT a new publish
      // path). Toggle direction is decided from whether we're ACTUALLY
      // broadcasting (isHeartbeatBroadcasting on the current heartbeatStatus),
      // never from the raw stored intent string. Intent defaults to 'on' on a
      // fresh install even though nothing has ever published, so branching on
      // getHeartbeatIntent() here would flip a first-time owner's very first
      // click straight to 'off' instead of publishing + asking for NIP-07
      // consent. Blocked states (no-signer / no-node-relay /
      // wallet-requires-approval) surface via the tab's heartbeatStatus label.
      const currentlyBroadcasting = isHeartbeatBroadcasting(_homepageStubState().heartbeatStatus);
      const next = currentlyBroadcasting ? 'off' : 'on';
      setHeartbeatIntent(next);
      if (next === 'on') {
        _heartbeat.republishPaused = false;
        _heartbeat.lastError = null;
        publishOurWorldPresence().catch(() => { /* status surfaced */ });
      } else {
        _heartbeat.republishPaused = false;
        showEntryStatus('Heartbeat OFF.');
      }
      // Re-render happens at the call site (settings content delegation),
      // which calls renderActiveSettingsTab() right after invoking this.
    },
    onSetNodeRelays: (str) => {
      // Mirrors the old in-game menu's onSetNodeRelays callback body exactly
      // (setNodeRelays does all validation/dedup/capping — reused, not
      // duplicated). Re-render happens at the call site.
      setNodeRelays(str);
      showEntryStatus('Node relays saved.');
    },
    onSaveProfile: async (fields) => {
      // Always persist the local draft first — a signer rejection or missing
      // extension must never lose what the owner typed.
      setProfileDraft(fields);
      const pubkey = state.nostrPubkey || '';
      const hasSigner = typeof window !== 'undefined' && !!window.nostr && typeof window.nostr.signEvent === 'function';
      if (!HEX64.test(pubkey) || !hasSigner) {
        _profilePublishStatus = 'saved-local';
        showEntryStatus('Profile saved locally — log in with a Nostr signer to publish.');
        return;
      }
      const built = buildProfileMetadataEvent({ pubkey, ...fields });
      if (!built.ok) {
        _profilePublishStatus = 'failed';
        showEntryStatus('Profile not published — please check the entered fields.');
        return;
      }
      _profilePublishStatus = 'publishing';
      try {
        const signed = await signEvent(built.event);
        await fanoutPublish(_effectiveRelays(), signed);
        _profilePublishStatus = 'published';
        showEntryStatus('Profile published.');
      } catch {
        _profilePublishStatus = 'failed';
        showEntryStatus('Profile saved locally — publish failed (relay or signer error).');
      }
    },
    onClose: () => { /* title screen: no pause to resume */ },
  };
}

// _openHomepageStub() — v0.3: retargeted from the old standalone overlay to
// the new settings panel's Gateway Setup tab. Still the single open path the
// in-game menu's "Gateway setup" admin button (via onOpenHomepageStub above)
// and the login-resolved auto-open both call — name kept for both call sites,
// behavior now opens the shared panel pre-selected to the 'gateway' tab.
function _openHomepageStub() {
  openSettingsPanel({ initialTab: 'gateway', onClose: () => { /* title screen: no pause to resume */ } });
}

// v0.3: the old standalone "⛩ GATEWAY SETUP" secondary-CTA button + its
// dedicated ESC handler are REMOVED. That IIFE targeted #btn-enter (deleted
// in an earlier homepage-simplification pass), so it had silently fallen
// through to appending a stray purple button directly onto #title-centre on
// every load — dead-looking but actually still live and unstyled to the new
// theme. Gateway Setup is now a tab inside the settings panel (opened via the
// single top-left settings icon), so this separate entry point and its ESC
// handling are no longer needed; settingsPanel.js's own backdrop-click/×/ESC
// handling covers it.

// _gwOpenVisit(world, opts?) — the OPEN-VISIT n2n hop (Phase 0, the DEFAULT travel
// mode). Direct-navigate to the world's hardened https `website`, tagging the
// traveller's pubkey as ?torii-traveller=. No signed handshake — that code is
// reserved below (_gwTravel/_executeJump/_handshake) but is NOT called by the
// default path. allowPrivate is gated on the dev/staging domain (localhost /
// *.pplx.app) so production stays private-host-rejecting.
//
// Phase 0c: opts.zoneSlug (a valid NAP-zone slug) is forwarded to buildVisitUrl so
// the canonical hash route `#/zone/<slug>` is appended — visiting lands in the
// destination NAP zone. The in-world gateway gate + the menu's Visit button both
// pass the destination world's zoneId here.
function _gwOpenVisit(world, opts) {
  const allowPrivate = (() => {
    try {
      const h = (typeof location !== 'undefined' && location.hostname) || '';
      return h === 'localhost' || h.endsWith('.pplx.app');
    } catch { return false; }
  })();
  const zoneSlug = opts && typeof opts.zoneSlug === 'string' ? opts.zoneSlug : null;
  const visit = buildVisitUrl(world, { ourHex: state.nostrPubkey || '', allowPrivate, zoneSlug });
  if (!visit.ok) {
    // Surface the error the same way _executeJump does — log + re-render the
    // gateway card so the player sees the screen return to its live state.
    console.warn('open-visit rejected:', visit.errors.join(', '));
    renderGatewayCard();
    return;
  }
  // MP-1: gracefully close the multiplayer WebSocket before we navigate, so the
  // server logs a proper LEFT rather than a ping-timeout when we hop instances.
  try { _arena?.stopMultiplayer?.('travel'); } catch (e) { /* best-effort */ }
  try { window.location.href = visit.url; } catch (e) { renderGatewayCard(); }
}

// _gwTravel(world) — the SIGNED handshake hop. KEPT for an optional future
// "private/invite-only travel mode" but is NOT the default path in Phase 0: the
// in-world onTravel + the title-screen row click route to _gwOpenVisit above.
// Left intact (not deleted) so re-enabling signed travel is a one-line routing
// change, not a rebuild.
async function _gwTravel(world) {
  await _handshake.requestTravel(world);
  renderGatewayCard();
}
async function _gwAccept() {
  await _handshake.respondIncoming(true, { spawn: window.location.origin + window.location.pathname });
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
  const spawn = armed.spawn || (window.location.origin + window.location.pathname);
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
    const raw = await fanoutReq(_effectiveRelays(), [filter], { timeoutMs: 5000, graceMs: 250, retries: 1 });
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
  // Read-side discovery (Phase 0d follow-up): query the single relay list (the
  // same list presence publishes to, ADR-0081). This is read-only — a failed
  // relay just lands in `failed` and never fails the scan (fanoutReq returns the
  // union).
  const r = await fetchOnlineWorlds({
    request: fanoutReq,
    relays: _effectiveRelays(),
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
  // Friend detection rides the same scan cadence. Fail-soft: any relay error
  // leaves the friend caches empty so arenas still renders every world.
  await _refreshFriendData();
  renderGatewayCard();
}

// _refreshFriendData() — the cheapest correct mutual-follow detection (v0.2.403):
//   (1) fetch the user's newest kind:3 contact list;
//   (2) intersect its follows with online-world owners → candidate owners;
//   (3) fetch the newest kind:3 for ONLY those candidates;
//   (4) partitionGatewaySections marks a world a "friend" iff the user follows the
//       owner AND the owner follows the user back.
// No broad {#p:[user]} follower fanout. Never throws; relay errors → empty caches.
async function _refreshFriendData() {
  _userContacts = new Set();
  _ownerContacts = new Map();
  const me = state.nostrPubkey || '';
  if (!HEX64.test(me)) return; // logged out: no friends section
  try {
    const mineRaw = await fanoutReq(_effectiveRelays(), [{ kinds: [3], authors: [me], limit: 4 }],
      { timeoutMs: 5000, graceMs: 250, retries: 1 });
    const mineEvents = mineRaw && Array.isArray(mineRaw.events) ? mineRaw.events : [];
    _userContacts = contactSetFromEvent(newestContactEvent(mineEvents, me));
  } catch { return; } // no contact list → no friends, arenas unaffected
  const candidates = candidateFriendOwners({
    worlds: _worldsCache, userContacts: _userContacts, userPubkey: me,
  });
  if (!candidates.length) return;
  try {
    const ownersRaw = await fanoutReq(_effectiveRelays(),
      [{ kinds: [3], authors: candidates, limit: candidates.length * 4 }],
      { timeoutMs: 5000, graceMs: 250, retries: 1 });
    const ownerEvents = ownersRaw && Array.isArray(ownersRaw.events) ? ownersRaw.events : [];
    for (const owner of candidates) {
      _ownerContacts.set(owner, contactSetFromEvent(newestContactEvent(ownerEvents, owner)));
    }
  } catch { /* owners unreachable → mutual unconfirmed → they fall to arenas */ }
}

let _presencePublishedPubkey = '';
// ── Phase 0d: node presence heartbeat state ──────────────────────────────────
// The heartbeat is consent-gated + rAF-driven (NO setTimeout in new code).
// The menu toggle sets intent + triggers an explicit first publish (the NIP-07
// prompt = operator consent); the rAF _shellTick then republishes every
// HEARTBEAT_INTERVAL_MS. If a republish sign is rejected/thrown, we PAUSE
// (status paused:wallet-requires-approval) and stop auto-republishing until
// the operator re-toggles — so a per-call-prompting wallet never spams prompts.
// FIRST_PUBLISH_RETRY_MS + the pure isFirstPublishDue() live in heartbeat.js
// (centralised with HEARTBEAT_INTERVAL_MS) so the auto-on due-check is unit-
// tested. See ADR-0077.
const _heartbeat = {
  lastPublishedAt: null,   // epoch ms of the last successful publish (null = never)
  lastAttemptedAt: null,   // epoch ms of the last publish ATTEMPT (null = never tried) — gates first-publish retry backoff (ADR-0077)
  lastError: null,          // last non-sign error string (null = none)
  republishPaused: false,   // true when a republish sign was rejected → stop auto-republish
  inflight: false,          // true while a publish is mid-flight (guards re-entrancy)
};

// ADR-0094 (v0.2.734-alpha): server-side always-on beacon. While the server
// beacon is enabled the SERVER publishes presence 24/7 (signed by its own
// instance-bound key), so the client must NOT also publish — that would list the
// world twice (two keys, same zone). `state.enabled` therefore gates the client
// heartbeat OFF; the client heartbeat remains only the fallback path used before
// first activation or when the server beacon is unreachable/off.
const _beacon = {
  state: { enabled: false }, // latest server beacon state (default: off)
  syncing: false,            // in-flight sync guard (prevents duplicate activates)
};

// _syncServerBeacon() → read the server beacon state and, on the FIRST admin
// login (never-before-activated instance), turn it ON once — the permanent
// pulse. An admin who had explicitly turned it OFF is NOT re-enabled on a later
// login (enabled=false but activatedAt set). Never throws; an unreachable server
// just leaves the client-side fallback active.
async function _syncServerBeacon() {
  if (_beacon.syncing) return;
  const httpBase = resolveMpHttpBase();
  if (!httpBase) return;
  _beacon.syncing = true;
  try {
    const token = getStoredToken();
    let st = await fetchBeaconState({ httpBase });
    // The beacon state carries the configured admin pubkey — resolve ownership
    // directly from it (no dependency on the separate update-capability fetch).
    const who = (state.nostrPubkey || '').toLowerCase();
    const adm = (st.adminPubkey || '').toLowerCase();
    const isOwner = !!(who && adm && who === adm);
    if (isOwner && token && !st.enabled && st.activatedAt === null) {
      // First admin login: activate the permanent beacon (idempotent).
      await setBeacon({ httpBase, token, action: 'on' }).catch(() => ({ ok: false }));
      st = await fetchBeaconState({ httpBase }).catch(() => ({ enabled: false }));
    }
    _beacon.state = st;
  } finally {
    _beacon.syncing = false;
  }
}

// _nodeRelaysOpts() → the { storage, metaGetter } injection for the effective
// reader (readEffectiveNodeRelays). Built once so the Relay tab's list and the
// heartbeat's publish set stay in lockstep with a single source.
function _nodeRelaysOpts() {
  return {
    storage: typeof localStorage !== 'undefined' ? localStorage : undefined,
    metaGetter: typeof document !== 'undefined'
      ? (name) => {
          const el = document.querySelector(`meta[name="${name}"]`);
          return el && el.content ? el.content : '';
        }
      : null,
  };
}

// _effectiveRelays() → the validated wss:// relay set the WHOLE game uses —
// reads (profile/login/leaderboard/discovery) AND presence publish (ADR-0081).
// The operator's configured node relays (localStorage `torii.node.relays` +
// <meta name="torii-relays">), else the curated 5-relay DEFAULT_NODE_RELAYS so
// a fresh install works with zero config. Returns [] only if both configured
// AND defaults are empty (defaults are non-empty, so this practically never
// blocks).
function _effectiveRelays() {
  return readEffectiveNodeRelays(_nodeRelaysOpts());
}

// _publishPresenceOnce() → signs + fanout-publishes ONE presence event to the
// single relay list (ADR-0081). The NIP-40 expiration is now baked into
// buildPresenceEvent (default 20 min). Returns { ok, error }.
//   - On sign rejection/throw (nip-07-rejected/nip-07-threw): sets
//     _heartbeat.republishPaused = true so the rAF tick stops auto-republishing.
//     The operator re-toggles to resume. Quiet only when the wallet auto-allows.
//   - On other failure: records lastError (status failed:<error>) but does NOT
//     pause — a transient relay failure should retry on the next tick.
async function _publishPresenceOnce() {
  const pubkey = state.nostrPubkey || '';
  if (!/^[0-9a-f]{64}$/.test(pubkey)) return { ok: false, error: 'no-pubkey' };
  const relays = _effectiveRelays();
  if (!relays.length) return { ok: false, error: 'blocked:no-node-relay' };
  // Record the attempt time so a FAILED first publish backs off (ADR-0077) —
  // set BEFORE buildPresenceEvent + the async publish, so a BUILD failure OR a
  // slow wallet/relay can't leave lastAttemptedAt null + firstPublishDue true
  // every rAF frame (a ~60fps spin). The cheap preconditions above (pubkey/
  // signer/relays) are NOT publish attempts — the tick already gates on them.
  _heartbeat.lastAttemptedAt = Date.now();
  const built = buildPresenceEvent({
    pubkey,
    zoneId: 'quest-torii',
    title: 'Torii Quest',
    zoneType: 'arena',
    website: (typeof window !== 'undefined' ? window.location.origin + window.location.pathname : ''),
    relays,
    // NIP-40 default-on (1200s / 20 min) — stale nodes auto-drop from the directory.
  });
  if (!built.ok) { _heartbeat.lastError = 'build-failed'; return { ok: false, error: 'build-failed' }; }
  const res = await publishOurPresence({
    unsigned: built.event,
    sign: signEvent,
    publish: fanoutPublish,
    relays,
    timeoutMs: 5000,
  });
  if (res.ok) {
    _heartbeat.lastPublishedAt = Date.now();
    _heartbeat.lastError = null;
    return { ok: true, error: null };
  }
  // A sign rejection/throw pauses auto-republish (wallet prompts each call).
  if (res.error === 'nip-07-rejected' || res.error === 'nip-07-threw') {
    _heartbeat.republishPaused = true;
  } else {
    _heartbeat.lastError = res.error || 'unknown';
  }
  return { ok: false, error: res.error || 'publish-failed' };
}

// _heartbeatTick(now) — called from the existing rAF _shellTick loop (no new
// timers). Republishes when due IF: intent is on, owner, signer present, node
// relays configured, not paused, and not already mid-publish. Mirrors the
// gateway-scan polling that already rides this tick.
function _heartbeatTick(now) {
  if (_heartbeat.inflight) return;
  // ADR-0094: when the server beacon is enabled the SERVER publishes presence
  // 24/7 — the client must not also publish (duplicate world). Client heartbeat
  // is only the fallback for not-yet-activated / server-off states.
  if (_beacon.state.enabled) return;
  const intent = getHeartbeatIntent();
  if (intent !== 'on') return;
  const cap = _updateCapability;
  const isOwner = !!(cap && isAdminOperator(state.nostrPubkey || '', cap.adminPubkey));
  if (!isOwner) return;
  const hasSigner = typeof window !== 'undefined' && !!window.nostr && typeof window.nostr.signEvent === 'function';
  if (!hasSigner) return;
  if (_heartbeat.republishPaused) return;
  // ADR-0077: the heartbeat is ON by default and auto-fires the FIRST publish
  // when the owner logs in (the login click is the user gesture that authorises
  // the NIP-07 signer prompt — approving it IS the consent). isHeartbeatDue
  // returns false when lastPublishedAt is null (its contract is unchanged), so
  // the first publish is driven by `firstPublishDue` below; subsequent
  // republishes use the 10-min interval. A signer rejection/throw sets
  // republishPaused so it never nags — the operator can re-toggle to retry.
  // A FAILED first publish (non-signer error) backs off by FIRST_PUBLISH_RETRY_MS
  // so it doesn't spin every rAF frame while lastPublishedAt is still null.
  const firstPublishDue = isFirstPublishDue({
    lastPublishedAt: _heartbeat.lastPublishedAt,
    lastAttemptedAt: _heartbeat.lastAttemptedAt,
    now,
    retryMs: FIRST_PUBLISH_RETRY_MS,
  });
  const intervalDue = isHeartbeatDue({ lastPublishedAt: _heartbeat.lastPublishedAt, now, intervalMs: HEARTBEAT_INTERVAL_MS });
  if (!firstPublishDue && !intervalDue) return;
  _heartbeat.inflight = true;
  _publishPresenceOnce()
    .catch(() => { /* publish threw — leave paused/error state as set */ })
    .finally(() => { _heartbeat.inflight = false; });
}

// publishOurWorldPresence() — the re-enable / manual re-publish entry point.
// ADR-0077: the FIRST publish is no longer manual — _heartbeatTick auto-fires
// it when the owner logs in (intent defaults to 'on'). This function is now
// called by the menu toggle when the operator re-enables a paused heartbeat
// (re-publishes immediately, no waiting for the next tick) or explicitly asks
// to re-publish. v0.2.263 idempotency guard kept so a re-toggle of the same
// intent doesn't double-publish. Now publishes to the single relay list ONLY;
// if none configured, blocks with status
// blocked:no-node-relay and publishes nothing.
async function publishOurWorldPresence() {
  const pubkey = state.nostrPubkey || '';
  if (!/^[0-9a-f]{64}$/.test(pubkey)) return;
  // Consent-gated: the menu toggle calls this once on enable. A re-toggle of
  // the same intent re-publishes (the operator explicitly asked again).
  _presencePublishedPubkey = pubkey;
  const res = await _publishPresenceOnce();
  if (res.ok) {
    refreshOnlineWorlds();
  } else if (res.error === 'blocked:no-node-relay') {
    showEntryStatus('Heartbeat blocked — set a node relay in Node settings first.');
  } else if (res.error === 'nip-07-rejected' || res.error === 'nip-07-threw') {
    showEntryStatus('Heartbeat paused — approve the signer request in your Nostr extension, then re-toggle.');
  }
}

function renderGatewayPreview() {
  renderGatewayCard();
  refreshOnlineWorlds();
}
renderGatewayPreview();

// The player's own character mesh URL (Blossom), resolved at login from their
// signed kind-35100 character event. Set before arena boot so loadPlayerModel()
// fetches the custom mesh instead of the built-in default.
let _ownCharacterMeshUrl = null;
let _ownCharacterMeshHash = null;

on(EV.NOSTR_LOGIN, () => {
  _handshake.setOurPubkey(state.nostrPubkey || '');
  renderGatewayCard();
  _applyOwnCharacterMesh();
  // v0.2.375-alpha — "1 sign at login, 0 signs in-game": the login-time presence
  // publish signed a kind:31111 event on every NOSTR_LOGIN (a 2nd signer prompt
  // beyond the arena auth). Presence is now the WS roster only; the n2n gateway
  // card is read-only. (publishOurWorldPresence remains available for a future
  // explicit, user-initiated publish, but is no longer auto-triggered.)
  // ADR-0063: the login-resolved auto-open of the Gateway Setup panel was
  // removed — it popped a settings modal unprompted the moment Nostr login
  // resolved, which read as a surprise interrupt right when the player clicked
  // ENTER. The Gateway Setup tab is still reachable any time via the title-screen
  // settings icon and the in-game KeyM menu. Both are explicit user actions.
});

// _applyOwnCharacterMesh() — the player path of the automatic mesh-loading slice.
// After login, fetch the player's own kind-35100 character event, resolve its mesh
// hash to a Blossom URL, and stash it so ensureArenaReady() seats it before boot.
// Read-only + no prompt (reuses fetchOwnCharacter); a missing/invalid character
// leaves the built-in default avatar in place.
async function _applyOwnCharacterMesh() {
  const pk = (state.nostrPubkey || '').trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(pk)) { _ownCharacterMeshUrl = null; _ownCharacterMeshHash = null; return; }
  try {
    const manifest = await fetchOwnCharacter(pk);
    _ownCharacterMeshUrl = resolveCharacterMeshUrl(manifest) || null;
    _ownCharacterMeshHash = (manifest && manifest.mesh && manifest.mesh.hash) || null;
  } catch {
    _ownCharacterMeshUrl = null;
    _ownCharacterMeshHash = null;
  }
}

// ── Access tab (ADR-0078, v0.2.712) ─────────────────────────────────────────
// The Instance Settings admin surface (ACC-2b, v0.2.400) was hidden in v0.2.676
// ("nothing useful there for admins or guests"). v0.2.712 RESTORES it as the
// "Access" tab per "make the settings panel feel complete + useful" — the
// signed kind:30078 access-control enforcement in handoffArrival.js /
// writeAuthority.js stayed live the whole time it was hidden, so this only
// re-surfaces the editing UI. The view-model + renderer are the unchanged
// instanceSettings.js (v0.2.358); main.js owns the read/save relay round-trips
// (readLatestAccessSettings / publishAccessSettings in nostr.js) below.
//
// Arrival authority + write authority are owner-only + gated by a signed
// kind:30078 event verified on read before it can affect arrival — the edit
// surface can never weaken enforcement, only persist the operator's choice.
const _instanceSettingsState = {
  loading: false,
  saving: false,
  persisted: null,
  draftArrivalMode: null,
  draftWritePolicy: null,
  statusMessage: '',
  statusTone: '',
  _readStarted: false,
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
  if (!isSettingsPanelOpen()) return;
  const model = _currentInstanceSettingsModel();
  if (!model.visible) { _closeSettingsContentPanel(); return; }
  renderActiveSettingsTab();
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
    relays: _effectiveRelays(),
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
    relays: _effectiveRelays(),
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

// Access tab content renderer. Renders a gate note for non-owners (the model's
// own visible/canEditAccess gating still applies inside renderInstanceSettings-
// Panel). Only the 'access' section is surfaced — the module's placeholder
// 'multiplayer' + 'more' ("coming soon") sections are filtered out so the tab
// shows only useful, live controls. The relay read is kicked off lazily on the
// first render so opening the tab populates the persisted setting.
registerSettingsTabRenderer('access', () => {
  const model = _currentInstanceSettingsModel();
  if (!model.visible) return '<div class="is-note">Instance settings are only available to the node owner.</div>';
  model.sections = (Array.isArray(model.sections) ? model.sections : []).filter((s) => s && s.key === 'access');
  if (!_instanceSettingsState._readStarted) {
    _instanceSettingsState._readStarted = true;
    _refreshInstanceSettingsAccessState().catch(() => { /* status surfaced */ });
  }
  return renderInstanceSettingsPanel(model);
});

// Generic settings-panel close — kept (was previously named for the instance
// tab, but the 'close' data-action applies to the whole panel, both tabs).
function _closeSettingsContentPanel() {
  closeSettingsPanel();
}

// Gateway Setup tab content renderer — reuses the exact same state/callback
// builders as the old homepage stub (_homepageStubState / _homepageStubCallbacks,
// defined above), just rendered as HTML into the shared content pane instead
// of a separate DOM overlay.
registerSettingsTabRenderer('gateway', () => renderGatewaySetupPanel(_homepageStubState()));

// Heartbeat tab content renderer — v0.3: split out of Gateway Setup's former
// 3rd card. Same underlying state (_homepageStubState's heartbeatStatus) and
// callback (onPublishNode), just its own tab.
registerSettingsTabRenderer('heartbeat', () => renderHeartbeatPanel(_homepageStubState()));

// Relay tab content renderer (v0.4) — view/add/remove the wss:// relays this
// node publishes presence to. Same state builder as the other tabs.
registerSettingsTabRenderer('relay', () => renderRelayPanel(_homepageStubState()));

// Profile tab content renderer (v0.4) — standard Nostr kind:0 fields for
// this Quest installation's identity. Same state builder as the other tabs.
registerSettingsTabRenderer('profile', () => {
  const st = _homepageStubState();
  return renderProfilePanel({ ...st, draft: st.profileDraft, publishStatus: st.profilePublishStatus });
});

// Character tab content renderer (v0.2.718, Character Forge) — the player's
// playable character (a signed kind-35100 event). v0.2.719 wires the LIVE relay
// read: on first render (and on retry) it checks the logged-in npub's kind-35100
// event via fetchOwnCharacter and seats an existing character automatically (the
// "smooth experience" seam) — no prompt, no re-upload. The create round-trip
// (writing a new character event) is a follow-up slice.
const _characterForgeState = {
  status: 'idle', // 'idle' | 'checking' | 'found' | 'none' | 'failed'
  character: null, // { name, meshName, stickerCount, stickers } | null
  manifest: null, // the full `torii.character` manifest (used for sticker edits)
  mode: 'view',   // 'view' | 'edit' — 'edit' is the sticker editor
  error: null,
  _readStarted: false,
};

// _summarizeCharacterManifest(manifest) → the panel's character summary, used
// by every read/create/update path so the summary shape stays in one place.
function _summarizeCharacterManifest(manifest) {
  const m = (manifest && typeof manifest === 'object') ? manifest : {};
  return {
    name: (typeof m.name === 'string' && m.name) ? m.name : 'Unnamed',
    meshName: (m.mesh && typeof m.mesh.name === 'string') ? m.mesh.name : '',
    stickerCount: Array.isArray(m.stickers) ? m.stickers.length : 0,
    stickers: Array.isArray(m.stickers) ? m.stickers : [],
  };
}

// _republishCharacter(manifest) — sign + publish a character manifest update
// (the shared write half for the sticker editor), then refresh the panel state.
async function _republishCharacter(manifest) {
  _characterForgeState.status = 'creating';
  renderActiveSettingsTab();
  try {
    const res = await publishCharacter(manifest);
    if (res.ok) {
      _characterForgeState.status = 'found';
      _characterForgeState.manifest = manifest;
      _characterForgeState.character = _summarizeCharacterManifest(manifest);
      _characterForgeState.error = null;
    } else {
      _characterForgeState.status = 'failed';
      _characterForgeState.error = res.error === 'nip-07-unavailable'
        ? 'Signing needs a NIP-07 extension (e.g. nos2x / Alby).'
        : (res.error || 'Could not update your character.');
    }
  } catch {
    _characterForgeState.status = 'failed';
    _characterForgeState.error = 'Could not update your character.';
  }
  renderActiveSettingsTab();
}

// _addOwnSticker(stickerId) — place a sticker from the curated library on its
// recommended zone (default centre u/v), then republish. The precise 3D
// placement (raycast → zone/u/v/rot) is a later in-world step; this is the
// settings-tab authoring path that closes the create→edit loop.
async function _addOwnSticker(stickerId) {
  const manifest = _characterForgeState.manifest;
  if (!manifest) return;
  const entry = STICKER_LIBRARY.find((s) => s.id === stickerId);
  if (!entry) return;
  const next = addSticker(manifest, {
    hash: entry.hash,
    zoneId: entry.recommendedZone,
    u: 0.5,
    v: 0.5,
    rot: 0,
  });
  if (next !== manifest) await _republishCharacter(next);
}

// _removeOwnSticker(index) — remove the sticker at `index` from the manifest and
// republish. Out-of-range index is a no-op (removeSticker returns the input).
async function _removeOwnSticker(index) {
  const manifest = _characterForgeState.manifest;
  if (!manifest) return;
  const next = removeSticker(manifest, index);
  if (next !== manifest) await _republishCharacter(next);
}

// _confirmSelfViewPlacement(placement) — the self-view sticker placement confirm
// half (ADR-0088). The in-world orbit self-view confirms a real 3D raycast
// placement ({hash, zoneId, u, v, rot}); fold it into the manifest + republish.
// Ensures a manifest exists first (the self-view is entered in-game, possibly
// without ever opening the Character tab).
async function _confirmSelfViewPlacement(placement) {
  if (!placement || !placement.zoneId) return;
  let manifest = _characterForgeState.manifest;
  if (!manifest) {
    const pk = (state.nostrPubkey || '').trim().toLowerCase();
    if (/^[0-9a-f]{64}$/.test(pk)) manifest = await fetchOwnCharacter(pk);
  }
  if (!manifest || !manifest.mesh || !manifest.mesh.hash) {
    _characterForgeState.status = 'failed';
    _characterForgeState.error = 'Create a character first (Character tab) to add stickers.';
    renderActiveSettingsTab();
    showFlyNotice('Sticker placement — create a character first');
    return;
  }
  const next = addSticker(manifest, placement);
  if (next !== manifest) {
    await _republishCharacter(next);
    showFlyNotice(`Sticker placed — ${placement.zoneId} (${_characterForgeState.character ? _characterForgeState.character.stickerCount : 0} total)`);
  }
}

async function _checkOwnCharacter() {
  const pk = (state.nostrPubkey || '').trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(pk)) {
    _characterForgeState.status = 'none';
    _characterForgeState.character = null;
    return;
  }
  _characterForgeState.status = 'checking';
  renderActiveSettingsTab();
  try {
    const manifest = await fetchOwnCharacter(pk);
    if (manifest && manifest.mesh && manifest.mesh.hash) {
      _characterForgeState.status = 'found';
      _characterForgeState.manifest = manifest;
      _characterForgeState.character = _summarizeCharacterManifest(manifest);
    } else {
      _characterForgeState.status = 'none';
      _characterForgeState.character = null;
    }
  } catch {
    _characterForgeState.status = 'failed';
    _characterForgeState.error = 'Could not reach relays to check for your character.';
  }
  renderActiveSettingsTab();
}

// _createOwnCharacter(presetId) — the create round-trip write half: build the
// manifest from a curated preset, sign the kind-35100 event via NIP-07, and
// publish to the unified relay list. On success the tab flips to 'found' (the
// same view the read half produces), so create→read round-trips seamlessly.
async function _createOwnCharacter(presetId) {
  const preset = getCharacterPreset(presetId);
  if (!preset) {
    _characterForgeState.status = 'failed';
    _characterForgeState.error = 'Unknown preset.';
    renderActiveSettingsTab();
    return;
  }
  _characterForgeState.status = 'creating';
  renderActiveSettingsTab();
  try {
    const manifest = presetToManifest(preset);
    const res = await publishCharacter(manifest);
    if (res.ok) {
      _characterForgeState.status = 'found';
      _characterForgeState.manifest = manifest;
      _characterForgeState.character = _summarizeCharacterManifest(manifest);
      _characterForgeState.error = null;
    } else {
      _characterForgeState.status = 'failed';
      _characterForgeState.error = res.error === 'nip-07-unavailable'
        ? 'Signing needs a NIP-07 extension (e.g. nos2x / Alby).'
        : (res.error || 'Could not publish your character.');
    }
  } catch {
    _characterForgeState.status = 'failed';
    _characterForgeState.error = 'Could not publish your character.';
  }
  renderActiveSettingsTab();
}

// _pickCustomMesh() — open a file picker for a .glb and hand the file to
// _uploadCustomMesh. The picker is created dynamically (not baked into the pure
// panel HTML) so the panel stays a node-testable string renderer.
function _pickCustomMesh() {
  const doc = typeof document !== 'undefined' ? document : null;
  if (!doc) return;
  const input = doc.createElement('input');
  input.type = 'file';
  input.accept = '.glb,.gltf';
  input.onchange = () => {
    const file = input.files && input.files[0];
    if (file) _uploadCustomMesh(file);
  };
  input.click();
}

// _uploadCustomMesh(file) — the "make it so" path: upload a GLB to Blossom
// (NIP-98 auth via NIP-07), build a manifest from the returned content hash,
// sign + publish the kind-35100 character event, then seat the mesh for the
// player's own avatar. Two NIP-07 prompts (upload auth + event sign).
async function _uploadCustomMesh(file) {
  _characterForgeState.status = 'creating';
  renderActiveSettingsTab();
  try {
    const up = await uploadBlossom(file);
    if (!up.ok) {
      _characterForgeState.status = 'failed';
      _characterForgeState.error = up.error === 'nip-07-unavailable'
        ? 'Signing needs a NIP-07 extension (e.g. nos2x / Alby).'
        : (up.error || 'Could not upload your mesh.');
      renderActiveSettingsTab();
      return;
    }
    const manifest = {
      version: 1,
      mesh: { hash: up.sha256, name: (file && file.name) || 'custom.glb' },
      clips: [],
      stickers: [],
      name: '',
      colors: [],
      contrib: [],
    };
    const res = await publishCharacter(manifest);
    if (res.ok) {
      _characterForgeState.status = 'found';
      _characterForgeState.manifest = manifest;
      _characterForgeState.character = _summarizeCharacterManifest(manifest);
      _characterForgeState.error = null;
      // Seat the newly-published mesh for the player's own avatar + broadcast
      // its hash so peers can load it too.
      _ownCharacterMeshUrl = resolveCharacterMeshUrl(manifest) || null;
      _ownCharacterMeshHash = (manifest && manifest.mesh && manifest.mesh.hash) || null;
      if (_arena && typeof _arena.setCustomMeshUrl === 'function') _arena.setCustomMeshUrl(_ownCharacterMeshUrl);
      if (_arena && typeof _arena.setCustomMeshHash === 'function') _arena.setCustomMeshHash(_ownCharacterMeshHash);
    } else {
      _characterForgeState.status = 'failed';
      _characterForgeState.error = res.error === 'nip-07-unavailable'
        ? 'Signing needs a NIP-07 extension (e.g. nos2x / Alby).'
        : (res.error || 'Could not publish your character.');
    }
  } catch {
    _characterForgeState.status = 'failed';
    _characterForgeState.error = 'Could not upload your mesh.';
  }
  renderActiveSettingsTab();
}

registerSettingsTabRenderer('character', () => {
  const st = _homepageStubState();
  if (st.isLoggedIn && !_characterForgeState._readStarted) {
    _characterForgeState._readStarted = true;
    _checkOwnCharacter();
  }
  return renderCharacterForgePanel({
    isLoggedIn: st.isLoggedIn,
    status: _characterForgeState.status,
    character: _characterForgeState.character,
    mode: _characterForgeState.mode,
    stickerLibrary: STICKER_LIBRARY.map((s) => ({ id: s.id, label: s.label })),
    presets: CHARACTER_PRESETS.map((p) => ({ id: p.id, label: p.label })),
    error: _characterForgeState.error,
  });
});

// Single delegated listener on the settings panel's content container, scoped
// by data-action conventions so every tab's clicks are handled without
// needing its own listeners.
(function _wireSettingsContentDelegation() {
  const doc = typeof document !== 'undefined' ? document : null;
  if (!doc) return;
  // The content container is built lazily by settingsPanel.js on first open,
  // so delegate from `document` (capture bubble naturally) rather than trying
  // to grab a reference that may not exist yet.
  doc.addEventListener('click', (e) => {
    const t = e && e.target;
    if (!t || !t.closest) return;
    if (!t.closest('#torii-settings-content')) return;
    const action = t.getAttribute && t.getAttribute('data-action');
    if (!action) return;
    if (action === 'close') { e.preventDefault(); _closeSettingsContentPanel(); return; }
    if (action === 'check-character') { e.preventDefault(); _checkOwnCharacter(); return; }
    if (action === 'select-preset') { e.preventDefault(); _createOwnCharacter(t.getAttribute('data-preset') || ''); return; }
    if (action === 'upload-mesh') { e.preventDefault(); _pickCustomMesh(); return; }
    if (action === 'edit-character') { e.preventDefault(); _characterForgeState.mode = 'edit'; renderActiveSettingsTab(); return; }
    if (action === 'done-edit') { e.preventDefault(); _characterForgeState.mode = 'view'; renderActiveSettingsTab(); return; }
    if (action === 'add-sticker') { e.preventDefault(); _addOwnSticker(t.getAttribute('data-sticker') || ''); return; }
    if (action === 'remove-sticker') { e.preventDefault(); _removeOwnSticker(t.getAttribute('data-index')); return; }
    if (action === 'choose-blank') { e.preventDefault(); _homepageStubCallbacks().onChooseWorld('gateway-blank'); return; }
    if (action === 'choose-template') { e.preventDefault(); _homepageStubCallbacks().onChooseWorld('chiefmonkey-template'); return; }
    if (action === 'publish-node') { e.preventDefault(); _homepageStubCallbacks().onPublishNode(); renderActiveSettingsTab(); return; }
    if (action === 'save-relays') {
      e.preventDefault();
      const ta = doc.getElementById('rl-add-input');
      _homepageStubCallbacks().onSetNodeRelays(ta ? ta.value : '');
      renderActiveSettingsTab();
      return;
    }
    if (action === 'remove-relay') {
      e.preventDefault();
      const url = t.getAttribute('data-relay') || '';
      // Remove from the EFFECTIVE list (curated defaults included) and persist
      // the remaining set as the operator's configured list — so deleting a
      // starter relay materialises the rest as an explicit config rather than
      // silently leaving the default fallback in place.
      const effective = readEffectiveNodeRelays(_nodeRelaysOpts());
      const remaining = effective.filter((r) => r !== url);
      _homepageStubCallbacks().onSetNodeRelays(remaining.join('\n'));
      renderActiveSettingsTab();
      return;
    }
    if (action === 'save-profile') {
      e.preventDefault();
      const fields = {};
      for (const id of ['displayName', 'about', 'picture', 'website', 'nip05', 'lud16']) {
        const el = doc.getElementById(`pf-${id}`);
        if (el) fields[id] = el.value;
      }
      Promise.resolve(_homepageStubCallbacks().onSaveProfile(fields)).finally(() => {
        renderActiveSettingsTab();
        _refreshOwnerLabel(); // owner's displayName edit should reflect on the homepage caption immediately
      });
      return;
    }
  });

  // v0.2.712 (ADR-0078): Access tab — delegated `change` for the arrival-mode /
  // write-policy radio groups (writes the selection into the draft, same as the
  // old v0.2.400 wiring), + delegated `submit` for the signed-access form
  // (data-form="access-settings" → _saveInstanceSettingsAccess signs +
  // publishes the kind:30078). Scoped to #torii-settings-content like the click
  // handler so it never catches events outside the settings panel.
  doc.addEventListener('change', (e) => {
    const t = e && e.target;
    if (!t || !t.matches || !t.closest || !t.closest('#torii-settings-content')) return;
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
  doc.addEventListener('submit', (e) => {
    const t = e && e.target;
    if (!t || !t.getAttribute || !t.closest || !t.closest('#torii-settings-content')) return;
    if (t.getAttribute('data-form') !== 'access-settings') return;
    e.preventDefault();
    _saveInstanceSettingsAccess();
  });
})();

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

// ── Title-screen proof cards (leaderboard / update) ─────────────────────────────
// v0.2.403-alpha: the MARKET/product preview card was removed from the title
// screen. The product proof-surface now lives only in the in-world NAP zone
// (see src/world/napZone.js + the productPreview/product-panel modules). The
// pure product view-model modules stay intact and are exercised by that panel.

// The side-panel combines the latest server-authoritative local SCORE frame
// with verified kind:30078/kind:1 relay history. The local frame is cached per
// player so returning Home is immediate even while the relay read settles.
let _latestScoreFrame = null;
let _relayScoreEvents = { current: [], history: [] };
let _scoreReadSeq = 0;
let _scoreReportInFlight = false;

function renderLeaderboardPreview() {
  const body = document.getElementById('leaderboard-preview-body');
  if (!body) return;
  const localCurrent = _latestScoreFrame
    ? talliesToCurrentEvents(
      _latestScoreFrame.tallies,
      _latestScoreFrame.sessionId,
      _latestScoreFrame.endedAt,
    )
    : [];
  const rows = renderLeaderboardRows(
    {
      current: [..._relayScoreEvents.current, ...localCurrent],
      history: _relayScoreEvents.history,
    },
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
_renderGamestrLeaderboard();
on(EV.SCORE_FRAME, (frame) => {
  _latestScoreFrame = normaliseScoreFrame(frame);
  if (_latestScoreFrame && state.nostrPubkey) {
    saveLatestScoreFrame(globalThis.localStorage, state.nostrPubkey, _latestScoreFrame);
  }
  renderLeaderboardPreview();
  _renderGamestrLeaderboard();
});

function _isScoreEvent(event) {
  if (!event || !verifyNostrEventSig(event)) return false;
  if (event.kind === SCORE_KIND_ADDRESSABLE) {
    return event.tags?.some((tag) => tag?.[0] === 'd' && tag[1] === SCORE_D_TAG);
  }
  return event.kind === SCORE_KIND_HISTORY
    && event.tags?.some((tag) => tag?.[0] === 't' && tag[1] === SCORE_HISTORY_T_TAG);
}

async function _refreshPersistentScores() {
  const seq = ++_scoreReadSeq;
  try {
    const filters = [
      { kinds: [SCORE_KIND_ADDRESSABLE], '#d': [SCORE_D_TAG], limit: 50 },
      { kinds: [SCORE_KIND_HISTORY], '#t': [SCORE_HISTORY_T_TAG], limit: 200 },
    ];
    const { events } = await fanoutReq(_effectiveRelays(), filters, { timeoutMs: 4000, graceMs: 300 });
    if (seq !== _scoreReadSeq) return;
    const valid = Array.isArray(events) ? events.filter(_isScoreEvent) : [];
    _relayScoreEvents = {
      current: valid.filter((event) => event.kind === SCORE_KIND_ADDRESSABLE),
      history: valid.filter((event) => event.kind === SCORE_KIND_HISTORY),
    };
    renderLeaderboardPreview();
  } catch {
    // Keep the latest local SCORE frame visible when relays are unavailable.
  }
}

// Phase 0h — gamestr.io score READING (kind 30762). The read-side companion to
// the Phase 0f publish: fetches the latest torii-quest score events from the
// gamestr relays, dedupes to the latest score per player, and renders a
// "gamestr.io" sub-section below the in-app NIP-78 leaderboard preview. This
// reuses fanoutReq over GAMESTR_RELAYS exactly like _refreshPersistentScores
// uses fanoutReq over RELAYS — NO new relay client. The pure dedupe/sort lives
// in gamestrLeaderboard.js (node-safe, no DOM/sockets/timers).
//
// Opt-in / no external requests when off: the fetch fires ONLY when
// (GAMESTR_ENABLED || getGamestrEnabled()) — the SAME gate as the publish — so
// a default operator never hits gamestr relays on load. Best-effort: a relay
// down / network failure is caught and NEVER breaks the in-app leaderboard or
// the game loop; the section just shows its empty state. Render is a no-op when
// the body element is missing (mirroring renderLeaderboardPreview).
let _gamestrRows = [];
let _gamestrReadSeq = 0;

function _renderGamestrLeaderboard() {
  const body = document.getElementById('gamestr-leaderboard-body');
  if (!body) return;
  const on = GAMESTR_ENABLED || getGamestrEnabled();
  if (!on) {
    const msg = document.createElement('div');
    msg.className = 'lb-empty';
    msg.textContent = 'Enable gamestr.io in Node settings to see the global leaderboard.';
    body.replaceChildren(msg);
    return;
  }
  if (!_gamestrRows.length) {
    const msg = document.createElement('div');
    msg.className = 'lb-empty';
    msg.textContent = 'No gamestr scores yet.';
    body.replaceChildren(msg);
    return;
  }
  body.replaceChildren(..._gamestrRows.flatMap((r, i) => {
    const l = document.createElement('div');
    l.className = 'lb-row-label';
    l.textContent = `#${i + 1} ${shortenNpub(r.pubkey)}`;
    const v = document.createElement('div');
    v.className = 'lb-row-value';
    v.textContent = r.duration != null ? `${r.score} · ${r.duration}s` : `${r.score}`;
    return [l, v];
  }));
}

async function _refreshGamestrScores() {
  // Same opt-in as publish — never hit gamestr relays when the operator hasn't
  // enabled it (the build-time GAMESTR_ENABLED const OR the runtime override).
  if (!(GAMESTR_ENABLED || getGamestrEnabled())) { _gamestrRows = []; _renderGamestrLeaderboard(); return; }
  const seq = ++_gamestrReadSeq;
  try {
    const { events } = await fanoutReq(
      GAMESTR_RELAYS,
      [{ kinds: [GAMESTR_KIND], '#game': [GAMESTR_GAME_ID], limit: 100 }],
      { timeoutMs: 4000, graceMs: 300 },
    );
    if (seq !== _gamestrReadSeq) return; // a newer fetch superseded this one
    _gamestrRows = buildGamestrLeaderboard(events);
    _renderGamestrLeaderboard();
  } catch {
    // Best-effort: leave the last good rows (or the empty state) in place — a
    // gamestr relay failure must never break the in-app leaderboard or the loop.
  }
}

async function _publishLatestScore() {
  if (!SCORE_PUBLISH_ENABLED) return;
  if (_scoreReportInFlight || !_latestScoreFrame || !HEX64.test(state.nostrPubkey || '')) return;
  _scoreReportInFlight = true;
  const reporter = createScoreReporter({
    self: { selfPubkey: state.nostrPubkey },
    signer: async (unsigned) => {
      const result = await signEvent(unsigned);
      if (!result?.ok || !result.event) throw new Error(result?.error || 'score signing failed');
      return result.event;
    },
    publisher: async (event) => {
      const result = await fanoutPublish(_effectiveRelays(), event);
      if (!result || result.accepted < 1) throw new Error('no relay accepted score');
      return { published: result.accepted, tried: _effectiveRelays().length };
    },
    log: (message, error) => console.warn('[score]', message, error?.message || ''),
  });
  const result = await reporter.report(_latestScoreFrame);
  _scoreReportInFlight = false;
  if (result.published) {
    _relayScoreEvents.current.push(result.addressable);
    _relayScoreEvents.history.push(result.history);
    renderLeaderboardPreview();
    void _refreshPersistentScores();
    void _refreshGamestrScores();
  }
}

// _prefillProfileDraftFromNostr(pubkey) → fetch the logged-in user's published
// kind:0 profile and pre-fill the Profile settings tab's draft from it — but
// ONLY when the draft is still empty, so we never clobber an owner's unsaved
// edits. Maps the sanitised profile view-model to the draft field shape and
// re-renders the Profile tab if it is open. Never throws.
let _profilePrefillPubkey = null; // short-circuit repeat login events
async function _prefillProfileDraftFromNostr(pubkey) {
  const pk = typeof pubkey === 'string' ? pubkey.trim().toLowerCase() : '';
  if (!/^[0-9a-f]{64}$/.test(pk)) return;
  if (pk === _profilePrefillPubkey) return;
  _profilePrefillPubkey = pk;
  const existing = getProfileDraft();
  if (existing && Object.keys(existing).length) return; // already has a draft — leave it
  const profile = await fetchOwnProfile(pk);
  if (!profile) return;
  const displayName = (profile.displayName && profile.displayName !== profile.shortPubkey)
    ? profile.displayName
    : '';
  setProfileDraft({
    displayName,
    about: profile.about || '',
    picture: profile.picture || '',
    website: profile.website || '',
    nip05: profile.nip05 || '',
    lud16: profile.lud16 || '',
  });
  renderActiveSettingsTab(); // no-op unless the panel is open; refreshes the Profile tab if so
}

on(EV.NOSTR_LOGIN, ({ pubkey }) => {
  _latestScoreFrame = loadLatestScoreFrame(globalThis.localStorage, pubkey) || _latestScoreFrame;
  renderLeaderboardPreview();
  _renderGamestrLeaderboard();
  void _refreshPersistentScores();
  void _refreshGamestrScores();
  void _prefillProfileDraftFromNostr(pubkey);
});
on(EV.PHASE_CHANGE, ({ to }) => {
  if (to !== 'title') return;
  renderLeaderboardPreview();
  _renderGamestrLeaderboard();
  void _publishLatestScore();
  void _refreshPersistentScores();
  void _refreshGamestrScores();
});

// ── LIVE leaderboard publish (M2, v0.2.285) ────────────────────────────────────
// The promoted relay write. A consented, crypto-verified finalised score is signed
// via NIP-07 and fanned out to the configured RELAYS — reusing nostr.js seams
// through the SEC-1 publishGate (no ungated path). The button arms ONLY when the
// player is logged in; the click is the explicit consent, confirmed once more so
// the sign+publish stakes are never hidden. Status: idle → publishing → published
// / failed.
const _livePublisher = createLiveLeaderboardPublisher({
  sign: signEvent, publish: fanoutPublish, relays: _effectiveRelays(),
});
let _publishInFlight = false;

// Phase 0f — gamestr.io score publish (kind 30762). A SEPARATE destination from
// the in-app NIP-78 leaderboard above: off by default (GAMESTR_ENABLED),
// best-effort, and only ever reached through the same explicit "PUBLISH MY
// SCORE" consent path. A gamestr failure is captured here and NEVER blocks or
// fails the in-app leaderboard write — the caller invokes this AFTER the in-app
// publish, regardless of its outcome. Reuses the same nostr.js signEvent /
// fanoutPublish seams (no new relay client) over GAMESTR_RELAYS.
const _gamestrPublisher = createGamestrPublisher({
  sign: signEvent, publish: fanoutPublish, relays: GAMESTR_RELAYS,
});
// Last gamestr result, surfaced read-only in the menu's Node settings (gamestr:
// on/off, last publish ok/failed). null until the first publish attempt.
let _lastGamestrResult = null;

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
  if (!SCORE_PUBLISH_ENABLED) {
    btn.disabled = true;
    btn.textContent = 'SCORE PUBLISHING DISABLED';
    _setLbPublishStatus('scores are saved locally; relay publishing is disabled during development', 'muted');
    return;
  }
  const loggedIn = /^[0-9a-f]{64}$/.test(state.nostrPubkey || '');
  btn.disabled = !loggedIn || _publishInFlight;
  btn.textContent = _publishInFlight ? 'PUBLISHING…' : 'PUBLISH MY SCORE';
  if (!loggedIn) _setLbPublishStatus('login with Nostr to publish your score', 'muted');
  else if (!_publishInFlight && !document.getElementById('leaderboard-publish-status')?.textContent) {
    _setLbPublishStatus('', '');
  }
}

async function _publishMyScore() {
  if (!SCORE_PUBLISH_ENABLED) return;
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

  // Phase 0f — gamestr.io best-effort publish (kind 30762). Runs ONLY when the
  // operator opted in (the build-time GAMESTR_ENABLED const OR the runtime
  // adminPrefs.getGamestrEnabled() override) AND the player consented (consent===true,
  // already established above). A gamestr failure is captured into
  // _lastGamestrResult and NEVER blocks or fails the in-app leaderboard write
  // above — this runs regardless of the in-app outcome, and any throw is caught
  // so it can never propagate into the game loop. First publish = NIP-07 signer
  // prompt (the wallet may auto-allow thereafter).
  if ((GAMESTR_ENABLED || getGamestrEnabled()) && consent === true) {
    try {
      _lastGamestrResult = await _gamestrPublisher.publishGameScore(
        { score: stats.score, kills: stats.kills },
        { signerPubkey: pubkey, consent: true },
      );
    } catch (e) {
      _lastGamestrResult = {
        ok: false, published: false, errors: ['gamestr unexpected error: ' + (e?.message || String(e))],
      };
    }
  } else {
    _lastGamestrResult = null;
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

// v0.2.706-alpha: the owner's PUBLISHED Nostr displayName, read-only fetched
// once per adminPubkey (see fetchOwnerProfileName in nostr.js) so the homepage
// caption shows the real name to EVERY visitor, not just the owner viewing
// their own browser. Keyed by pubkey so a stale name from a previous instance
// (e.g. during tests, or if adminPubkey ever changes at runtime) is never shown.
let _ownerProfileNamePubkey = null;
let _ownerProfileName = '';

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

// Paint the top-left "This torii belongs to: <label>" caption. Reads the same
// capability.adminPubkey _refreshUpdateButton() already has (no extra fetch),
// so it is called right alongside it — on the capability probe resolving and
// on every NOSTR_LOGIN. Pure DOM write; missing element/data degrades to the
// helper's own safe defaults, never throws.
function _refreshOwnerLabel() {
  const el = document.getElementById('torii-owner-label');
  if (!el) return;
  const cap = _updateCapability;
  const adminPubkey = cap ? cap.adminPubkey : null;
  const label = resolveToriiOwnerLabel({
    adminPubkey,
    viewerPubkey: state.nostrPubkey || '',
    profileDraft: getProfileDraft(),
    ownerProfileName: (adminPubkey && adminPubkey === _ownerProfileNamePubkey) ? _ownerProfileName : '',
  });
  // v0.2.705 (ADR-0071): the name lives in its own truncating span now (was the
  // whole element's textContent) so the admin-only "logged in" badge can sit to
  // its right without being clipped by the ellipsis.
  const nameEl = document.getElementById('torii-owner-name');
  const line1 = document.getElementById('torii-owner-line1');
  // Admin-only greeting: when the logged-in viewer IS the configured owner, the
  // caption becomes "Welcome <name>," / green-dot "you are logged in". Otherwise
  // every visitor sees the standard "This torii belongs to / <name>" caption.
  // Reuses the same isAdminOperator() check the rest of the shell uses — never
  // reveals the pubkey, never shows for non-owners/anonymous, starts display:none
  // so it never flashes before login confirms.
  const isOwner = !!(adminPubkey && isAdminOperator(state.nostrPubkey || '', adminPubkey));
  if (line1) {
    if (isOwner) {
      // v0.2.706 (ADR-0072): "Welcome <name>," with ONLY the name in orange.
      // Built via DOM API (textContent per span) so a Nostr display name can
      // never inject markup — no innerHTML, never surfaces the pubkey.
      line1.classList.add('toc-greet');
      line1.replaceChildren();
      const pre = document.createElement('span'); pre.className = 'toc-dim'; pre.textContent = 'Welcome ';
      const nm = document.createElement('span'); nm.className = 'toc-name'; nm.textContent = label;
      const comma = document.createElement('span'); comma.className = 'toc-dim'; comma.textContent = ',';
      line1.append(pre, nm, comma);
      line1.title = label;
    } else {
      line1.classList.remove('toc-greet');
      line1.replaceChildren(document.createTextNode('This torii belongs to'));
      line1.title = '';
    }
  }
  if (nameEl) {
    if (isOwner) { nameEl.hidden = true; }                       // name moved into the greeting line
    else { nameEl.hidden = false; nameEl.textContent = label; nameEl.title = label; } // full text on hover when ellipsis-clipped
  }
  else if (!isOwner) { el.textContent = label; el.title = label; } // fallback if the span is absent
  const badge = document.getElementById('torii-loggedin-badge');
  if (badge) badge.classList.toggle('show', isOwner);
  _fetchOwnerProfileNameOnce(adminPubkey);
}

// Kick off a read-only relay lookup of the owner's published displayName, once
// per adminPubkey per session (fetchOwnerProfileName itself also caches, so this
// is just an in-memory short-circuit to avoid redundant calls on every login
// event/capability re-probe). Never throws; a failed/empty lookup just leaves
// the shortened-npub fallback in place. Repaints the caption on success so a
// visitor who loaded before the profile resolved still sees the name land.
let _ownerProfileNameFetchInFlightFor = null;
function _fetchOwnerProfileNameOnce(adminPubkey) {
  const pk = typeof adminPubkey === 'string' ? adminPubkey.trim() : '';
  if (!pk) return;
  if (pk === _ownerProfileNamePubkey) return; // already resolved (name or confirmed-empty) for this owner
  if (pk === _ownerProfileNameFetchInFlightFor) return; // already in flight
  _ownerProfileNameFetchInFlightFor = pk;
  fetchOwnerProfileName(pk)
    .then((name) => {
      _ownerProfileNamePubkey = pk;
      _ownerProfileName = name || '';
      if (_ownerProfileNameFetchInFlightFor === pk) _ownerProfileNameFetchInFlightFor = null;
      _refreshOwnerLabel();
    })
    .catch(() => {
      if (_ownerProfileNameFetchInFlightFor === pk) _ownerProfileNameFetchInFlightFor = null;
    });
}

// v0.2.387-alpha (UPD-2): Update Now button + copy-fallback visibility rule.
// Fail-closed — nothing is shown unless the logged-in operator IS the configured
// admin AND the latest probe says an update is available. When auto-update is
// installed (capability.autoUpdate) the button is an ENABLED trigger; otherwise
// it is disabled and the copy-command fallback is revealed. Never throws.
function _refreshUpdateButton() {
  const btn = document.getElementById('update-upgrade-btn');
  const fallback = document.getElementById('update-copy-fallback');
  _refreshOwnerLabel();
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
// ADR-0094: on admin login, read the server beacon state and activate it once if
// never before activated. Runs after login so state.nostrPubkey is set.
on(EV.NOSTR_LOGIN, _syncServerBeacon);

// LIVE update-check: paint an immediate "checking…" row, then resolve against the
// real GitHub TAGS endpoint (cached client-side) and repaint. In parallel, probe
// the server capability endpoint (public, no auth). Failure degrades to an inert
// "UNABLE TO CHECK" — the card never breaks.
function renderUpdatePreview() {
  const body = document.getElementById('update-preview-body');
  if (!body) return;
  _refreshOwnerLabel(); // paint an immediate best-effort label before the capability probe resolves
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

// ── Boot loading overlay (v0.2.529) ──────────────────────────────────────────
// Full-screen CSS-only overlay shown on ENTER, hidden after the first rendered
// frame. Lives in main.js (three-free) so it can paint BEFORE the arenaRuntime
// dynamic import loads the THREE vendor chunk.
const _bootOverlay = document.getElementById('boot-overlay');
const _bootStatus  = document.getElementById('boot-overlay-status');
const _bootBar     = document.getElementById('boot-overlay-bar');
const _bootSub     = document.getElementById('boot-overlay-sub');

const BOOT_STEPS = [
  { pct: 8,  label: 'Loading engine…',     sub: 'Fetching modules' },
  { pct: 16, label: 'Building scene…',     sub: 'Renderer · lights · sky' },
  { pct: 24, label: 'Sculpting terrain…',  sub: 'Mountains · arena · coast' },
  { pct: 30, label: 'Growing grass…',      sub: '75,000 blades · wind shaders' },
  { pct: 62, label: 'Loading physics…',   sub: 'Rapier WASM · colliders' },
  { pct: 75, label: 'Loading avatar…',    sub: 'Character model · animations' },
  { pct: 88, label: 'Preparing world…',    sub: 'Body · NPCs · details' },
  { pct: 96, label: 'Entering…',           sub: 'Almost there' },
];

// Smoothly animate the progress bar toward a target percentage.
// Eases forward between discrete step updates so it never stalls visually.
let _bootCurrentPct = 0;
let _bootTargetPct = 0;
let _bootAnimId = null;

function _animateBootBar() {
  if (_bootAnimId) cancelAnimationFrame(_bootAnimId);
  const tick = () => {
    const diff = _bootTargetPct - _bootCurrentPct;
    if (Math.abs(diff) < 0.5) {
      _bootCurrentPct = _bootTargetPct;
      if (_bootBar) _bootBar.style.width = _bootCurrentPct + '%';
      _bootAnimId = null;
      return;
    }
    _bootCurrentPct += diff * 0.12;
    if (_bootBar) _bootBar.style.width = _bootCurrentPct + '%';
    _bootAnimId = requestAnimationFrame(tick);
  };
  _bootAnimId = requestAnimationFrame(tick);
}

function showBootOverlay() {
  if (!_bootOverlay) return;
  _bootOverlay.classList.remove('hidden');
  _setBootProgress(0);
}

function hideBootOverlay() {
  if (!_bootOverlay) return;
  _bootOverlay.classList.add('hidden');
}

function _setBootProgress(stepIndex) {
  const step = BOOT_STEPS[stepIndex] || BOOT_STEPS[BOOT_STEPS.length - 1];
  if (_bootStatus) _bootStatus.textContent = step.label;
  _bootTargetPct = step.pct;
  if (_bootSub)    _bootSub.textContent = step.sub;
  _animateBootBar();
}

// Set an exact percentage for sub-step progress (e.g. GLB download progress).
function _setBootPct(pct, label, sub) {
  _bootTargetPct = Math.min(95, Math.max(0, pct));
  if (label && _bootStatus) _bootStatus.textContent = label;
  if (sub && _bootSub) _bootSub.textContent = sub;
  _animateBootBar();
}

// Yield to the browser so the overlay can paint before heavy synchronous work.
// Uses double-rAF (two animation frames) — a single rAF can resume before paint.
function _yieldToPaint() {
  return new Promise(resolve => {
    requestAnimationFrame(() => requestAnimationFrame(resolve));
  });
}

// ── ENTER ARENA — the ONE place THREE is loaded ─────────────────────────────────
// On first click we `await import('./arenaRuntime.js')` (the three-vendor chunk
// loads HERE, deferred off first paint), build the scene + start the render loop,
// then lazy-load Rapier + spawn the player. Subsequent entries just start a fresh
// run. A failed bootstrap resets the button + shows a visible message.
let _arena = null;            // arenaRuntime API once imported
let _arenaBootstrapped = false;

// v0.3 cleanup: the single ENTER TORII handler (formerly ENTER ARENA) was
// removed — #btn-enter-nap below is now the only entry point and everyone
// drops into the NAP zone by default, so it owns the whole flow.

// v0.2.275: shared bootstrap for entering the game. Lazy-loads the
// three-vendor chunk + Rapier ONCE, then returns the ready arena API.
async function ensureArenaReady(loadingLabel) {
  if (_arenaBootstrapped) return _arena;
  elNapBtn.textContent = loadingLabel;
  elNapBtn.disabled = true;
  try {
    if (!_arena) {
      _setBootProgress(0); // 'Loading engine…'
      startPhase('import-runtime');
      // ← THE deferred three-vendor load. Nothing the shell imports touches three.
      const mod = await import('./arenaRuntime.js');
      endPhase('import-runtime');
      _setBootProgress(1); // 'Building scene…'
      _arena = mod.createArenaRuntime({
        showEntryStatus,
        resetEnterButton,
        onBootProgress: _setBootProgress,
        onBootPct: _setBootPct,
        getGatewayScreenState: () => {
          const canTravel = /^[0-9a-f]{64}$/.test(state.nostrPubkey || '');
          // ADR-0054: the gateway screen now shows three columns (Friends /
          // Follows / Games) — reuse the same classifySections partition the
          // Torii menu (KeyM) already uses.
          const { friends, following, games } = classifySections({
            worlds: _worldsCache,
            userPubkey: canTravel ? state.nostrPubkey : '',
            userContacts: _userContacts,
            ownerContacts: _ownerContacts,
          });
          return {
            friends,
            following,
            games,
            scanStatus: _worldsScan,
            canTravel,
            onTravel: (w) => _gwOpenVisit(w, { zoneSlug: isValidZoneSlug(w && w.zoneId) ? w.zoneId : null }),
          };
        },
        // Phase 0c: the in-game (KeyM) Torii menu hook. arenaRuntime opens the
        // SAME menu element the title-screen burger button opens — it calls this
        // hook, which supplies getState + onClose (resume-on-close). arenaRuntime
        // must NOT create its own menu DOM; it just calls the hook.
        openToriiMenu: ({ onClose }) => openToriiMenu({ getState: _getToriiMenuState, onClose }),
        closeToriiMenu,
        isToriiMenuOpen,
        // ADR-0088: the in-world self-view placement confirm — main.js folds the
        // confirmed raycast placement into the character manifest + republish.
        confirmStickerPlacement: _confirmSelfViewPlacement,
      });
      // Apply character selection BEFORE boot so the MP host sends the
      // correct character in AUTH. boot() opens the WebSocket immediately.
      if (_selectedCharacter) _arena.setCharacter(_selectedCharacter);
      // Seat the player's own character mesh (Blossom URL) before boot so
      // loadPlayerModel() fetches it instead of the built-in default, and
      // broadcast its hash so peers resolve + load the same mesh.
      _arena.setCustomMeshUrl(_ownCharacterMeshUrl);
      _arena.setCustomMeshHash(_ownCharacterMeshHash);
      startPhase('boot');
      await _arena.boot();
      endPhase('boot');
    } else {
      _setBootProgress(1);
    }
    startPhase('bootstrap-physics');
    await _arena.bootstrapPhysics();
    endPhase('bootstrap-physics');
  } catch (e) {
    console.error('Arena bootstrap failed:', e);
    elNapBtn.textContent = 'ENTER TORII';
    elNapBtn.disabled = false;
    // v0.2.277: show the REAL error (bootstrapPhysics now throws a step-tagged
    // message; fall back to e.message for import/boot failures). The generic
    // message hid the actual failure.
    const real = (e && e.message) ? e.message : String(e);
    showEntryStatus(`⚠ Arena failed to load — ${real}`);
    throw e;
  }
  _arenaBootstrapped = true;
  // Log the boot timing report for dev/debug.
  try { logReport(); } catch {}
  return _arena;
}

function resetEnterButton() {
  if (elNapBtn) {
    elNapBtn.textContent = 'ENTER TORII';
    elNapBtn.disabled = false;
  }
}

// v0.2.275: ENTER NAP ZONE — same bootstrap, then a one-shot spawn override
// drops the player into the NAP far-left corner (config: NAP_SPAWN_*) facing
// west across the grass field, skipping the torii-gate walk.
elNapBtn?.addEventListener('click', async () => {
  if (!isTitle()) return;
  // IMMEDIATE visible status (mirrors ENTER ARENA) before the async bootstrap.
  showEntryStatus('Entering NAP zone…');
  resetTimings();
  mark('enter-click-nap');
  showBootOverlay();
  await _yieldToPaint();
  try {
    await ensureArenaReady('LOADING NAP…');
  } catch { hideBootOverlay(); return; }
  showEntryStatus('');
  hideBootOverlay();
  _arena.setSpawnOverride(NAP_SPAWN_X, NAP_SPAWN_Z, NAP_SPAWN_YAW);
  _arena.enter();
});
// v0.3: homepage FLY MODE toggle button removed per design direction; the
// wiring IIFE that used to sync #btn-fly-toggle went with it. state.flyMode
// stays false by default; in-game F still calls arenaRuntime's initFlyCamera
// directly, which null-guards its own #btn-fly-toggle DOM sync.

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
    // Phase 0d: heartbeat republish rides the same rAF tick (no new timers).
    // Throttled to ~once per 120 frames like the handshake tick — the actual
    // interval check (10 min default) lives in isHeartbeatDue, so this just
    // pokes that pure helper often enough.
    if (++_heartbeatFrame >= 120) {
      _heartbeatFrame = 0;
      _heartbeatTick(Date.now());
    }
  }
  requestAnimationFrame(_shellTick);
}
requestAnimationFrame(_shellTick);

// ── Title-screen preloading (v0.2.543) ───────────────────────────────────────
// Start fetching critical assets during title-screen idle time so they’re in
// the browser cache when the player clicks ENTER. Also kicks off the Rapier
// WASM import in parallel (independent of arenaRuntime).
const _preloadBase = (import.meta.env && import.meta.env.BASE_URL) || '/';
const PRELOAD_ASSETS = [
  'models/chiefmonkey7.glb',
  'augustink4.glb',
  'models/animation-library.glb',
];
let _preloadedAssets = null;
let _preloadingStarted = false;
function startPreloading() {
  if (_preloadingStarted) return;
  _preloadingStarted = true;
  _preloadedAssets = {};
  for (const asset of PRELOAD_ASSETS) {
    const url = _preloadBase + asset.replace(/^\/+/, '');
    _preloadedAssets[asset] = fetch(url, { cache: 'force-cache' })
      .then(r => r.ok)
      .catch(() => false);
  }
  _preloadedAssets._rapier = import('@dimforge/rapier3d-compat')
    .then(r => { r.init(); return r; })
    .catch(() => null);
}
requestAnimationFrame(() => requestAnimationFrame(startPreloading));

// ── n2n gateway preflight (v0.2.601) ──────────────────────────────────────────
// Exposes a live diagnostic snapshot so the user can verify the node2node jump
// is configured correctly before testing. Open the browser console and run:
//   ToriiDebug.gateway()
// Returns { hostPubkey, loggedInNpub, relays, handshakeState, armed, spawnUrl,
//           hardenResult, currentUrl, hasInboundTraveller }
if (typeof window !== 'undefined') {
  window.ToriiDebug = window.ToriiDebug || {};
  window.ToriiDebug.gateway = () => {
    const snap = _handshake.snapshot();
    const armed = snap && snap.armed;
    const spawn = armed?.spawn || (window.location.origin + window.location.pathname);
    const hardened = hardenSpawnUrl(spawn);
    const incoming = readArrivingTraveller(window.location?.href || '');
    const view = _handshake.view();
    return {
      hostPubkey: _hostIdentity() || 'NOT CONFIGURED',
      loggedInNpub: state.nostrPubkey || 'not logged in',
      relays: _effectiveRelays(),
      handshakeMode: view?.mode || 'idle',
      handshakeBadge: view?.badge || '',
      armed: armed ? { toZone: armed.toZone, spawn: armed.spawn, hostPubkey: armed.hostPubkey } : null,
      spawnUrl: spawn,
      hardenResult: hardened,
      currentUrl: window.location?.href || '',
      hasInboundTraveller: incoming ? { npub: incoming.npub, hint: incoming.pubkey } : null,
      worldsOnline: _worldsCache.length,
      ready: !!(armed && hardened.ok && state.nostrPubkey),
    };
  };
}