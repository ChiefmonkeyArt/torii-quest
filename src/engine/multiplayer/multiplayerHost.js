// multiplayerHost.js — the one place main.js wires the MP-1 subsystem.
//
// Kept as a single seam so:
//   * main.js has just ONE `if (MP_ENABLED)` branch (see rule "wiring only" in
//     torii-quest-handoff.md §5)
//   * disabling MP_ENABLED at build-time short-circuits every side effect
//   * a subagent can regression-test the whole MP wire path by mocking one file
//
// This module is impure (it constructs a real WebSocket + Three objects), but
// every impure dependency is INJECTABLE via the `deps` argument so unit tests
// can exercise the orchestration without a browser.
//
// Pre-conditions asserted (fail-closed):
//   * MP_ENABLED must be true in config OR overridden via deps.mpEnabled
//   * A NIP-07 signer must be present (window.nostr.signEvent)
//   * A scene + a way to load a peer avatar must be provided
//
// Public API:
//   const mp = createMultiplayerHost({ ...deps });
//   mp.start();                 // resolve config + open ws
//   mp.stop('reason');          // clean disconnect + dispose avatars
//   mp.sendMove({pos, rot, vel})
//   mp.sendShot({origin, dir, ts})
//   mp.sendHit({targetId, dmg, zone, shotTs})
//   mp.sendKill({shooterId, victimId, weapon})
//   mp.sendChat(msg)
//   mp.tick(renderTime)         // call every frame from the render loop
//   mp.state                    // WS_STATE.*
//   mp.selfId                   // once WELCOME lands
//   mp.roster                   // remoteAvatarRoster (test seam)

import { MP_ENABLED, MP_WS_PATH } from '../../config.js';
import { createWsClient, WS_STATE } from './wsClient.js';
import { createRemoteAvatarRoster } from './remoteAvatars.js';
import { MSG } from './wireProtocol.js';

/**
 * @param {object} deps
 * @param {object} deps.scene              THREE scene (or a fake with add/remove)
 * @param {Function} deps.avatarLoader     (peer) => Promise<Object3D>
 * @param {Function} deps.signAuth         async ({challenge}) => {npub, sig, event}
 * @param {Function} [deps.getSessionToken]   () => string|null — when set, AUTH_TOKEN is sent instead of signing
 * @param {Function} [deps.clearSessionToken] () => void — clears a rejected token so reconnect falls back to NIP-42
 * @param {string} [deps.origin]           overrides location.host (test seam)
 * @param {boolean} [deps.mpEnabled]       overrides MP_ENABLED (test seam)
 * @param {Function} [deps.WebSocketCtor]  overrides window.WebSocket (test seam)
 * @param {Function} [deps.emit]           observability sink
 * @param {Function} [deps.now]            () => ms clock
 */
export function createMultiplayerHost(deps) {
  const {
    scene,
    avatarLoader,
    signAuth,
    getSessionToken = null,
    clearSessionToken = null,
    origin,
    mpEnabled = MP_ENABLED,
    WebSocketCtor,
    emit = () => {},
    now = () => Date.now(),
  } = deps || {};

  if (!scene || typeof scene.add !== 'function') {
    throw new TypeError('multiplayerHost: scene required');
  }
  if (typeof avatarLoader !== 'function') {
    throw new TypeError('multiplayerHost: avatarLoader required');
  }
  if (typeof signAuth !== 'function') {
    throw new TypeError('multiplayerHost: signAuth required');
  }

  const roster = createRemoteAvatarRoster({ avatarLoader, scene, emit });
  let ws = null;
  const host = {
    state: WS_STATE.IDLE,
    selfId: null,
    roster,
    _enabled: !!mpEnabled,
    start, stop,
    sendMove, sendShot, sendHit, sendKill, sendChat,
    tick,
  };

  function resolveUrl() {
    // MP-1.5: pplx.app sandbox port-forward sentinel. deploy_website rewrites
    // __PORT_5000__ → 'port/5000' at S3 upload time; local dev keeps the literal
    // sentinel and we fall through to same-origin (VPS/dev shape wss://host/mp).
    // See skills/website-building/shared/19-backend.md.
    const PORT_SENTINEL = '__PORT_5000__';
    const rewritten = !PORT_SENTINEL.startsWith('__');
    const wsPath = rewritten ? `/${PORT_SENTINEL}${MP_WS_PATH}` : MP_WS_PATH;

    if (typeof origin === 'string' && origin.length > 0) return `wss://${origin}${wsPath}`;
    // Browser path: same origin, wss guaranteed for pplx.app / any HTTPS host.
    if (typeof globalThis !== 'undefined' && globalThis.location && globalThis.location.host) {
      return `wss://${globalThis.location.host}${wsPath}`;
    }
    // Fallback (should not happen in prod) — refuse rather than dial a bad URL.
    return null;
  }

  function start() {
    if (!host._enabled) { emit('mp_disabled', {}); return false; }
    if (ws) return true; // already started
    const url = resolveUrl();
    if (!url) { emit('mp_no_url', {}); return false; }
    ws = createWsClient({
      url,
      WebSocketCtor: WebSocketCtor || (typeof globalThis !== 'undefined' && globalThis.WebSocket),
      signAuth,
      getSessionToken,
      clearSessionToken,
      now,
      emit: (name, payload) => _onWsEvent(name, payload),
    });
    ws.connect();
    return true;
  }

  function stop(reason = 'stop') {
    if (ws) { ws.disconnect(reason); ws = null; }
    roster.dispose();
    host.state = WS_STATE.CLOSED;
    host.selfId = null;
    emit('mp_stopped', { reason });
  }

  // ---- WS event fan-in ----
  function _onWsEvent(name, payload) {
    emit('mp_' + name, payload);
    switch (name) {
      case 'state': {
        host.state = payload.state;
        if (payload.state === WS_STATE.CONNECTED && payload.selfId) host.selfId = payload.selfId;
        return;
      }
      case 'roster': {
        for (const p of payload.roster || []) roster.upsert(p);
        return;
      }
      case 'peerJoin': {
        roster.upsert(payload);
        return;
      }
      case 'peerLeft': {
        roster.remove(payload.id);
        return;
      }
      case 'move': {
        roster.applyMove(payload.id, {
          pos: payload.pos, rot: payload.rot, vel: payload.vel,
          clientTs: now(), // server->client relay is treated as arriving-now
        });
        return;
      }
      // shot / hit / kill / chat are forwarded via emit() for main.js
      // subscribers — no side effects from this module beyond the roster.
      default: return;
    }
  }

  // ---- outbound ----
  function _send(msg) {
    if (!ws || host.state !== WS_STATE.CONNECTED) return false;
    return ws.send(msg);
  }
  function sendMove(m) { return _send({ t: MSG.MOVE, pos: m.pos, rot: m.rot, vel: m.vel }); }
  function sendShot(m) { return _send({ t: MSG.SHOT, origin: m.origin, dir: m.dir, ts: m.ts }); }
  // MP-2 (v0.2.366-alpha): server is authoritative on hits. This is now a
  // no-op export kept for regression compat with callers that were wired in
  // MP-1. Under MP_MODE=advisory the server still relays if a client sends
  // one, but the shipped client never should. See MP_2_SPEC.md §10.
  function sendHit(_m) { return false; }
  function sendKill(m) { return _send({ t: MSG.KILL, shooterId: m.shooterId, victimId: m.victimId, weapon: m.weapon }); }
  function sendChat(msg) { return _send({ t: MSG.CHAT, msg }); }

  function tick(renderTime) { roster.tick(renderTime); }

  return host;
}
