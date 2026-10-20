// @vitest-environment jsdom
// ADR-0137 touch thumb controls + PWA manifest.
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';

function ptr(type, el, id, x, y) {
  const e = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y });
  Object.defineProperty(e, 'pointerId', { value: id });
  el.dispatchEvent(e);
  return e;
}

describe('joystickKeys (pure 8-way mapping)', () => {
  let tc;
  beforeEach(async () => { tc = await import('../src/engine/input/touchControls.js'); });
  const k = (dx, dy) => [...tc.joystickKeys(dx, dy)].sort().join(',');

  test('dead zone holds nothing', () => {
    expect(k(0, 0)).toBe('');
    expect(k(5, -5)).toBe('');
  });
  test('cardinals are pure (no diagonal bleed)', () => {
    expect(k(0, -50)).toBe('KeyW');
    expect(k(0, 50)).toBe('KeyS');
    expect(k(-50, 0)).toBe('KeyA');
    expect(k(50, 0)).toBe('KeyD');
    expect(k(10, -50)).toBe('KeyW'); // slight drift stays forward
  });
  test('diagonals hold two keys', () => {
    expect(k(40, -40)).toBe('KeyD,KeyW');
    expect(k(-40, 40)).toBe('KeyA,KeyS');
  });
  test('non-finite input is inert', () => {
    expect(k(NaN, 10)).toBe('');
    expect(k(Infinity, 0)).toBe('');
  });
  test('clampKnob limits travel to the ring', () => {
    const c = tc.clampKnob(300, 400, 50);
    expect(Math.hypot(c.x, c.y)).toBeCloseTo(50, 6);
    expect(tc.clampKnob(10, 0, 50)).toEqual({ x: 10, y: 0 });
  });
  test('shouldEnableTouch honours ?touch= and coarse pointer', () => {
    const win = (search, coarse) => ({ location: { search }, matchMedia: () => ({ matches: coarse }) });
    expect(tc.shouldEnableTouch(win('?touch=1', false))).toBe(true);
    expect(tc.shouldEnableTouch(win('?touch=0', true))).toBe(false);
    expect(tc.shouldEnableTouch(win('', true))).toBe(true);
    expect(tc.shouldEnableTouch(win('', false))).toBe(false);
  });
});

describe('input.js touch hooks', () => {
  let input, st;
  beforeEach(async () => {
    vi.resetModules();
    st = await import('../src/state.js');
    input = await import('../src/input.js');
  });

  test('applyLookDelta turns only while PLAYING, without pointer lock', () => {
    st.state.phase = st.PHASE.TITLE;
    input.setYaw(0);
    input.applyLookDelta(0.5, 0);
    expect(input.getYaw()).toBe(0);
    st.state.phase = st.PHASE.PLAYING;
    st.state.pointerLocked = false;
    input.applyLookDelta(0.5, 0);
    expect(input.getYaw()).toBeCloseTo(-0.5, 10);
    input.applyLookDelta(0, 99); // pitch clamps
    expect(input.getPitch()).toBeCloseTo(-Math.PI / 2.1, 10);
  });

  test('applyLookDelta is blocked by full input suppression', () => {
    st.state.phase = st.PHASE.PLAYING;
    input.setYaw(0);
    input.setGameInputSuppressed(true);
    input.applyLookDelta(1, 0);
    expect(input.getYaw()).toBe(0);
    input.setGameInputSuppressed(false);
  });

  test('triggerShoot fires shoot callbacks and honours Kami suppression', () => {
    st.state.phase = st.PHASE.PLAYING;
    const fn = vi.fn();
    input.onShoot(fn);
    expect(input.triggerShoot()).toBe(true);
    input.setShootingSuppressed(true);
    expect(input.triggerShoot()).toBe(false);
    input.setShootingSuppressed(false);
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe('installTouchControls overlay', () => {
  let tc, ctl, active, look, shoot, events;
  const onKey = e => events.push(e.type + ':' + e.code);
  beforeEach(async () => {
    vi.resetModules();
    vi.useFakeTimers();
    document.body.innerHTML = '<div id="crosshair"></div>';
    tc = await import('../src/engine/input/touchControls.js');
    active = true; look = vi.fn(); shoot = vi.fn(); events = [];
    document.addEventListener('keydown', onKey);
    document.addEventListener('keyup', onKey);
    ctl = tc.installTouchControls({ isActive: () => active, look, shoot });
  });
  afterEach(() => {
    document.removeEventListener('keydown', onKey);
    document.removeEventListener('keyup', onKey);
    ctl?.destroy();
    vi.useRealTimers();
  });

  test('shows while active and shows the crosshair; hides when not', () => {
    expect(ctl.root.classList.contains('on')).toBe(true);
    expect(document.getElementById('crosshair').classList.contains('active')).toBe(true);
    active = false; vi.advanceTimersByTime(200);
    expect(ctl.root.classList.contains('on')).toBe(false);
  });

  test('left thumb slide emits W/D keydowns and releases them on lift', () => {
    const z = ctl.root.querySelector('.tz-move');
    ptr('pointerdown', z, 1, 100, 300);
    ptr('pointermove', z, 1, 100, 240);           // up → W
    expect(events).toEqual(['keydown:KeyW']);
    ptr('pointermove', z, 1, 150, 250);           // up-right → +D
    expect(events).toContain('keydown:KeyD');
    ptr('pointerup', z, 1, 150, 250);
    expect(events.filter(e => e.startsWith('keyup')).sort()).toEqual(['keyup:KeyD', 'keyup:KeyW']);
  });

  test('a second finger on the move zone is ignored', () => {
    const z = ctl.root.querySelector('.tz-move');
    ptr('pointerdown', z, 1, 100, 300);
    ptr('pointerdown', z, 2, 50, 50);
    ptr('pointermove', z, 2, 50, 0);
    expect(events).toEqual([]);
  });

  test('right thumb slide feeds incremental look deltas', () => {
    const z = ctl.root.querySelector('.tz-look');
    ptr('pointerdown', z, 3, 500, 300);
    ptr('pointermove', z, 3, 510, 300);
    ptr('pointermove', z, 3, 530, 290);
    expect(look).toHaveBeenNthCalledWith(1, 10 * tc.LOOK_SENS, 0);
    expect(look.mock.calls[1][0]).toBeCloseTo(20 * tc.LOOK_SENS, 10);
    expect(look.mock.calls[1][1]).toBeCloseTo(-10 * tc.LOOK_SENS, 10);
  });

  test('look-pad pointerdown is preventDefault-ed (no compat click-shot)', () => {
    const e = ptr('pointerdown', ctl.root.querySelector('.tz-look'), 4, 1, 1);
    expect(e.defaultPrevented).toBe(true);
  });

  test('FIRE shoots, JUMP holds Space, MENU sends Escape', () => {
    ptr('pointerdown', ctl.root.querySelector('.tb-fire'), 5, 0, 0);
    expect(shoot).toHaveBeenCalledTimes(1);
    const j = ctl.root.querySelector('.tb-jump');
    ptr('pointerdown', j, 6, 0, 0); ptr('pointerup', j, 6, 0, 0);
    ptr('pointerdown', ctl.root.querySelector('.tb-menu'), 7, 0, 0);
    expect(events).toEqual(['keydown:Space', 'keyup:Space', 'keydown:Escape']);
  });

  test('going inactive mid-slide releases held movement keys', () => {
    const z = ctl.root.querySelector('.tz-move');
    ptr('pointerdown', z, 1, 100, 300);
    ptr('pointermove', z, 1, 100, 200);
    active = false; vi.advanceTimersByTime(200);
    expect(events).toEqual(['keydown:KeyW', 'keyup:KeyW']);
  });
});

describe('PWA manifest', () => {
  const m = JSON.parse(readFileSync('public/manifest.webmanifest', 'utf8'));
  test('is installable: name, relative start_url/scope, 192+512 PNG icons', () => {
    expect(m.name).toBe('Torii Quest');
    expect(m.start_url).toBe('./');   // relative → works under /quest/ and root
    expect(m.scope).toBe('./');
    const sizes = m.icons.filter(i => i.type === 'image/png').map(i => i.sizes);
    expect(sizes).toContain('192x192');
    expect(sizes).toContain('512x512');
    for (const i of m.icons) expect(() => readFileSync('public/' + i.src)).not.toThrow();
  });
  test('index.html links the manifest relatively', () => {
    const html = readFileSync('index.html', 'utf8');
    expect(html).toMatch(/<link rel="manifest" href="\.\/manifest\.webmanifest"\/>/);
  });
});
