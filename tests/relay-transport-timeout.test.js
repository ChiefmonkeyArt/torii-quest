// tests/relay-transport-timeout.test.js — locks audit F04: a relay request or
// publication must settle exactly-once and never leave a socket that can open
// later and emit a stray REQ/EVENT after a CONNECTING-time timeout.
//
// relayReq/publishEvent construct the GLOBAL WebSocket, so we stub it with a
// controllable fake that stays in CONNECTING (readyState 0) until the test
// decides to drive open/message/error.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { relayReq, publishEvent } from '../src/nostr.js';

class FakeWebSocket {
  static instances = [];
  constructor(url) {
    this.url = url;
    this.readyState = 0; // CONNECTING
    this.sent = [];
    this._closed = false;
    this.onopen = this.onmessage = this.onerror = this.onclose = null;
    FakeWebSocket.instances.push(this);
  }
  send(data) { this.sent.push(data); }
  // close() in CONNECTING/OPEN both just mark terminated; do not auto-fire
  // onclose (the real event loop would, but the test drives frames itself).
  close() { this._closed = true; this.readyState = 3; }
  // test drivers
  _open() { this.readyState = 1; if (this.onopen) this.onopen({}); }
  _message(obj) { if (this.onmessage) this.onmessage({ data: JSON.stringify(obj) }); }
}

const EVENT = {
  id: 'a'.repeat(64), pubkey: 'b'.repeat(64), kind: 0,
  created_at: 1700000000, content: '{}', tags: [], sig: 'c'.repeat(128),
};

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

describe('relayReq — F04 timeout/cancellation', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('closes a CONNECTING socket on timeout and a late open never sends a REQ', async () => {
    vi.stubGlobal('WebSocket', FakeWebSocket);
    FakeWebSocket.instances = [];
    const p = relayReq('wss://r.example', [{ kinds: [0] }], { timeoutMs: 10 });
    await sleep(30); // let the timeout win before any open
    const ws = FakeWebSocket.instances[0];
    expect(ws._closed).toBe(true); // terminated even though still CONNECTING
    ws._open();                    // simulate the late handshake completing
    expect(ws.sent.length).toBe(0); // guard: no stray REQ after settlement
    const res = await p;
    expect(res.ok).toBe(false);
    expect(res.error).toBe('timeout');
  });
});

describe('publishEvent — F04 timeout/cancellation', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('closes a CONNECTING socket on timeout and a late open never sends an EVENT', async () => {
    vi.stubGlobal('WebSocket', FakeWebSocket);
    FakeWebSocket.instances = [];
    const p = publishEvent('wss://r.example', EVENT, { timeoutMs: 10 });
    await sleep(30);
    const ws = FakeWebSocket.instances[0];
    expect(ws._closed).toBe(true);
    ws._open();
    expect(ws.sent.length).toBe(0);
    const res = await p;
    expect(res.ok).toBe(false);
    expect(res.error).toBe('timeout');
  });

  it('settles exactly once on a duplicate OK frame', async () => {
    vi.stubGlobal('WebSocket', FakeWebSocket);
    FakeWebSocket.instances = [];
    const p = publishEvent('wss://r.example', EVENT, { timeoutMs: 100 });
    const ws = FakeWebSocket.instances[0];
    ws._open();
    ws.sent.length = 0; // ignore the EVENT frame for this assertion
    ws._message(['OK', EVENT.id, true, '']);
    ws._message(['OK', EVENT.id, true, '']); // duplicate — must be ignored
    const res = await p;
    expect(res.ok).toBe(true);
    expect(res.accepted).toBe(true);
  });
});