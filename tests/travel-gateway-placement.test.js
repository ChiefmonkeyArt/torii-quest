// tests/travel-gateway-placement.test.js — locks the v0.2.239 travel-gateway slice:
//
//   The metaverse TRAVEL portal is the new torii-gateway-experience.glb, placed on
//   the FAR side of the NAP zone (TRAVEL_GATE_X). The original torii-gate.glb stays
//   at NAP_X as a PURE entrance marker — the proximity detection, rings/diamond
//   visual marker, "Press F to travel" prompt and KeyF interact all arm out at the
//   far gateway, NOT at the entrance. This freezes:
//     1. the new GLB asset exists on disk in public/ (and is precached by the SW),
//     2. config exposes a far-side TRAVEL_GATE_X strictly between NAP_X and NAP_FAR_X,
//     3. arena.js loads the new GLB at TRAVEL_GATE_X (entrance gate untouched at NAP_X),
//     4. main.js anchors the portal trigger + portal mesh at TRAVEL_GATE_X (not NAP_X).
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { NAP_X, NAP_FAR_X, TRAVEL_GATE_X, TRAVEL_GATE_Z, ARENA_HALF } from '../src/config.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ARENA = readFileSync(join(ROOT, 'src/arena.js'), 'utf8');
// v0.2.264 (R2): the in-world portal trigger + gateway component moved from main.js
// (now the three-free shell) into arenaRuntime.js, dynamically imported on ENTER.
const MAIN = readFileSync(join(ROOT, 'src/arenaRuntime.js'), 'utf8');
const SW = readFileSync(join(ROOT, 'public/sw.js'), 'utf8');

describe('v0.2.239 — travel gateway asset', () => {
  it('ships the new torii-gateway-experience.glb in public/', () => {
    const p = join(ROOT, 'public/torii-gateway-experience.glb');
    expect(existsSync(p)).toBe(true);
    // glTF binary magic + non-trivial size (compressed, but a real model).
    const buf = readFileSync(p);
    expect(buf.subarray(0, 4).toString('ascii')).toBe('glTF');
    expect(statSync(p).size).toBeGreaterThan(10_000);
  });

  it('precaches the travel gateway GLB in the service worker', () => {
    expect(SW).toContain('/torii-gateway-experience.glb');
  });

  it('keeps the original entrance torii-gate.glb shipped too', () => {
    expect(existsSync(join(ROOT, 'public/torii-gate.glb'))).toBe(true);
    expect(SW).toContain('/torii-gate.glb');
  });
});

describe('v0.2.239 — far-side placement constant', () => {
  it('TRAVEL_GATE_X sits strictly past the entrance, inside the NAP floor', () => {
    expect(TRAVEL_GATE_X).toBeGreaterThan(NAP_X);
    expect(TRAVEL_GATE_X).toBeLessThan(NAP_FAR_X);
    // The portal ring (radius = trigger range 3) must stay clear of the floor edge.
    expect(TRAVEL_GATE_X + 3).toBeLessThanOrEqual(NAP_FAR_X);
  });
});

describe('v0.2.239 — arena loads the travel gateway on the far side', () => {
  it('loads the new GLB model', () => {
    expect(ARENA).toContain("loader.load(assetUrl('/torii-gateway-experience.glb')");
  });

  it('builds the travel gateway and names it distinctly from the entrance', () => {
    expect(ARENA).toContain('_buildTravelGateway()');
    expect(ARENA).toContain("name = 'travel-gateway'");
    // Entrance gate is still built and still named 'torii-gate' (the NAP marker).
    expect(ARENA).toContain("loader.load(assetUrl('/torii-gate.glb')");
    expect(ARENA).toContain("name = 'torii-gate'");
  });

  it('anchors the travel gateway at TRAVEL_GATE_X, not the entrance plane', () => {
    expect(ARENA).toContain('TRAVEL_GATE_X');
    // The entrance gate keeps using ARENA_HALF; the travel gateway uses TRAVEL_GATE_X.
    expect(ARENA).toMatch(/position\.set\(TRAVEL_GATE_X,/);
  });
});

describe('v0.2.239 — travel interaction anchored to the far gateway', () => {
  it('wires the portal trigger position to TRAVEL_GATE_X', () => {
    // portalPos for the trigger AND the gateway component use TRAVEL_GATE_X now.
    const triggerBlock = MAIN.slice(MAIN.indexOf('createPortalTrigger('));
    expect(triggerBlock).toContain('portalPos: { x: TRAVEL_GATE_X');
  });

  it('the gateway component position is the far-side plane', () => {
    const gwBlock = MAIN.slice(MAIN.indexOf('createToriiGateway('));
    expect(gwBlock).toContain('position: { x: TRAVEL_GATE_X');
  });

  it('does NOT anchor the travel portal at the entrance (ARENA_HALF) any more', () => {
    // No portal/gateway position should pin to { x: ARENA_HALF, y: 0, z: 0 }.
    expect(MAIN).not.toContain('position: { x: ARENA_HALF, y: 0, z: 0 }');
    expect(MAIN).not.toContain('portalPos: { x: ARENA_HALF, y: 0, z: 0 }');
  });

  it('still builds the visible portal marker at the trigger position (rings/diamond follow)', () => {
    // The portal mesh is built from the trigger's own portalPos(), so the rings,
    // beam and spinning diamond move to the far gateway automatically.
    expect(MAIN).toContain('position: _portalTrigger.portalPos()');
  });
});

describe('v0.2.245 — travel gateway moved to the far-right NAP corner', () => {
  // v0.2.245: the gateway was sitting on top of the leaderboard proof panel
  // (nap-zone-far-centre, also at x=40, z=0). Moved off-axis into the far-right
  // corner (player's right, +z) so the portal no longer overlaps the panel.
  it('exposes a non-zero TRAVEL_GATE_Z corner offset (off the z=0 panel plane)', () => {
    expect(typeof TRAVEL_GATE_Z).toBe('number');
    expect(TRAVEL_GATE_Z).not.toBe(0);
  });

  it('places the corner on the player\'s right (+z), matching the chosen corner B', () => {
    expect(TRAVEL_GATE_Z).toBeGreaterThan(0);
  });

  it('keeps the detection ring clear of the z=0 proof panel', () => {
    // Trigger range is 3; the inner ring edge must not reach back to z=0.
    expect(TRAVEL_GATE_Z - 3).toBeGreaterThan(0);
  });

  it('keeps the detection ring inside the NAP floor z-edge (±ARENA_HALF)', () => {
    // NAP floor spans z∈[-ARENA_HALF, ARENA_HALF]; outer ring must stay inside.
    expect(TRAVEL_GATE_Z + 3).toBeLessThanOrEqual(ARENA_HALF);
  });

  it('arena.js anchors every travel-gateway position to TRAVEL_GATE_Z (not z=0)', () => {
    // fallback, accent light, and GLB gate all use the corner z. Stage 3 (v0.2.329)
    // lifts the Y onto the raised NAP island surface (gwY = sampleNapHeight(...)),
    // so the feet ride the terrain; the X/Z corner anchoring is unchanged.
    expect(ARENA).toContain('fallback.position.set(TRAVEL_GATE_X, gwY, TRAVEL_GATE_Z)');
    expect(ARENA).toContain('gate.position.set(TRAVEL_GATE_X, -box.min.y + gwY, TRAVEL_GATE_Z)');
  });

  it('main.js anchors the portal trigger + gateway component to TRAVEL_GATE_Z', () => {
    const triggerBlock = MAIN.slice(MAIN.indexOf('createPortalTrigger('));
    expect(triggerBlock).toContain('portalPos: { x: TRAVEL_GATE_X, y: 0, z: TRAVEL_GATE_Z }');
    const gwBlock = MAIN.slice(MAIN.indexOf('createToriiGateway('));
    expect(gwBlock).toContain('position: { x: TRAVEL_GATE_X, y: 0, z: TRAVEL_GATE_Z }');
  });
});
