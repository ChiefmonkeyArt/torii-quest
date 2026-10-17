// @vitest-environment jsdom
// tests/gamezone/feel-dom.test.js — ADR-0131 HUD + audio feel surfaces, plus the
// ADR-0132 NAP sticker cues (same file: the suite shares module state across files).
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
  createBiquadFilter() { const n = new Node(); n.frequency = new P(); n.Q = new P(); return n; }
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

describe('sticker HUD (ADR-0132)', () => {
  it('pink sticker marker reuses the pooled hit marker', () => {
    hud.showHitMarker('sticker');
    const el = document.getElementById('gz-hitmarker');
    expect(el.style.opacity).toBe('1');
    expect(el.children[0].style.background).toMatch(/ff7ad9|255, 122, 217/);
    hud.tickHUD(1);
    expect(el.style.opacity).toBe('0');
    expect(document.querySelectorAll('#gz-hitmarker')).toHaveLength(1);
  });

  it('STUCK! pops pink from the same pool', () => {
    const before = document.body.children.length;
    hud.popCombatText('STUCK!', 'sticker');
    const pop = [...document.body.children].find((e) => e.textContent === 'STUCK!');
    expect(pop).toBeTruthy();
    expect(pop.style.color).toMatch(/ff7ad9|255, 122, 217/);
    for (let i = 0; i < 10; i++) hud.popCombatText('STUCK!', 'sticker');
    expect(document.body.children.length - before).toBeLessThanOrEqual(6);
    hud.clearCombatFeel();
  });
});

describe('sticker audio (ADR-0132)', () => {
  it('fire thwip and landing pops never allocate a new AudioBuffer after the first', () => {
    audio.playStickerFire();
    const buf0 = made.buf;
    for (let i = 0; i < 20; i++) { audio.playStickerFire(); audio.playStickerStick(1, 0.3, i % 2 === 0, 1); }
    audio.playBotShoot(1, 0);
    expect(made.buf).toBe(buf0);
    expect(buf0).toBeLessThanOrEqual(1);
  });

  it('a character pop adds the boing; distance pans; silence at level 0', () => {
    let o = made.osc; audio.playStickerStick(1, 0, false); const plain = made.osc - o;
    o = made.osc; audio.playStickerStick(1, 0, true); const boing = made.osc - o;
    expect(boing).toBe(plain + 1);
    const p = made.pan; audio.playStickerStick(0.4, 0.6, false); expect(made.pan).toBe(p + 1);
    o = made.osc; audio.playStickerStick(0, 0, true); expect(made.osc).toBe(o);
  });
});
