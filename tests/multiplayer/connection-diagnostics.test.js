// tests/multiplayer/connection-diagnostics.test.js — ADR-0049 v0.2.671.
//
// Locks the WebSocket lifecycle + main-thread heartbeat diagnostic
// (src/engine/diagnostics/connectionDiagnostics.js) and the wsClient emit wiring
// that feeds it. ADR-0048 proved the BOT_STATE stream stalls (lastIngestAge >> 1s);
// this diagnostic splits the WHY: socket dropped (ws.lastCloseAge small) vs main
// thread froze (heartbeat.maxGap large).
import { describe, it, expect } from 'vitest';
import {
  createConnectionDiagnostics,
  HEARTBEAT_STALL_THRESHOLD_MS,
} from '../../src/engine/diagnostics/connectionDiagnostics.js';
import { createWsClient, WS_STATE } from '../../src/engine/multiplayer/wsClient.js';
import { MSG, encode } from '../../src/engine/multiplayer/wireProtocol.js';

// A fake clock so ages are deterministic.
function makeClock(start = 1000) {
  let t = start;
  return { now: () => t, advance: (ms) => { t += ms; }, set: (v) => { t = v; } };
}

describe('createConnectionDiagnostics — WebSocket lifecycle', () => {
  it('records connect attempts, opens, closes, and reconnects with ages', () => {
    const clock = makeClock(1000);
    const d = createConnectionDiagnostics(clock.now);
    d.recordConnect();
    d.recordConnect();
    clock.advance(10);
    d.recordOpen();
    clock.advance(50);
    d.recordClose(1006, 'lost');
    d.recordReconnect();

    const out = d.diagnose();
    expect(out.ws.connectAttempts).toBe(2);
    expect(out.ws.openCount).toBe(1);
    expect(out.ws.closeCount).toBe(1);
    expect(out.ws.reconnectCount).toBe(1);
    expect(out.ws.lastCloseCode).toBe(1006);
    expect(out.ws.lastCloseReason).toBe('lost');
    expect(out.ws.lastCloseAge).toBe(0); // closed at t=1060, diagnose at t=1060
    expect(out.ws.lastOpenAge).toBe(50);
  });

  it('tracks state transitions and the last time we reached CONNECTED', () => {
    const clock = makeClock(0);
    const d = createConnectionDiagnostics(clock.now);
    d.recordState('connecting');
    clock.advance(20);
    d.recordState('authenticating');
    clock.advance(30);
    d.recordState('connected');

    const out = d.diagnose();
    expect(out.ws.state).toBe('connected');
    expect(out.ws.stateAge).toBe(0);
    expect(out.ws.connectedAge).toBe(0);

    clock.advance(100);
    expect(d.diagnose().ws.connectedAge).toBe(100);
  });

  it('ignores duplicate state transitions (no stateAge reset on same state)', () => {
    const clock = makeClock(0);
    const d = createConnectionDiagnostics(clock.now);
    d.recordState('connected');
    clock.advance(50);
    d.recordState('connected'); // no-op
    expect(d.diagnose().ws.stateAge).toBe(50);
  });

  it('returns null ages before any event', () => {
    const d = createConnectionDiagnostics(() => 0);
    const out = d.diagnose();
    expect(out.ws.state).toBe('idle');
    expect(out.ws.lastCloseAge).toBeNull();
    expect(out.ws.lastOpenAge).toBeNull();
    expect(out.ws.connectedAge).toBeNull();
    expect(out.ws.connectAttempts).toBe(0);
  });
});

describe('createConnectionDiagnostics — main-thread heartbeat', () => {
  it('measures the gap between ticks and tracks the max + stall count', () => {
    const clock = makeClock(0);
    const d = createConnectionDiagnostics(clock.now);
    d.heartbeat();          // t=0 (first tick, no gap yet)
    clock.advance(16);
    d.heartbeat();          // gap 16ms — normal
    clock.advance(5000);
    d.heartbeat();          // gap 5000ms — a freeze
    clock.advance(16);
    d.heartbeat();          // gap 16ms — recovered

    const out = d.diagnose();
    expect(out.heartbeat.lastGap).toBe(16);
    expect(out.heartbeat.maxGap).toBe(5000);
    expect(out.heartbeat.stallCount).toBe(1); // only the 5000ms gap exceeds threshold
  });

  it('counts every gap above the stall threshold', () => {
    const clock = makeClock(0);
    const d = createConnectionDiagnostics(clock.now);
    d.heartbeat();
    clock.advance(HEARTBEAT_STALL_THRESHOLD_MS + 1);
    d.heartbeat();
    clock.advance(HEARTBEAT_STALL_THRESHOLD_MS + 1);
    d.heartbeat();
    expect(d.diagnose().heartbeat.stallCount).toBe(2);
  });

  it('does not count a gap exactly at the threshold as a stall', () => {
    const clock = makeClock(0);
    const d = createConnectionDiagnostics(clock.now);
    d.heartbeat();
    clock.advance(HEARTBEAT_STALL_THRESHOLD_MS);
    d.heartbeat();
    expect(d.diagnose().heartbeat.stallCount).toBe(0);
    expect(d.diagnose().heartbeat.maxGap).toBe(HEARTBEAT_STALL_THRESHOLD_MS);
  });

  it('reset() clears all lifecycle and heartbeat state', () => {
    const clock = makeClock(0);
    const d = createConnectionDiagnostics(clock.now);
    d.recordConnect();
    d.recordOpen();
    d.recordClose(1000, 'x');
    d.recordState('connected');
    d.heartbeat();
    clock.advance(1000);
    d.heartbeat();
    d.reset();

    const out = d.diagnose();
    expect(out.ws.connectAttempts).toBe(0);
    expect(out.ws.closeCount).toBe(0);
    expect(out.ws.state).toBe('idle');
    expect(out.ws.lastCloseAge).toBeNull();
    expect(out.heartbeat.maxGap).toBe(0);
    expect(out.heartbeat.stallCount).toBe(0);
  });
});

describe('wsClient emits socket lifecycle events (ADR-0049 wiring)', () => {
  class FakeWS {
    constructor(url) { this.url = url; this.sent = []; }
    send(d) { this.sent.push(d); }
    close(code, reason) { if (this.onclose) this.onclose({ code: code || 1000, reason: reason || '' }); }
    _open() { if (this.onopen) this.onopen(); }
    _message(p) { if (this.onmessage) this.onmessage({ data: typeof p === 'string' ? p : encode(p) }); }
    _closeFromServer(code = 1006, reason = 'lost') { if (this.onclose) this.onclose({ code, reason }); }
  }

  function makeClient() {
    const emitted = [];
    const client = createWsClient({
      url: 'wss://example.test/mp',
      WebSocketCtor: FakeWS,
      signAuth: async () => ({ npub: 'npub1' + 'x'.repeat(58), sig: 'b'.repeat(128), event: {} }),
      emit: (name, payload) => emitted.push({ name, payload }),
      setTimeoutFn: () => 1,
      clearTimeoutFn: () => {},
    });
    return { client, emitted };
  }

  it('emits socket_connect on connect(), socket_open on onopen, socket_close on onclose', () => {
    const { client, emitted } = makeClient();
    client.connect();
    const sock = client.ws; // the FakeWS instance connect() constructed
    sock._open();
    sock._closeFromServer(1006, 'lost');

    expect(emitted.some((e) => e.name === 'socket_connect')).toBe(true);
    expect(emitted.some((e) => e.name === 'socket_open')).toBe(true);
    const close = emitted.find((e) => e.name === 'socket_close');
    expect(close).toBeTruthy();
    expect(close.payload.code).toBe(1006);
    expect(close.payload.reason).toBe('lost');
  });
});
