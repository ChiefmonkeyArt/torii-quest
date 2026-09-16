// tests/portal-browse.test.js — the torii-gate BROWSE-LOOP state machine.
//
// Locks the interaction the two-node playtest asked for: click a name to PEER through
// the gate (no swap), click another to switch, click 入 (enter) to commit (the ONLY
// swap), and click ✕ to step away (cancel, no swap). Peek and cancel must NEVER swap;
// commit must swap ONLY from an open peek. Pure module → node-testable, no DOM.
import { describe, it, expect } from 'vitest';
import {
  createPortalBrowse, BROWSE_STATE, BROWSE_ACTION,
} from '../src/engine/gateway/portalBrowse.js';

describe('portalBrowse — states and the swap rule', () => {
  it('starts in the directory, nothing peeked, no swaps', () => {
    const b = createPortalBrowse();
    expect(b.state()).toBe(BROWSE_STATE.DIRECTORY);
    expect(b.snapshot()).toEqual({ state: 'directory', peekId: null, peeks: 0, cancels: 0, swaps: 0 });
  });

  it('peek opens a mirror but NEVER swaps the world', () => {
    const b = createPortalBrowse();
    const r = b.step(BROWSE_ACTION.PEEK);
    expect(r.state).toBe(BROWSE_STATE.PEEKING);
    expect(r.swap).toBe(false);
    expect(b.state()).toBe(BROWSE_STATE.PEEKING);
    expect(b.snapshot().swaps).toBe(0);
  });

  it('peek again while peeking SWITCHES the mirror (click-see, click-see) and still never swaps', () => {
    const b = createPortalBrowse();
    b.step(BROWSE_ACTION.PEEK); // world A
    const r2 = b.step(BROWSE_ACTION.PEEK); // world B — switch, no Esc needed
    expect(r2.state).toBe(BROWSE_STATE.PEEKING);
    expect(r2.swap).toBe(false);
    expect(r2.changed).toBe(true);
    expect(b.snapshot().peeks).toBe(2);
    expect(b.snapshot().swaps).toBe(0);
  });

  it('cancel tears the mirror down and returns to the directory without swapping', () => {
    const b = createPortalBrowse();
    b.step(BROWSE_ACTION.PEEK);
    const r = b.step(BROWSE_ACTION.CANCEL);
    expect(r.state).toBe(BROWSE_STATE.DIRECTORY);
    expect(r.swap).toBe(false);
    expect(r.changed).toBe(true);
    expect(b.snapshot().cancels).toBe(1);
    expect(b.snapshot().swaps).toBe(0);
  });

  it('commit from an open peek is the ONLY action that swaps the world', () => {
    const b = createPortalBrowse();
    b.step(BROWSE_ACTION.PEEK);
    const r = b.step(BROWSE_ACTION.COMMIT);
    expect(r.swap).toBe(true);
    expect(r.state).toBe(BROWSE_STATE.TRAVELLING);
    expect(b.snapshot().swaps).toBe(1);
  });

  it('commit is refused from the directory (nothing to walk into)', () => {
    const b = createPortalBrowse();
    const r = b.step(BROWSE_ACTION.COMMIT);
    expect(r.swap).toBe(false);
    expect(r.changed).toBe(false);
    expect(b.state()).toBe(BROWSE_STATE.DIRECTORY);
  });

  it('cancel from the directory is a no-op (never a swap)', () => {
    const b = createPortalBrowse();
    const r = b.step(BROWSE_ACTION.CANCEL);
    expect(r.swap).toBe(false);
    expect(r.changed).toBe(false);
    expect(b.snapshot().cancels).toBe(0);
  });

  it('once travelling, nothing un-swaps the landed world (commit is one-way)', () => {
    const b = createPortalBrowse();
    b.step(BROWSE_ACTION.PEEK);
    b.step(BROWSE_ACTION.COMMIT);
    // Landing is final: cancel/peek after the fact must not change state back.
    const c = b.step(BROWSE_ACTION.CANCEL);
    expect(c.changed).toBe(false);
    expect(b.state()).toBe(BROWSE_STATE.TRAVELLING);
    // A peek after landing is refused too (you are already inside).
    const p = b.step(BROWSE_ACTION.PEEK);
    expect(p.state).toBe(BROWSE_STATE.TRAVELLING);
    expect(p.changed).toBe(false);
    expect(p.swap).toBe(false);
  });

  it('unknown actions are ignored safely', () => {
    const b = createPortalBrowse();
    const r = b.step('bogus');
    expect(r.swap).toBe(false);
    expect(r.changed).toBe(false);
    expect(b.state()).toBe(BROWSE_STATE.DIRECTORY);
  });

  it('reset starts a fresh gate visit — a landed player can peek the next gate', () => {
    const b = createPortalBrowse();
    b.step(BROWSE_ACTION.PEEK);
    b.step(BROWSE_ACTION.COMMIT);
    expect(b.state()).toBe(BROWSE_STATE.TRAVELLING);
    b.reset();
    expect(b.snapshot()).toEqual({ state: 'directory', peekId: null, peeks: 0, cancels: 0, swaps: 0 });
    // And the fresh session can peek + commit normally again.
    const peek = b.step(BROWSE_ACTION.PEEK);
    expect(peek.state).toBe(BROWSE_STATE.PEEKING);
    expect(peek.swap).toBe(false);
  });
});