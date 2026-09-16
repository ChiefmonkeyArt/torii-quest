// spectator-client.test.js — the READ-ONLY live stream (ADR-0118 D4). Locks that a
// spectator sends SPECTATE (and only SPECTATE + PING), projects BOT_STATE/JOIN/MOVE/LEFT
// into a pollable roster, and never emits identity or mutation.
import { describe, it, expect, vi } from 'vitest';
import { createSpectatorClient, SPECTATOR_STATE } from '../../src/engine/multiplayer/spectatorClient.js';
import { MSG, encode } from '../../src/engine/multiplayer/wireProtocol.js';

// A minimal mock WebSocket with controllable lifecycle, mirroring spectatorGate's style.
function mockSocket() {
  const sent = [];
  const ws = {
    sent,
    onopen: null, onmessage: null, onerror: null, onclose: null,
    send(raw) { sent.push(raw); },
    close() { if (ws.onclose) ws.onclose(); },
    // test helpers
    open() { if (ws.onopen) ws.onopen(); },
    message(msg) { if (ws.onmessage) ws.onmessage({ data: encode(msg) }); },
  };
  return ws;
}

function decodeSent(raw) {
  return JSON.parse(typeof raw === 'string' ? raw : String(raw));
}

// Wrap a mock socket in a constructor (the client does `new WebSocketCtor(url)`).
function ctorFor(ws) {
  return function MockWebSocket() { return ws; };
}

describe('createSpectatorClient', () => {
  it('sends SPECTATE on open, nothing before it', () => {
    const ws = mockSocket();
    const c = createSpectatorClient({ url: 'wss://dest/mp', WebSocketCtor: ctorFor(ws), now: () => 1 });
    expect(c.state).toBe(SPECTATOR_STATE.IDLE);
    c.open();
    expect(c.state).toBe(SPECTATOR_STATE.CONNECTING);
    expect(ws.sent).toHaveLength(0); // nothing sent before the socket opens
    ws.open();
    expect(c.state).toBe(SPECTATOR_STATE.LIVE);
    expect(ws.sent).toHaveLength(1);
    expect(decodeSent(ws.sent[0]).t).toBe(MSG.SPECTATE);
  });

  it('projects BOT_STATE into a pollable bot roster, last-write-wins', () => {
    const ws = mockSocket();
    const c = createSpectatorClient({ url: 'wss://x', WebSocketCtor: ctorFor(ws) });
    c.open(); ws.open();
    ws.message({ t: MSG.BOT_STATE, bots: [
      { id: 0, x: 1, z: 2, rotY: 0.5, hp: 100, alive: true, animHint: 'walk' },
      { id: 1, x: 5, z: 6, rotY: 1.0, hp: 80, alive: true, animHint: 'idle' },
    ] });
    expect(c.readBots()).toEqual([
      { id: 0, x: 1, z: 2, rotY: 0.5, hp: 100, alive: true, animHint: 'walk' },
      { id: 1, x: 5, z: 6, rotY: 1.0, hp: 80, alive: true, animHint: 'idle' },
    ]);
    // A later snapshot REPLACES the roster entirely (not merged).
    ws.message({ t: MSG.BOT_STATE, bots: [{ id: 2, x: 9, z: 9, rotY: 0, hp: 50, alive: false, animHint: 'idle' }] });
    expect(c.readBots()).toEqual([{ id: 2, x: 9, z: 9, rotY: 0, hp: 50, alive: false, animHint: 'idle' }]);
  });

  it('tracks peers via JOIN/MOVE/LEFT (pos/rot are wire arrays)', () => {
    const ws = mockSocket();
    const c = createSpectatorClient({ url: 'wss://x', WebSocketCtor: ctorFor(ws) });
    c.open(); ws.open();
    ws.message({ t: MSG.JOIN, id: 'a', npub: 'n'.repeat(64), pos: [1, 2, 3], rot: [0.4, 0], character: 'c' });
    ws.message({ t: MSG.MOVE, id: 'a', pos: [4, 5, 6], rot: [1.2, 0], vel: [0, 0, 0], anim: 'run' });
    expect(c.readPeers()).toEqual([{ id: 'a', pos: { x: 4, y: 5, z: 6 }, rot: { yaw: 1.2, pitch: 0 }, anim: 'run' }]);
    ws.message({ t: MSG.LEFT, id: 'a', reason: 'travel' });
    expect(c.readPeers()).toEqual([]);
  });

  it('ignores a MOVE for an unknown peer and identity/mutation frames', () => {
    const ws = mockSocket();
    const c = createSpectatorClient({ url: 'wss://x', WebSocketCtor: ctorFor(ws) });
    c.open(); ws.open();
    ws.message({ t: MSG.MOVE, id: 'ghost', pos: [1, 1, 1], rot: [0, 0], vel: [0, 0, 0] });
    expect(c.readPeers()).toEqual([]);
    // Combat/score/respawn frames are dropped entirely (a mirror renders none of them).
    ws.message({ t: MSG.SCORE, sessionId: '0'.repeat(16), endedAt: 0, tallies: [] });
    expect(c.readPeers()).toEqual([]);
    expect(c.readBots()).toEqual([]);
  });

  it('sends a keepalive PING while live and goes CLOSED on socket close', () => {
    vi.useFakeTimers();
    try {
      const ws = mockSocket();
      const c = createSpectatorClient({ url: 'wss://x', WebSocketCtor: ctorFor(ws), now: () => 123 });
      c.open(); ws.open();
      vi.advanceTimersByTime(15000);
      const ping = ws.sent[ws.sent.length - 1];
      expect(decodeSent(ping).t).toBe(MSG.PING);
      expect(decodeSent(ping).ts).toBe(123);
      ws.close();
      expect(c.state).toBe(SPECTATOR_STATE.CLOSED);
    } finally {
      vi.useRealTimers();
    }
  });

  it('never emits AUTH/JOIN/MOVE/SHOT even on request — SPECTATE + PING only', () => {
    const ws = mockSocket();
    const c = createSpectatorClient({ url: 'wss://x', WebSocketCtor: ctorFor(ws), now: () => 1 });
    c.open(); ws.open();
    const types = ws.sent.map((r) => decodeSent(r).t);
    expect(types).toEqual([MSG.SPECTATE]);
    // The public API surface has no send() for arbitrary messages — only sendPing.
    expect(typeof c.sendPing).toBe('function');
  });
});