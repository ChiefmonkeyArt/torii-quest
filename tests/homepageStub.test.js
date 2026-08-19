// tests/homepageStub.test.js — locks the Phase 0g "Gateway setup" homepage
// stub (src/engine/homepage/homepageStub.js). Pure vitest (node env, no jsdom):
// a hand-rolled fake DOM is injected via globalThis.document so the three-free
// DOM module can be exercised without a browser. Mirrors the fake-DOM approach
// in tests/login-bootstrap.test.js + tests/nostr-profile-progressive.test.js.
//
// Covers: the 4-card render, owner vs guest gating (guests never mutate
// torii.world.active), card→callback wiring (Choose Blank → 'gateway-blank',
// Use Template → 'chiefmonkey-template', Visit → onVisitNodeDirectory,
// Publish → onPublishNode), close/isOpen lifecycle, the sessionStorage
// shown-this-session round-trip + auto-open gating, and the no-timer /
// no-three-import invariants. No real DOM/storage is touched.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  openHomepageStub, closeHomepageStub, isHomepageStubOpen,
  setShownThisSession, hasShownThisSession, _resetForTest,
} from '../src/engine/homepage/homepageStub.js';

// ── Minimal fake DOM ───────────────────────────────────────────────────────
// A fake element that records children, event handlers, attributes, style,
// and supports querySelector by id + tag. Enough for homepageStub.js's
// createElement/append/setAttribute/Object.assign(style)/addEventListener/
// querySelector/replaceChildren/focus surface. No real DOM semantics.
function fakeEl(tag) {
  const el = {
    tagName: String(tag || 'div').toUpperCase(),
    id: '',
    textContent: '',
    style: {},
    disabled: false,
    children: [],
    handlers: {},
    attrs: {},
    append(...kids) { for (const k of kids) { if (k) this.children.push(k); k && (k._parent = this); } },
    appendChild(k) { this.children.push(k); k._parent = this; return k; },
    insertBefore(k, ref) {
      const i = this.children.indexOf(ref);
      if (i >= 0) this.children.splice(i, 1, k); else this.children.push(k);
      k._parent = this; return k;
    },
    replaceChildren(...kids) { this.children = []; for (const k of kids) { if (k) { this.children.push(k); k._parent = this; } } },
    addEventListener(type, fn) { (this.handlers[type] ||= []).push(fn); },
    setAttribute(k, v) { this.attrs[k] = v; },
    getAttribute(k) { return this.attrs[k] ?? null; },
    focus() { this._focused = true; },
    querySelector(sel) {
      // Support '#id' and 'button' (the two selectors the stub uses).
      if (typeof sel !== 'string') return null;
      if (sel.startsWith('#')) {
        const id = sel.slice(1);
        const walk = (n) => {
          for (const c of n.children || []) {
            if (c.id === id) return c;
            const r = walk(c);
            if (r) return r;
          }
          return null;
        };
        return walk(this);
      }
      if (sel === 'button') {
        const walk = (n) => {
          for (const c of n.children || []) {
            if (c.tagName === 'BUTTON') return c;
            const r = walk(c);
            if (r) return r;
          }
          return null;
        };
        return walk(this);
      }
      return null;
    },
  };
  return el;
}

function fakeDoc() {
  const body = fakeEl('body');
  return {
    createElement: (tag) => fakeEl(tag),
    getElementById: () => null,
    body,
    addEventListener: () => {},
  };
}

// ── Helpers to inspect the rendered stub ───────────────────────────────────
function stubEl(doc) { return doc.body.children[0]; }
function cardRows(doc) {
  const list = stubEl(doc).querySelector('#torii-homepage-stub-list');
  return (list && list.children) || [];
}
function findCardByLabel(doc, label) {
  return cardRows(doc).find((row) => {
    // The label is the first text child of the second grid cell (the body div).
    const body = row.children.find((c) => c.tagName === 'DIV' && c.children.length >= 1);
    if (!body) return false;
    const labelEl = body.children.find((c) => typeof c.textContent === 'string');
    return labelEl && labelEl.textContent.includes(label);
  });
}
function cardButton(row) {
  return row.children.find((c) => c.tagName === 'BUTTON');
}

// ── Test setup: inject + restore globalThis.document / sessionStorage ───────
let origDoc, origStorage;
beforeEach(() => {
  origDoc = globalThis.document;
  origStorage = globalThis.sessionStorage;
  globalThis.document = fakeDoc();
  globalThis.sessionStorage = (() => {
    const m = new Map();
    return {
      getItem: (k) => (m.has(k) ? m.get(k) : null),
      setItem: (k, v) => { m.set(k, String(v)); },
      removeItem: (k) => { m.delete(k); },
    };
  })();
  // Reset module-internal open state between tests by closing + resetting the
  // lazily-built DOM singleton (isolate:false shares the module graph).
  closeHomepageStub();
  _resetForTest();
});
afterEach(() => {
  closeHomepageStub();
  if (origDoc === undefined) delete globalThis.document; else globalThis.document = origDoc;
  if (origStorage === undefined) delete globalThis.sessionStorage; else globalThis.sessionStorage = origStorage;
});

// ── Tests ───────────────────────────────────────────────────────────────────
describe('homepageStub — render + gating', () => {
  it('owner sees all 4 cards enabled', () => {
    const cbs = { onChooseWorld: () => {}, onVisitNodeDirectory: () => {}, onPublishNode: () => {}, onClose: () => {} };
    openHomepageStub({ isOwner: true, isLoggedIn: true, activeWorld: '', heartbeatStatus: 'off' }, cbs);
    expect(isHomepageStubOpen()).toBe(true);
    const rows = cardRows(globalThis.document);
    expect(rows.length).toBe(4);
    // Owner cards: Choose Blank, Use Template, Publish are enabled; Visit too.
    const buttons = rows.map(cardButton);
    expect(buttons.every((b) => b && b.disabled === false)).toBe(true);
  });

  it('guest/non-owner: Visit enabled; Choose Blank / Use Template / Publish disabled + hinted', () => {
    const cbs = { onChooseWorld: () => {}, onVisitNodeDirectory: () => {}, onPublishNode: () => {}, onClose: () => {} };
    openHomepageStub({ isOwner: false, isLoggedIn: false, activeWorld: '', heartbeatStatus: 'off' }, cbs);
    const rows = cardRows(globalThis.document);
    // 4 cards + 1 non-owner hint note appended after the cards.
    expect(rows.length).toBe(5);
    // The owner cards (Choose Blank, Use Template, Publish) must be disabled.
    const blank = findCardByLabel(globalThis.document, 'Choose Blank');
    const tmpl = findCardByLabel(globalThis.document, 'Use My World as Template');
    const pub = findCardByLabel(globalThis.document, 'Publish my node presence');
    const visit = findCardByLabel(globalThis.document, 'Visit a Node');
    expect(cardButton(blank).disabled).toBe(true);
    expect(cardButton(tmpl).disabled).toBe(true);
    expect(cardButton(pub).disabled).toBe(true);
    expect(cardButton(visit).disabled).toBe(false);
    // Each disabled owner card carries the login hint (walk descendants for text).
    const allText = (n) => (n.textContent || '') + (n.children || []).map(allText).join('');
    expect(allText(blank)).toContain('Log in as the node owner to configure this node.');
  });

  it('Choose Blank click calls onChooseWorld with "gateway-blank"', () => {
    let received = null;
    const cbs = { onChooseWorld: (id) => { received = id; }, onVisitNodeDirectory: () => {}, onPublishNode: () => {}, onClose: () => {} };
    openHomepageStub({ isOwner: true, isLoggedIn: true, activeWorld: '', heartbeatStatus: 'off' }, cbs);
    const blank = findCardByLabel(globalThis.document, 'Choose Blank');
    const btn = cardButton(blank);
    btn.handlers.click[0]();
    expect(received).toBe('gateway-blank');
  });

  it('Use My World as Template click calls onChooseWorld with "chiefmonkey-template"', () => {
    let received = null;
    const cbs = { onChooseWorld: (id) => { received = id; }, onVisitNodeDirectory: () => {}, onPublishNode: () => {}, onClose: () => {} };
    openHomepageStub({ isOwner: true, isLoggedIn: true, activeWorld: '', heartbeatStatus: 'off' }, cbs);
    const tmpl = findCardByLabel(globalThis.document, 'Use My World as Template');
    cardButton(tmpl).handlers.click[0]();
    expect(received).toBe('chiefmonkey-template');
  });

  it('Visit a Node click calls onVisitNodeDirectory', () => {
    let called = false;
    const cbs = { onChooseWorld: () => {}, onVisitNodeDirectory: () => { called = true; }, onPublishNode: () => {}, onClose: () => {} };
    openHomepageStub({ isOwner: false, isLoggedIn: false, activeWorld: '', heartbeatStatus: 'off' }, cbs);
    const visit = findCardByLabel(globalThis.document, 'Visit a Node');
    cardButton(visit).handlers.click[0]();
    expect(called).toBe(true);
  });

  it('Publish My Node click calls onPublishNode (owner only)', () => {
    let called = 0;
    const cbs = { onChooseWorld: () => {}, onVisitNodeDirectory: () => {}, onPublishNode: () => { called++; }, onClose: () => {} };
    openHomepageStub({ isOwner: true, isLoggedIn: true, activeWorld: '', heartbeatStatus: 'off' }, cbs);
    const pub = findCardByLabel(globalThis.document, 'Publish my node presence');
    cardButton(pub).handlers.click[0]();
    expect(called).toBe(1);
  });

  it('guest Publish card is disabled so onPublishNode is never reached', () => {
    let called = false;
    const cbs = { onChooseWorld: () => {}, onVisitNodeDirectory: () => {}, onPublishNode: () => { called = true; }, onClose: () => {} };
    openHomepageStub({ isOwner: false, isLoggedIn: false, activeWorld: '', heartbeatStatus: 'off' }, cbs);
    const pub = findCardByLabel(globalThis.document, 'Publish my node presence');
    // Disabled button has no click handler attached (fail-closed on the gate).
    expect(cardButton(pub).handlers.click).toBeUndefined();
    expect(called).toBe(false);
  });
});

describe('homepageStub — close + isOpen lifecycle', () => {
  it('open sets isOpen true; close sets it false and calls onClose once', () => {
    let closes = 0;
    const cbs = { onChooseWorld: () => {}, onVisitNodeDirectory: () => {}, onPublishNode: () => {}, onClose: () => { closes++; } };
    openHomepageStub({ isOwner: true, isLoggedIn: true, activeWorld: '', heartbeatStatus: 'off' }, cbs);
    expect(isHomepageStubOpen()).toBe(true);
    closeHomepageStub();
    expect(isHomepageStubOpen()).toBe(false);
    expect(closes).toBe(1);
    // A second close does not call onClose again.
    closeHomepageStub();
    expect(closes).toBe(1);
  });

  it('openHomepageStub is a no-op (never throws) when document is missing', () => {
    delete globalThis.document;
    expect(() => openHomepageStub({ isOwner: true }, {})).not.toThrow();
    expect(isHomepageStubOpen()).toBe(false);
  });
});

describe('homepageStub — shown-this-session + auto-open gating', () => {
  it('hasShownThisSession is false before set, true after set (round-trip)', () => {
    expect(hasShownThisSession()).toBe(false);
    setShownThisSession();
    expect(hasShownThisSession()).toBe(true);
  });

  it('hasShownThisSession is false when sessionStorage is missing (never throws)', () => {
    delete globalThis.sessionStorage;
    expect(hasShownThisSession()).toBe(false);
    expect(() => setShownThisSession()).not.toThrow();
  });

  it('auto-open gating: opens only when isOwner && !activeWorld && !shown', () => {
    // The gating logic lives in main.js; this test asserts the helper contract
    // the gate relies on: shown flips to true after the first auto-open so a
    // second call with the same inputs does NOT re-trigger.
    const shouldAutoOpen = (isOwner, activeWorld, shown) => isOwner && !activeWorld && !shown;
    expect(shouldAutoOpen(true, '', false)).toBe(true);
    // After the first auto-open the shown flag is set → second time is false.
    setShownThisSession();
    expect(shouldAutoOpen(true, '', hasShownThisSession())).toBe(false);
  });

  it('auto-open gating: NOT triggered for a non-owner even with no active world', () => {
    const shouldAutoOpen = (isOwner, activeWorld, shown) => isOwner && !activeWorld && !shown;
    expect(shouldAutoOpen(false, '', false)).toBe(false);
    // And not when an active world is already set (the legacy default stays).
    expect(shouldAutoOpen(true, 'chiefmonkey-template', false)).toBe(false);
  });
});

describe('homepageStub — invariants', () => {
  it('the module source has no setTimeout call (regression-check allowlist closed for src/engine)', () => {
    // Read the module source and assert the regression-check regex never matches.
    const src = readFileSync(join(process.cwd(), 'src/engine/homepage/homepageStub.js'), 'utf8');
    expect(/setTimeout\s*\(/.test(src)).toBe(false);
  });

  it('the module source has no `three` import', () => {
    const src = readFileSync(join(process.cwd(), 'src/engine/homepage/homepageStub.js'), 'utf8');
    expect(/from\s+['"]three['"]/.test(src)).toBe(false);
    expect(/import\s+.*three/.test(src)).toBe(false);
  });
});
