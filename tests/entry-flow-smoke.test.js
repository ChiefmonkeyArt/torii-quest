// tests/entry-flow-smoke.test.js — entry-flow binding contract (v0.2.227).
//
// Companion to sw-app-shell.test.js. That suite freezes the SERVICE-WORKER side of the
// v0.2.226 "dead login / ENTER ARENA button" blocker (no stale HTML-shell precache, cache
// version tracks the app, network-first HTML/JS, self-heal reload). THIS suite freezes the
// SOURCE side: that the two title-screen entry buttons actually exist in the shipped
// index.html AND are looked up + click-bound in main.js. A silent id rename / typo on
// EITHER side would unbind a button (it renders but does nothing) without failing any other
// test — exactly the "buttons don't respond" symptom, just from a different cause. Pure file
// reads, no DOM / network.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const HTML = readFileSync(join(ROOT, 'index.html'), 'utf8');
const MAIN = readFileSync(join(ROOT, 'src/main.js'), 'utf8');
const HUD  = readFileSync(join(ROOT, 'src/hud.js'), 'utf8');

// The title-screen entry buttons: DOM id ↔ the main.js handle each is assigned to.
const ENTRY_BUTTONS = [
  { id: 'btn-enter', handle: 'elEnterBtn', label: 'ENTER ARENA' },
  { id: 'btn-nostr-centre', handle: 'elNostrCentreBtn', label: 'LOGIN WITH NOSTR' },
];

describe('entry-flow smoke — title-screen buttons exist and are bound (regression)', () => {
  for (const { id, label } of ENTRY_BUTTONS) {
    it(`index.html declares the ${label} button (id="${id}")`, () => {
      expect(HTML).toContain(`id="${id}"`);
    });
  }

  for (const { id, handle, label } of ENTRY_BUTTONS) {
    it(`main.js resolves #${id} into ${handle} (${label})`, () => {
      const re = new RegExp(`${handle}\\s*=\\s*document\\.getElementById\\(\\s*['"]${id}['"]\\s*\\)`);
      expect(MAIN).toMatch(re);
    });

    it(`main.js binds a click handler to ${handle} (${label} responds)`, () => {
      // Tolerate optional-chaining (`handle?.addEventListener`) and whitespace.
      const re = new RegExp(`${handle}\\??\\.addEventListener\\(\\s*['"]click['"]`);
      expect(MAIN).toMatch(re);
    });
  }

  it('the ENTER handler is gated to the title screen (no fire mid-game)', () => {
    // The click handler must early-return when not on the title screen, so a stray
    // click can never re-bootstrap the arena from PLAYING/HOME.
    expect(MAIN).toMatch(/elEnterBtn\??\.addEventListener\(\s*['"]click['"]/);
    expect(MAIN).toMatch(/if\s*\(\s*!isTitle\(\)\s*\)\s*return/);
  });
});

// v0.2.228: the v0.2.226 SW fix made the buttons reachable, but a cloud/no-extension
// smoke still showed silent no-ops: (a) login feedback was written to #nostr-status,
// an element that never existed in index.html, so it was dropped; (b) the ENTER catch
// only console.error'd and reset the button, and the model-load steps lived OUTSIDE the
// try (a throw there froze the button on "LOADING PHYSICS…"). These contracts freeze the
// "no silent no-op" guarantee: a visible status line exists, and both buttons write to it.
describe('entry-flow no-silent-noop — visible feedback on every click (v0.2.228 regression)', () => {
  it('index.html declares the visible #entry-status feedback line', () => {
    expect(HTML).toMatch(/id="entry-status"/);
  });

  it('main.js routes feedback through the real #entry-status element (not the dead #nostr-status)', () => {
    expect(MAIN).toMatch(/getElementById\(\s*['"]entry-status['"]\s*\)/);
    // The old null target must be gone — writing to it was the silent-login bug.
    expect(MAIN).not.toMatch(/getElementById\(\s*['"]nostr-status['"]\s*\)/);
  });

  it('the ENTER catch surfaces a user-facing message AND re-enables the button (no silent reset)', () => {
    // Grab the ENTER click handler body up to the LOGIN handler that follows it.
    const block = MAIN.slice(
      MAIN.indexOf("elEnterBtn?.addEventListener('click'"),
      MAIN.indexOf('_doNostrLogin'),
    );
    expect(block).toMatch(/catch\s*\(/);
    expect(block).toMatch(/showEntryStatus\(/);          // visible message, not just console.error
    expect(block).toMatch(/elEnterBtn\.disabled\s*=\s*false/); // button recovers for a retry
  });

  it('the LOGIN handler shows its result on the visible status line', () => {
    const block = MAIN.slice(MAIN.indexOf('async function _doNostrLogin'));
    expect(block).toMatch(/showEntryStatus\(\s*result\s*\)/);
  });
});

// v0.2.229: the v0.2.228 #entry-status line shipped, but a cloud/no-extension smoke
// STILL saw no visible ENTER/LOGIN feedback, plus "YOU DIED"/"Respawning..." leaking
// into the accessibility tree on the TITLE screen. Two residual causes: (a) the ENTER
// click CLEARED the status line and relied on the disabled-button text, so a stalled
// (never-settling) Rapier WASM bootstrap looked like a silent no-op with no status;
// (b) #death-msg is always in the DOM with no aria-hidden, so its text reached AT/smoke
// before any arena entry; (c) a THROW from nostrLogin() left the interim "Connecting…"
// stuck. These contracts freeze the fixes.
describe('entry-flow visibility — immediate feedback + clean a11y tree (v0.2.229 regression)', () => {
  it('the ENTER click shows an IMMEDIATE visible status (not a clear) before awaiting bootstrap', () => {
    const block = MAIN.slice(
      MAIN.indexOf("elEnterBtn?.addEventListener('click'"),
      MAIN.indexOf('_doNostrLogin'),
    );
    // A non-empty message must be set before the `try`/`await initPhysics()` so a
    // stalled bootstrap is never an apparent silent no-op.
    const beforeTry = block.slice(0, block.indexOf('try {'));
    expect(beforeTry).toMatch(/showEntryStatus\(\s*['"][^'"]+['"]\s*\)/);
  });

  it('#death-msg is aria-hidden by default in index.html (no YOU DIED on the title a11y tree)', () => {
    expect(HTML).toMatch(/id="death-msg"[^>]*aria-hidden="true"/);
  });

  it('hud.js toggles aria-hidden in lockstep with the .show class', () => {
    const block = HUD.slice(HUD.indexOf('PLAYER_KILLED'), HUD.indexOf('}', HUD.indexOf('PLAYER_RESPAWN')));
    expect(block).toMatch(/classList\.add\(\s*['"]show['"]\s*\)[\s\S]*setAttribute\(\s*['"]aria-hidden['"]\s*,\s*['"]false['"]\s*\)/);
    expect(block).toMatch(/classList\.remove\(\s*['"]show['"]\s*\)[\s\S]*setAttribute\(\s*['"]aria-hidden['"]\s*,\s*['"]true['"]\s*\)/);
  });

  it('the LOGIN handler guards the nostrLogin await so a throw still surfaces a message', () => {
    const block = MAIN.slice(MAIN.indexOf('async function _doNostrLogin'), MAIN.indexOf('elNostrCentreBtn?.addEventListener'));
    expect(block).toMatch(/try\s*\{/);
    expect(block).toMatch(/catch\s*\(/);
    // The catch path must show a visible message, not just console.error.
    const catchPart = block.slice(block.indexOf('catch'));
    expect(catchPart).toMatch(/showEntryStatus\(/);
  });
});

// v0.2.230: even with the v0.2.228/229 source fixes, the LIVE site was STILL a complete
// silent no-op on both buttons — the symptom of the module bundle never binding its
// handlers at all (a stale SW shell 404'ing the hashed bundle, OR a top-level throw such
// as WebGL/renderer init failing in a headless cloud browser, which aborts main.js before
// the listeners attach). The static version label renders either way, so the page looks
// alive while every button is dead. These contracts freeze a bundle-INDEPENDENT inline
// bootstrap in index.html that wires both buttons regardless of the module, plus the
// readiness flags the module sets so the inline path stands down once the real handlers
// are bound. The inline script is attribute-less; sw-app-shell.test.js separately proves
// the CSP sha256 still matches it.
describe('entry-flow runtime proof — inline bundle-independent bootstrap (v0.2.230 regression)', () => {
  // The last attribute-less <script> is the inline bootstrap + SW registration.
  function inlineScript() {
    const re = /<script>([\s\S]*?)<\/script>/g;
    let m, last = null;
    while ((m = re.exec(HTML)) !== null) last = m[1];
    return last || '';
  }

  it('the inline script binds a click handler to BOTH entry buttons (works even if the bundle is dead)', () => {
    const s = inlineScript();
    expect(s).toMatch(/getElementById\(\s*['"]btn-enter['"]\s*\)/);
    expect(s).toMatch(/getElementById\(\s*['"]btn-nostr-centre['"]\s*\)/);
    // Two inline click bindings (ENTER + LOGIN), independent of the module bundle.
    expect((s.match(/addEventListener\(\s*['"]click['"]/g) || []).length).toBeGreaterThanOrEqual(2);
  });

  it('the inline LOGIN fallback surfaces the no-provider case visibly (no window.nostr)', () => {
    const s = inlineScript();
    expect(s).toMatch(/window\.nostr/);
    expect(s).toMatch(/NIP-07 extension not found/);
  });

  it('the inline handlers stand down once the module sets its readiness flags (no double-handling)', () => {
    const s = inlineScript();
    expect(s).toMatch(/window\.__toriiEnterReady/);
    expect(s).toMatch(/window\.__toriiLoginReady/);
  });

  it('main.js sets the readiness flags AFTER binding the real handlers', () => {
    // Each flag must be assigned true, and only after its addEventListener call.
    expect(MAIN).toMatch(/window\.__toriiEnterReady\s*=\s*true/);
    expect(MAIN).toMatch(/window\.__toriiLoginReady\s*=\s*true/);
    const enterBind = MAIN.indexOf("elEnterBtn?.addEventListener('click'");
    const enterFlag = MAIN.indexOf('window.__toriiEnterReady = true');
    expect(enterBind).toBeGreaterThanOrEqual(0);
    expect(enterFlag).toBeGreaterThan(enterBind);
    const loginBind = MAIN.indexOf("elNostrCentreBtn?.addEventListener('click'");
    const loginFlag = MAIN.indexOf('window.__toriiLoginReady = true');
    expect(loginBind).toBeGreaterThanOrEqual(0);
    expect(loginFlag).toBeGreaterThan(loginBind);
  });

  it('the inline bootstrap uses textContent, never innerHTML (no injection surface)', () => {
    const s = inlineScript();
    expect(s).toMatch(/textContent/);
    expect(s).not.toMatch(/innerHTML/);
  });
});
