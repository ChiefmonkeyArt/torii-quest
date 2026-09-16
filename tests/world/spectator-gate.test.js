// spectator-gate.test.js — locks the read-only SPECTATE tier (ADR-0118 Decision 4):
// a spectator may only SEND keepalive, world listeners gate the broadcast, and the
// registry fans out read-only while terminating slow readers. Pure; wws are mocks.
import { describe, it, expect } from 'vitest';
import { MSG } from '../../src/engine/multiplayer/wireProtocol.js';
import {
  canSpectatorSend, hasWorldListeners, createSpectatorRegistry, SPECTATOR_SEND_ALLOWED,
} from '../../src/engine/multiplayer/spectatorGate.js';

function mockWs() {
  const sent = [];
  return {
    sent,
    bufferedAmount: 0,
    send(wire) { sent.push(wire); },
    terminate() { this.terminated = true; },
    terminated: false,
  };
}

describe('canSpectatorSend (inbound hardening)', () => {
  it('allows only keepalive', () => {
    expect(canSpectatorSend(MSG.PING)).toBe(true);
    expect(canSpectatorSend(MSG.PONG)).toBe(true);
    expect(SPECTATOR_SEND_ALLOWED).toEqual([MSG.PING, MSG.PONG]);
  });

  it('refuses every identity / mutation / publish message', () => {
    for (const t of [MSG.AUTH, MSG.AUTH_TOKEN, MSG.JOIN, MSG.MOVE, MSG.SHOT, MSG.HIT, MSG.KILL, MSG.CHAT, MSG.KAMI_STATE, MSG.SPECTATE]) {
      expect(canSpectatorSend(t)).toBe(false);
    }
  });
});

describe('hasWorldListeners (broadcast gate)', () => {
  it('fires the periodic broadcast when any peer OR spectator is present', () => {
    expect(hasWorldListeners(0, 0)).toBe(false);
    expect(hasWorldListeners(1, 0)).toBe(true);   // authed peer only
    expect(hasWorldListeners(0, 1)).toBe(true);   // spectator only → still live
    expect(hasWorldListeners(5, 3)).toBe(true);
  });
});

describe('createSpectatorRegistry (read-only fan-out)', () => {
  it('adds, tracks, fans out, and removes', () => {
    const reg = createSpectatorRegistry();
    const a = mockWs();
    const b = mockWs();
    reg.add(a);
    reg.add(b);
    reg.add({}); // no send() → rejected, never a spectator
    expect(reg.size()).toBe(2);
    expect(reg.has(a)).toBe(true);

    reg.send({ t: MSG.BOT_STATE, bots: [] });
    expect(a.sent.length).toBe(1);
    expect(b.sent.length).toBe(1);

    reg.remove(a);
    expect(reg.size()).toBe(1);
    reg.send({ t: MSG.JOIN });
    expect(a.sent.length).toBe(1); // removed spectator no longer receives
    expect(b.sent.length).toBe(2);
  });

  it('terminates and drops a slow reader rather than buffering unbounded', () => {
    const reg = createSpectatorRegistry({ maxBuffered: 100 });
    const slow = mockWs();
    slow.bufferedAmount = 500; // over the bound
    const ok = mockWs();
    reg.add(slow);
    reg.add(ok);

    reg.send({ t: MSG.MOVE });
    expect(slow.terminated).toBe(true);
    expect(slow.sent.length).toBe(0);
    expect(reg.size()).toBe(1);        // slow reader dropped
    expect(ok.sent.length).toBe(1);
  });

  it('swallows per-socket send failures', () => {
    const reg = createSpectatorRegistry();
    const broken = { send() { throw new Error('gone'); }, bufferedAmount: 0 };
    const fine = mockWs();
    reg.add(broken);
    reg.add(fine);
    expect(() => reg.send({ t: MSG.SCORE })).not.toThrow();
    expect(fine.sent.length).toBe(1);
    expect(reg.size()).toBe(2); // a send failure is not a drop (mirrors broadcastToAll)
  });
});