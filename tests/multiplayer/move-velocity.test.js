import { describe, expect, it } from 'vitest';
import { computeMoveVelocity } from '../../src/engine/multiplayer/moveVelocity.js';
import { createMultiplayerHost } from '../../src/engine/multiplayer/multiplayerHost.js';
import { encode, MSG, PROTOCOL_VERSION } from '../../src/engine/multiplayer/wireProtocol.js';

class FakeWS {
  static instances = [];

  constructor() {
    this.sent = [];
    FakeWS.instances.push(this);
  }

  send(data) { this.sent.push(data); }
  close() {}
  open() { this.onopen?.(); }
  message(payload) { this.onmessage?.({ data: encode(payload) }); }
}

describe('MOVE velocity', () => {
  it('computes velocity from the actual position and elapsed-time deltas', () => {
    expect(computeMoveVelocity([4, 5, 8], [1, 3, 2], 0.5)).toEqual([6, 4, 12]);
  });

  it('returns zero velocity for the first MOVE', () => {
    expect(computeMoveVelocity([4, 5, 8], null, 0.05)).toEqual([0, 0, 0]);
  });

  it('returns zero velocity for a teleport-sized position delta', () => {
    expect(computeMoveVelocity([51, 0, 0], [0, 0, 0], 0.05)).toEqual([0, 0, 0]);
  });

  it('passes the computed velocity through sendMove', async () => {
    FakeWS.instances.length = 0;
    const host = createMultiplayerHost({
      origin: 'example.test',
      mpEnabled: true,
      WebSocketCtor: FakeWS,
      signAuth: async () => ({}),
      avatarLoader: async () => ({ object: {} }),
      scene: { add() {}, remove() {} },
    });
    host.start();
    const ws = FakeWS.instances[0];
    ws.open();
    ws.message({
      t: MSG.HELLO,
      challenge: 'a'.repeat(44),
      serverVersion: 'test',
      protocolVersion: PROTOCOL_VERSION,
    });
    await Promise.resolve();
    await Promise.resolve();
    ws.message({ t: MSG.WELCOME, selfId: 'me1', roster: [] });

    const vel = computeMoveVelocity([2, 3, 4], [1, 1, 1], 0.5);
    expect(host.sendMove({ pos: [2, 3, 4], rot: [0.25, 0], vel })).toBe(true);
    expect(JSON.parse(ws.sent.at(-1))).toEqual({
      t: MSG.MOVE,
      pos: [2, 3, 4],
      rot: [0.25, 0],
      vel: [2, 4, 6],
    });
  });
});
