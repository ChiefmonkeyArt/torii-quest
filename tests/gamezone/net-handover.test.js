// tests/gamezone/net-handover.test.js — ADR-0133 start-up / reconnect hand-over.
//
// Before: the client spawned a throwaway LOCAL world of bots at boot, then tore
// it down and rebuilt the node's bots somewhere else once multiplayer
// connected. The same happened after Home and on every connection blip
// (net → local → net). Now, while a multiplayer (re)connect is pending, no bots
// are drawn; the local sim starts only if the node has not answered in time.
import { describe, it, expect, vi, afterEach } from 'vitest';
import * as THREE from 'three';

vi.mock('three/addons/loaders/GLTFLoader.js', () => ({ GLTFLoader: class { setDRACOLoader() {} load() {} } }));

let clock = 1000;
afterEach(() => { vi.restoreAllMocks(); });

async function makeZone({ withMp = true } = {}) {
  vi.spyOn(performance, 'now').mockImplementation(() => clock);
  const { createGameZone, NET_HOLD_MS } = await import('../../src/gamezone/client/gameZone.js');
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera();
  const playerObj = new THREE.Object3D();
  playerObj.position.set(0, 1.7, 0);
  playerObj.add(camera);
  scene.add(playerObj);
  const sent = [];
  const mp = { state: 'connecting', selfId: null, sendGzFire: (s) => { sent.push(s); return true; } };
  const noop = () => {};
  const gz = createGameZone({
    scene, camera, playerObj,
    castWorld: () => null, getPlayerCollider: () => null,
    getMp: () => (withMp ? mp : null), isKami: () => false,
    hud: { flashCross: noop, addKill: noop, setReticleState: noop, setBossBar: noop, hideBossBar: noop },
    player: { takeDamage: noop, killPlayer: noop, setNextSpawn: noop, isDead: () => false },
    state: { hp: 100, kills: 0, sats: 0 }, emit: noop, EV: { BOT_KILLED: 'bk', HUD_UPDATE: 'hu' },
  });
  const step = (ms) => { clock += ms; gz.frame(ms / 1000, { playing: false }); };
  const connect = () => { mp.state = 'connected'; mp.selfId = 'me'; };
  const drop = () => { mp.state = 'connecting'; mp.selfId = null; };
  return { gz, mp, sent, step, connect, drop, NET_HOLD_MS };
}
// row: [id, kind, x, y, z, yaw, hp, st, anim, sp]
const snap = (tick) => ({ tick, b: [[0, 0, 0, 0, -10, 0, 5, 0, 1, 0], [1, 0, 3, 0, -12, 0, 5, 0, 1, 0]] });
const shoot = (gz) => gz.fire({ origin: new THREE.Vector3(0, 1.7, 0), dir: new THREE.Vector3(0, -0.07, -1).normalize() });

describe('Game Zone start-up hand-over (ADR-0133)', () => {
  it('boot with multiplayer: no throwaway local bots, straight onto the node’s bots', async () => {
    const { gz, step, connect, sent } = await makeZone();
    gz.holdForNet();
    for (let i = 0; i < 60; i++) step(50); // 3 s of connecting
    expect(gz.debug().authority).toBe(null);
    expect(gz.debug().holding).toBe(true);
    expect(gz.count).toBe(0);
    shoot(gz);
    expect(sent).toHaveLength(0); // nothing to shoot while holding
    connect();
    gz.ingestSnapshot(snap(10));
    step(16);
    expect(gz.debug().authority).toBe('net');
    expect(gz.count).toBe(2);
    expect(gz.debug().handovers).toBe(0); // never swapped worlds
  });

  it('falls back to the local sim if the node never answers', async () => {
    const { gz, step, NET_HOLD_MS } = await makeZone();
    gz.holdForNet();
    for (let t = 0; t < NET_HOLD_MS - 100; t += 100) step(100);
    expect(gz.debug().authority).toBe(null);
    step(200);
    expect(gz.debug().authority).toBe('local');
    expect(gz.debug().holding).toBe(false);
  });

  it('connected but no snapshot yet: waits, then goes local (older node)', async () => {
    const { gz, step, connect } = await makeZone();
    connect();
    step(16);
    expect(gz.debug().authority).toBe(null); // NET_WAIT_MS hold from the net creation
    for (let i = 0; i < 40; i++) step(100); // 4 s > NET_WAIT_MS
    expect(gz.debug().authority).toBe('local');
  });

  it('a connection blip never swaps in a local world', async () => {
    const { gz, step, connect, drop } = await makeZone();
    connect();
    gz.ingestSnapshot(snap(10));
    step(16);
    expect(gz.debug().authority).toBe('net');
    drop();
    for (let i = 0; i < 20; i++) step(100); // 2 s reconnecting
    expect(gz.debug().authority).toBe(null);
    expect(gz.count).toBe(0);
    connect();
    gz.ingestSnapshot(snap(3)); // a restarted node may start its ticks again
    step(16);
    expect(gz.debug().authority).toBe('net');
    expect(gz.count).toBe(2);
    expect(gz.debug().handovers).toBe(0);
  });

  it('offline play is never interrupted by a later hold', async () => {
    const { gz, step } = await makeZone({ withMp: false });
    step(16);
    expect(gz.debug().authority).toBe('local');
    const n = gz.count;
    gz.holdForNet();
    step(16);
    expect(gz.debug().authority).toBe('local');
    expect(gz.count).toBe(n);
  });
});
