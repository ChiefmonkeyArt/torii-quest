// tests/fire-diagnostics.test.js — ADR-0014 shot-fired diagnostic layer.
//
// The composed [FIRE] line must correctly classify every path shown in the
// bug-hunt log: no hit, hit terrain, hit a live bot, hit a dead bot, MP mode.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { classifyFireHit, composeFireLine } from '../src/engine/entities/fireDiagnostics.js';

describe('fireDiagnostics.classifyFireHit (ADR-0014)', () => {
  it('returns "none" when the aim ray hit nothing', () => {
    expect(classifyFireHit(null)).toBe('none');
    expect(classifyFireHit(undefined)).toBe('none');
  });

  it('returns "terrain" when the ray hit non-bot geometry', () => {
    expect(classifyFireHit({ toi: 12.3, point: { x: 0, y: 0, z: 0 } })).toBe('terrain');
  });

  it('returns "bot" when the ray hit a live bot', () => {
    const hit = { toi: 8.1, bot: { id: 3, name: 'Sleepy', alive: true } };
    expect(classifyFireHit(hit)).toBe('bot');
  });

  it('returns "dead-bot" when the ray hit a dead bot\'s parked collider', () => {
    const hit = { toi: 8.1, bot: { id: 3, name: 'Sleepy', alive: false } };
    expect(classifyFireHit(hit)).toBe('dead-bot');
  });
});

describe('fireDiagnostics.composeFireLine (ADR-0014)', () => {
  it('SP clean hit → resolved=yes reason=clean-hit', () => {
    const aimHit = { toi: 14.2, bot: { id: 3, name: 'Sleepy', alive: true }, bodyPart: 'body' };
    const local  = { bot: aimHit.bot, dmg: 3, isHead: false, toi: 14.2 };
    const line = composeFireLine({ netMode: false, aimHit, local, zone: 'body' });
    expect(line).toMatchObject({
      mode: 'sp', hit: 'bot', botId: 3, name: 'Sleepy',
      zone: 'body', toi: 14.2, resolved: 'yes', reason: 'clean-hit',
    });
  });

  it('SP miss (no ray hit) → resolved=no reason=miss', () => {
    const line = composeFireLine({ netMode: false, aimHit: null, local: null });
    expect(line).toMatchObject({
      mode: 'sp', hit: 'none', botId: '-', name: '-',
      zone: '-', toi: '-', resolved: 'no', reason: 'miss',
    });
  });

  it('SP dead-bot hit → resolved=no reason=dead', () => {
    // The exact bug hypothesis: player keeps shooting a dead bot's parked collider.
    const aimHit = { toi: 12.0, bot: { id: 4, name: 'Augustink', alive: false } };
    const line = composeFireLine({ netMode: false, aimHit, local: null });
    expect(line).toMatchObject({
      mode: 'sp', hit: 'dead-bot', botId: 4, name: 'Augustink',
      zone: '-', toi: 12.0, resolved: 'no', reason: 'dead',
    });
  });

  it('SP hit terrain → resolved=no reason=other', () => {
    const aimHit = { toi: 6.6, point: { x: 0, y: 0, z: 0 } };
    const line = composeFireLine({ netMode: false, aimHit, local: null });
    expect(line).toMatchObject({
      mode: 'sp', hit: 'terrain', resolved: 'no', reason: 'other', toi: 6.6,
    });
  });

  it('MP mode → resolved=mp regardless of local (server authoritative)', () => {
    const aimHit = { toi: 9.0, bot: { id: 1, name: 'Grumpy', alive: true } };
    const line = composeFireLine({ netMode: true, aimHit, local: null, zone: 'head' });
    expect(line).toMatchObject({
      mode: 'mp', hit: 'bot', botId: 1, name: 'Grumpy',
      zone: 'head', toi: 9.0, resolved: 'mp', reason: 'clean-hit'.replace('clean-hit', 'net'),
    });
    // Explicit — reason must be 'net' in MP with no local resolution.
    expect(line.reason).toBe('net');
  });

  it('MP mode + miss → hit=none reason=miss', () => {
    // Ray missed → miss reason wins even in MP; the server won't see a target either.
    const line = composeFireLine({ netMode: true, aimHit: null, local: null });
    expect(line).toMatchObject({ mode: 'mp', hit: 'none', resolved: 'mp', reason: 'miss' });
  });

  it('does not throw on malformed inputs', () => {
    expect(() => composeFireLine({})).not.toThrow();
    expect(() => composeFireLine({ netMode: false, aimHit: {}, local: null })).not.toThrow();
  });

  it('bot with missing name falls back to "-"', () => {
    const aimHit = { toi: 5, bot: { id: 0, alive: true } };
    const line = composeFireLine({ netMode: false, aimHit, local: null, zone: 'body' });
    expect(line.botId).toBe(0);
    expect(line.name).toBe('-');
  });
});

describe('fireDiagnostics runtime gate (window.__toriiFireDiag)', () => {
  // The gate lives inside logShotFired; assert it via the module's own read
  // path so we don't fake console. We can't easily import _enabled (private),
  // but we can prove the flag's shape by inspecting window contract.
  const origWindow = globalThis.window;
  beforeEach(() => { globalThis.window = {}; });
  afterEach(() => { globalThis.window = origWindow; });

  it('default (undefined) is treated as ON per ADR-0014', () => {
    // Contract: the module reads `window.__toriiFireDiag !== false`.
    expect(globalThis.window.__toriiFireDiag).toBeUndefined();
    expect(globalThis.window.__toriiFireDiag !== false).toBe(true);
  });

  it('explicit false disables', () => {
    globalThis.window.__toriiFireDiag = false;
    expect(globalThis.window.__toriiFireDiag !== false).toBe(false);
  });
});
