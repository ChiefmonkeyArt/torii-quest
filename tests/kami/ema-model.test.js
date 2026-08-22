// ema-model.test.js — ADR-0025 (v0.2.634-alpha).
//
// Locks the ema record + tray contract. These rules protect the OWNER'S NOTES,
// which are unrecoverable if lost: a capture that silently writes a blank or
// place-less record is worse than one that refuses loudly.
//
// Pure: plain data in, plain data out. No DOM, no crypto, no network.
import { describe, it, expect } from 'vitest';
import {
  EMA_KIND, EMA_STATUS, NOTE_MAX, TRAY_MAX, SCREENSHOT_KEEP,
  makeEma, makeEmaId, noteIsValid, addToTray, removeFromTray, trayBytes,
  screenshotsToCull, resolveEma, openEma,
  normaliseWorldTarget, normaliseUiTarget,
} from '../../src/engine/kami/emaModel.js';

const WORLD = { pos: { x: 1.234, y: 2.345, z: -3.456 }, yaw: 0.5, pitch: -0.25 };
const base = (over = {}) => ({ id: 'ema_1', note: 'a note', kind: EMA_KIND.WORLD, world: WORLD, ts: 1000, version: 'v0.2.634-alpha', ...over });

describe('emaModel — record building', () => {
  it('builds a world ema and rounds coordinates to 2dp', () => {
    const rec = makeEma(base());
    expect(rec.kind).toBe(EMA_KIND.WORLD);
    expect(rec.status).toBe(EMA_STATUS.OPEN);
    expect(rec.world.pos).toEqual({ x: 1.23, y: 2.35, z: -3.46 });
  });

  it('REFUSES an empty note rather than writing a blank plaque', () => {
    expect(() => makeEma(base({ note: '   ' }))).toThrow(/note is required/i);
  });

  it('REFUSES a world ema with no usable position', () => {
    expect(() => makeEma(base({ world: { pos: { x: 1, y: NaN, z: 3 } } }))).toThrow(/valid position/i);
  });

  it('REFUSES a ui ema with no selector', () => {
    expect(() => makeEma(base({ kind: EMA_KIND.UI, world: null, ui: { text: 'hi' } }))).toThrow(/selector/i);
  });

  it('requires an id, so records can never collide silently', () => {
    expect(() => makeEma(base({ id: '' }))).toThrow(/id is required/i);
  });

  it('caps an over-long note instead of rejecting the whole capture', () => {
    const rec = makeEma(base({ note: 'x'.repeat(NOTE_MAX + 500) }));
    expect(rec.note).toHaveLength(NOTE_MAX);
  });

  it('keeps the debug snapshot whole and unfiltered', () => {
    const snapshot = { version: 'v1', combat: { lastShot: { decision: 'miss' } }, nested: { deep: [1, 2, 3] } };
    expect(makeEma(base({ snapshot })).snapshot).toEqual(snapshot);
  });

  it('records what the crosshair was over, so a note names the bot', () => {
    const world = { ...WORLD, lookingAt: { kind: 'bot', name: 'Sleepy', id: 3, dist: 12.567 } };
    expect(makeEma(base({ world })).world.lookingAt).toEqual({ kind: 'bot', name: 'Sleepy', id: 3, dist: 12.57 });
  });

  it('generates time-ordered ids so the JSONL sorts chronologically', () => {
    const early = makeEmaId(1_000_000, () => 0.5);
    const later = makeEmaId(9_000_000, () => 0.5);
    expect(early < later).toBe(true);
  });

  it('generates distinct ids within the same millisecond', () => {
    let n = 0;
    const seq = () => [0.11, 0.87][n++ % 2];
    expect(makeEmaId(5000, seq)).not.toBe(makeEmaId(5000, seq));
  });
});

describe('emaModel — ui targets', () => {
  it('prefers the selector and collapses label whitespace', () => {
    const ui = normaliseUiTarget({ selector: '#btn-resume', tag: 'BUTTON', text: '  ▶  RESUME \n ', rect: { x: 10.6, y: 20.2, w: 100.4, h: 30.9 } });
    expect(ui.selector).toBe('#btn-resume');
    expect(ui.tag).toBe('button');
    expect(ui.text).toBe('▶ RESUME');
    expect(ui.rect).toEqual({ x: 11, y: 20, w: 100, h: 31 });
  });

  it('returns null with no selector, so callers can fall back', () => {
    expect(normaliseUiTarget({ text: 'orphan' })).toBeNull();
    expect(normaliseWorldTarget({ pos: { x: 0, y: 0 } })).toBeNull();
  });
});

describe('emaModel — tray', () => {
  it('accumulates notes so several can be hung in one batch', () => {
    let tray = [];
    for (const id of ['a', 'b', 'c']) tray = addToTray(tray, makeEma(base({ id }))).tray;
    expect(tray.map((r) => r.id)).toEqual(['a', 'b', 'c']);
  });

  it('refuses past TRAY_MAX rather than silently dropping a note', () => {
    let tray = [];
    for (let i = 0; i < TRAY_MAX; i++) tray = addToTray(tray, makeEma(base({ id: `e${i}` }))).tray;
    const res = addToTray(tray, makeEma(base({ id: 'overflow' })));
    expect(res.added).toBe(false);
    expect(res.reason).toMatch(/full/i);
    expect(res.tray).toHaveLength(TRAY_MAX);
  });

  it('does not mutate the input tray', () => {
    const tray = [makeEma(base())];
    addToTray(tray, makeEma(base({ id: 'ema_2' })));
    expect(tray).toHaveLength(1);
  });

  it('removes a pending ema by id', () => {
    const tray = [makeEma(base({ id: 'a' })), makeEma(base({ id: 'b' }))];
    expect(removeFromTray(tray, 'a').map((r) => r.id)).toEqual(['b']);
  });

  it('estimates batch size including base64 image overhead', () => {
    const withShot = { ...makeEma(base()), shotBytes: 1000 };
    expect(trayBytes([withShot])).toBeGreaterThan(1340);
  });
});

describe('emaModel — lifecycle and cull', () => {
  it('only OPEN ema are drawn in the world', () => {
    const open = makeEma(base({ id: 'open' }));
    const done = resolveEma(makeEma(base({ id: 'done' })), { version: 'v0.2.635-alpha', ref: 'ADR-0026', ts: 42 });
    expect(openEma([open, done]).map((r) => r.id)).toEqual(['open']);
    expect(done.status).toBe(EMA_STATUS.RESOLVED);
    expect(done.resolved).toEqual({ version: 'v0.2.635-alpha', ref: 'ADR-0026', ts: 42 });
  });

  it('keeps the newest SCREENSHOT_KEEP images and culls older ones', () => {
    const ids = Array.from({ length: SCREENSHOT_KEEP + 30 }, (_, i) => `s${i}`);
    const cull = screenshotsToCull(ids);
    expect(cull).toHaveLength(30);
    expect(cull[0]).toBe('s0');                       // oldest goes first
    expect(cull).not.toContain(`s${ids.length - 1}`);  // newest is kept
  });

  it('culls nothing while under the keep window', () => {
    expect(screenshotsToCull(['a', 'b', 'c'], 420)).toEqual([]);
  });

  it('noteIsValid gates the hang button live', () => {
    expect(noteIsValid('ok')).toBe(true);
    expect(noteIsValid('   ')).toBe(false);
    expect(noteIsValid('x'.repeat(NOTE_MAX + 1))).toBe(false);
  });
});
