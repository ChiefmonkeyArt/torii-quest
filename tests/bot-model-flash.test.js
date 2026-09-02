// tests/bot-model-flash.test.js — ADR-0042 visible bot hit feedback.
//
// Locks the red emissive flash that makes server-confirmed hits visible: the
// owner fires at a bot, the server resolves the shot, applyBotHit calls
// model.flashHit(), every mesh material tints red for ~0.18s, then tick()
// decays it back to the original emissive. Bots are excluded from the sticker
// decal raycaster by design (isBotMesh flag), so this flash + the HP chip + the
// death anim ARE the hit feedback — there is no sticker-on-mesh to rely on.
import { describe, it, expect, vi } from 'vitest';

// scene.js builds a WebGLRenderer at module top-level which node cannot satisfy.
// botModel only imports `scene` to add the root in init() — never reached here.
vi.mock('../src/scene.js', () => ({ scene: { add: () => {} } }));

import { BotModel } from '../src/botModel.js';

// A minimal MeshStandardMaterial stand-in: an emissive colour object + intensity.
function fakeMaterial(origEmissive = 0x000000, origIntensity = 0) {
  let hex = origEmissive;
  return {
    emissive: { setHex: (h) => { hex = h >>> 0; }, getHex: () => hex >>> 0 },
    emissiveIntensity: origIntensity,
    userData: {},
  };
}

describe('BotModel red hit-flash (ADR-0042)', () => {
  it('flashHit tints every collected material red + raises intensity', () => {
    const m = new BotModel('regular', 'Doc');
    const a = fakeMaterial(), b = fakeMaterial(0x223344, 0.2);
    m._materials = [a, b];
    m.flashHit();
    expect(a.emissive.getHex()).toBe(0xff3030);
    expect(b.emissive.getHex()).toBe(0xff3030);
    expect(a.emissiveIntensity).toBeGreaterThan(0);
  });

  it('flashHit no-ops when there are no materials', () => {
    const m = new BotModel('regular', 'Doc');
    expect(() => m.flashHit()).not.toThrow();
  });

  it('tick decays the flash back to the original emissive once the window elapses', () => {
    const m = new BotModel('regular', 'Doc');
    const mat = fakeMaterial(0x112233, 0.5);
    m._materials = [mat];
    m.flashHit();
    expect(mat.emissive.getHex()).toBe(0xff3030);
    // 0.18s flash window — a single tick past it should restore the original.
    m.tick(0.2);
    expect(mat.emissive.getHex()).toBe(0x112233);
    expect(mat.emissiveIntensity).toBe(0.5);
  });

  it('tick leaves the flash on while the window is still open', () => {
    const m = new BotModel('regular', 'Doc');
    const mat = fakeMaterial();
    m._materials = [mat];
    m.flashHit();
    m.tick(0.1);
    expect(mat.emissive.getHex()).toBe(0xff3030);
  });

  it('updateNameplate is a no-op without a nameplate canvas (regulars with no label)', () => {
    const m = new BotModel('regular', null);
    expect(() => m.updateNameplate('Doc', 0.6)).not.toThrow();
  });
});
