// wsClient.js — connection state machine for MP-1 multiplayer.
//
// Impure (touches WebSocket), but the WebSocket constructor is INJECTABLE so
// this module is testable with a fake. See tests/multiplayer/ws-client-state.test.js.
//
// State machine (see MP_1_SPEC.md §6):
//
//   idle → connecting → authenticating → connected
//                                      → closed (any state can enter closed)
//
// On close, if MP_ENABLED is still true and disconnect() wasn't called, the
// client reconnects with exponential backoff capped at 30s.
//
// This module only relays events — it does NOT own the scene, avatars, or hit
// application. Those live in remoteAvatars.js and main.js subscribers.

import { MSG, PROTOCOL_VERSION, encode, decode, sanitize } from './wireProtocol.js';

export const WS_STATE = Object.freeze({
  IDLE:           'idle',
  CONNECTING:     'connecting',
  AUTHENTICATING: 'authenticating',
  CONNECTED:      'connected',
  CLOSED:         'closed',
});

export const BACKOFF_MS_INITIAL = 500;
export const BACKOFF_MS_CAP     = 30_000;

/**
 * Create a WS client.
 *
 * @param {object} opts
 * @param {string} opts.url                        - wss URL (typically wss://host/mp)
 * @param {Function} opts.WebSocketCtor            - WebSocket constructor (window.WebSocket or a fake)
 * @param {Function} opts.signAuth                 - async ({ challenge }) => { npub, sig, event }
 * @param {Function} [opts.emit]                   - event sink: (name, payload) => void
 * @param {Function} [opts.now]                    - () => ms clock (defaults Date.now)
 * @param {Function} [opts.setTimeoutFn]           - injectable setTimeout (test seam)
 * @param {Function} [opts.clearTimeoutFn]         - injectable clearTimeout
 */
export function createWsClient(opts) {
  const {
    url,
    WebSocketCtor,
    signAuth,
    emit = () => {},
    now = () => Date.now(),
    setTimeoutFn = setTimeout,
    clearTimeoutFn = clearTimeout,
  } = opts;

  if (typeof url !== 'string' || !url.startsWith('ws')) {
    throw new TypeError('wsClient: url must start with ws:// or wss://');
  }
  if (typeof WebSocketCtor !== 'function') {
    throw new TypeError('wsClient: WebSocketCtor must be a constructor');
  }
  if (typeof signAuth !== 'function') {
    throw new TypeError('wsClient: signAuth must be a function');
  }

  const api = {
    state: WS_STATE.IDLE,
    selfId: null,
    ws: null,
    backoffMs: BACKOFF_MS_INITIAL,
    reconnectTimer: null,
    // for testing / observability
    lastError: null,
    // set by disconnect() to suppress reconnect
    _disconnected: false,
    // server-time offset estimate (server-clock ms - client-clock ms) — set on WELCOME
    serverTsOffset: 0,
    connect,
    disconnect,
    send,
    setState,
    _handleMessage,
    _scheduleReconnect,
  };

  return api;

  // ---------- state ----------

  function setState(next, meta) {
    if (api.state === next) return;
    api.state = next;
    emit('state', { state: next, ...(meta || {}) });
  }

  // ---------- lifecycle ----------

  function connect() {
    if (api._disconnected) api._disconnected = false;
    if (api.state === WS_STATE.CONNECTING || api.state === WS_STATE.AUTHENTICATING || api.state === WS_STATE.CONNECTED) {
      return;
    }
    setState(WS_STATE.CONNECTING);
    try {
      api.ws = new WebSocketCtor(url);
    } catch (err) {
      api.lastError = err;
      setState(WS_STATE.CLOSED, { reason: 'construct_failed' });
      _scheduleReconnect();
      return;
    }
    api.ws.onopen    = () => { /* wait for HELLO */ };
    api.ws.onmessage = (ev) => _handleMessage(ev && ev.data);
    api.ws.onerror   = (err) => { api.lastError = err; };
    api.ws.onclose   = (ev) => {
      const wasConnected = api.state === WS_STATE.CONNECTED || api.state === WS_STATE.AUTHENTICATING;
      setState(WS_STATE.CLOSED, { code: ev && ev.code, reason: ev && ev.reason });
      api.ws = null;
      if (wasConnected || api.state === WS_STATE.CLOSED) _scheduleReconnect();
    };
  }

  function disconnect(reason = 'client_disconnect') {
    api._disconnected = true;
    if (api.reconnectTimer) {
      clearTimeoutFn(api.reconnectTimer);
      api.reconnectTimer = null;
    }
    if (api.ws) {
      try { api.ws.close(1000, reason); } catch { /* noop */ }
      api.ws = null;
    }
    setState(WS_STATE.CLOSED, { reason });
  }

  function send(msg) {
    if (api.state !== WS_STATE.CONNECTED) return false;
    if (!api.ws) return false;
    try { api.ws.send(encode(msg)); return true; }
    catch (err) { api.lastError = err; return false; }
  }

  // ---------- message handling ----------

  async function _handleMessage(raw) {
    const parsed = decode(raw);
    if (!parsed.ok) {
      emit('bad_message', { code: parsed.code, error: parsed.error });
      // A version mismatch in the HELLO must abort the connection — no reason
      // to keep waiting on a server we can't speak to.
      if (parsed.code === 'BAD_VERSION') disconnect('protocol_mismatch');
      return;
    }
    const msg = sanitize(parsed.msg);
    switch (msg.t) {
      case MSG.HELLO: {
        if (msg.protocolVersion !== PROTOCOL_VERSION) {
          emit('bad_message', { code: 'BAD_VERSION', error: 'protocol mismatch' });
          disconnect('protocol_mismatch');
          return;
        }
        setState(WS_STATE.AUTHENTICATING);
        try {
          const auth = await signAuth({ challenge: msg.challenge });
          if (!api.ws) return;
          api.ws.send(encode({ t: MSG.AUTH, npub: auth.npub, sig: auth.sig, event: auth.event }));
        } catch (err) {
          api.lastError = err;
          emit('auth_error', { error: String(err && err.message || err) });
          disconnect('auth_error');
        }
        return;
      }
      case MSG.WELCOME: {
        api.selfId = msg.selfId;
        setState(WS_STATE.CONNECTED, { selfId: msg.selfId });
        api.backoffMs = BACKOFF_MS_INITIAL; // reset on successful connect
        emit('roster', { roster: msg.roster });
        return;
      }
      case MSG.AUTH_FAIL: {
        emit('auth_fail', { reason: msg.reason });
        disconnect('auth_fail');
        return;
      }
      case MSG.JOIN:  emit('peerJoin', msg); return;
      case MSG.LEFT:  emit('peerLeft', msg); return;
      case MSG.MOVE:  emit('move', msg);    return;
      case MSG.SHOT:  emit('shot', msg);    return;
      case MSG.HIT:   emit('hit', msg);     return;
      case MSG.KILL:  emit('kill', msg);    return;
      case MSG.CHAT:  emit('chat', msg);    return;
      case MSG.PING:  send({ t: MSG.PONG, ts: msg.ts }); return;
      case MSG.PONG:  return; // measured elsewhere
      default: return;
    }
  }

  // ---------- reconnect ----------

  function _scheduleReconnect() {
    if (api._disconnected) return;
    const delay = api.backoffMs;
    api.backoffMs = Math.min(api.backoffMs * 2, BACKOFF_MS_CAP);
    if (api.reconnectTimer) clearTimeoutFn(api.reconnectTimer);
    api.reconnectTimer = setTimeoutFn(() => {
      api.reconnectTimer = null;
      if (api._disconnected) return;
      connect();
    }, delay);
    emit('reconnect_scheduled', { delay });
  }
}
