// tests/login-bootstrap.test.js — behavioural proof of the v0.2.236 Nostr-login runtime repair
// (src/engine/ui/loginBootstrap.js). The static entry-flow-smoke suite proves the WIRING exists and
// is decoupled from the 3D boot; THIS suite actually RUNS installLoginBootstrap()/doNostrLogin()
// against a hand-rolled fake DOM + window.nostr to prove a loaded bundle can never leave login stuck
// in the inline "Login still loading" fallback, and that each outcome shows a SPECIFIC visible
// message: no provider → "NIP-07 extension not found", success → "" (line hidden, no pubkey fragment), error → actionable.
// No jsdom dependency — a tiny fake document/window is enough for these pure-DOM handlers.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { installLoginBootstrap, doNostrLogin } from '../src/engine/ui/loginBootstrap.js';

// Minimal fake element: records addEventListener handlers and textContent/style writes.
function fakeEl() {
  return {
    handlers: {},
    textContent: '',
    style: {},
    addEventListener(type, fn) { (this.handlers[type] ||= []).push(fn); },
  };
}
// Minimal fake document with the two title-screen nodes the bootstrap looks up.
function fakeDoc({ withButton = true, withStatus = true } = {}) {
  const btn = withButton ? fakeEl() : null;
  const status = withStatus ? fakeEl() : null;
  return {
    btn,
    status,
    getElementById(id) {
      if (id === 'btn-nostr-centre') return btn;
      if (id === 'entry-status') return status;
      return null;
    },
  };
}

const origWindow = globalThis.window;
beforeEach(() => { globalThis.window = {}; });
afterEach(() => { if (origWindow === undefined) delete globalThis.window; else globalThis.window = origWindow; });

describe('installLoginBootstrap — wiring + readiness (loaded bundle never stuck in fallback)', () => {
  it('binds a click handler and raises window.__toriiLoginReady so the inline fallback stands down', () => {
    const doc = fakeDoc();
    expect(globalThis.window.__toriiLoginReady).toBeFalsy();
    const ok = installLoginBootstrap(doc);
    expect(ok).toBe(true);
    expect(globalThis.window.__toriiLoginReady).toBe(true);
    expect(doc.btn.handlers.click).toHaveLength(1);
  });

  it('is idempotent — a second install does not stack a second click handler', () => {
    const doc = fakeDoc();
    installLoginBootstrap(doc);
    installLoginBootstrap(doc); // __toriiLoginReady already true → early return
    expect(doc.btn.handlers.click).toHaveLength(1);
  });

  it('still raises the readiness flag even if the button is momentarily absent', () => {
    const doc = fakeDoc({ withButton: false });
    installLoginBootstrap(doc);
    expect(globalThis.window.__toriiLoginReady).toBe(true);
  });

  it('no document → inert no-op (safe under node/test import)', () => {
    expect(installLoginBootstrap(null)).toBe(false);
  });
});

describe('doNostrLogin — specific, visible outcome on every path (never a stuck "Connecting…")', () => {
  it('no NIP-07 provider → "NIP-07 extension not found" (not "still loading")', async () => {
    const status = fakeEl();
    delete globalThis.window.nostr;
    const result = await doNostrLogin(status);
    expect(result).toBe('NIP-07 extension not found');
    expect(status.textContent).toBe('NIP-07 extension not found');
    expect(status.textContent).not.toMatch(/still loading/i);
  });

  it('provider present + approves → status line hides (no pubkey fragment shown)', async () => {
    const status = fakeEl();
    globalThis.window.nostr = { getPublicKey: async () => 'a'.repeat(64) };
    const result = await doNostrLogin(status);
    expect(result).toBe('');
    expect(status.textContent).toBe('');
  });

  it('provider present but rejects/throws → an ACTIONABLE visible error, not a dead end', async () => {
    const status = fakeEl();
    globalThis.window.nostr = { getPublicKey: async () => { throw new Error('user rejected'); } };
    const result = await doNostrLogin(status);
    // nostrLogin() catches the throw and returns its own actionable string; either way the visible
    // line must be actionable and never the stuck interim text.
    expect(status.textContent).toBe(result);
    expect(status.textContent).toMatch(/extension|try again|anonymously/i);
    expect(status.textContent).not.toBe('Connecting…');
    expect(status.textContent).not.toMatch(/still loading/i);
  });
});
