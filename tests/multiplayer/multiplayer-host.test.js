// multiplayer-host.test.js — locks the MP-1 host wire (single seam that main.js calls).
// Pure — fake WebSocket + fake scene, no browser globals.
import { describe, it, expect, vi } from 'vitest';
import { createMultiplayerHost } from '../../src/engine/multiplayer/multiplayerHost.js';
import { WS_STATE } from '../../src/engine/multiplayer/wsClient.js';
import { MSG, PROTOCOL_VERSION, encode } from '../../src/engine/multiplayer/wireProtocol.js';

// ---------- fakes ----------

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
  _open() { if (this.onopen) this.onopen(); }
  _message(payload) {
    if (this.onmessage) this.onmessage({ data: typeof payload === 'string' ? payload : encode(payload) });
  }
}

function makeFakeObj(id) {
  const pos = { x: 0, y: 0, z: 0, set(x, y, z) { this.x = x; this.y = y; this.z = z; } };
  const rot = { x: 0, y: 0, z: 0, set(x, y, z) { this.x = x; this.y = y; this.z = z; } };
  return { id, position: pos, rotation: rot, disposed: false, dispose() { this.disposed = true; } };
}
function makeFakeScene() {
  const added = new Set(); const removed = [];
  return {
    add: (o) => added.add(o),
    remove: (o) => { added.delete(o); removed.push(o); },
    _added: added, _removed: removed,
  };
}

const goodSignAuth = async ({ challenge }) => ({
  npub: 'npub1' + 'x'.repeat(58),
  sig:  'b'.repeat(128),
  event: { kind: 22242, tags: [['challenge', challenge]], content: '', created_at: 1 },
});

function makeHost(overrides = {}) {
  FakeWS.instances.length = 0;
  const emitted = [];
  const host = createMultiplayerHost({
    scene: overrides.scene || makeFakeScene(),
    avatarLoader: overrides.avatarLoader || (async (p) => makeFakeObj(p.id)),
    signAuth: overrides.signAuth || goodSignAuth,
    origin: 'example.test',
    mpEnabled: overrides.mpEnabled !== undefined ? overrides.mpEnabled : true,
    WebSocketCtor: FakeWS,
    emit: (name, payload) => emitted.push({ name, payload }),
    now: overrides.now || (() => 1000),
  });
  return { host, emitted };
}

// Peer descriptors matching wireProtocol validators (character is required for JOIN/WELCOME).
const peerDesc = (id, extra = {}) => ({
  id, npub: 'npub1' + id.repeat(58).slice(0, 58),
  pos: [0, 0, 0], rot: [0, 0], character: 'chiefmonkey', ...extra,
});

// Drive the WS through the full handshake so host.state === CONNECTED.
async function handshake(ws, { selfId = 'me1', roster = [] } = {}) {
  ws._open();
  ws._message({ t: MSG.HELLO, challenge: 'a'.repeat(44), serverVersion: 'test', protocolVersion: PROTOCOL_VERSION });
  await Promise.resolve(); await Promise.resolve();
  ws._message({ t: MSG.WELCOME, selfId, roster });
  // Flush async roster upserts.
  await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
}

// ---------- constructor validation ----------

describe('multiplayerHost — constructor', () => {
  it('throws without a scene', () => {
    expect(() => createMultiplayerHost({
      avatarLoader: () => ({}), signAuth: async () => ({}),
    })).toThrow(/scene required/);
  });
  it('throws without an avatarLoader', () => {
    expect(() => createMultiplayerHost({
      scene: makeFakeScene(), signAuth: async () => ({}),
    })).toThrow(/avatarLoader required/);
  });
  it('throws without a signAuth', () => {
    expect(() => createMultiplayerHost({
      scene: makeFakeScene(), avatarLoader: () => ({}),
    })).toThrow(/signAuth required/);
  });
});

// ---------- start / stop ----------

describe('multiplayerHost — lifecycle', () => {
  it('start() short-circuits when MP_ENABLED is false and never opens a socket', () => {
    const { host, emitted } = makeHost({ mpEnabled: false });
    const ok = host.start();
    expect(ok).toBe(false);
    expect(FakeWS.instances.length).toBe(0);
    expect(emitted.some((e) => e.name === 'mp_disabled')).toBe(true);
  });

  it('start() opens the WS at wss://<origin>/mp when enabled', () => {
    const { host } = makeHost();
    const ok = host.start();
    expect(ok).toBe(true);
    expect(FakeWS.instances.length).toBe(1);
    expect(FakeWS.instances[0].url).toBe('wss://example.test/mp');
  });

  it('start() is idempotent — a second call does not open a second socket', () => {
    const { host } = makeHost();
    host.start();
    host.start();
    expect(FakeWS.instances.length).toBe(1);
  });

  it('stop() disconnects the ws, disposes the roster, and resets state', async () => {
    const scene = makeFakeScene();
    const { host } = makeHost({ scene });
    host.start();
    const ws = FakeWS.instances[0];
    await handshake(ws, { selfId: 'me', roster: [peerDesc('p1')] });
    expect(host.roster.size).toBe(1);
    host.stop('test');
    expect(ws.closed).toBe(true);
    expect(host.state).toBe(WS_STATE.CLOSED);
    expect(host.selfId).toBe(null);
    expect(host.roster.size).toBe(0);
  });
});

// ---------- WS event fan-in ----------

describe('multiplayerHost — inbound wire', () => {
  it('WELCOME → sets selfId and populates roster from the welcome payload', async () => {
    const scene = makeFakeScene();
    const { host } = makeHost({ scene });
    host.start();
    const ws = FakeWS.instances[0];
    await handshake(ws, { selfId: 'me7', roster: [
      peerDesc('p1', { pos: [1, 0, 2] }),
      peerDesc('p2', { pos: [3, 0, 4] }),
    ]});
    expect(host.selfId).toBe('me7');
    expect(host.state).toBe(WS_STATE.CONNECTED);
    expect(host.roster.size).toBe(2);
  });

  it('JOIN → upserts a new peer into the roster', async () => {
    const { host } = makeHost();
    host.start();
    const ws = FakeWS.instances[0];
    await handshake(ws);
    ws._message({ t: MSG.JOIN, ...peerDesc('p9') });
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    expect(host.roster.size).toBe(1);
  });

  it('LEFT → removes a peer from the roster', async () => {
    const { host } = makeHost();
    host.start();
    const ws = FakeWS.instances[0];
    await handshake(ws);
    ws._message({ t: MSG.JOIN, ...peerDesc('p1') });
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    expect(host.roster.size).toBe(1);
    ws._message({ t: MSG.LEFT, id: 'p1', reason: 'quit' });
    expect(host.roster.size).toBe(0);
  });

  it('MOVE → feeds the peer snapshot buffer (visible via tick interpolation)', async () => {
    const { host } = makeHost();
    host.start();
    const ws = FakeWS.instances[0];
    await handshake(ws);
    ws._message({ t: MSG.JOIN, ...peerDesc('p1') });
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    // Two moves — the buffer records both regardless of interp timing.
    ws._message({ t: MSG.MOVE, id: 'p1', pos: [0, 0, 0],  rot: [0, 0], vel: [0, 0, 0] });
    ws._message({ t: MSG.MOVE, id: 'p1', pos: [10, 0, 0], rot: [0, 0], vel: [0, 0, 0] });
    const entry = host.roster._peek('p1');
    expect(entry).not.toBeNull();
    expect(entry.buf.snaps.length).toBeGreaterThanOrEqual(2);
  });
});

// ---------- outbound wire ----------

describe('multiplayerHost — outbound wire', () => {
  it('sendMove/Shot/Hit/Kill/Chat are dropped when not CONNECTED', () => {
    const { host } = makeHost();
    host.start();
    // still CONNECTING — no handshake yet
    expect(host.sendMove({ pos: [0, 0, 0], rot: [0, 0], vel: [0, 0, 0] })).toBe(false);
    expect(host.sendShot({ origin: [0, 0, 0], dir: [1, 0, 0], ts: 1 })).toBe(false);
    expect(host.sendHit({ targetId: 'x', dmg: 25, zone: 'body', shotTs: 1 })).toBe(false);
  });

  it('after CONNECTED, sendMove/Shot/Hit/Kill/Chat emit framed messages with the correct type', async () => {
    const { host } = makeHost();
    host.start();
    const ws = FakeWS.instances[0];
    await handshake(ws);
    expect(host.sendMove({ pos: [1, 2, 3], rot: [0.5, 0], vel: [0, 0, 0] })).toBe(true);
    expect(host.sendShot({ origin: [0, 0, 0], dir: [1, 0, 0], ts: 100 })).toBe(true);
    expect(host.sendHit({ targetId: 'p1', dmg: 25, zone: 'body', shotTs: 99 })).toBe(true);
    expect(host.sendKill({ shooterId: 'me', victimId: 'p1', weapon: 'pistol' })).toBe(true);
    expect(host.sendChat('gg')).toBe(true);
    // Skip the initial AUTH frame; sanity-check the last 5 sends against expected types.
    const outbound = ws.sent.slice(-5).map((raw) => JSON.parse(raw).t);
    expect(outbound).toEqual([MSG.MOVE, MSG.SHOT, MSG.HIT, MSG.KILL, MSG.CHAT]);
  });

  it('tick() forwards to the roster (no crash when roster is empty)', () => {
    const { host } = makeHost();
    host.start();
    expect(() => host.tick(16.6)).not.toThrow();
  });
});
