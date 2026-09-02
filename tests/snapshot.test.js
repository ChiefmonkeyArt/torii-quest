// tests/snapshot.test.js — locks down the pure debug snapshot builder
// (src/engine/debug/snapshot.js). Every field comes from an injected provider
// read behind safe(), so the surface must NEVER throw — even when a provider is
// missing or itself throws. These tests use plain fake providers (no Three/
// Rapier/DOM), matching how the module is designed to be exercised in node.
import { describe, it, expect } from 'vitest';
import {
  buildSnapshot, buildCombatReport, buildPhysicsReport, buildKamiReport,
} from '../src/engine/debug/snapshot.js';

describe('buildCombatReport', () => {
  it('passes through provider values for last hit/shot/miss', () => {
    const p = {
      getLastHit:  () => ({ part: 'head' }),
      getLastShot: () => ({ outcome: 'hit' }),
      getLastMiss: () => null,
    };
    expect(buildCombatReport(p)).toEqual({
      lastHit:  { part: 'head' },
      lastShot: { outcome: 'hit' },
      lastMiss: null,
      lastSentShot: null,
    });
  });
  // ADR-0046 v0.2.667: the ema/dashboard path for the sent-ray diagnostic —
  // proves combat.lastSentShot actually flows through buildCombatReport when a
  // provider is wired, not just that the missing-provider case returns null.
  it('passes through a non-null lastSentShot for the sent-ray diagnostic', () => {
    const sentDiag = {
      ts: 555, viewLag: 15, usedAimRay: true,
      sentOrigin: [0, 2.59, 1], sentDir: [0, 0, 1],
      muzzleOrigin: [0.3, 2.40, 1], muzzleDir: [0, 0, 1],
      aimOrigin: [0, 2.59, 1], aimDir: [0, 0, 1],
    };
    const p = { getLastSentShot: () => sentDiag };
    expect(buildCombatReport(p)).toEqual({
      lastHit: null, lastShot: null, lastMiss: null, lastSentShot: sentDiag,
    });
  });

  it('returns nulls when providers are missing', () => {
    expect(buildCombatReport({})).toEqual({ lastHit: null, lastShot: null, lastMiss: null, lastSentShot: null });
    expect(buildCombatReport()).toEqual({ lastHit: null, lastShot: null, lastMiss: null, lastSentShot: null });
  });
  it('does not throw when a provider throws — yields null for that field', () => {
    const p = { getLastHit: () => { throw new Error('boom'); }, getLastShot: () => 1, getLastMiss: () => 2 };
    expect(() => buildCombatReport(p)).not.toThrow();
    expect(buildCombatReport(p)).toEqual({ lastHit: null, lastShot: 1, lastMiss: 2, lastSentShot: null });
  });
});

describe('buildPhysicsReport', () => {
  it('summarises readiness + counts from providers', () => {
    const p = {
      isPhysicsReady: () => true,
      getBodyCount:   () => 12,
      getColliderCount: () => 20,
      getBotSummary:  () => ({ total: 5, alive: 3 }),
      getCrateSummary: () => ({ count: 9, positions: [] }),
    };
    expect(buildPhysicsReport(p)).toEqual({
      ready: true, bodies: 12, colliders: 20,
      bots: { total: 5, alive: 3 }, crates: { count: 9, positions: [] },
    });
  });
  it('ready falls back to false (never null) when the provider is missing', () => {
    const r = buildPhysicsReport({});
    expect(r.ready).toBe(false);
    expect(r.bodies).toBeNull();
    expect(r.colliders).toBeNull();
  });
  it('does not throw when a provider throws', () => {
    const p = { isPhysicsReady: () => { throw new Error('x'); }, getBodyCount: () => { throw new Error('y'); } };
    expect(() => buildPhysicsReport(p)).not.toThrow();
    const r = buildPhysicsReport(p);
    expect(r.ready).toBe(false);
    expect(r.bodies).toBeNull();
  });
});

describe('buildKamiReport', () => {
  it('passes through the four Kami client-state flags', () => {
    const p = {
      isKamiActive:   () => true,
      isKamiNoteOpen: () => false,
      isKamiEntering: () => false,
      isPointerLocked: () => true,
    };
    expect(buildKamiReport(p)).toEqual({
      active: true, noteOpen: false, entering: false, pointerLocked: true,
    });
  });
  it('defaults every flag to false when providers are missing', () => {
    expect(buildKamiReport({})).toEqual({
      active: false, noteOpen: false, entering: false, pointerLocked: false,
    });
    expect(buildKamiReport()).toEqual({
      active: false, noteOpen: false, entering: false, pointerLocked: false,
    });
  });
  it('does not throw when a provider throws — yields false for that flag', () => {
    const p = {
      isKamiActive: () => { throw new Error('boom'); },
      isKamiNoteOpen: () => true,
    };
    expect(() => buildKamiReport(p)).not.toThrow();
    expect(buildKamiReport(p)).toEqual({
      active: false, noteOpen: true, entering: false, pointerLocked: false,
    });
  });
});

describe('buildSnapshot', () => {
  it('assembles a full JSON-serialisable object from providers', () => {
    const p = {
      version: 'v0.2.130-alpha',
      getPhase: () => 'playing',
      getState: () => ({ hp: 100, ammo: 30 }),
      getPlayerPos: () => ({ x: 1.23456, y: 1.7, z: -4.98765 }),
      getLastHit: () => null, getLastShot: () => null, getLastMiss: () => null,
      isPhysicsReady: () => true, getBodyCount: () => 1, getColliderCount: () => 2,
      getBotSummary: () => ({ total: 5, alive: 5 }), getCrateSummary: () => ({ count: 9 }),
      isKamiActive: () => true, isKamiNoteOpen: () => false,
      isKamiEntering: () => false, isPointerLocked: () => true,
      config: { godMode: false },
    };
    const snap = buildSnapshot(p);
    expect(snap.version).toBe('v0.2.130-alpha');
    expect(snap.phase).toBe('playing');
    expect(snap.state).toEqual({ hp: 100, ammo: 30 });
    // player position is rounded to 3 decimals for compact, stable output.
    expect(snap.player).toEqual({ x: 1.235, y: 1.7, z: -4.988 });
    expect(snap.kami).toEqual({ active: true, noteOpen: false, entering: false, pointerLocked: true });
    expect(snap.config).toEqual({ godMode: false });
    // round-trips through JSON without loss (the whole point of the surface).
    expect(() => JSON.stringify(snap)).not.toThrow();
    expect(JSON.parse(JSON.stringify(snap))).toEqual(snap);
  });
  it('is safe to call with NOTHING wired up (title screen / pre-physics)', () => {
    expect(() => buildSnapshot()).not.toThrow();
    const snap = buildSnapshot();
    expect(snap.version).toBeNull();
    expect(snap.phase).toBeNull();
    expect(snap.player).toBeNull();
    expect(snap.combat).toEqual({ lastHit: null, lastShot: null, lastMiss: null, lastSentShot: null });
    expect(snap.physics.ready).toBe(false);
    expect(snap.kami).toEqual({ active: false, noteOpen: false, entering: false, pointerLocked: false });
    expect(snap.config).toBeNull();
  });
  it('player is null when the position provider returns nothing', () => {
    expect(buildSnapshot({ getPlayerPos: () => null }).player).toBeNull();
  });
});
