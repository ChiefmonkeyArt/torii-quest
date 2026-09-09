// @vitest-environment jsdom
// tests/v0.2.783-heartbeat-switch-click.test.js — regression lock for the
// v0.2.783 fix that makes the Settings > Heartbeat switch actually respond to
// clicks.
//
// Root cause of the "switch is dead — nothing happens" report (v0.2.782 and
// earlier): the document-level delegated click router in main.js read
// `data-action` off `e.target` directly. The Heartbeat switch is a <button
// data-action="publish-node"> whose ENTIRE clickable surface is nested <span>s
// (.settings-switch-track > .settings-switch-knob, and .settings-switch-state),
// so `e.target` is always a <span> with no data-action, `getAttribute` returned
// null, and the router bailed before ever reaching the publish-node branch.
// Every click silently died — logged in as admin or not, the switch toggled
// nothing and showed no toast.
//
// Fix (src/main.js): resolve the action element with `t.closest('[data-action]')`
// instead of reading data-action off `e.target`, and read the sibling data-*
// attributes (data-relay / data-sticker / data-index) off that same resolved
// element. This is the same element for every existing action button, so plain
// buttons are unaffected and nested-span buttons now resolve correctly.
//
// main.js can't be imported in isolation (top-level DOM/init side effects), so —
// consistent with the sibling v0.2.781 source-lock — part 1 locks the fix at
// the source level, and part 2 behaviourally locks the structural contract that
// `closest('[data-action]')` resolves the nested-span switch back to its button.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { renderHeartbeatPanel } from '../src/engine/settings/heartbeatPanel.js';

// jsdom rewrites import.meta.url to a non-file scheme, so source-lock reads use
// process.cwd() (tests run from the repo root) instead of import.meta.url.
const SRC = readFileSync(resolve(process.cwd(), 'src/main.js'), 'utf8');

describe('v0.2.783 — heartbeat switch click reaches the publish-node handler', () => {
  it('resolves the action element via closest instead of reading data-action off e.target', () => {
    // The old code was `const action = t.getAttribute('data-action')`. The fix must
    // resolve the target's [data-action] ancestor so nested <span>s don't kill the
    // click. Lock both the closest() resolution and that it precedes the action read.
    expect(SRC).toMatch(/const actionEl = t\.closest\('\[data-action\]'\);/);
    expect(SRC).toMatch(/const action = actionEl\.getAttribute\('data-action'\);/);
    expect(SRC).not.toContain("const action = t.getAttribute && t.getAttribute('data-action');");
  });

  it('reads remove-relay data-relay off the resolved action element, not e.target', () => {
    expect(SRC).toContain("const url = actionEl.getAttribute('data-relay') || '';");
  });

  it('renders data-action on the button and nested spans that resolve back to it via closest', () => {
    const host = document.createElement('div');
    host.innerHTML = renderHeartbeatPanel({ isOwner: true, heartbeatStatus: 'live' });
    document.body.appendChild(host);

    const btn = host.querySelector('button[data-action="publish-node"]');
    expect(btn).not.toBeNull();

    // The clickable surface is nested spans — none of which carry data-action.
    const knob = host.querySelector('.settings-switch-knob');
    const track = host.querySelector('.settings-switch-track');
    const state = host.querySelector('.settings-switch-state');
    expect(knob).not.toBeNull();
    expect(track).not.toBeNull();
    expect(state).not.toBeNull();
    for (const span of [knob, track, state]) {
      expect(span.getAttribute('data-action')).toBeNull();
      // This is the exact resolution the fixed router performs: from any inner
      // span, closest([data-action]) === the publish-node button.
      expect(span.closest('[data-action]')).toBe(btn);
      expect(span.closest('[data-action]').getAttribute('data-action')).toBe('publish-node');
    }

    host.remove();
  });
});