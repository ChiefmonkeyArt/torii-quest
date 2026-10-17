// tests/gamezone/feel.test.js — ADR-0131 combat feel pass.
//
// Two layers:
//   1. the pure feel maths (markers, direction, spatial audio, curves, meter);
//   2. the real Game Zone client driven through the network authority with
//      hand-built GZ_SNAP / GZ_EVENT frames — proving feedback shows on the
//      click, is taken back on rejection, the reward pops only when paid, the
//      damage arc points at the shooter, and bot fire is distance-mixed.
import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import {
  MARKER, MARKER_MS, markerKind, screenAngleTo, shotMix, flinchEnvelope, flinchPeak,
  leanFromShot, kickRoll, recoilPose, createFeelMeter, AUDIO_FAR, AUDIO_FLOOR,
  KICK_MS, RECOIL_MS, RECOIL_BACK, RECOIL_CLIMB,
} from '../../src/gamezone/client/feel.js';
import {
  FLINCH_BODY_RAD, FLINCH_HEAD_RAD, FLINCH_MS, HEAD_DAMAGE, BODY_DAMAGE, KILL_SATS,
} from '../../src/gamezone/core/constants.js';

const close = (a, b, e = 1e-9) => Math.abs(a - b) < e;

describe('feel maths (ADR-0131)', () => {
  it('marker kind escalates body → head → kill → headkill', () => {
    expect(markerKind('body', false)).toBe(MARKER.BODY);
    expect(markerKind('head', false)).toBe(MARKER.HEAD);
    expect(markerKind('body', true)).toBe(MARKER.KILL);
    expect(markerKind('head', true)).toBe(MARKER.HEADKILL);
    expect(MARKER_MS.headkill).toBeGreaterThan(MARKER_MS.kill);
    expect(MARKER_MS.kill).toBeGreaterThan(MARKER_MS.head);
    expect(MARKER_MS.head).toBeGreaterThan(MARKER_MS.body);
  });

  it('screenAngleTo: ahead 0, right +π/2, left −π/2, behind ±π, follows yaw', () => {
    // yaw 0 faces −Z (player heading basis).
    expect(close(screenAngleTo(0, 0, 0, 0, -10), 0)).toBe(true);
    expect(close(screenAngleTo(0, 0, 0, 10, 0), Math.PI / 2)).toBe(true);
    expect(close(screenAngleTo(0, 0, 0, -10, 0), -Math.PI / 2)).toBe(true);
    expect(close(Math.abs(screenAngleTo(0, 0, 0, 0, 10)), Math.PI)).toBe(true);
    // Turned 90° left (yaw +π/2 faces −X): a source at −X is now dead ahead.
    expect(close(screenAngleTo(0, 0, Math.PI / 2, -10, 0), 0, 1e-9)).toBe(true);
    expect(screenAngleTo(3, 3, 1, 3, 3)).toBe(0); // degenerate: on top of us
  });

  it('shotMix: full volume near, monotonic roll-off with a floor, silent past AUDIO_FAR, pans by side', () => {
    const m = { gain: 0, pan: 0 };
    expect(shotMix(0, 0, 0, 0, -3, m).gain).toBe(1);
    let prev = 2;
    for (const d of [6, 10, 20, 40, 80]) {
      const g = shotMix(0, 0, 0, 0, -d, m).gain;
      expect(g).toBeLessThanOrEqual(prev);
      expect(g).toBeGreaterThanOrEqual(AUDIO_FLOOR);
      prev = g;
    }
    expect(shotMix(0, 0, 0, 0, -(AUDIO_FAR + 1), m).gain).toBe(0);
    expect(shotMix(0, 0, 0, 20, 0, m).pan).toBeGreaterThan(0.5);   // right
    expect(shotMix(0, 0, 0, -20, 0, m).pan).toBeLessThan(-0.5);    // left
    expect(Math.abs(shotMix(0, 0, 0, 0, -20, m).pan)).toBeLessThan(1e-9); // ahead
  });

  it('flinch envelope rises fast, falls to exactly 0 by FLINCH_MS, never exceeds 1', () => {
    expect(flinchEnvelope(0)).toBe(0);
    let peak = 0;
    for (let t = 0; t <= FLINCH_MS + 10; t += 2) {
      const k = flinchEnvelope(t);
      expect(k).toBeGreaterThanOrEqual(0); expect(k).toBeLessThanOrEqual(1);
      peak = Math.max(peak, k);
    }
    expect(peak).toBeGreaterThan(0.95);
    expect(flinchEnvelope(FLINCH_MS)).toBe(0);
    expect(flinchEnvelope(-1)).toBe(0);
    expect(flinchPeak('head')).toBe(FLINCH_HEAD_RAD);
    expect(flinchPeak('body')).toBe(FLINCH_BODY_RAD);
    expect(FLINCH_HEAD_RAD).toBeGreaterThan(FLINCH_BODY_RAD);
  });

  it('leanFromShot tips the top of the bot ALONG the shot, in its local frame', () => {
    const o = { x: 0, z: 0 };
    const top = new THREE.Vector3();
    for (const yaw of [0, 0.7, -2.1, Math.PI]) {
      for (const [dx, dz] of [[1, 0], [0, -1], [-0.6, 0.8]]) {
        leanFromShot(dx, dz, yaw, 0.1, o);
        const g = new THREE.Group(); g.rotation.y = yaw;
        const lean = new THREE.Group(); lean.rotation.set(o.x, 0, o.z); g.add(lean);
        const p = new THREE.Object3D(); p.position.set(0, 1, 0); lean.add(p);
        g.updateMatrixWorld(true);
        p.getWorldPosition(top);
        const L = Math.hypot(dx, dz);
        // horizontal displacement of the top points along the shot direction
        expect(top.x * dx / L + top.z * dz / L).toBeGreaterThan(0.09);
        expect(Math.abs(top.x * -dz / L + top.z * dx / L)).toBeLessThan(0.01);
      }
    }
    expect(leanFromShot(0, 0, 0, 0.1, o)).toEqual({ x: 0, z: 0 });
  });

  it('screen kick is camera roll that settles to 0; recoil kicks at once then settles', () => {
    expect(kickRoll(0, 0.01)).toBe(0);
    expect(kickRoll(KICK_MS, 0.01)).toBe(0);
    let mx = 0; for (let t = 0; t < KICK_MS; t++) mx = Math.max(mx, Math.abs(kickRoll(t, 0.01)));
    expect(mx).toBeGreaterThan(0.004); expect(mx).toBeLessThanOrEqual(0.01);
    const r = recoilPose(0);
    expect(r.back).toBe(RECOIL_BACK); expect(r.climb).toBe(RECOIL_CLIMB);
    expect(recoilPose(RECOIL_MS / 2).back).toBeLessThan(RECOIL_BACK);
    expect(recoilPose(RECOIL_MS)).toEqual({ back: 0, climb: 0 });
  });

  it('feel meter: click→frame percentiles, void %, fixed ring', () => {
    const m = createFeelMeter(8);
    for (let i = 0; i < 20; i++) { m.shotAt(1000 * i); m.frameAt(1000 * i + (i % 4) * 4); }
    m.frameAt(99999); // no pending shot → ignored
    const s = m.stats();
    expect(s.samples).toBe(8);
    expect(s.clickToFrameMs.max).toBe(12);
    expect(s.clickToFrameMs.p50).toBeGreaterThanOrEqual(4);
    for (let i = 0; i < 50; i++) m.marker();
    m.voided();
    expect(m.stats().voidPct).toBe(2);
    m.reset();
    expect(m.stats().samples).toBe(0);
  });
});

// ── The real client, driven through the net authority ─────────────────────────
vi.mock('../../src/engine/state/clientSuspended.js', () => ({ isClientSuspended: () => false }));
// No GLBs in node: bots stay on their coarse placeholder body (the same path a
// browser uses while the model streams in).
vi.mock('three/addons/loaders/GLTFLoader.js', () => ({ GLTFLoader: class { setDRACOLoader() {} load() {} } }));

describe('bot view flinch (ADR-0131)', () => {
  it('leans away along the shot, peaks at the zone limit, and settles to exactly 0', async () => {
    const { createBotView } = await import('../../src/gamezone/client/botView.js');
    const scene = new THREE.Scene();
    const v = createBotView(scene, { id: 3, kind: 'regular', name: 'Doc' });
    const lean = v.holder.getObjectByName('gz-lean');
    expect(lean).toBeTruthy();
    v.setPose(0, 0, 0, 0.4);
    v.flinch('head', 1, 0); // shot travelling +X
    let peak = 0;
    for (let i = 0; i < 30; i++) {
      v.update(1 / 120, i);
      peak = Math.max(peak, Math.hypot(lean.rotation.x, lean.rotation.z));
    }
    expect(peak).toBeGreaterThan(FLINCH_HEAD_RAD * 0.9);
    expect(peak).toBeLessThanOrEqual(FLINCH_HEAD_RAD + 1e-9);
    for (let i = 0; i < 30; i++) v.update(1 / 60, 30 + i);
    expect(v.flinching).toBe(false);
    expect(lean.rotation.x).toBe(0); expect(lean.rotation.z).toBe(0);
    // A dying bot does not flinch; a headshot kill records its zone.
    v.predictDeath('head');
    v.flinch('body', 1, 0);
    expect(v.flinching).toBe(false);
    expect(v.lastZone).toBe('head');
    v.dispose();
    expect(scene.children.includes(v.holder)).toBe(false);
  });
});

async function makeZone() {
  const { createGameZone } = await import('../../src/gamezone/client/gameZone.js');
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera();
  const playerObj = new THREE.Object3D();
  playerObj.position.set(0, 1.7, 0);
  playerObj.add(camera);
  scene.add(playerObj);
  let tok = 0;
  const calls = [];
  const rec = (name) => (...a) => { calls.push([name, ...a]); return ++tok; };
  const hud = {
    flashCross: rec('flashCross'), addKill: rec('addKill'), setReticleState: () => {},
    setBossBar: () => {}, hideBossBar: () => {},
    showHitMarker: rec('marker'), voidHitMarker: rec('voidMarker'),
    popCombatText: rec('pop'), voidCombatText: rec('voidPop'),
    showDamageDir: rec('dir'), clearCombatFeel: rec('clearFeel'),
  };
  const state = { hp: 100, kills: 0, sats: 0 };
  const sent = [];
  const mp = { state: 'connected', selfId: 'me', sendGzFire: (s) => { sent.push(s); return true; } };
  const emitted = [];
  const gz = createGameZone({
    scene, camera, playerObj,
    castWorld: () => null, getPlayerCollider: () => null,
    getMp: () => mp, isKami: () => false,
    hud, player: { takeDamage: (n) => { state.hp -= n; }, killPlayer: () => {}, setNextSpawn: () => {}, isDead: () => false },
    state, emit: (n, p) => emitted.push([n, p]), EV: { BOT_KILLED: 'bk', HUD_UPDATE: 'hu' },
    playBotShoot: rec('botShoot'),
    sfx: { hitMarker: rec('sfxHit'), killConfirm: rec('sfxKill') },
    inputAt: () => performance.now() - 5,
  });
  return { gz, calls, sent, state, emitted, camera, playerObj };
}
// row: [id, kind, x, y, z, yaw, hp, st, anim, sp]
const snap = (tick, rows) => ({ tick, b: rows });
const shoot = (gz, y) => gz.fire({
  origin: new THREE.Vector3(0, 1.7, 0),
  dir: new THREE.Vector3(0, y - 1.7, -10).normalize(),
});

describe('Game Zone client feel wiring (ADR-0131)', () => {
  it('shows marker + number + sound on the click; voids them when the authority rejects', async () => {
    const { gz, calls, sent } = await makeZone();
    gz.ingestSnapshot(snap(10, [[0, 0, 0, 0, -10, 0, 5, 0, 1, 0]]));
    gz.frame(1 / 60, { playing: false });
    expect(gz.count).toBe(1);
    shoot(gz, 1.0); // body
    expect(sent).toHaveLength(1);
    expect(sent[0].claim).toMatchObject({ k: 'bot', id: 0, zone: 'body' });
    const marker = calls.find((c) => c[0] === 'marker');
    expect(marker[1]).toBe('body');
    expect(calls.find((c) => c[0] === 'pop')[1]).toBe(String(BODY_DAMAGE));
    expect(calls.find((c) => c[0] === 'sfxHit')[1]).toBe('body');
    // The red "damage taken" vignette is no longer part of landing a shot.
    expect(calls.some((c) => c[0] === 'flashHit')).toBe(false);
    gz.ingestEvents({ ev: [{ type: 'result', sid: 'me', seq: sent[0].seq, ok: false, reason: 'geom' }] });
    expect(calls.some((c) => c[0] === 'voidMarker')).toBe(true);
    expect(calls.some((c) => c[0] === 'voidPop')).toBe(true);
    const f = gz.debug().feel;
    expect(f.markers).toBe(1); expect(f.voided).toBe(1);
    gz.frame(1 / 60, { playing: false });
    expect(gz.debug().feel.samples).toBe(1); // click→frame measured
  });

  it('accepted shots keep their feedback; a headshot kicks the camera by ROLL only', async () => {
    const { gz, calls, sent, camera } = await makeZone();
    gz.ingestSnapshot(snap(10, [[0, 0, 0, 0, -10, 0, 60, 0, 1, 0]])); // tanky regular row
    gz.frame(1 / 60, { playing: false });
    const pitch = camera.rotation.x, yaw = camera.rotation.y;
    shoot(gz, 1.7); // head
    expect(calls.find((c) => c[0] === 'marker')[1]).toBe('head');
    expect(calls.find((c) => c[0] === 'pop')[1]).toBe(String(HEAD_DAMAGE));
    gz.ingestEvents({ ev: [{ type: 'result', sid: 'me', seq: sent[0].seq, ok: true, hit: { tk: 'bot', tid: 0, zone: 'head', dmg: 9, hp: 51, killed: false } }] });
    expect(calls.some((c) => c[0] === 'voidMarker')).toBe(false);
    gz.frame(0.02, { playing: false });
    expect(camera.rotation.z).not.toBe(0);
    expect(camera.rotation.x).toBe(pitch); expect(camera.rotation.y).toBe(yaw);
    for (let i = 0; i < 10; i++) gz.frame(0.02, { playing: false });
    expect(camera.rotation.z).toBe(0);
  });

  it('lethal shot: kill marker + confirm now; the +5⚡ reward only when the authority pays it', async () => {
    const { gz, calls, sent, state, emitted } = await makeZone();
    gz.ingestSnapshot(snap(10, [[0, 0, 0, 0, -10, 0, 5, 0, 1, 0]]));
    gz.frame(1 / 60, { playing: false });
    shoot(gz, 1.7);
    expect(calls.find((c) => c[0] === 'marker')[1]).toBe('headkill');
    expect(calls.some((c) => c[0] === 'sfxKill' && c[1] === true)).toBe(true);
    expect(calls.some((c) => c[0] === 'pop' && c[2] === 'reward')).toBe(false);
    expect(state.sats).toBe(0);
    gz.ingestEvents({ ev: [
      { type: 'result', sid: 'me', seq: sent[0].seq, ok: true, hit: { tk: 'bot', tid: 0, zone: 'head', dmg: 9, hp: 0, killed: true } },
      { type: 'kill', tk: 'bot', tid: 0, sid: 'me', sk: 'player', zone: 'head' },
    ] });
    expect(calls.some((c) => c[0] === 'pop' && c[1] === `+${KILL_SATS}⚡` && c[2] === 'reward')).toBe(true);
    expect(state.sats).toBe(KILL_SATS);
    expect(emitted.find((e) => e[0] === 'bk')[1]).toEqual({ sats: KILL_SATS, zone: 'head' });
    expect(calls.filter((c) => c[0] === 'sfxKill')).toHaveLength(1); // not doubled
    expect(gz.debug().feel.killsConfirmed).toBe(1);
  });

  it('damage arc points at the bot that hit you; none when the hit cost no hp', async () => {
    const { gz, calls, state } = await makeZone();
    gz.ingestSnapshot(snap(10, [[0, 0, 10, 0, 0, 0, 5, 0, 1, 0]])); // bot to the RIGHT (+X)
    gz.frame(1 / 60, { playing: false });
    gz.ingestEvents({ ev: [{ type: 'hit', tk: 'player', tid: 'me', sid: 0, sk: 'bot', zone: 'body', dmg: 10, hp: 90 }] });
    const dir = calls.find((c) => c[0] === 'dir');
    expect(dir).toBeTruthy();
    expect(Math.abs(dir[1] - Math.PI / 2)).toBeLessThan(1e-6);
    expect(state.hp).toBe(90);
    // God/Kami: takeDamage is a no-op → no arc.
    const z2 = await makeZone();
    z2.gz.ingestSnapshot(snap(10, [[0, 0, 10, 0, 0, 0, 5, 0, 1, 0]]));
    z2.gz.frame(1 / 60, { playing: false });
    z2.state.hp = 100;
    const orig = z2.gz; // replace takeDamage via state freeze: emulate god mode
    Object.defineProperty(z2.state, 'hp', { get: () => 100, set: () => {} });
    orig.ingestEvents({ ev: [{ type: 'hit', tk: 'player', tid: 'me', sid: 0, sk: 'bot', zone: 'body', dmg: 10, hp: 90 }] });
    expect(z2.calls.some((c) => c[0] === 'dir')).toBe(false);
  });

  it('bot gunfire is distance-mixed and panned; far fights are quieter', async () => {
    const { gz, calls } = await makeZone();
    gz.ingestSnapshot(snap(10, [[0, 0, 0, 0, -10, 0, 5, 0, 1, 0]]));
    gz.frame(1 / 60, { playing: false });
    gz.ingestEvents({ ev: [
      { type: 'shot', sk: 'bot', sid: 0, from: [3, 1.5, -1], to: [0, 1.7, 0] },
      { type: 'shot', sk: 'bot', sid: 0, from: [-50, 1.5, 0], to: [0, 1.7, 0] },
    ] });
    const shots = calls.filter((c) => c[0] === 'botShoot');
    expect(shots).toHaveLength(2);
    expect(shots[0][1]).toBe(1);
    expect(shots[0][2]).toBeGreaterThan(0);       // right of us
    expect(shots[1][1]).toBeLessThan(0.2);        // 50 m away
    expect(shots[1][2]).toBeLessThan(0);          // left of us
  });

  it('clear() hides all feel elements and resets the camera roll', async () => {
    const { gz, calls, camera } = await makeZone();
    gz.ingestSnapshot(snap(10, [[0, 0, 0, 0, -10, 0, 60, 0, 1, 0]]));
    gz.frame(1 / 60, { playing: false });
    shoot(gz, 1.7);
    gz.frame(0.02, { playing: false });
    gz.clear();
    expect(camera.rotation.z).toBe(0);
    expect(calls.some((c) => c[0] === 'clearFeel')).toBe(true);
  });
});

describe('predicted deaths always resolve (ADR-0134: boss lying on the ground)', () => {
  const pdOf = (gz, id) => gz.list().find((b) => b.id === id).predictedDead;

  it('sustained fire on the 60 HP boss never predicts death early', async () => {
    const { gz } = await makeZone();
    gz.ingestSnapshot(snap(10, [[4, 1, 0, 0, -10, 0, 60, 0, 1, 0]]));
    gz.frame(1 / 60, { playing: false });
    // 12 body shots = 36 dmg pending, no results yet: 60 − 36 > 0.
    for (let i = 0; i < 12; i++) { shoot(gz, 1.0); gz.frame(1 / 60, { playing: false }); }
    expect(pdOf(gz, 4)).toBe(false);
  });

  it('a landed but non-lethal result stands a predicted death back up', async () => {
    const { gz, sent } = await makeZone();
    gz.ingestSnapshot(snap(10, [[0, 0, 0, 0, -10, 0, 5, 0, 1, 0]]));
    gz.frame(1 / 60, { playing: false });
    shoot(gz, 1.7); // head claim: 9 ≥ 5 → predicted kill
    expect(pdOf(gz, 0)).toBe(true);
    // The authority downgrades it to a body hit: 3 dmg, 2 hp left, not killed.
    gz.ingestEvents({ ev: [{ type: 'result', sid: 'me', seq: sent[0].seq, ok: true,
      hit: { tk: 'bot', tid: 0, zone: 'body', dmg: 3, hp: 2, killed: false, absorbed: false } }] });
    expect(pdOf(gz, 0)).toBe(false);
    expect(gz.list()[0].life).toBe(0);
  });

  it('a confirmed kill keeps it down', async () => {
    const { gz, sent } = await makeZone();
    gz.ingestSnapshot(snap(10, [[0, 0, 0, 0, -10, 0, 5, 0, 1, 0]]));
    gz.frame(1 / 60, { playing: false });
    shoot(gz, 1.7);
    gz.ingestEvents({ ev: [{ type: 'result', sid: 'me', seq: sent[0].seq, ok: true,
      hit: { tk: 'bot', tid: 0, zone: 'head', dmg: 9, hp: 0, killed: true, absorbed: false } }] });
    expect(pdOf(gz, 0)).toBe(true);
  });
});
