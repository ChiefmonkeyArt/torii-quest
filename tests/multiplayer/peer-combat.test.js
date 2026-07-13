// peer-combat.test.js — MP-2 client peer-combat bridge lock (v0.2.374-alpha).
//
// Covers the pure peerCombat module that arenaRuntime delegates to:
//   • outbound gate (shouldSendShot) + payload (buildShotPayload)
//   • inbound dispatch (createPeerCombat): mp_shot visual-only, mp_hit damage
//     gating, mp_kill death/score gating.
// Node-pure: no three, no DOM — deps are injected fakes.
import { describe, it, expect, vi } from 'vitest';
import {
  shouldSendShot,
  buildShotPayload,
  createPeerCombat,
} from '../../src/engine/multiplayer/peerCombat.js';

const NAP_X = -20;

// ---------- outbound ----------

describe('peerCombat outbound (shouldSendShot + buildShotPayload)', () => {
  // The arena sits at x <= NAP_X (shooting is suppressed for x > NAP_X, the NAP zone).
  it('sends when we have selfId and are inside the arena', () => {
    expect(shouldSendShot({ playerX: NAP_X - 30, napX: NAP_X, selfId: 'me1' })).toBe(true);
    expect(shouldSendShot({ playerX: NAP_X, napX: NAP_X, selfId: 'me1' })).toBe(true);
  });

  it('does NOT send in the NAP zone (playerX > napX)', () => {
    expect(shouldSendShot({ playerX: NAP_X + 5, napX: NAP_X, selfId: 'me1' })).toBe(false);
  });

  it('does NOT send when selfId is falsy (pre-WELCOME)', () => {
    expect(shouldSendShot({ playerX: NAP_X - 30, napX: NAP_X, selfId: null })).toBe(false);
    expect(shouldSendShot({ playerX: NAP_X - 30, napX: NAP_X, selfId: undefined })).toBe(false);
    expect(shouldSendShot({ playerX: NAP_X - 30, napX: NAP_X, selfId: '' })).toBe(false);
  });

  it('prefers the AIM ray and serialises vectors to [x,y,z] arrays', () => {
    const shot = buildShotPayload({
      origin:    { x: 1, y: 2, z: 3 },
      dir:       { x: 0, y: 0, z: 1 },
      aimOrigin: { x: 4, y: 5, z: 6 },
      aimDir:    { x: 0, y: 1, z: 0 },
    }, 1234);
    expect(shot).toEqual({ origin: [4, 5, 6], dir: [0, 1, 0], ts: 1234 });
  });

  it('falls back to the muzzle origin/dir when no aim ray is present', () => {
    const shot = buildShotPayload({
      origin: { x: 1, y: 2, z: 3 },
      dir:    { x: 0, y: 0, z: 1 },
    }, 9);
    expect(shot).toEqual({ origin: [1, 2, 3], dir: [0, 0, 1], ts: 9 });
  });

  it('returns null when neither ray is available', () => {
    expect(buildShotPayload({}, 0)).toBeNull();
  });
});

// ---------- inbound ----------

function makeCombat(overrides = {}) {
  const calls = {
    takeDamage: [], killPlayer: 0, flashCross: 0, addKill: [], fx: [], hud: 0,
  };
  const state = { kills: 0, deaths: 0 };
  const deps = {
    getSelfId: () => overrides.selfId ?? 'me1',
    takeDamage: (d) => calls.takeDamage.push(d),
    killPlayer: () => { calls.killPlayer++; },
    flashCross: () => { calls.flashCross++; },
    addKill: (t) => calls.addKill.push(t),
    spawnPeerShotFx: (o, d) => calls.fx.push({ o, d }),
    state,
    onHudUpdate: () => { calls.hud++; },
  };
  return { handle: createPeerCombat(deps), calls, state };
}

describe('peerCombat inbound — mp_shot (visual only)', () => {
  it('renders a peer shot fx and never damages locally', () => {
    const { handle, calls } = makeCombat();
    const handled = handle('mp_shot', { id: 'peer2', origin: [1, 2, 3], dir: [0, 0, 1] });
    expect(handled).toBe(true);
    expect(calls.fx).toEqual([{ o: [1, 2, 3], d: [0, 0, 1] }]);
    expect(calls.takeDamage).toEqual([]);
    expect(calls.killPlayer).toBe(0);
  });

  it('skips our own shot echoed back through the relay', () => {
    const { handle, calls } = makeCombat();
    handle('mp_shot', { id: 'me1', origin: [1, 2, 3], dir: [0, 0, 1] });
    expect(calls.fx).toEqual([]);
  });

  it('ignores malformed shot payloads', () => {
    const { handle, calls } = makeCombat();
    handle('mp_shot', { id: 'peer2', origin: 'nope' });
    expect(calls.fx).toEqual([]);
  });
});

describe('peerCombat inbound — mp_hit (server-authoritative)', () => {
  it('applies damage only when we are the target', () => {
    const { handle, calls } = makeCombat();
    handle('mp_hit', { id: 'peer2', targetId: 'me1', dmg: 25, zone: 'body' });
    expect(calls.takeDamage).toEqual([25]);
    expect(calls.hud).toBe(1);
  });

  it('does NOT apply damage when another peer is the target', () => {
    const { handle, calls } = makeCombat();
    handle('mp_hit', { id: 'me1', targetId: 'peer2', dmg: 25 });
    expect(calls.takeDamage).toEqual([]);
    // We are the shooter (wire field `id`) → crosshair flash.
    expect(calls.flashCross).toBe(1);
  });

  it('flashes the crosshair only when we landed the shot (wire field id)', () => {
    const { handle, calls } = makeCombat();
    handle('mp_hit', { id: 'peer2', targetId: 'peer3', dmg: 10 });
    expect(calls.flashCross).toBe(0);
    expect(calls.takeDamage).toEqual([]);
  });
});

describe('peerCombat inbound — mp_kill (server-authoritative)', () => {
  it('triggers death/respawn only when we are the victim', () => {
    const { handle, calls } = makeCombat();
    handle('mp_kill', { shooterId: 'peer2', victimId: 'me1' });
    expect(calls.killPlayer).toBe(1);
    // deaths is bumped inside killPlayer (guarded) — not double-counted here.
    expect(calls.addKill).toEqual([]);
  });

  it('does NOT kill us when another peer is the victim', () => {
    const { handle, calls } = makeCombat();
    handle('mp_kill', { shooterId: 'peer2', victimId: 'peer3' });
    expect(calls.killPlayer).toBe(0);
  });

  it('scores + killfeeds when we are the shooter', () => {
    const { handle, calls, state } = makeCombat();
    handle('mp_kill', { shooterId: 'me1', victimId: 'peer2' });
    expect(state.kills).toBe(1);
    expect(calls.addKill.length).toBe(1);
    expect(calls.killPlayer).toBe(0);
  });
});

describe('peerCombat inbound — routing', () => {
  it('returns false for non-combat events (falls through to mp_respawn)', () => {
    const { handle } = makeCombat();
    expect(handle('mp_respawn', { pos: [0, 0, 0] })).toBe(false);
    expect(handle('roster', {})).toBe(false);
  });

  it('swallows combat events but does nothing before WELCOME (no selfId)', () => {
    const { handle, calls } = makeCombat({ selfId: null });
    expect(handle('mp_hit', { targetId: 'x', dmg: 25 })).toBe(true);
    expect(calls.takeDamage).toEqual([]);
    expect(calls.fx).toEqual([]);
  });
});
