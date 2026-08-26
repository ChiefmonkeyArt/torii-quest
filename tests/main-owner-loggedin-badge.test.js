// tests/main-owner-loggedin-badge.test.js — regression lock for the
// v0.2.705-alpha (ADR-0070) / v0.2.705-alpha (ADR-0071) admin-only logged-in
// indicator on the top-left owner caption. When the logged-in viewer IS the
// configured instance owner, the caption becomes a greeting:
//     Welcome <owner name>,
//     <green dot> you are logged in
// Every other visitor sees the standard "This torii belongs to / <name>" caption.
// The badge must:
//   - be hidden by default (never flashes before login confirms),
//   - show ONLY when the logged-in viewer IS the configured instance owner,
//   - never reveal the owner's pubkey,
//   - leave the owner's name visible to every (non-admin) visitor.
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

describe('main.js admin-only "logged in" greeting wiring (v0.2.705 / ADR-0071)', () => {
  const labelStart = MAIN.indexOf('function _refreshOwnerLabel()');
  expect(labelStart).toBeGreaterThan(-1);
  const labelBody = MAIN.slice(labelStart, labelStart + 2100);

  it('swaps the caption line 1 to the admin greeting "Welcome <name>," only when isOwner', () => {
    expect(labelBody).toMatch(/getElementById\(\s*['"]torii-owner-line1['"]\s*\)/);
    expect(labelBody).toMatch(/line1\.textContent\s*=\s*['"]Welcome\s*['"]\s*\+\s*label\s*\+\s*['"],['"]\s*;/);
    expect(labelBody).toMatch(/line1\.classList\.add\(\s*['"]toc-greet['"]\s*\)/);
    expect(labelBody).toMatch(/line1\.textContent\s*=\s*['"]This torii belongs to['"]\s*;/);
    expect(labelBody).toMatch(/line1\.classList\.remove\(\s*['"]toc-greet['"]\s*\)/);
  });

  it('hides the name span for the admin (name moved into the greeting) and shows it for everyone else', () => {
    expect(labelBody).toMatch(/getElementById\(\s*['"]torii-owner-name['"]\s*\)/);
    expect(labelBody).toMatch(/isOwner\)\s*\{\s*nameEl\.hidden\s*=\s*true/);
    expect(labelBody).toMatch(/nameEl\.textContent\s*=\s*label/);
    expect(labelBody).toMatch(/nameEl\.title\s*=\s*label/);
  });

  it('toggles the badge .show class from isAdminOperator(viewer, adminPubkey) — admin-only', () => {
    expect(labelBody).toMatch(/getElementById\(\s*['"]torii-loggedin-badge['"]\s*\)/);
    expect(labelBody).toMatch(/isAdminOperator\(\s*state\.nostrPubkey[^)]*\)/);
    expect(labelBody).toMatch(/classList\.toggle\(\s*['"]show['"]\s*,\s*isOwner\s*\)/);
  });

  it('never writes the pubkey into a DOM attribute of the badge or greeting (no pubkey leak)', () => {
    expect(labelBody).not.toMatch(/badge\.(innerHTML|textContent|title)\s*=/i);
  });

  it('does not touch unrelated wiring (no scope creep into update/heartbeat/menu)', () => {
    expect(labelBody).not.toMatch(/update-now|triggerUpdate|onUpdateNow|publishHeartbeat/i);
  });

  it('index.html ships the badge hidden by default with sentence-case "you are logged in" text + a decorative dot', () => {
    expect(HTML).toMatch(/<span class="toc-loggedin" id="torii-loggedin-badge">/);
    expect(HTML).toMatch(/<span class="toc-loggedin-dot" aria-hidden="true"><\/span>you are logged in/);
    expect(HTML).toMatch(/<span class="toc-owner-name" id="torii-owner-name"/);
    expect(HTML).toMatch(/<div class="toc-line1" id="torii-owner-line1">/);
    // Hidden by default in CSS — only .show reveals it (no flicker before login).
    expect(HTML).toMatch(/\.toc-loggedin\s*\{[^}]*display:\s*none/);
    expect(HTML).toMatch(/\.toc-loggedin\.show\s*\{[^}]*display:\s*inline-flex/);
    // Sentence-case: the badge text is NOT uppercased (user quoted exact case).
    expect(HTML).toMatch(/\.toc-loggedin\s*\{[^}]*text-transform:\s*none/);
    // The greeting override is sentence-case too.
    expect(HTML).toMatch(/\.toc-line1\.toc-greet\s*\{[^}]*text-transform:\s*none/);
    // Color is not the only signal: the literal "you are logged in" text ships in the DOM.
    expect(HTML).toMatch(/you are logged in/);
  });
});
