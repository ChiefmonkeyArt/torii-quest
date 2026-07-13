// tests/travel-gateway-entry-repair.test.js — locks the v0.2.240 ENTER-ARENA repair.
//
//   v0.2.239 shipped the new travel-gateway GLB and added it to the SW precache. On
//   the live deploy ENTER ARENA broke: sw.js precached the large GLB via the ATOMIC
//   cache.addAll(), so one not-yet-propagated asset rejected the WHOLE SW install,
//   skipWaiting() never ran, the upgrade wedged, and a stale SW served a mismatched
//   bundle/wasm pair — initPhysics() (Rapier WASM) then failed and ENTER fell back to
//   the menu. This freezes the repair so it can't regress:
//     1. the SW precache is per-asset and fault-tolerant (NOT atomic addAll),
//     2. install still calls skipWaiting() (so a precache hiccup can't wedge upgrades),
//     3. the travel-gateway GLB load is strictly fail-soft — the procedural fallback
//        is added immediately and only swapped on a FULLY successful load+process,
//        every failure path keeps the fallback + surfaces a loggable error,
//     4. the travel portal trigger/mesh stay anchored at TRAVEL_GATE_X (entry repair
//        must not move the gameplay placement from the v0.2.239 slice).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { TRAVEL_GATE_X } from '../src/config.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SW = readFileSync(join(ROOT, 'public/sw.js'), 'utf8');
const ARENA = readFileSync(join(ROOT, 'src/arena.js'), 'utf8');
// v0.2.264 (R2): the in-world portal trigger moved from main.js (now the three-free
// shell) into arenaRuntime.js, dynamically imported on ENTER ARENA.
const MAIN = readFileSync(join(ROOT, 'src/arenaRuntime.js'), 'utf8');

describe('v0.2.240 — service worker precache is fail-soft (non-atomic)', () => {
  it('does NOT call the atomic cache.addAll(PRECACHE_ASSETS) that wedged the v0.2.239 install', () => {
    // The explanatory comment may NAME addAll(); what must not exist is the actual
    // atomic call over the asset list.
    expect(SW).not.toMatch(/addAll\(\s*PRECACHE_ASSETS\s*\)/);
  });

  it('precaches each asset independently with a per-asset catch', () => {
    // PRECACHE_ASSETS.map(asset => cache.add(asset).catch(...)) — one bad asset is
    // skipped, never failing the whole install.
    expect(SW).toContain('PRECACHE_ASSETS.map');
    expect(SW).toContain('cache.add(');
    expect(SW).toMatch(/cache\.add\([^)]*\)\.catch\(/);
  });

  it('still calls skipWaiting() so the upgrade can never wedge on a precache hiccup', () => {
    expect(SW).toContain('self.skipWaiting()');
  });

  it('still lists the travel gateway GLB (cached opportunistically, never blocking)', () => {
    expect(SW).toContain('/torii-gateway-experience.glb');
  });
});

describe('v0.2.240 — travel gateway GLB load is strictly fail-soft', () => {
  it('adds the procedural fallback to the scene before the async load', () => {
    const fn = ARENA.slice(ARENA.indexOf('function _buildTravelGateway'));
    const addFallback = fn.indexOf('scene.add(fallback)');
    const load = fn.indexOf("loader.load(assetUrl('/torii-gateway-experience.glb')");
    expect(addFallback).toBeGreaterThan(-1);
    expect(load).toBeGreaterThan(-1);
    // fallback is in the scene BEFORE the loader is invoked.
    expect(addFallback).toBeLessThan(load);
  });

  it('only removes the fallback after a successful load+process (swap, not pre-remove)', () => {
    const fn = ARENA.slice(
      ARENA.indexOf('function _buildTravelGateway'),
      ARENA.indexOf('function _buildNapZone'),
    );
    const removeFallback = fn.indexOf('scene.remove(fallback)');
    const addReal = fn.indexOf('scene.add(gate)');
    expect(removeFallback).toBeGreaterThan(-1);
    expect(addReal).toBeGreaterThan(-1);
    // The real model is added right after the fallback is removed, inside the
    // success path — so a processing throw can never leave the scene empty.
    expect(removeFallback).toBeLessThan(addReal);
  });

  it('guards loader-init, load and process failures and surfaces a loggable error', () => {
    const fn = ARENA.slice(
      ARENA.indexOf('function _buildTravelGateway'),
      ARENA.indexOf('function _buildNapZone'),
    );
    // A try/catch around loader construction + a try/catch around onLoad processing
    // + the onError callback all route through a single fail-soft marker.
    expect(fn).toContain('markGatewayFallback');
    expect(fn).toContain('loader-init-error');
    expect(fn).toContain('process-error');
    expect(fn).toContain('load-error');
    expect(fn).toContain('console.error');
    // A smoke-observable flag so harnesses can assert the fallback path was taken.
    expect(fn).toContain('__toriiTravelGatewayFailed');
  });
});

describe('v0.2.240 — entry repair preserves the v0.2.239 placement', () => {
  it('keeps the travel portal trigger anchored at TRAVEL_GATE_X', () => {
    const triggerBlock = MAIN.slice(MAIN.indexOf('createPortalTrigger('));
    expect(triggerBlock).toContain('portalPos: { x: TRAVEL_GATE_X');
  });

  it('keeps the gateway model anchored at TRAVEL_GATE_X (far side, not entrance)', () => {
    expect(ARENA).toMatch(/position\.set\(TRAVEL_GATE_X,/);
    expect(TRAVEL_GATE_X).toBeGreaterThan(0);
  });

  it('still builds the portal mesh from the trigger position (rings/diamond follow)', () => {
    expect(MAIN).toContain('position: _portalTrigger.portalPos()');
  });
});
