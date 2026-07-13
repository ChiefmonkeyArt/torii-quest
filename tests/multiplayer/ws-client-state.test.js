// ws-client-state.test.js — locks the MP-1 WS client state machine.
// Uses a fake WebSocket + fake timers, so it stays node-pure.
import { describe, it, expect, vi } from 'vitest';
import {
  createWsClient, WS_STATE,
  BACKOFF_MS_INITIAL, BACKOFF_MS_CAP, KEEPALIVE_MS,
} from '../../src/engine/multiplayer/wsClient.js';
import { MSG, PROTOCOL_VERSION, encode } from '../../src/engine/multiplayer/wireProtocol.js';

// ---------- fake WebSocket ----------

class FakeWS {
  static instances = [];
  constructor(url) {
    this.url = url;
    this.sent = [];
    this.closed = false;
    FakeWS.instances.push(this);
  }
  send(data) { this.sent.push(data); }
  close(code, reason) {
    this.closed = true;
    if (this.onclose) this.onclose({ code: code || 1000, reason: reason || '' });
  }
  // Test helpers
  _open()               { if (this.onopen) this.onopen(); }
  _message(payload)     { if (this.onmessage) this.onmessage({ data: typeof payload === 'string' ? payload : encode(payload) }); }
  _closeFromServer(code = 1006, reason = 'lost') {
    this.closed = true;
    if (this.onclose) this.onclose({ code, reason });
  }
}

function makeClient(overrides = {}) {
  FakeWS.instances.length = 0;
  const emitted = [];
  const timers = [];
  const setTimeoutFn = (fn, ms) => { const id = timers.length + 1; timers.push({ id, fn, ms }); return id; };
  const clearTimeoutFn = (id) => { const i = timers.findIndex((t) => t.id === id); if (i >= 0) timers.splice(i, 1); };
  const client = createWsClient({
    url: 'wss://example.test/mp',
    WebSocketCtor: FakeWS,
    signAuth: overrides.signAuth || (async ({ challenge }) => ({
      npub: 'npub1' + 'x'.repeat(58),
      sig:  'b'.repeat(128),
      event: { kind: 22242, tags: [['challenge', challenge]], content: '', created_at: 1 },
    })),
    emit: (name, payload) => emitted.push({ name, payload }),
    setTimeoutFn,
    clearTimeoutFn,
  });
  return { client, emitted, timers, runTimers: () => { const t = timers.splice(0); t.forEach(({ fn }) => fn()); } };
}

// ---------- tests ----------

describe('wsClient state machine', () => {
  it('starts idle, transitions idle → connecting on connect()', () => {
    const { client } = makeClient();
    expect(client.state).toBe(WS_STATE.IDLE);
    client.connect();
    expect(client.state).toBe(WS_STATE.CONNECTING);
    expect(FakeWS.instances.length).toBe(1);
    expect(FakeWS.instances[0].url).toBe('wss://example.test/mp');
  });

  it('runs the full handshake to CONNECTED and emits roster', async () => {
    const { client, emitted } = makeClient();
    client.connect();
    const ws = FakeWS.instances[0];
    ws._open();
    ws._message({ t: MSG.HELLO, challenge: 'a'.repeat(44), serverVersion: 'v0.2.366-alpha', protocolVersion: PROTOCOL_VERSION });
    // signAuth is async — flush microtasks.
    await Promise.resolve(); await Promise.resolve();
    expect(client.state).toBe(WS_STATE.AUTHENTICATING);
    // WELCOME arrives.
    ws._message({ t: MSG.WELCOME, selfId: 'me1', roster: [] });
    expect(client.state).toBe(WS_STATE.CONNECTED);
    expect(client.selfId).toBe('me1');
    expect(emitted.some((e) => e.name === 'roster')).toBe(true);
  });

  it('rejects a mismatched protocolVersion and closes', async () => {
    const { client, emitted } = makeClient();
    client.connect();
    const ws = FakeWS.instances[0];
    ws._open();
    ws._message({ t: MSG.HELLO, challenge: 'a'.repeat(44), serverVersion: 'v99', protocolVersion: 999 });
    expect(client.state).toBe(WS_STATE.CLOSED);
    expect(emitted.some((e) => e.name === 'bad_message' && e.payload.code === 'BAD_VERSION')).toBe(true);
  });

  it('exponential backoff: schedules reconnect and doubles the delay, capped at BACKOFF_MS_CAP', () => {
    const { client, timers } = makeClient();
    client.connect();
    // Simulate server dropping the connection immediately.
    FakeWS.instances[0]._closeFromServer(1006, 'lost');
    // First reconnect scheduled at BACKOFF_MS_INITIAL.
    expect(timers[0].ms).toBe(BACKOFF_MS_INITIAL);
    // Manually walk backoffMs to verify doubling capped.
    // After the initial schedule, backoffMs should be 2x initial.
    expect(client.backoffMs).toBe(BACKOFF_MS_INITIAL * 2);
    // Simulate 20 rounds worth to verify cap.
    for (let i = 0; i < 20; i++) client._scheduleReconnect();
    expect(client.backoffMs).toBe(BACKOFF_MS_CAP);
  });

  it('disconnect() cancels reconnect and stays closed', () => {
    const { client, timers } = makeClient();
    client.connect();
    FakeWS.instances[0]._closeFromServer(1006);
    expect(timers.length).toBe(1);
    client.disconnect('user requested');
    expect(timers.length).toBe(0);
    expect(client.state).toBe(WS_STATE.CLOSED);
    expect(client._disconnected).toBe(true);
  });
});

describe('wsClient keepalive', () => {
  async function toConnected(client) {
    client.connect();
    const ws = FakeWS.instances[0];
    ws._open();
    ws._message({ t: MSG.HELLO, challenge: 'a'.repeat(44), serverVersion: 'v0.2.374-alpha', protocolVersion: PROTOCOL_VERSION });
    await Promise.resolve(); await Promise.resolve();
    ws._message({ t: MSG.WELCOME, selfId: 'me1', roster: [] });
    return ws;
  }

  it('starts a keepalive timer at KEEPALIVE_MS when it reaches CONNECTED', async () => {
    const { client, timers } = makeClient();
    await toConnected(client);
    expect(client.state).toBe(WS_STATE.CONNECTED);
    expect(client.keepaliveTimer).not.toBeNull();
    expect(timers.some((t) => t.ms === KEEPALIVE_MS)).toBe(true);
  });

  it('sends a PING on each keepalive tick and re-arms the timer', async () => {
    const { client, timers } = makeClient();
    const ws = await toConnected(client);
    const before = ws.sent.length;
    // Fire the pending keepalive tick.
    const tick = timers.find((t) => t.ms === KEEPALIVE_MS);
    tick.fn();
    expect(ws.sent.length).toBe(before + 1);
    expect(ws.sent[ws.sent.length - 1]).toContain(MSG.PING);
    // A fresh keepalive timer is re-armed (recursive setTimeout, not a one-shot).
    expect(client.keepaliveTimer).not.toBeNull();
  });

  it('clears the keepalive timer on disconnect()', async () => {
    const { client } = makeClient();
    await toConnected(client);
    expect(client.keepaliveTimer).not.toBeNull();
    client.disconnect('user requested');
    expect(client.keepaliveTimer).toBeNull();
  });

  it('clears the keepalive timer when the socket closes', async () => {
    const { client } = makeClient();
    const ws = await toConnected(client);
    expect(client.keepaliveTimer).not.toBeNull();
    ws._closeFromServer(1006, 'lost');
    expect(client.keepaliveTimer).toBeNull();
  });
});
