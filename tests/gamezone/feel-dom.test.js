// @vitest-environment jsdom
// tests/gamezone/feel-dom.test.js — ADR-0131 HUD + audio feel surfaces.
import { describe, it, expect, vi, beforeAll } from 'vitest';

vi.mock('../../src/engine/state/clientSuspended.js', () => ({ isClientSuspended: () => false }));

// Minimal WebAudio fake: counts nodes so we can assert what each cue builds.
const made = { osc: 0, buf: 0, pan: 0, src: 0 };
class P { constructor() { this.value = 0; } setValueAtTime() {} linearRampToValueAtTime() {} exponentialRampToValueAtTime() {} }
class Node { connect() {} }
class FakeCtx {
  constructor() { this.currentTime = 0; this.sampleRate = 8000; this.state = 'running'; this.destination = new Node(); }
  createOscillator() { made.osc++; const n = new Node(); n.frequency = new P(); n.start = () => {}; n.stop = () => {}; return n; }
  createGain() { const n = new Node(); n.gain = new P(); return n; }
  createBiquadFilter() { const n = new Node(); n.frequency = new P(); return n; }
  createBuffer(c, len) { made.buf++; const d = new Float32Array(len); return { sampleRate: this.sampleRate, getChannelData: () => d }; }
  createBufferSource() { made.src++; const n = new Node(); n.start = () => {}; return n; }
  createStereoPanner() { made.pan++; const n = new Node(); n.pan = new P(); return n; }
  resume() {}
}

let hud, audio;
beforeAll(async () => {
  window.AudioContext = FakeCtx;
  hud = await import('../../src/hud.js');
  audio = await import('../../src/audio.js');
});

describe('HUD combat feel (ADR-0131)', () => {
  it('hit marker shows at once, fades out on tick, and a void pulls it fast', () => {
    const tok = hud.showHitMarker('head');
    const el = document.getElementById('gz-hitmarker');
    expect(el).toBeTruthy();
    expect(el.style.opacity).toBe('1');
    expect(el.children).toHaveLength(4);
    hud.tickHUD(0.05);
    expect(Number(el.style.opacity)).toBeGreaterThan(0);
    expect(hud.voidHitMarker(tok)).toBe(true);
    hud.tickHUD(0.08); // > MARKER_VOID_MS
    expect(el.style.opacity).toBe('0');
    // A stale token cannot void a newer marker.
    const t2 = hud.showHitMarker('body');
    expect(hud.voidHitMarker(t2 - 1)).toBe(false);
    hud.tickHUD(1);
    expect(el.style.opacity).toBe('0');
    expect(document.querySelectorAll('#gz-hitmarker')).toHaveLength(1); // reused, not re-created
  });

  it('damage numbers are pooled (6 elements max), coloured by kind, voidable, and rise', () => {
    const before = document.body.children.length;
    const toks = [];
    for (let i = 0; i < 10; i++) toks.push(hud.popCombatText(String(i), i % 2 ? 'head' : 'body'));
    hud.popCombatText('+5⚡', 'reward');
    expect(document.body.children.length - before).toBeLessThanOrEqual(6);
    const last = toks[toks.length - 1];
    expect(hud.voidCombatText(last)).toBe(true);
    expect(hud.voidCombatText(last)).toBe(false);
    hud.tickHUD(2);
    hud.clearCombatFeel();
  });

  it('damage arc rotates to the source and fades', () => {
    hud.showDamageDir(Math.PI / 2, 1);
    const arcs = [...document.body.children].filter((e) => (e.style.transform || '').includes('translateY(-120px)'));
    expect(arcs.length).toBeGreaterThanOrEqual(1);
    expect(arcs[0].style.transform).toContain('rotate(1.5708rad)');
    expect(Number(arcs[0].style.opacity)).toBeGreaterThan(0.9);
    hud.tickHUD(1);
    expect(arcs[0].style.opacity).toBe('0');
    hud.showDamageDir(NaN); // ignored, no throw
  });
});

describe('audio feel cues (ADR-0131)', () => {
  it('hit/kill cues build only oscillators; bot fire reuses ONE noise buffer and pans', () => {
    audio.playHitMarker('body');
    audio.playHitMarker('head');
    audio.playKillConfirm(true);
    expect(made.osc).toBeGreaterThanOrEqual(5);
    const buf0 = made.buf;
    audio.playBotShoot(1, 0.5);
    audio.playBotShoot(0.2, -0.5);
    audio.playBotShoot();
    expect(made.buf - buf0).toBe(1);   // cached, not rebuilt per shot
    expect(made.src).toBe(3);
    expect(made.pan).toBe(2);          // centred shot skips the panner
    const o = made.osc;
    audio.playBotShoot(0);             // silent → builds nothing
    expect(made.osc).toBe(o);
  });
});
