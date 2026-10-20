// ADR-0139: your tracer leaves the gun you SEE, in a colour opposite the bots'.
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { readFileSync } from 'node:fs';
import { screenMatchedPoint, findGunTip, MUZZLE_VIS_DEPTH } from '../../src/engine/weapons/muzzle.js';
import { createGzFx, TRACER_PLAYER, TRACER_BOT, TRACER_PEER } from '../../src/gamezone/client/fx.js';

const hue = ([r, g, b]) => { const c = new THREE.Color(r, g, b); const h = {}; c.getHSL(h); return h.h * 360; };
const opp = (a, b) => { const d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; };

describe('screen-matched muzzle point', () => {
  it('lands on the main-camera ray through the gun tip pixel, at the given depth', () => {
    const gunCam = new THREE.PerspectiveCamera(55, 16 / 9, 0.01, 10); gunCam.updateMatrixWorld(true);
    const main = new THREE.PerspectiveCamera(75, 16 / 9, 0.1, 1000);
    main.position.set(3, 2, -4); main.rotation.set(-0.2, 1.1, 0, 'YXZ'); main.updateMatrixWorld(true);
    const tip = new THREE.Vector3(0.22, -0.1, -0.41);
    const ndc = tip.clone().project(gunCam);
    const out = screenMatchedPoint(ndc.x, ndc.y, MUZZLE_VIS_DEPTH, main.fov, main.aspect, main.matrixWorld.elements, new THREE.Vector3());
    const back = out.clone().project(main);
    expect(back.x).toBeCloseTo(ndc.x, 5); expect(back.y).toBeCloseTo(ndc.y, 5);
    const local = main.worldToLocal(out.clone());
    expect(local.z).toBeCloseTo(-MUZZLE_VIS_DEPTH, 5);
    // the old fixed offset is NOT on that pixel (FOVs differ): the bug this fixes
    const old = new THREE.Vector3(0.12, -0.1, -0.3).project(new THREE.PerspectiveCamera(75, 16 / 9, 0.1, 1000));
    expect(Math.abs(old.x - ndc.x)).toBeGreaterThan(0.1);
  });
  it('finds the front-most point of the gun model as its tip', () => {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.1, 0.2)); body.position.set(0, 0, 0);
    const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.02, 0.1)); barrel.position.set(0.01, 0.03, -0.15);
    g.add(body, barrel); g.position.set(0.22, -0.1, -0.24);
    const out = new THREE.Vector3();
    expect(findGunTip(g, out)).toBe(true);
    g.updateMatrixWorld(true);
    const w = g.localToWorld(out.clone());
    expect(w.z).toBeCloseTo(-0.24 - 0.2, 5);
    expect(w.x).toBeCloseTo(0.23, 5); expect(w.y).toBeCloseTo(-0.07, 5);
    expect(findGunTip(new THREE.Group(), out)).toBe(false);
  });
});

describe('player tracer', () => {
  it('orange core + magenta-violet glow, opposite the bots cyan/lime', () => {
    expect(opp(hue(TRACER_PLAYER.core), hue(TRACER_BOT.core))).toBeGreaterThan(160);
    expect(opp(hue(TRACER_PLAYER.glow), hue(TRACER_BOT.glow))).toBeGreaterThan(160);
    expect(TRACER_PEER.core).toEqual(TRACER_PLAYER.core);
  });
  it('stays attached to the muzzle for the first frames, then lets go', () => {
    const parent = new THREE.Group();
    const cam = new THREE.PerspectiveCamera(); cam.position.set(0, 1.7, 0); cam.lookAt(0, 1.7, -10); cam.updateMatrixWorld(true);
    const fx = createGzFx(parent, cam);
    const p = parent.children.find((o) => o.name === 'gz-tracers').geometry.attributes.position.array;
    fx.tracer(0.1, 1.6, -0.5, 0, 1.7, -60, TRACER_PLAYER);
    fx.tick(1 / 60);
    const tailZ = (p[2] + p[5]) / 2, headZ = (p[8] + p[11]) / 2;
    expect(tailZ).toBeCloseTo(-0.5, 1);        // tail still on the gun
    expect(headZ).toBeLessThan(-2.5);           // head already out
    for (let i = 0; i < 4; i++) fx.tick(1 / 60);
    const tailZ2 = (p[2] + p[5]) / 2, headZ2 = (p[8] + p[11]) / 2;
    expect(headZ2 - tailZ2).toBeGreaterThan(-TRACER_PLAYER.len - 0.01); // back to a streak
    expect(tailZ2).toBeLessThan(-5);
  });
  it('is never fat next to the gun: width capped per metre up close', () => {
    const parent = new THREE.Group();
    const cam = new THREE.PerspectiveCamera(); cam.position.set(0, 1.7, 0); cam.lookAt(0, 1.7, -10); cam.updateMatrixWorld(true);
    const fx = createGzFx(parent, cam);
    const p = parent.children.find((o) => o.name === 'gz-tracers').geometry.attributes.position.array;
    fx.tracer(0.1, 1.6, -0.5, 0.1, 1.6, -60, TRACER_PLAYER);
    fx.tick(1 / 60);
    const tailW = Math.hypot(p[3] - p[0], p[4] - p[1], p[5] - p[2]);
    const headW = Math.hypot(p[9] - p[6], p[10] - p[7], p[11] - p[8]);
    expect(tailW).toBeLessThanOrEqual(0.52 * TRACER_PLAYER.wMaxPx + 1e-3); // ~0.5 m from the lens
    expect(headW).toBeGreaterThan(tailW); // tapers with perspective, not one fat band
  });
});

describe('wiring', () => {
  it('the shot carries the visible-muzzle point to the tracer and flash', () => {
    const P = readFileSync('src/player.js', 'utf8');
    const A = readFileSync('src/arenaRuntime.js', 'utf8');
    const G = readFileSync('src/gamezone/client/gameZone.js', 'utf8');
    const V = readFileSync('src/engine/weapons/gunViewmodel.js', 'utf8');
    expect(P).toMatch(/tracerFrom: getGunMuzzleVisualWorld\(camera/);
    expect(A).toMatch(/_muzzleFlashes\.trigger\('muzzle', tracerFrom \|\| origin\)/);
    expect(A).toMatch(/_gz\.fire\(\{ origin, dir, aimOrigin, aimDir, tracerFrom \}\)/);
    expect(G).toMatch(/const tf = s\.tracerFrom \|\| s\.origin;/);
    expect(V).toMatch(/_tipReady = findGunTip\(_gunMesh, _tipLocal\)/);
  });
});

describe('never hidden by the grass at your feet', () => {
  it('only YOUR tracer is flagged x-ray; bots/peers still respect walls', () => {
    expect(TRACER_PLAYER.xray).toBe(true);
    expect(TRACER_BOT.xray).toBeFalsy(); expect(TRACER_PEER.xray).toBeFalsy();
    const parent = new THREE.Group();
    const fx = createGzFx(parent, null);
    const g = parent.children.find((o) => o.name === 'gz-tracers').geometry;
    fx.tracer(0, 1, 0, 0, 1, -30, TRACER_PLAYER);
    fx.tracer(0, 1, -30, 0, 1, 0, TRACER_BOT);
    const x = g.attributes.aX.array;
    for (let k = 0; k < 8; k++) { expect(x[k * 2]).toBe(1); expect(x[k * 2 + 1]).toBeCloseTo(TRACER_PLAYER.coreW, 5); }
    for (let k = 8; k < 16; k++) { expect(x[k * 2]).toBe(0); expect(x[k * 2 + 1]).toBe(1); }
    expect(TRACER_PLAYER.coreW).toBeGreaterThan(1); // wider hot core over the lilac grass
    const vs = parent.children.find((o) => o.name === 'gz-tracers').material.vertexShader;
    expect(vs).toMatch(/if \(aX\.x > 0\.5\) gl_Position\.z = -gl_Position\.w \* 0\.9999;/);
  });
});
