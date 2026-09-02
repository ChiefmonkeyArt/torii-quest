// ADR-0099 (v0.2.743-alpha) — Kami-mode dev menu: model + DOM driver.
//
// The menu MUST NOT surface on the public perpetual-world view. That means:
//   1. When isVisible() is false, renderModel() reports no entries.
//   2. When isVisible() is false, applyToggle() refuses (gate in CODE, not UI).
//   3. When isVisible() flips true, the DOM driver shows the panel and
//      injects one row per registered entry.
//   4. Clicking a row calls the entry's set(...) once with the flipped value.
//   5. A synthesized click while the gate is closed does NOT reach set(...).

import { describe, it, expect, beforeEach } from 'vitest';
import { createDevMenuModel } from '../src/engine/dev/devMenuModel.js';
import { installDevMenu, registerDevToggle, pumpDevMenu, __resetDevMenuForTests } from '../src/engine/dev/devMenu.js';

// Small headless-DOM stub so the driver can render without JSDOM. We only need
// getElementById + a "hidden" flag + innerHTML + querySelectorAll + click
// dispatch for the specific button element the driver renders.
function makeDocStub() {
  const root = makeEl('div', 'torii-dev-menu');
  return {
    _root: root,
    getElementById(id) { return id === 'torii-dev-menu' ? root : null; },
  };
}
function makeEl(tag, id) {
  const el = {
    tagName: tag.toUpperCase(),
    id: id || '',
    hidden: false,
    innerHTML: '',
    _listeners: {},
    _attrs: {},
    setAttribute(k, v) { this._attrs[k] = String(v); },
    getAttribute(k) { return this._attrs[k]; },
    addEventListener(ev, fn) { (this._listeners[ev] = this._listeners[ev] || []).push(fn); },
    dispatch(ev) { (this._listeners[ev] || []).forEach((fn) => fn({ target: this })); },
    querySelectorAll(sel) {
      // Only supports the attribute-selector the driver uses.
      const m = sel.match(/^\[data-dev-toggle-id\]$/);
      if (!m) return [];
      // Parse the current innerHTML for data-dev-toggle-id="..." — the driver
      // renders buttons as strings, so we synthesize matching element stubs
      // that carry the id and re-render the innerHTML around clicks.
      const ids = [...this.innerHTML.matchAll(/data-dev-toggle-id="([^"]+)"/g)].map((m) => m[1]);
      return ids.map((id) => {
        const b = makeEl('button', '');
        b.setAttribute('data-dev-toggle-id', id);
        b._parent = this;
        return b;
      });
    },
  };
  return el;
}

describe('ADR-0099 devMenuModel — pure model', () => {
  it('renderModel is empty when isVisible is false', () => {
    const m = createDevMenuModel({ isVisible: () => false });
    m.register({ id: 'x', label: 'X', get: () => true, set: () => {} });
    const snap = m.renderModel();
    expect(snap.visible).toBe(false);
    expect(snap.entries.length).toBe(0);
  });

  it('renderModel returns registered entries with live get() when visible', () => {
    let flag = false;
    const m = createDevMenuModel({ isVisible: () => true });
    m.register({ id: 'flag', label: 'Flag', get: () => flag, set: (v) => { flag = v; } });
    expect(m.renderModel().entries[0].on).toBe(false);
    flag = true;
    expect(m.renderModel().entries[0].on).toBe(true);
  });

  it('applyToggle refuses when gate is closed — set() is NEVER called', () => {
    let calls = 0;
    let visible = false;
    const m = createDevMenuModel({ isVisible: () => visible });
    m.register({ id: 'x', label: 'X', get: () => false, set: () => { calls += 1; } });
    const r = m.applyToggle('x', true);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('not-visible');
    expect(calls).toBe(0);
  });

  it('applyToggle flips value when gate is open', () => {
    let flag = false;
    const m = createDevMenuModel({ isVisible: () => true });
    m.register({ id: 'flag', label: 'Flag', get: () => flag, set: (v) => { flag = v; } });
    const r = m.applyToggle('flag', true);
    expect(r.ok).toBe(true);
    expect(r.on).toBe(true);
    expect(flag).toBe(true);
  });

  it('applyToggle rejects unknown ids', () => {
    const m = createDevMenuModel({ isVisible: () => true });
    const r = m.applyToggle('nope', true);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('unknown-id');
  });

  it('applyToggle catches thrown setters and reports reason', () => {
    const m = createDevMenuModel({ isVisible: () => true });
    m.register({ id: 'boom', label: 'Boom', get: () => false, set: () => { throw new Error('nope'); } });
    const r = m.applyToggle('boom', true);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('set-threw');
  });

  it('register rejects invalid ids', () => {
    const m = createDevMenuModel({ isVisible: () => true });
    expect(() => m.register({ id: 'Not Valid', label: 'X', get: () => 0, set: () => {} })).toThrow();
    expect(() => m.register({ id: '', label: 'X', get: () => 0, set: () => {} })).toThrow();
  });

  it('register rejects duplicate ids', () => {
    const m = createDevMenuModel({ isVisible: () => true });
    m.register({ id: 'a', label: 'A', get: () => 0, set: () => {} });
    expect(() => m.register({ id: 'a', label: 'A2', get: () => 0, set: () => {} })).toThrow();
  });

  it('factory rejects a missing isVisible predicate', () => {
    expect(() => createDevMenuModel({})).toThrow();
  });

  it('renderModel snapshot is frozen so DOM driver can\'t mutate it back', () => {
    const m = createDevMenuModel({ isVisible: () => true });
    m.register({ id: 'a', label: 'A', get: () => true, set: () => {} });
    const snap = m.renderModel();
    expect(Object.isFrozen(snap)).toBe(true);
    expect(Object.isFrozen(snap.entries)).toBe(true);
    expect(Object.isFrozen(snap.entries[0])).toBe(true);
  });
});

describe('ADR-0099 devMenu DOM driver — hidden vs visible', () => {
  let visible;
  let doc;

  beforeEach(() => {
    __resetDevMenuForTests();
    visible = false;
    doc = makeDocStub();
  });

  it('panel stays hidden and empty when isVisible=false', () => {
    installDevMenu({ isVisible: () => visible, doc });
    registerDevToggle({ id: 'x', label: 'X', get: () => false, set: () => {} });
    pumpDevMenu(0, doc);
    expect(doc._root.hidden).toBe(true);
    expect(doc._root.innerHTML).toBe('');
  });

  it('panel shows one row per registered entry when isVisible=true', () => {
    installDevMenu({ isVisible: () => visible, doc });
    registerDevToggle({ id: 'sticker-plane-mode', label: 'Sticker: force plane', get: () => false, set: () => {} });
    visible = true;
    pumpDevMenu(0, doc);
    expect(doc._root.hidden).toBe(false);
    expect(doc._root.innerHTML).toContain('sticker-plane-mode');
    expect(doc._root.innerHTML).toContain('Sticker: force plane');
    expect(doc._root.innerHTML).toContain('OFF');
  });

  it('panel wipes its body when isVisible flips back to false', () => {
    installDevMenu({ isVisible: () => visible, doc });
    registerDevToggle({ id: 'x', label: 'X', get: () => true, set: () => {} });
    visible = true;
    pumpDevMenu(0, doc);
    expect(doc._root.hidden).toBe(false);
    expect(doc._root.innerHTML).not.toBe('');
    visible = false;
    pumpDevMenu(0, doc);
    expect(doc._root.hidden).toBe(true);
    expect(doc._root.innerHTML).toBe('');
  });

  it('reflects live get() on every pump — a console flip surfaces in the row', () => {
    let flag = false;
    installDevMenu({ isVisible: () => visible, doc });
    registerDevToggle({ id: 'flag', label: 'Flag', get: () => flag, set: (v) => { flag = v; } });
    visible = true;
    pumpDevMenu(0, doc);
    expect(doc._root.innerHTML).toContain('>OFF<');
    flag = true;
    pumpDevMenu(0, doc);
    expect(doc._root.innerHTML).toContain('>ON<');
  });

  it('installDevMenu is idempotent — a second install returns the same model', () => {
    const a = installDevMenu({ isVisible: () => true, doc });
    const b = installDevMenu({ isVisible: () => true, doc });
    expect(a).toBe(b);
  });

  it('is not present in the DOM stub without install() (defence-in-depth)', () => {
    // No install call. Just to prove the driver does nothing on its own.
    expect(doc._root.hidden).toBe(false);
    expect(doc._root.innerHTML).toBe('');
    pumpDevMenu(0, doc); // safe no-op
    expect(doc._root.hidden).toBe(false);
    expect(doc._root.innerHTML).toBe('');
  });
});

describe('ADR-0099 devMenu owner + kami gate — code, not just UI', () => {
  beforeEach(() => __resetDevMenuForTests());

  it('gate closed \u2192 open flow (public view \u2192 owner enters Kami)', () => {
    let kami = false;
    let owner = false;
    let flag = false;
    const doc = makeDocStub();
    installDevMenu({ isVisible: () => kami && owner, doc });
    registerDevToggle({ id: 'flag', label: 'Flag', get: () => flag, set: (v) => { flag = v; } });

    // Public view: no Kami, no owner. Menu hidden.
    pumpDevMenu(0, doc);
    expect(doc._root.hidden).toBe(true);

    // A non-owner visitor toggles Kami-active on their side (bug scenario):
    // owner check still returns false, menu still hidden.
    kami = true;
    owner = false;
    pumpDevMenu(0, doc);
    expect(doc._root.hidden).toBe(true);

    // Owner enters Kami: menu shows, sticker toggle row visible.
    owner = true;
    pumpDevMenu(0, doc);
    expect(doc._root.hidden).toBe(false);
    expect(doc._root.innerHTML).toContain('flag');
  });

  it('a synthesized DOM click while gate is closed does NOT call set()', () => {
    // The DOM driver only wires clicks on rows that were rendered under an
    // open gate. But even if a caller preserves a stale button reference,
    // the model refuses the intent \u2014 code-side gate.
    let kami = true;
    let owner = true;
    let calls = 0;
    const doc = makeDocStub();
    const model = installDevMenu({ isVisible: () => kami && owner, doc });
    registerDevToggle({ id: 'x', label: 'X', get: () => false, set: () => { calls += 1; } });
    pumpDevMenu(0, doc);
    const btns = doc._root.querySelectorAll('[data-dev-toggle-id]');
    expect(btns.length).toBe(1);

    // Now close the gate but hold the stale reference.
    kami = false;
    // Bypass the DOM wiring and call the model directly \u2014 same intent surface
    // any code path (or devtools) would eventually hit.
    const r = model.applyToggle('x', true);
    expect(r.ok).toBe(false);
    expect(calls).toBe(0);
  });
});
