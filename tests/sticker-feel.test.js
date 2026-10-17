// tests/sticker-feel.test.js — ADR-0132 NAP sticker feel pass.
//
// 1. Pure curves (bounce, pop pitch, scaled recoil).
// 2. The orchestrator driven with fakes, the same way stickerNpc's hooks call it.
// 3. Source contracts for the THREE-bound wiring (stickerNpc / napNpc /
//    arenaRuntime are not unit-importable, consistent with the other sticker tests).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  bounceEnvelope, BOUNCE_MS, BOUNCE_SQUASH, BOUNCE_HOP, popPitch, isCharacterTarget, createStickerFeel,
} from '../src/engine/feel/stickerFeel.js';
import { recoilPose, RECOIL_BACK, RECOIL_CLIMB, MARKER_MS } from '../src/gamezone/client/feel.js';

const src = (p) => readFileSync(new URL('../src/' + p, import.meta.url), 'utf8');

describe('giggle bounce curve', () => {
  it('rests at both ends and outside the window', () => {
    for (const ms of [0, BOUNCE_MS, BOUNCE_MS + 50, -5, NaN]) {
      const b = bounceEnvelope(ms);
      expect(b.sy).toBeCloseTo(1, 9);
      expect(b.hop).toBe(0);
    }
  });

  it('is continuous (no pops between phases), bounded and volume-preserving', () => {
    let prev = bounceEnvelope(0), maxHop = 0, minSy = 1, maxSy = 1;
    const out = { sy: 1, sxz: 1, hop: 0 };
    for (let ms = 0.5; ms <= BOUNCE_MS; ms += 0.5) {
      bounceEnvelope(ms, out);
      expect(Math.abs(out.sy - prev.sy)).toBeLessThan(0.004);
      expect(Math.abs(out.hop - prev.hop)).toBeLessThan(0.002);
      expect(out.sy * out.sxz * out.sxz).toBeCloseTo(1, 9);
      maxHop = Math.max(maxHop, out.hop); minSy = Math.min(minSy, out.sy); maxSy = Math.max(maxSy, out.sy);
      prev = { sy: out.sy, hop: out.hop };
    }
    expect(maxHop).toBeCloseTo(BOUNCE_HOP, 3);
    expect(minSy).toBeCloseTo(1 - BOUNCE_SQUASH, 3); // squash first…
    expect(maxSy).toBeGreaterThan(1);                  // …then stretch in the air
    expect(maxSy).toBeLessThanOrEqual(1 + BOUNCE_SQUASH);
  });

  it('squashes before it hops (anticipation), then hops', () => {
    expect(bounceEnvelope(35).sy).toBeLessThan(1);
    expect(bounceEnvelope(35).hop).toBe(0);
    expect(bounceEnvelope(165).hop).toBeGreaterThan(0.08);
  });
});

describe('pop pitch, targets, markers, recoil scale', () => {
  it('pop pitch varies within ±8 % and is deterministic', () => {
    const seen = new Set();
    for (let n = 0; n < 50; n++) {
      const p = popPitch(n);
      expect(p).toBeGreaterThanOrEqual(0.92); expect(p).toBeLessThanOrEqual(1.08);
      seen.add(p.toFixed(3));
      expect(popPitch(n)).toBe(p);
    }
    expect(seen.size).toBeGreaterThan(30);
    for (let n = 1; n < 50; n++) expect(Math.abs(popPitch(n) - popPitch(n - 1))).toBeGreaterThan(0.009); // neighbours always differ
  });

  it('characters vs surfaces', () => {
    expect(['npc', 'peer', 'bot'].every(isCharacterTarget)).toBe(true);
    expect(isCharacterTarget('surface')).toBe(false);
    expect(isCharacterTarget(undefined)).toBe(false);
  });

  it('a sticker marker kind exists and is brief', () => {
    expect(MARKER_MS.sticker).toBeGreaterThan(0);
    expect(MARKER_MS.sticker).toBeLessThanOrEqual(MARKER_MS.head);
  });

  it('recoilPose scales the arena curve; the default is unchanged', () => {
    const full = recoilPose(0, { back: 0, climb: 0 });
    expect(full.back).toBeCloseTo(RECOIL_BACK, 9);
    expect(full.climb).toBeCloseTo(RECOIL_CLIMB, 9);
    for (const ms of [0, 20, 60]) {
      const a = recoilPose(ms, { back: 0, climb: 0 });
      const s = recoilPose(ms, { back: 0, climb: 0 }, 0.45);
      expect(s.back).toBeCloseTo(a.back * 0.45, 9);
      expect(s.climb).toBeCloseTo(a.climb * 0.45, 9);
    }
    expect(recoilPose(10, { back: 0, climb: 0 }, 0).back).toBeCloseTo(recoilPose(10).back, 9); // bad scale → 1
  });
});

function rig(listener = { x: 0, z: 0, yaw: 0 }) {
  const log = [];
  let t = 1000;
  const feel = createStickerFeel({
    hud: { showHitMarker: (k) => log.push(['marker', k]), popCombatText: (txt, k) => log.push(['pop', txt, k]) },
    sfx: { stick: (g, p, ch, pitch) => log.push(['stick', g, p, ch, pitch]) },
    flash: (k, pt) => log.push(['flash', k, pt]),
    bounceNpc: () => log.push(['bounce']),
    getListener: () => listener,
    inputAt: () => t,
    now: () => t,
  });
  return { feel, log, tick: (ms) => { t += ms; } };
}

describe('sticker feel orchestrator', () => {
  it('click on a character: pink marker on the click, nothing else yet', () => {
    const { feel, log } = rig();
    feel.onFire({ target: 'npc', point: { x: 0, y: 1, z: -5 }, dist: 5 });
    expect(log).toEqual([['marker', 'sticker']]);
    expect(feel.stats()).toMatchObject({ fired: 1, aimedAtCharacter: 1, aimedAtSurface: 0, misses: 0 });
  });

  it('click on a surface or at nothing: no marker', () => {
    const { feel, log } = rig();
    feel.onFire({ target: 'surface', point: { x: 0, y: 0, z: -3 }, dist: 3 });
    feel.onFire(null);
    expect(log).toEqual([]);
    expect(feel.stats()).toMatchObject({ fired: 2, aimedAtSurface: 1, misses: 1 });
  });

  it('landing on the NPC: boing pop, sparkle, STUCK! and a giggle bounce', () => {
    const { feel, log } = rig();
    const pt = { x: 0, y: 1.2, z: -4 };
    feel.onLand({ target: 'npc', point: pt });
    const stick = log.find((l) => l[0] === 'stick');
    expect(stick[1]).toBe(1);             // close → full volume
    expect(stick[2]).toBeCloseTo(0, 6);   // straight ahead → centred
    expect(stick[3]).toBe(true);          // character → boing
    expect(log).toContainEqual(['flash', 'sticker', pt]);
    expect(log).toContainEqual(['pop', 'STUCK!', 'sticker']);
    expect(log).toContainEqual(['bounce']);
    expect(feel.stats()).toMatchObject({ landed: 1, stuck: 1, bounces: 1 });
  });

  it('landing on a peer: STUCK! but no NPC bounce (other players are not moved)', () => {
    const { feel, log } = rig();
    feel.onLand({ target: 'peer', point: { x: 2, y: 1, z: -2 } });
    expect(log).toContainEqual(['pop', 'STUCK!', 'sticker']);
    expect(log.some((l) => l[0] === 'bounce')).toBe(false);
  });

  it('landing far away on a surface: quieter, panned to its side, no STUCK!', () => {
    const { feel, log } = rig({ x: 0, z: 0, yaw: 0 });
    feel.onLand({ target: 'surface', point: { x: 30, y: 0, z: 0 } }); // to the right (yaw 0 → right = +x)
    const stick = log.find((l) => l[0] === 'stick');
    expect(stick[1]).toBeLessThan(0.3);
    expect(stick[2]).toBeGreaterThan(0.5);
    expect(stick[3]).toBe(false);
    expect(log.some((l) => l[0] === 'pop')).toBe(false);
    expect(log.some((l) => l[0] === 'bounce')).toBe(false);
  });

  it('pop pitch advances per landing; click→frame latency is measured; reset zeroes', () => {
    const { feel, log, tick } = rig();
    feel.onLand({ target: 'surface', point: { x: 0, y: 0, z: -2 } });
    feel.onLand({ target: 'surface', point: { x: 0, y: 0, z: -2 } });
    const pitches = log.filter((l) => l[0] === 'stick').map((l) => l[4]);
    expect(pitches[0]).not.toBe(pitches[1]);
    feel.onFire({ target: 'npc', point: { x: 0, y: 1, z: -3 }, dist: 3 });
    tick(9);
    feel.frame();
    expect(feel.stats().clickToFrameMs.p50).toBe(9);
    feel.reset();
    expect(feel.stats()).toMatchObject({ fired: 0, landed: 0, samples: 0 });
  });

  it('survives missing deps and a null landing', () => {
    const feel = createStickerFeel();
    expect(() => { feel.onFire({ target: 'npc' }); feel.onLand({ target: 'npc', point: { x: 0, y: 0, z: 0 } }); feel.onLand(null); feel.frame(); }).not.toThrow();
  });
});

describe('wiring contracts (THREE-bound modules)', () => {
  const NPC = src('stickerNpc.js');
  const NAP = src('napNpc.js');
  const RT = src('arenaRuntime.js');
  const GUN = src('engine/weapons/gunViewmodel.js');

  it('stickerNpc reports fire (sync, incl. misses) and land through guarded hooks', () => {
    expect(NPC).toMatch(/export function setStickerFeelHooks\(/);
    expect(NPC).toMatch(/if \(!hitPoint\) \{ _aim\.last = null; _feel\('onFire', null\); return false; \}/);
    expect(NPC).toMatch(/_feel\('onFire', \{ target, point: hitPoint, dist: bestDist \}\)/);
    expect(NPC).toMatch(/_feel\('onLand', \{ target: s\.target, point: s\.to \}\)/);
    expect(NPC).toMatch(/try \{ f\(info\); \} catch/); // a throwing hook never breaks placement
    // Landing hook fires BEFORE the baked-decal branch can `continue`.
    expect(NPC.indexOf("_feel('onLand'")).toBeLessThan(NPC.indexOf('STICKER_RENDER_MODE.BAKED && s.meshObj'));
  });

  it('flying stickers share one material and the gesture import is cached', () => {
    expect((NPC.match(/new THREE\.SpriteMaterial\(/g) || []).length).toBe(1);
    expect(NPC).toMatch(/new THREE\.Sprite\(_flyMaterial\(\)\)/);
    expect(NPC).not.toMatch(/s\.sprite\.material\.dispose\(\)/);
    expect((NPC.match(/import\('\.\/napNpc\.js'\)\.then\(\(\{ triggerNpcGesture/g) || []).length).toBe(1);
    expect(NPC).toMatch(/if \(_gestureFn\) \{ _gestureFn\(\); return; \}/);
  });

  it('napNpc bounces the root, keeps feet planted, and syncs colliders after', () => {
    expect(NAP).toMatch(/export function bounceNpc\(\)/);
    expect(NAP).toMatch(/_root\.position\.y -= _bounceDy/);
    expect(NAP).toMatch(/_bounceDy = _bounce\.hop \+ _minY \* \(1 - _bounce\.sy\)/);
    expect(NAP).toMatch(/_root\.scale\.set\(_bounce\.sxz, _bounce\.sy, _bounce\.sxz\)/);
    expect(NAP.indexOf('_root.scale.set(_bounce.sxz')).toBeLessThan(NAP.indexOf('setNpcColliderPos(_npcColliderBody.body'));
    // ADR-0135: no per-bone sensors any more (stickers use the exact skin test).
    expect(NAP).not.toMatch(/syncNpcBoneColliders|createNpcBoneColliders/);
  });

  it('NAP fire path: sticker sound + gentle recoil; arena keeps its gunshot', () => {
    const i = RT.indexOf('if (inNap) {', RT.indexOf('on(EV.SHOOT, ({ origin, dir, aimOrigin, aimDir })'));
    const napBranch = RT.slice(i, RT.indexOf('return;', i));
    expect(napBranch).toMatch(/playStickerFire\(\)/);
    expect(napBranch).toMatch(/triggerRecoil\('sticker'\)/);
    expect(napBranch).not.toMatch(/playShoot\(\)/);
    expect(RT).toMatch(/playShoot\(\);\s*\n\s*triggerRecoil\(true\);/);
    expect(RT).toMatch(/setStickerFeelHooks\(\{ onFire: _stickerFeel\.onFire, onLand: _stickerFeel\.onLand \}\)/);
    expect(RT).toMatch(/if \(_stickerFeel\) _stickerFeel\.frame\(\)/);
  });

  it('sticker recoil is the arena curve at reduced strength', () => {
    expect(GUN).toMatch(/export const STICKER_RECOIL_SCALE = 0\.45/);
    expect(GUN).toMatch(/recoilPose\(_arenaRecoilMs, _rp, _recoilScale\)/);
    expect(src('engine/render/muzzleFlash.js')).toMatch(/sticker: \{ color: 0xff7ad9/);
  });
});
