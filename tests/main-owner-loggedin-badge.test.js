// tests/main-owner-loggedin-badge.test.js — regression lock for the
// v0.2.704-alpha (ADR-0070) / v0.2.705-alpha (ADR-0071) / v0.2.706-alpha (ADR-0072) admin-only logged-in
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

describe('main.js admin-only "logged in" greeting wiring (v0.2.706 / ADR-0071 + ADR-0072)', () => {
  const labelStart = MAIN.indexOf('function _refreshOwnerLabel()');
  expect(labelStart).toBeGreaterThan(-1);
  const labelBody = MAIN.slice(labelStart, labelStart + 2800);

  it('builds the admin greeting "Welcome <name>," with ONLY the name in an orange span', () => {
    expect(labelBody).toMatch(/getElementById\(\s*['"]torii-owner-line1['"]\s*\)/);
    expect(labelBody).toMatch(/line1\.classList\.add\(\s*['"]toc-greet['"]\s*\)/);
    // Built via DOM API (not innerHTML): "Welcome " + name + "," as spans, name alone orange.
    expect(labelBody).toMatch(/className\s*=\s*['"]toc-dim['"]\s*;\s*pre\.textContent\s*=\s*['"]Welcome ['"]\s*;/);
    expect(labelBody).toMatch(/className\s*=\s*['"]toc-name['"]\s*;\s*nm\.textContent\s*=\s*label/);
    expect(labelBody).toMatch(/line1\.append\(\s*pre,\s*nm,\s*comma\s*\)/);
    // Non-admin restores the plain label.
    expect(labelBody).toMatch(/line1\.classList\.remove\(\s*['"]toc-greet['"]\s*\)/);
    expect(labelBody).toMatch(/replaceChildren\(\s*document\.createTextNode\(\s*['"]This torii belongs to['"]\s*\)\s*\)/);
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

  it('index.html ships the badge hidden by default, sentence-case, with the color split (name orange / logged in green)', () => {
    expect(HTML).toMatch(/<span class="toc-loggedin" id="torii-loggedin-badge">/);
    // Badge text split into neutral "you are " + green "logged in".
    expect(HTML).toMatch(/<span class="toc-dim">you are <\/span><span class="toc-on">logged in<\/span>/);
    expect(HTML).toMatch(/<span class="toc-owner-name" id="torii-owner-name"/);
    expect(HTML).toMatch(/<div class="toc-line1" id="torii-owner-line1">/);
    // Hidden by default in CSS — only .show reveals it (no flicker before login).
    expect(HTML).toMatch(/\.toc-loggedin\s*\{[^}]*display:\s*none/);
    expect(HTML).toMatch(/\.toc-loggedin\.show\s*\{[^}]*display:\s*inline-flex/);
    // Sentence-case: the badge text is NOT uppercased.
    expect(HTML).toMatch(/\.toc-loggedin\s*\{[^}]*text-transform:\s*none/);
    // Greeting override is sentence-case too.
    expect(HTML).toMatch(/\.toc-line1\.toc-greet\s*\{[^}]*text-transform:\s*none/);
    // v0.2.706 color split: only the name is orange; "Welcome"/"you are" neutral; "logged in" green.
    expect(HTML).toMatch(/\.toc-name\s*\{[^}]*color:\s*#f7931a/);
    expect(HTML).toMatch(/\.toc-dim\s*\{[^}]*color:\s*#d8c3ac/);
    expect(HTML).toMatch(/\.toc-on\s*\{[^}]*color:\s*#6DAA45/);
    // .toc-greet must NOT set orange — only the .toc-name span is orange.
    const greetRule = HTML.match(/\.toc-line1\.toc-greet\s*\{[^}]*\}/);
    expect(greetRule).toBeTruthy();
    expect(greetRule[0]).not.toMatch(/color:\s*#f7931a/);
  });
});
