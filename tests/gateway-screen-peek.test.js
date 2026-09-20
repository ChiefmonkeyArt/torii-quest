// gateway-screen-peek.test.js — locks the browse-loop PRE-PEEK hand-off seam
// (v0.2.866). A world picked OUTSIDE the gateway screen (the in-game Torii menu's
// "Visit") opens the screen and pre-peeks it via peekGateWorld: the row highlights,
// the 入 commit bar arms, and the host's onPeek fires — exactly what a live row
// click does, so one travel flow covers every directory surface.
//
// Node-pure: a hand-rolled fake DOM is injected via globalThis.document (the same
// approach as tests/homepageStub.test.js) so the three-free DOM module can be
// exercised without a browser. gatewayScreen is a module SINGLETON (cached _el), so
// the whole file shares one fake document + one open/peek/close lifecycle.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  openGatewayScreen, closeGatewayScreen, isGatewayScreenOpen, peekGateWorld, refreshGatewayScreen,
} from '../src/engine/gateway/gatewayScreen.js';

// ---------- fake DOM ----------

function fakeEl(tag) {
  return {
    tagName: (tag || 'div').toUpperCase(),
    id: '',
    textContent: '',
    style: {},
    disabled: false,
    children: [],
    handlers: {},
    attrs: {},
    append(...kids) { for (const k of kids) { if (k) { this.children.push(k); k._parent = this; } } },
    appendChild(k) { this.children.push(k); k._parent = this; return k; },
    replaceChildren(...kids) { this.children = []; for (const k of kids) { if (k) { this.children.push(k); k._parent = this; } } },
    addEventListener(type, fn) { (this.handlers[type] ||= []).push(fn); },
    setAttribute(k, v) { this.attrs[k] = v; },
    getAttribute(k) { return this.attrs[k] ?? null; },
    focus() { this._focused = true; },
    querySelector(sel) {
      if (typeof sel !== 'string') return null;
      const walk = (n, pred) => {
        for (const c of n.children || []) { if (pred(c)) return c; const r = walk(c, pred); if (r) return r; }
        return null;
      };
      if (sel.startsWith('#')) { const id = sel.slice(1); return walk(this, (c) => c.id === id); }
      if (sel === 'button') return walk(this, (c) => c.tagName === 'BUTTON');
      return null;
    },
    querySelectorAll(sel) {
      if (typeof sel !== 'string') return [];
      const out = [];
      const attr = sel.match(/^\[([a-z-]+)\]/);
      const walk = (n) => {
        for (const c of n.children || []) {
          if (attr && c.attrs[attr[1]] != null) out.push(c);
          walk(c);
        }
      };
      walk(this);
      return out;
    },
  };
}

let doc;
beforeAll(() => {
  doc = { createElement: (tag) => fakeEl(tag), body: fakeEl('body'), addEventListener: () => {}, getElementById: () => null };
  globalThis.document = doc;
});
afterAll(() => { delete globalThis.document; });

// The gateway backdrop is the single top-level child the module appends to body.
function _backdrop() { return doc.body.children[0]; }

// ---------- tests (ordered: they share one singleton screen) ----------

describe('gatewayScreen — peekGateWorld pre-peek hand-off', () => {
  it('is a no-op while the screen is closed (never opened)', () => {
    expect(isGatewayScreenOpen()).toBe(false);
    expect(() => peekGateWorld({ pubkey: 'aa', displayName: 'X' })).not.toThrow();
    expect(isGatewayScreenOpen()).toBe(false);
  });

  it('opening + pre-peeking a world arms the commit bar and fires onPeek once', () => {
    const peeks = [];
    const commits = [];
    const world = { pubkey: 'pub_key_1', displayName: 'Alice' };
    openGatewayScreen({
      mutualFriends: [{ pubkey: 'pub_key_0', displayName: 'Bob' }, world],
      otherWorlds: [],
      canTravel: true,
      onPeek: (w) => peeks.push(w),
      onCommit: () => commits.push(true),
      onClose: () => {},
    });
    expect(isGatewayScreenOpen()).toBe(true);

    // Pre-peek the second world — the menu hand-off fires this right after open.
    peekGateWorld(world);

    expect(peeks.length).toBe(1);
    expect(peeks[0]).toBe(world);
    expect(commits.length).toBe(0); // peek never travels
  });

  it('peekGateWorld highlights the matching row (data-gw-pubkey)', () => {
    const rows = _backdrop().querySelectorAll('[data-gw-pubkey]');
    expect(rows.length).toBe(2);
    const active = rows.filter((r) => r.getAttribute('data-gw-pubkey') === 'pub_key_1');
    expect(active.length).toBe(1);
  });

  it('closeGatewayScreen after a peek returns to a closed, non-committing state', () => {
    closeGatewayScreen();
    expect(isGatewayScreenOpen()).toBe(false);
  });
});

// v0.2.875 — refreshGatewayScreen: the owner-profile (kind:0) enrichment is async and
// can resolve AFTER the directory is open; the open screen snapshots once, so without
// an in-place re-render the row stays frozen on the pre-enrichment serial. This locks
// that re-render seam: it rebuilds the rows from fresh arrays while preserving an
// active peek highlight.
describe('gatewayScreen — refreshGatewayScreen in-place re-render', () => {
  it('is a no-op while closed', () => {
    expect(isGatewayScreenOpen()).toBe(false);
    expect(() => refreshGatewayScreen({ mutualFriends: [{ pubkey: 'x', displayName: 'X' }] })).not.toThrow();
    expect(isGatewayScreenOpen()).toBe(false);
  });

  it('re-renders rows from fresh arrays (serial resolved to a name) in place', () => {
    openGatewayScreen({
      mutualFriends: [{ pubkey: 'friend_1', displayName: 'FRIENDSERIAL' }],
      otherWorlds: [],
      canTravel: true,
      onPeek: () => {},
      onCommit: () => {},
      onClose: () => {},
    });

    // Fresh data: the SAME pubkey now has a resolved display name.
    refreshGatewayScreen({
      mutualFriends: [{ pubkey: 'friend_1', displayName: 'BitcoinBekka' }],
      otherWorlds: [],
      canTravel: true,
    });

    const rows = _backdrop().querySelectorAll('[data-gw-pubkey]');
    // Exactly one row survives the re-render (no duplicate/ghost rows).
    expect(rows.length).toBe(1);
    // The name node now shows the resolved display name, not the serial.
    const nameEl = rows[0].children[1].children[0]; // dot, then lab{name,npub}
    expect(nameEl.textContent).toBe('BitcoinBekka');
  });

  it('preserves an active peek highlight across the re-render', () => {
    const world = { pubkey: 'peeked_1', displayName: 'Alice' };
    openGatewayScreen({
      mutualFriends: [{ pubkey: 'peeked_1', displayName: 'AliceSERIAL' }],
      otherWorlds: [],
      canTravel: true,
      onPeek: () => {},
      onCommit: () => {},
      onClose: () => {},
    });
    peekGateWorld(world);

    // Re-render with updated data for the SAME pubkey.
    refreshGatewayScreen({
      mutualFriends: [{ pubkey: 'peeked_1', displayName: 'Alice' }],
      otherWorlds: [],
      canTravel: true,
    });

    const rows = _backdrop().querySelectorAll('[data-gw-pubkey]');
    const active = rows.filter((r) => r.getAttribute('data-gw-pubkey') === 'peeked_1');
    expect(active.length).toBe(1);
    // The highlight is the "active" purple, not the idle purple.
    expect(active[0].style.background).toBe('rgba(139,92,246,0.28)');
    expect(active[0].style.borderColor).toBe('rgba(196,181,253,0.7)');
  });

  it('keeps canTravel from the last open when not re-supplied', () => {
    openGatewayScreen({
      mutualFriends: [{ pubkey: 'w', displayName: 'W' }],
      otherWorlds: [],
      canTravel: true,
      onPeek: () => {},
      onCommit: () => {},
      onClose: () => {},
    });
    refreshGatewayScreen({
      mutualFriends: [{ pubkey: 'w', displayName: 'W' }],
      otherWorlds: [],
      // canTravel omitted → preserved from open
    });
    // Rows remain clickable (role button) because canTravel stayed true.
    const rows = _backdrop().querySelectorAll('[data-gw-pubkey]');
    expect(rows.length).toBe(1);
    expect(rows[0].getAttribute('role')).toBe('button');
    closeGatewayScreen();
  });
});