// connectionDiagnostics.js — ADR-0049 v0.2.671.
//
// Two independent "why did the BOT_STATE stream stall?" signals, captured at shot
// time so a miss ema can split the stall cause:
//
//   1. WebSocket transport + protocol lifecycle (connect / open / close / reconnect
//      / state) — proves whether the socket dropped and re-dialed mid-stall.
//   2. Main-thread heartbeat (gap between rAF ticks) — proves whether the event
//      loop froze (a long synchronous task / GC / render hitch), which would ALSO
//      starve the WebSocket onmessage handler and thus the BOT_STATE ingest.
//
// ADR-0048 proved the stream stalls (lastIngestAge >> 1s at shot time). This
// module answers WHY: if `ws.lastCloseAge` is small the socket dropped; if
// `heartbeat.maxGap` is large the main thread froze. Both use the SAME monotonic
// clock (performance.now) as botNetState so ages are directly comparable.
//
// Pure factory (createConnectionDiagnostics) for tests + a module-level singleton
// with thin hook exports the runtime wiring calls directly.

export const HEARTBEAT_STALL_THRESHOLD_MS = 250;

const _defaultNow = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

export function createConnectionDiagnostics(now = _defaultNow) {
  // --- WebSocket lifecycle ---
  let _connectAttempts = 0;   // transport dials (connect() calls)
  let _openCount = 0;         // transport onopen
  let _closeCount = 0;        // transport onclose
  let _reconnectCount = 0;    // reconnect schedules
  let _lastOpenAt = null;
  let _lastCloseAt = null;
  let _lastCloseCode = null;
  let _lastCloseReason = null;
  let _connectedAt = null;    // last time the protocol reached CONNECTED
  let _state = 'idle';
  let _stateAt = null;

  // --- main-thread heartbeat ---
  let _lastTickAt = null;
  let _lastGap = 0;
  let _maxGap = 0;
  let _stallCount = 0;        // rAF gaps > HEARTBEAT_STALL_THRESHOLD_MS

  function recordConnect() { _connectAttempts++; }

  function recordOpen() {
    _openCount++;
    _lastOpenAt = now();
  }

  function recordClose(code, reason) {
    _closeCount++;
    _lastCloseAt = now();
    _lastCloseCode = (code === undefined || code === null) ? null : code;
    _lastCloseReason = (reason === undefined || reason === null) ? null : reason;
  }

  function recordReconnect() { _reconnectCount++; }

  function recordState(state) {
    if (_state === state) return;
    _state = state;
    _stateAt = now();
    if (state === 'connected') _connectedAt = now();
  }

  function heartbeat() {
    const t = now();
    if (_lastTickAt !== null) {
      const gap = t - _lastTickAt;
      _lastGap = gap;
      if (gap > _maxGap) _maxGap = gap;
      if (gap > HEARTBEAT_STALL_THRESHOLD_MS) _stallCount++;
    }
    _lastTickAt = t;
  }

  function diagnose() {
    const t = now();
    return {
      ws: {
        state: _state,
        stateAge: _stateAt !== null ? Math.round(t - _stateAt) : null,
        connectAttempts: _connectAttempts,
        openCount: _openCount,
        closeCount: _closeCount,
        reconnectCount: _reconnectCount,
        lastCloseCode: _lastCloseCode,
        lastCloseReason: _lastCloseReason,
        lastCloseAge: _lastCloseAt !== null ? Math.round(t - _lastCloseAt) : null,
        lastOpenAge: _lastOpenAt !== null ? Math.round(t - _lastOpenAt) : null,
        connectedAge: _connectedAt !== null ? Math.round(t - _connectedAt) : null,
      },
      heartbeat: {
        lastGap: Math.round(_lastGap),
        maxGap: Math.round(_maxGap),
        stallCount: _stallCount,
      },
    };
  }

  function reset() {
    _connectAttempts = 0;
    _openCount = 0;
    _closeCount = 0;
    _reconnectCount = 0;
    _lastOpenAt = null;
    _lastCloseAt = null;
    _lastCloseCode = null;
    _lastCloseReason = null;
    _connectedAt = null;
    _state = 'idle';
    _stateAt = null;
    _lastTickAt = null;
    _lastGap = 0;
    _maxGap = 0;
    _stallCount = 0;
  }

  return {
    recordConnect, recordOpen, recordClose, recordReconnect, recordState,
    heartbeat, diagnose, reset,
  };
}

// --- singleton (runtime wiring) ---

const _diag = createConnectionDiagnostics();

export const recordConnect = _diag.recordConnect;
export const recordOpen = _diag.recordOpen;
export const recordClose = _diag.recordClose;
export const recordReconnect = _diag.recordReconnect;
export const recordState = _diag.recordState;
export const heartbeat = _diag.heartbeat;

export function getConnectionDiagnostic() { return _diag.diagnose(); }
export function resetConnectionDiagnostic() { _diag.reset(); }
