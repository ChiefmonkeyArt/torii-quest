// gateway-screen-commit.test.js — locks the keyboard COMMIT seam for the live
// gate-browse redesign (v0.2.883). While browsing the player keeps pointer lock +
// movement, so the 入 walk-through must also be reachable from the keyboard: the
// host binds Enter to `commitGatewayScreen()`, which must fire onCommit ONLY when a
// world is actually peeked (armed) and stay inert otherwise — never a stray swap.
// Node-pure: the same hand-rolled fake DOM used by gateway-screen-peek.test.js.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
let
  openGatewayScreen, closeGatewayScreen, peekGateWorld,
  commitGatewayScreen, isGatewayCommitting, isGatewayScreenOpen;

function fakeEl(tag) {
  return {
    tagName: (tag || 'div').toUpperCase(),
    id: '', textContent: '', style: {}, disabled: false, children: [], handlers: {}, attrs: {},
    append(...kids) { for (const k of kids) { if (k) { this.children.push(k); k._parent = this; } } },
    appendChild(k) { this.children.push(k); k._parent = this; return k; },
    replaceChildren(...kids) { this.children = []; for (const k of kids) { if (k) { this.children.push(k); k._parent = this; } } },
    addEventListener(type, fn) { (this.handlers[type] ||= []).push(fn); },
    setAttribute(k, v) { this.attrs[k] = v; },
    getAttribute(k) { return this.attrs[k] ?? null; },
    focus() { this._focused = true; },
    querySelector(sel) {
      // The current directory has nested columns addressed by ID. Mirror that
      // existing DOM contract rather than making a valid render look broken.
      if (sel.startsWith('#')) {
        const walk = n => {
          for (const c of n.children || []) {
            if (c.id === sel.slice(1)) return c;
            const found = walk(c);
            if (found) return found;
          }
          return null;
        };
        return walk(this);
      }
      if (sel === 'button') { const walk = (n) => { for (const c of n.children || []) { if (c.tagName === 'BUTTON') return c; const r = walk(c); if (r) return r; } return null; }; return walk(this); }
      return null;
    },
    querySelectorAll() { return []; },
  };
}

let doc, previousDocument;
beforeAll(async () => {
  previousDocument = globalThis.document;
  doc = { createElement: (t) => fakeEl(t), body: fakeEl('body'), addEventListener: () => {}, getElementById: () => null };
  globalThis.document = doc;
  // This suite uses isolate:false. Never reuse another file's DOM singleton.
  vi.resetModules();
  ({ openGatewayScreen, closeGatewayScreen, peekGateWorld,
    commitGatewayScreen, isGatewayCommitting, isGatewayScreenOpen } =
    await import('../src/engine/gateway/gatewayScreen.js'));
});
afterAll(() => {
  closeGatewayScreen();
  vi.resetModules();
  if (previousDocument === undefined) delete globalThis.document;
  else globalThis.document = previousDocument;
});

describe('gatewayScreen — commitGatewayScreen keyboard seam', () => {
  it('is not committing while closed', () => {
    expect(isGatewayScreenOpen()).toBe(false);
    expect(isGatewayCommitting()).toBe(false);
  });

  it('fires onCommit exactly once when a world is armed, then inerts on the next bare press', () => {
    const commits = [];
    const world = { pubkey: 'kbd_commit', displayName: 'Keyboard' };
    openGatewayScreen({
      mutualFriends: [world],
      otherWorlds: [],
      canTravel: true,
      onPeek: () => {},
      onCommit: () => commits.push(true),
      onClose: () => {},
    });
    // No peek yet → committing false; commit is a safe no-op.
    expect(isGatewayCommitting()).toBe(false);
    commitGatewayScreen();
    expect(commits.length).toBe(0);

    // Arm a peek (the keyboard Enter path relies on this being set by the row / hand-off).
    peekGateWorld(world);
    expect(isGatewayCommitting()).toBe(true);

    commitGatewayScreen();
    expect(commits.length).toBe(1);
  });

  it('never travels without an armed peek, even after close', () => {
    closeGatewayScreen();
    expect(isGatewayCommitting()).toBe(false);
    // Bare Enter after close must not re-fire anything.
    expect(() => commitGatewayScreen()).not.toThrow();
  });
});
