// engine/multiplayer/spectatorClient.js — the READ-ONLY live-stream client (ADR-0118
// Decision 4). Dials a world's wsEndpoint, sends SPECTATE, and ingests the world-state
// broadcast (BOT_STATE + JOIN/MOVE/LEFT) into a pollable roster the mirror renderer can
// read each frame. It is the "live" tier of the portal mirror: peek (rendered manifest)
// escalates to LIVE when this socket starts feeding the destination's actual state.
//
// PURE + node-testable: `WebSocketCtor` and `now` are injected, so the exact subscribe
// message, the keepalive, and the roster projection are locked without a real socket.
// The ONLY messages this client ever emits are SPECTATE (subscribe) and PING (keepalive)
// — never AUTH/JOIN/MOVE/SHOT/…, so it can never be seated or mutate the world.

import { MSG, encode, decode, sanitize } from './wireProtocol.js';

export const SPECTATOR_STATE = Object.freeze({
  IDLE: 'idle', CONNECTING: 'connecting', LIVE: 'live', CLOSED: 'closed', ERROR: 'error',
});

export const SPECTATOR_KEEPALIVE_MS = 15000;

/**
 * Create a read-only spectator stream.
 *
 * @param {{ url:string, WebSocketCtor:Function, now?:()=>number,
 *           onState?:(state:string)=>void, onFrame?:(t:string)=>void }} opts
 * @returns {{ state:string, open:()=>object, close:()=>void, sendPing:()=>void,
 *             readBots:()=>Array, readPeers:()=>Array, _handleMessage:(raw:any)=>void }}
 *   `open()` returns the client (chainable). Never throws after construction apart from
 *   a synchronous bad-URL/ctor — those are guard clauses, not transport.
 */
export function createSpectatorClient({
  url, WebSocketCtor, now = () => Date.now(), onState = () => {}, onFrame = () => {},
} = {}) {
  if (typeof url !== 'string' || !url.startsWith('ws')) {
    throw new TypeError('spectatorClient: url must start with ws:// or wss://');
  }
  if (typeof WebSocketCtor !== 'function') {
    throw new TypeError('spectatorClient: WebSocketCtor must be a constructor');
  }

  let ws = null;
  let _state = SPECTATOR_STATE.IDLE;
  let keepaliveTimer = null;
  const bots = new Map();   // botId -> { id,x,z,rotY,hp,alive,animHint }
  const peers = new Map();  // peerId -> { id,pos:{x,y,z},rot:{yaw,pitch},anim }

  function _set(next) {
    if (_state === next) return;
    _state = next;
    try { onState(next); } catch { /* observer is best-effort */ }
  }
  function _startKeepalive() {
    _stopKeepalive();
    keepaliveTimer = setInterval(() => sendPing(), SPECTATOR_KEEPALIVE_MS);
  }
  function _stopKeepalive() {
    if (keepaliveTimer) { clearInterval(keepaliveTimer); keepaliveTimer = null; }
  }

  function open() {
    if (ws) return api;
    _set(SPECTATOR_STATE.CONNECTING);
    let socket;
    try { socket = new WebSocketCtor(url); } catch (e) {
      _set(SPECTATOR_STATE.ERROR);
      throw e;
    }
    ws = socket;
    socket.onopen = () => {
      try {
        // Subscribe read-only — the ONLY non-keepalive message this client sends.
        socket.send(encode({ t: MSG.SPECTATE }));
        _set(SPECTATOR_STATE.LIVE);
        _startKeepalive();
      } catch { _set(SPECTATOR_STATE.ERROR); }
    };
    socket.onmessage = (ev) => { try { _handleMessage(ev && ev.data); } catch { /* ignore */ } };
    socket.onerror = () => { /* let onclose drive the state transition */ };
    socket.onclose = () => {
      _stopKeepalive();
      ws = null;
      if (_state !== SPECTATOR_STATE.CLOSED) _set(SPECTATOR_STATE.CLOSED);
    };
    return api;
  }

  function close() {
    _stopKeepalive();
    if (ws) { try { ws.close(); } catch { /* noop */ } ws = null; }
    _set(SPECTATOR_STATE.CLOSED);
  }

  function sendPing() {
    if (ws && _state === SPECTATOR_STATE.LIVE) {
      try { ws.send(encode({ t: MSG.PING, ts: now() })); } catch { /* noop */ }
    }
  }

  // The roster projection the mirror renderer polls: frozen-style snapshots.
  function readBots() {
    return Array.from(bots.values()).map((b) => ({ ...b }));
  }
  function readPeers() {
    return Array.from(peers.values()).map((p) => ({ id: p.id, pos: { ...p.pos }, rot: { ...p.rot }, anim: p.anim }));
  }

  // Ingest ONE wire message. A spectator receives the SAME world-state broadcast as
  // seated peers; it projects only the state a mirror needs and discards the rest.
  function _handleMessage(raw) {
    const parsed = decode(raw);
    if (!parsed.ok) return;
    const m = sanitize(parsed.msg);
    if (!m || !m.t) return;

    switch (m.t) {
      case MSG.BOT_STATE:
        if (!Array.isArray(m.bots)) return;
        bots.clear();
        for (const b of m.bots) {
          if (!b || typeof b !== 'object') continue;
          bots.set(b.id, { id: b.id, x: b.x, z: b.z, rotY: b.rotY, hp: b.hp, alive: b.alive, animHint: b.animHint });
        }
        break;
      case MSG.JOIN:
        peers.set(m.id, {
          id: m.id,
          pos: { x: m.pos[0], y: m.pos[1], z: m.pos[2] },
          rot: { yaw: m.rot[0], pitch: m.rot[1] },
          anim: 'idle',
        });
        break;
      case MSG.MOVE:
        if (m.id == null || !peers.has(m.id)) return;
        peers.set(m.id, {
          id: m.id,
          pos: { x: m.pos[0], y: m.pos[1], z: m.pos[2] },
          rot: { yaw: m.rot[0], pitch: m.rot[1] },
          anim: typeof m.anim === 'string' ? m.anim : 'idle',
        });
        break;
      case MSG.LEFT:
        if (typeof m.id === 'string') peers.delete(m.id);
        break;
      // RESPAWN carries no id (local-only); PONG/SCORE/combat are irrelevant to a
      // mirror view. Everything else is intentionally ignored — a spectator must not
      // act on or surface identity-bearing or mutating frames.
      default:
        break;
    }
    try { onFrame(m.t); } catch { /* observer is best-effort */ }
  }

  const api = {
    get state() { return _state; },
    open, close, sendPing, readBots, readPeers, _handleMessage,
  };
  return api;
}