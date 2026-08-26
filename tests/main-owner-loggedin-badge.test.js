// tests/main-owner-loggedin-badge.test.js — regression lock for the
// v0.2.704-alpha (ADR-0070) admin-only "logged in" badge on the top-left
// owner caption. The green dot + "logged in" text must:
//   - be hidden by default (never flashes before login confirms),
//   - show ONLY when the logged-in viewer IS the configured instance owner,
//   - never reveal the owner's pubkey,
//   - leave the owner's name visible to every visitor.
//
// main.js has no DOM test harness (see tests/main-heartbeat-consent.test.js),
// so — consistent with tests/main-owner-profile-name-wiring.test.js — this
// locks the wiring at the source level via readFileSync + pattern assertions,
// backed by the pure isAdminOperator() coverage in
// tests/admin-update-client.test.js.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const MAIN = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
const HTML = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

describe('main.js admin-only "logged in" badge wiring (v0.2.704 / ADR-0070)', () => {
  const labelStart = MAIN.indexOf('function _refreshOwnerLabel()');
  expect(labelStart).toBeGreaterThan(-1);
  const labelBody = MAIN.slice(labelStart, labelStart + 1500);

  it('renders the name into its own truncating span (so the badge is not clipped by the ellipsis)', () => {
    expect(labelBody).toMatch(/getElementById\(\s*['"]torii-owner-name['"]\s*\)/);
    expect(labelBody).toMatch(/nameEl\.textContent\s*=\s*label/);
  });

  it('toggles the badge .show class from isAdminOperator(viewer, adminPubkey) — admin-only', () => {
    expect(labelBody).toMatch(/getElementById\(\s*['"]torii-loggedin-badge['"]\s*\)/);
    expect(labelBody).toMatch(/isAdminOperator\(\s*state\.nostrPubkey[^)]*\)/);
    expect(labelBody).toMatch(/classList\.toggle\(\s*['"]show['"]\s*,\s*isOwner\s*\)/);
  });

  it('never writes the pubkey into a DOM attribute of the badge (no pubkey leak)', () => {
    // The badge must only toggle a CSS class — never surface the owner npub.
    expect(labelBody).not.toMatch(/badge\.(innerHTML|textContent|title)\s*=/i);
  });

  it('keeps the owner name visible to all visitors (only the badge is admin-gated, not the name)', () => {
    expect(labelBody).toMatch(/if\s*\(nameEl\)\s*\{\s*nameEl\.textContent\s*=\s*label/);
  });

  it('does not touch unrelated wiring (no scope creep into update/heartbeat/menu)', () => {
    expect(labelBody).not.toMatch(/update-now|triggerUpdate|onUpdateNow|publishHeartbeat/i);
  });

  it('index.html ships the badge hidden by default, with a decorative dot + readable "logged in" text', () => {
    expect(HTML).toMatch(/<span class="toc-loggedin" id="torii-loggedin-badge">/);
    expect(HTML).toMatch(/<span class="toc-loggedin-dot" aria-hidden="true"><\/span>logged in/);
    expect(HTML).toMatch(/<span class="toc-owner-name" id="torii-owner-name"/);
    // Hidden by default in CSS — only .show reveals it (no flicker before login).
    expect(HTML).toMatch(/\.toc-loggedin\s*\{[^}]*display:\s*none/);
    expect(HTML).toMatch(/\.toc-loggedin\.show\s*\{[^}]*display:\s*inline-flex/);
    // Color is not the only signal: the text "logged in" is always present.
    expect(HTML).toMatch(/logged in/);
  });
});
